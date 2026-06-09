import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { initDB } from './config/db.js';
import shareRoutes from './routes/shareRoutes.js';
import { startCleanupWorker } from './services/cleanupService.js';
import { initSocket } from './services/socketService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable trust proxy dynamically (defaults to 'loopback' for security)
const trustProxyVal = process.env.TRUST_PROXY || 'loopback';
const parsedTrustProxy = trustProxyVal === 'true' ? true : (trustProxyVal === 'false' ? false : trustProxyVal);
app.set('trust proxy', parsedTrustProxy);

// Configure CORS - Allow all origins in development or specify domain in production
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routing
app.use('/api/share', shareRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

const server = createServer(app);
initSocket(server);

// Startup Routine
const startServer = async () => {
  try {
    // 1. Initialize PostgreSQL tables
    await initDB();
    
    // 2. Start Expired Uploads Clean-up Cron Worker (runs every 60 seconds)
    startCleanupWorker(60000);
    
    // 3. Listen to Port
    server.listen(PORT, () => {
      console.log(`nokkinokk Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Fatal: Failed to start nokkinokk server:', err);
    process.exit(1);
  }
};

startServer();
