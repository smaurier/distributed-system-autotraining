import express, { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { correlationMiddleware } from './lib/correlation.js';
import { authMiddleware } from './lib/auth.js';
import { rateLimiter } from './lib/rate-limiter.js';
import { proxyRoutes } from './routes/proxy.js';
import type { HealthStatus, ApiResponse } from '../../shared/types/index.js';

const logger = pino({
  name: 'api-gateway',
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const startTime = Date.now();

// Body parsing
app.use(express.json());

// Correlation ID middleware (must come first)
app.use(correlationMiddleware);

// Rate limiting middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  // Use client IP or API key as the rate limit key
  const key = (req.headers['x-api-key'] as string) || req.ip || req.socket.remoteAddress || 'unknown';
  const result = rateLimiter.consume(key);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
  res.setHeader('X-RateLimit-Limit', '100');

  if (!result.allowed) {
    res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000).toString());
    const correlationId = req.headers['x-correlation-id'] as string;
    const response: ApiResponse<null> = {
      success: false,
      error: 'Too many requests. Please try again later.',
      correlationId,
    };
    res.status(429).json(response);
    return;
  }

  next();
});

// Authentication middleware
app.use('/api', authMiddleware);

// Gateway health check (direct, not proxied)
app.get('/health', (_req: Request, res: Response) => {
  const health: HealthStatus = {
    status: 'healthy',
    service: 'api-gateway',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks: {
      server: true,
      memory: process.memoryUsage().heapUsed < 512 * 1024 * 1024,
    },
  };
  res.json(health);
});

// API routes (proxy to downstream services)
app.use('/api', proxyRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const response: ApiResponse<null> = {
    success: false,
    error: `Route ${req.method} ${req.path} not found. API routes are prefixed with /api`,
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

// Start cleanup for rate limiter
rateLimiter.startCleanup();

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API Gateway started');
  logger.info('Routes: /health, /api/orders, /api/payments, /api/inventory, /api/notifications');
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  rateLimiter.stopCleanup();
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
