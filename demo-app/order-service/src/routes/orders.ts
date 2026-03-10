import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { orderService } from '../services/order.service.js';
import { outbox } from '../lib/outbox.js';
import type { ApiResponse, Order } from '../../../shared/types/index.js';

const router = Router();

// Validation schemas
const createOrderSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'productId is required'),
        quantity: z.number().int().positive('quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one item is required'),
});

const cancelOrderSchema = z.object({
  reason: z.string().min(1, 'reason is required'),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'paid', 'shipped', 'cancelled', 'refunded']),
});

// POST /orders - Create a new order
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = createOrderSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const { userId, items } = validation.data;
    const order = await orderService.createOrder(userId, items, correlationId);

    const response: ApiResponse<{ order: Order }> = {
      success: true,
      data: { order },
      correlationId,
    };
    res.status(201).json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(500).json(response);
  }
});

// GET /orders - List all orders
router.get('/', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const userId = req.query.userId as string | undefined;

  const orders = orderService.getOrders(userId);
  const response: ApiResponse<{ orders: Order[] }> = {
    success: true,
    data: { orders },
    correlationId,
  };
  res.json(response);
});

// GET /orders/:id - Get order by ID
router.get('/:id', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const order = orderService.getOrder(req.params.id);

  if (!order) {
    const response: ApiResponse<null> = {
      success: false,
      error: `Order ${req.params.id} not found`,
      correlationId,
    };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse<{ order: Order }> = {
    success: true,
    data: { order },
    correlationId,
  };
  res.json(response);
});

// PATCH /orders/:id/status - Update order status
router.patch('/:id/status', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  const validation = updateStatusSchema.safeParse(req.body);
  if (!validation.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      correlationId,
    };
    res.status(400).json(response);
    return;
  }

  try {
    const order = orderService.updateOrderStatus(req.params.id, validation.data.status);
    const response: ApiResponse<{ order: Order }> = {
      success: true,
      data: { order },
      correlationId,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(404).json(response);
  }
});

// POST /orders/:id/cancel - Cancel an order
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  const validation = cancelOrderSchema.safeParse(req.body);
  if (!validation.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      correlationId,
    };
    res.status(400).json(response);
    return;
  }

  try {
    const order = await orderService.cancelOrder(req.params.id, validation.data.reason, correlationId);
    const response: ApiResponse<{ order: Order }> = {
      success: true,
      data: { order },
      correlationId,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(400).json(response);
  }
});

// GET /orders/debug/outbox - View outbox entries (debug endpoint)
router.get('/debug/outbox', (_req: Request, res: Response) => {
  const correlationId = _req.headers['x-correlation-id'] as string;
  const response: ApiResponse<{ entries: unknown[]; stats: Record<string, number> }> = {
    success: true,
    data: {
      entries: outbox.getEntries(),
      stats: outbox.getStats(),
    },
    correlationId,
  };
  res.json(response);
});

// GET /orders/debug/circuit-breakers - View circuit breaker stats
router.get('/debug/circuit-breakers', (_req: Request, res: Response) => {
  const correlationId = _req.headers['x-correlation-id'] as string;
  const response: ApiResponse<Record<string, unknown>> = {
    success: true,
    data: orderService.getCircuitBreakerStats(),
    correlationId,
  };
  res.json(response);
});

export { router as orderRoutes };
