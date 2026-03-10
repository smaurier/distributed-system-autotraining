import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

const logger = pino({ name: 'correlation' });

const CORRELATION_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Generate a new correlation ID.
 * Uses UUID v4 for uniqueness across services.
 */
export function generateCorrelationId(): string {
  return uuidv4();
}

/**
 * Extract or generate a correlation ID from the incoming request.
 * If the request already has a correlation ID header, use it.
 * Otherwise, generate a new one.
 */
export function extractCorrelationId(req: Request): string {
  const existing = req.headers[CORRELATION_HEADER] as string | undefined;
  if (existing && existing.length > 0) {
    return existing;
  }
  return generateCorrelationId();
}

/**
 * Express middleware that ensures every request has a correlation ID.
 * Sets it on the request headers and the response headers.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = extractCorrelationId(req);
  const requestId = uuidv4();

  // Set on request headers (for downstream propagation)
  req.headers[CORRELATION_HEADER] = correlationId;
  req.headers[REQUEST_ID_HEADER] = requestId;

  // Set on response headers (for client tracing)
  res.setHeader(CORRELATION_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);

  logger.info(
    {
      correlationId,
      requestId,
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.socket.remoteAddress,
    },
    'Request received at gateway'
  );

  next();
}

/**
 * Build headers object for proxying requests to downstream services.
 * Propagates correlation ID and other tracing headers.
 */
export function buildProxyHeaders(req: Request): Record<string, string> {
  const correlationId = req.headers[CORRELATION_HEADER] as string;
  const requestId = req.headers[REQUEST_ID_HEADER] as string;

  const headers: Record<string, string> = {
    [CORRELATION_HEADER]: correlationId,
    [REQUEST_ID_HEADER]: requestId,
    'content-type': 'application/json',
  };

  // Forward authorization if present
  const auth = req.headers.authorization;
  if (auth) {
    headers.authorization = auth;
  }

  return headers;
}
