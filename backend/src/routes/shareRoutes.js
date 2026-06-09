import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import crypto from 'crypto';
import { query } from '../config/db.js';
import redis from '../config/redis.js';
import upload from '../middleware/upload.js';
import { pinRateLimiter, uploadRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Helper to generate a unique 5-character secure alphanumeric PIN
const generateUniquePin = async () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters (excluding confusing O, 0, I, 1)
  for (let attempt = 0; attempt < 15; attempt++) {
    let pin = '';
    for (let i = 0; i < 5; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      pin += chars[randomIndex];
    }
    
    // Check Redis
    const cached = await redis.get(`pin:${pin}`);
    if (cached) continue;
    
    // Check Database
    const dbCheck = await query('SELECT 1 FROM uploads WHERE pin = $1', [pin]);
    if (dbCheck.rows.length === 0) {
      return pin;
    }
  }
  throw new Error('Collision ceiling hit: Failed to generate a unique PIN');
};

// POST /api/share/upload
router.post('/upload', uploadRateLimiter, upload.array('files', 10), async (req, res) => {
  try {
    const { type, content, url, expiry } = req.body;
    
    // Validate type
    if (!['files', 'text', 'link'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid sharing type.' });
    }

    // Validate inputs
    if (type === 'text' && (!content || content.trim() === '')) {
      return res.status(400).json({ success: false, message: 'Text content is required.' });
    }
    if (type === 'link') {
      if (!url || url.trim() === '') {
        return res.status(400).json({ success: false, message: 'Link URL is required.' });
      }
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ success: false, message: 'Invalid URL protocol. Only HTTP and HTTPS links are allowed.' });
        }
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Invalid URL format.' });
      }
    }
    if (type === 'files' && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ success: false, message: 'No files uploaded.' });
    }

    // Calculate expiration timestamp (hardcoded to exactly 2 minutes)
    const expiryMinutes = 2;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60000);
    const ttlSeconds = expiryMinutes * 60;

    // Generate unique 5-digit PIN
    const pin = await generateUniquePin();
    const uploadId = uuidv4();

    // Begin DB transaction
    await query('BEGIN');

    // Insert to uploads table
    await query(
      `INSERT INTO uploads (id, pin, type, expires_at) VALUES ($1, $2, $3, $4)`,
      [uploadId, pin, type, expiresAt]
    );

    if (type === 'text') {
      await query(
        `INSERT INTO upload_texts (id, upload_id, content) VALUES ($1, $2, $3)`,
        [uuidv4(), uploadId, content]
      );
    } else if (type === 'link') {
      await query(
        `INSERT INTO upload_links (id, upload_id, url) VALUES ($1, $2, $3)`,
        [uuidv4(), uploadId, url]
      );
    } else if (type === 'files') {
      for (const file of req.files) {
        await query(
          `INSERT INTO upload_files (id, upload_id, original_name, stored_name, mime_type, file_size) VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), uploadId, file.originalname, file.filename, file.mimetype, file.size]
        );
      }
    }

    await query('COMMIT');

    // Cache PIN to UploadId mapping in Redis with expiration
    await redis.set(`pin:${pin}`, uploadId, 'EX', ttlSeconds);

    res.status(201).json({
      success: true,
      pin,
      expiresAt: expiresAt.toISOString(),
      type,
    });

  } catch (err) {
    await query('ROLLBACK');
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: 'Server upload handling failed.' });
  }
});

// GET /api/share/retrieve/:pin
router.get('/retrieve/:pin', pinRateLimiter, async (req, res) => {
  const { pin } = req.params;
  
  if (!pin || pin.trim().length !== 5) {
    return res.status(400).json({ success: false, message: 'Invalid PIN structure.' });
  }

  try {
    // 0. Check if it's a P2P session first
    const p2pSessionData = await redis.get(`p2p:pin:${pin}`);
    if (p2pSessionData) {
      const session = JSON.parse(p2pSessionData);
      return res.json({
        success: true,
        type: 'p2p',
        expiresAt: session.expiresAt,
        data: { files: session.files }
      });
    }

    // 1. Look up in Redis
    let uploadId = await redis.get(`pin:${pin}`);
    
    // 2. Database Fallback (if Redis restarted or key evicted before PG deleted it)
    let uploadRecord;
    if (uploadId) {
      const dbResult = await query(
        'SELECT id, type, expires_at FROM uploads WHERE id = $1 AND expires_at > NOW()',
        [uploadId]
      );
      if (dbResult.rows.length > 0) {
        uploadRecord = dbResult.rows[0];
      }
    } else {
      const dbResult = await query(
        'SELECT id, type, expires_at FROM uploads WHERE pin = $1 AND expires_at > NOW()',
        [pin]
      );
      if (dbResult.rows.length > 0) {
        uploadRecord = dbResult.rows[0];
        uploadId = uploadRecord.id;
        
        // Restore to Redis
        const ttlSeconds = Math.max(0, Math.floor((new Date(uploadRecord.expires_at).getTime() - Date.now()) / 1000));
        if (ttlSeconds > 0) {
          await redis.set(`pin:${pin}`, uploadId, 'EX', ttlSeconds);
        }
      }
    }

    if (!uploadRecord) {
      return res.status(404).json({ success: false, message: 'Invalid or expired PIN.' });
    }

    // 3. Fetch content according to type
    let data = {};
    if (uploadRecord.type === 'text') {
      const textRes = await query('SELECT content FROM upload_texts WHERE upload_id = $1', [uploadId]);
      data = textRes.rows[0] || {};
    } else if (uploadRecord.type === 'link') {
      const linkRes = await query('SELECT url FROM upload_links WHERE upload_id = $1', [uploadId]);
      data = linkRes.rows[0] || {};
    } else if (uploadRecord.type === 'files') {
      const filesRes = await query(
        'SELECT id, original_name, mime_type, file_size FROM upload_files WHERE upload_id = $1',
        [uploadId]
      );
      data = { files: filesRes.rows };
    }

    res.json({
      success: true,
      type: uploadRecord.type,
      expiresAt: uploadRecord.expires_at,
      data,
    });

  } catch (err) {
    console.error('Retrieve error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving record.' });
  }
});

// GET /api/share/download/:fileId
router.get('/download/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const { pin } = req.query;

  if (!pin || pin.trim().length !== 5) {
    return res.status(400).send('PIN is required for download.');
  }

  try {
    // Fetch file record and join with uploads to check PIN and expiration
    const fileResult = await query(
      `SELECT f.upload_id, f.original_name, f.stored_name, u.pin, u.expires_at 
       FROM upload_files f
       JOIN uploads u ON f.upload_id = u.id
       WHERE f.id = $1`,
      [fileId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).send('File not found.');
    }

    const fileRecord = fileResult.rows[0];

    // Check PIN matching (case-insensitive)
    if (fileRecord.pin.toUpperCase() !== pin.toUpperCase()) {
      return res.status(403).send('Access denied. Invalid PIN.');
    }

    // Check expiration of the upload
    if (new Date(fileRecord.expires_at) <= new Date()) {
      return res.status(410).send('File share link has expired.');
    }

    const filePath = path.join(UPLOAD_DIR, fileRecord.stored_name);
    res.download(filePath, fileRecord.original_name);

  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Error downloading file.');
  }
});

export default router;
