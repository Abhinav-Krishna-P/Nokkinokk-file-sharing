import fs from 'fs/promises';
import path from 'path';
import { query } from '../config/db.js';
import redis from '../config/redis.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export const startCleanupWorker = (intervalMs = 60000) => {
  console.log(`Starting cleanup worker (interval: ${intervalMs / 1000}s)...`);
  
  setInterval(async () => {
    try {
      // Find expired uploads
      const expiredResult = await query(
        `SELECT id, pin FROM uploads WHERE expires_at <= NOW()`
      );
      
      if (expiredResult.rows.length === 0) {
        return;
      }
      
      console.log(`Cleanup Worker: Found ${expiredResult.rows.length} expired uploads.`);
      
      for (const row of expiredResult.rows) {
        const uploadId = row.id;
        const pin = row.pin;
        
        // Find associated files to delete from disk
        const filesResult = await query(
          `SELECT stored_name FROM upload_files WHERE upload_id = $1`,
          [uploadId]
        );
        
        for (const fileRow of filesResult.rows) {
          const filePath = path.join(UPLOAD_DIR, fileRow.stored_name);
          try {
            await fs.unlink(filePath);
            console.log(`Cleanup Worker: Deleted file ${filePath}`);
          } catch (fileErr) {
            if (fileErr.code === 'ENOENT') {
              console.warn(`Cleanup Worker: File ${filePath} was already deleted or not found.`);
            } else {
              console.error(`Cleanup Worker: Failed to delete file ${filePath}:`, fileErr);
            }
          }
        }
        
        // Remove from PostgreSQL (ON DELETE CASCADE will clear files, texts, links tables)
        await query(`DELETE FROM uploads WHERE id = $1`, [uploadId]);
        console.log(`Cleanup Worker: Cleared upload ID ${uploadId} from database.`);
        
        // Delete pin mapping from Redis
        try {
          await redis.del(`pin:${pin}`);
          console.log(`Cleanup Worker: Cleared Redis pin mapping: ${pin}`);
        } catch (redisErr) {
          console.error(`Cleanup Worker: Failed to delete PIN ${pin} from Redis:`, redisErr);
        }
      }
    } catch (err) {
      console.error('Error during cleanup routine:', err);
    }
  }, intervalMs);
};
