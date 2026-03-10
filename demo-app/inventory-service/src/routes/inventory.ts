import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { inventoryService } from '../services/inventory.service.js';
import type { ApiResponse, Product, StockReservation } from '../../../shared/types/index.js';

const router = Router();

// Validation schemas
const reserveStockSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'productId is required'),
        quantity: z.number().int().positive('quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one item is required'),
});

const releaseStockSchema = z.object({
  reservationId: z.string().optional(),
  orderId: z.string().min(1, 'orderId is required'),
  reason: z.string().optional().default('manual release'),
});

const checkAvailabilitySchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'productId is required'),
        quantity: z.number().int().positive('quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one item is required'),
});

const updateStockSchema = z.object({
  stock: z.number().int().min(0, 'stock must be non-negative'),
});

// POST /inventory/reserve - Reserve stock for an order
router.post('/reserve', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = reserveStockSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const { orderId, items } = validation.data;
    const result = await inventoryService.reserveStock(orderId, items, correlationId);

    const response: ApiResponse<{
      reservation: StockReservation;
      items: { productId: string; quantity: number; price: number }[];
    }> = {
      success: true,
      data: {
        reservation: result.reservation,
        items: result.items,
      },
      correlationId,
    };
    res.status(201).json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(409).json(response);
  }
});

// POST /inventory/release - Release a stock reservation
router.post('/release', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = releaseStockSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const { reservationId, orderId, reason } = validation.data;
    const result = await inventoryService.releaseStock(reservationId, orderId, reason, correlationId);

    const response: ApiResponse<{ reservations: StockReservation[] }> = {
      success: true,
      data: { reservations: result.reservations },
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

// POST /inventory/check-availability - Check stock availability
router.post('/check-availability', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  const validation = checkAvailabilitySchema.safeParse(req.body);
  if (!validation.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      correlationId,
    };
    res.status(400).json(response);
    return;
  }

  const result = inventoryService.checkAvailability(validation.data.items);
  const response: ApiResponse<typeof result> = {
    success: true,
    data: result,
    correlationId,
  };
  res.json(response);
});

// GET /inventory/products - List all products
router.get('/products', (_req: Request, res: Response) => {
  const correlationId = _req.headers['x-correlation-id'] as string;
  const products = inventoryService.getAllProducts();

  const response: ApiResponse<{ products: Product[] }> = {
    success: true,
    data: { products },
    correlationId,
  };
  res.json(response);
});

// GET /inventory/products/:id - Get product by ID
router.get('/products/:id', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const product = inventoryService.getProduct(req.params.id);

  if (!product) {
    const response: ApiResponse<null> = {
      success: false,
      error: `Product ${req.params.id} not found`,
      correlationId,
    };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse<{ product: Product }> = {
    success: true,
    data: { product },
    correlationId,
  };
  res.json(response);
});

// PATCH /inventory/products/:id/stock - Update product stock
router.patch('/products/:id/stock', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  const validation = updateStockSchema.safeParse(req.body);
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
    const product = inventoryService.updateStock(req.params.id, validation.data.stock);
    const response: ApiResponse<{ product: Product }> = {
      success: true,
      data: { product },
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

// GET /inventory/reservations - List all reservations
router.get('/reservations', (_req: Request, res: Response) => {
  const correlationId = _req.headers['x-correlation-id'] as string;
  const reservations = inventoryService.getAllReservations();

  const response: ApiResponse<{ reservations: StockReservation[] }> = {
    success: true,
    data: { reservations },
    correlationId,
  };
  res.json(response);
});

// GET /inventory/reservations/:id - Get reservation by ID
router.get('/reservations/:id', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const reservation = inventoryService.getReservation(req.params.id);

  if (!reservation) {
    const response: ApiResponse<null> = {
      success: false,
      error: `Reservation ${req.params.id} not found`,
      correlationId,
    };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse<{ reservation: StockReservation }> = {
    success: true,
    data: { reservation },
    correlationId,
  };
  res.json(response);
});

export { router as inventoryRoutes };
