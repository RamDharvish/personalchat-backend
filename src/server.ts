import http from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { initializeSocket } from './socket/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Production HTTP Security Headers via Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

// Open CORS Configuration (Accepts and allows all frontend origins)
app.use(
  cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '64kb' })); // Restrict JSON payload size

// Lightweight Health Check Endpoint (Safe for Render / orchestrator probes)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
  });
});

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global Error Handler (Hides stack traces from clients)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const httpServer = http.createServer(app);

// Initialize Socket.IO
initializeSocket(httpServer);

// Bind server to 0.0.0.0 and environment-provided PORT
httpServer.listen(PORT, HOST, () => {
  console.log(`[PersonalChat Server] Running at http://${HOST}:${PORT}`);
  console.log(`[PersonalChat Server] Health check available at http://${HOST}:${PORT}/health`);
});

// Graceful Shutdown for SIGTERM / SIGINT
const handleGracefulShutdown = (signal: string) => {
  console.log(`[PersonalChat Server] Received ${signal}. Closing server gracefully...`);
  httpServer.close(() => {
    console.log('[PersonalChat Server] Server closed cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[PersonalChat Server] Forcing process termination after timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
