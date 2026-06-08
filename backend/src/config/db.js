import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Connection config supporting individual params or a single connection URI
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'nokkinokk'}`,
});

export const query = (text, params) => pool.query(text, params);

export const initDB = async () => {
  const client = await pool.connect();
  try {
    console.log('Initializing database tables...');
    
    // Create Uploads table
    await client.query(`
      CREATE TABLE IF NOT EXISTS uploads (
        id VARCHAR(36) PRIMARY KEY,
        pin VARCHAR(10) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      );
    `);

    // Create Files table
    await client.query(`
      CREATE TABLE IF NOT EXISTS upload_files (
        id VARCHAR(36) PRIMARY KEY,
        upload_id VARCHAR(36) NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        original_name VARCHAR(255) NOT NULL,
        stored_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        file_size BIGINT NOT NULL
      );
    `);

    // Create Text Content table
    await client.query(`
      CREATE TABLE IF NOT EXISTS upload_texts (
        id VARCHAR(36) PRIMARY KEY,
        upload_id VARCHAR(36) NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        content TEXT NOT NULL
      );
    `);

    // Create Link Content table
    await client.query(`
      CREATE TABLE IF NOT EXISTS upload_links (
        id VARCHAR(36) PRIMARY KEY,
        upload_id VARCHAR(36) NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        url TEXT NOT NULL
      );
    `);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_uploads_pin ON uploads(pin);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_uploads_expires ON uploads(expires_at);`);

    console.log('Database tables successfully initialized!');
  } catch (err) {
    console.error('Error initializing database tables:', err);
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
