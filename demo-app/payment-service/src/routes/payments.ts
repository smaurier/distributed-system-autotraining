import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service.js';
import type { ApiResponse, Payment } from '../../../shared/types/index.js';

const router = Router();

// Validation schemas
const processPaymentSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
  amount: z.number().positive('amount must be positive'),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required'),
});

const refundPaymentSchema = z.object({
  paymentId: z.string().min(1, 'paymentId is required'),
});

// POST /payments/process - Process a payment
router.post('/process', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = processPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const { orderId, amount, idempotencyKey } = validation.data;
    const result = await paymentService.processPayment(orderId, amount, idempotencyKey, correlationId);

    if (result.payment.status === 'failed') {
      const response: ApiResponse<{ payment: Payment }> = {
        success: false,
        data: { payment: result.payment },
        error: 'Payment processing failed',
        correlationId,
      };
      res.status(402).json(response);
      return;
    }

    const statusCode = result.alreadyProcessed ? 200 : 201;
    const response: ApiResponse<{ payment: Payment; alreadyProcessed: boolean }> = {
      success: true,
      data: {
        payment: result.payment,
        alreadyProcessed: result.alreadyProcessed,
      },
      correlationId,
    };
    res.status(statusCode).json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(500).json(response);
  }
});

// POST /payments/refund - Refund a payment
router.post('/refund', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = refundPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const payment = await paymentService.refundPayment(validation.data.paymentId, correlationId);
    const response: ApiResponse<{ payment: Payment }> = {
      success: true,
      data: { payment },
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

// GET /payments - List all payments
router.get('/', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const orderId = req.query.orderId as string | undefined;

  const payments = orderId
    ? paymentService.getPaymentsByOrder(orderId)
    : paymentService.getAllPayments();

  const response: ApiResponse<{ payments: Payment[] }> = {
    success: true,
    data: { payments },
    correlationId,
  };
  res.json(response);
});

// GET /payments/:id - Get payment by ID
router.get('/:id', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const payment = paymentService.getPayment(req.params.id);

  if (!payment) {
    const response: ApiResponse<null> = {
      success: false,
      error: `Payment ${req.params.id} not found`,
      correlationId,
    };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse<{ payment: Payment }> = {
    success: true,
    data: { payment },
    correlationId,
  };
  res.json(response);
});

export { router as paymentRoutes };
