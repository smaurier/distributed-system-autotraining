import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import type { ApiResponse } from '../../../shared/types/index.js';

const logger = pino({ name: 'auth' });

// Valid API keys (in production, these would come from a database or secret manager)
const VALID_API_KEYS = new Set([
  process.env.API_KEY || 'demo-api-key-2024',
  'test-api-key',
]);

// Paths that don't require authentication
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/health',
]);

/**
 * Simple API key authentication middleware.
 * Checks the x-api-key header or Authorization: Bearer <key> header.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public paths
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  // Skip auth if disabled via env
  if (process.env.AUTH_DISABLED === 'true') {
    next();
    return;
  }

  const correlationId = req.headers['x-correlation-id'] as string;

  // Check x-api-key header
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey && VALID_API_KEYS.has(apiKey)) {
    logger.info({ correlationId, method: req.method, path: req.path }, 'API key authentication successful');
    next();
    return;
  }

  // Check Authorization: Bearer <key> header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      const token = parts[1];
      if (VALID_API_KEYS.has(token)) {
        logger.info(
          { correlationId, method: req.method, path: req.path },
          'Bearer token authentication successful'
        );
        next();
        return;
      }
    }
  }

  // Authentication failed
  logger.warn(
    { correlationId, method: req.method, path: req.path },
    'Authentication failed: invalid or missing API key'
  );

  const response: ApiResponse<null> = {
    success: false,
    error: 'Unauthorized: provide a valid API key via x-api-key header or Authorization: Bearer <key>',
    correlationId,
  };
  res.status(401).json(response);
}

/**
 * Add a new valid API key at runtime (for testing).
 */
export function addApiKey(key: string): void {
  VALID_API_KEYS.add(key);
}

/**
 * Remove an API key at runtime (for testing).
 */
export function removeApiKey(key: string): void {
  VALID_API_KEYS.delete(key);
}
