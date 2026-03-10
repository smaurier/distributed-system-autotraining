import express, { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { paymentRoutes } from './routes/payments.js';
import type { HealthStatus, ApiResponse } from '../../shared/types/index.js';

const logger = pino({
  name: 'payment-service',
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);
const startTime = Date.now();

// Body parsing
app.use(express.json());

// Correlation ID middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.headers['x-correlation-id'] = correlationId;
  logger.info({ correlationId, method: req.method, path: req.path }, 'Incoming request');
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  const health: HealthStatus = {
    status: 'healthy',
    service: 'payment-service',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks: {
      server: true,
      memory: process.memoryUsage().heapUsed < 512 * 1024 * 1024,
    },
  };
  res.json(health);
});

// Routes
app.use('/payments', paymentRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const response: ApiResponse<null> = {
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    correlationId,
  };
  res.status(404).json(response);
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  logger.error({ err, correlationId }, 'Unhandled error');
  const response: ApiResponse<null> = {
    success: false,
    error: err.message || 'Internal server error',
    correlationId,
  };
  res.status(500).json(response);
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Payment service started');
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, logger };
