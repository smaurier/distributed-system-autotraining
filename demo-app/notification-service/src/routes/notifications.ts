import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notification.service.js';
import type { ApiResponse } from '../../../shared/types/index.js';

const router = Router();

// Validation schemas
const sendNotificationSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  type: z.enum(['email', 'sms']),
  subject: z.string().min(1, 'subject is required'),
  body: z.string().min(1, 'body is required'),
});

const processEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().min(1),
  correlationId: z.string().min(1),
  payload: z.unknown(),
});

const processBatchSchema = z.object({
  events: z.array(processEventSchema).min(1, 'At least one event is required'),
});

// POST /notifications/send - Send a notification
router.post('/send', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = sendNotificationSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const { userId, type, subject, body } = validation.data;
    const notification = await notificationService.sendNotification(
      userId,
      type,
      subject,
      body,
      correlationId
    );

    const response: ApiResponse<{ notification: typeof notification }> = {
      success: true,
      data: { notification },
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

// POST /notifications/events - Process a single domain event
router.post('/events', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = processEventSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const result = await notificationService.processEvent(validation.data);
    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      correlationId,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(500).json(response);
  }
});

// POST /notifications/events/batch - Process a batch of domain events
router.post('/events/batch', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  try {
    const validation = processBatchSchema.safeParse(req.body);
    if (!validation.success) {
      const response: ApiResponse<null> = {
        success: false,
        error: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        correlationId,
      };
      res.status(400).json(response);
      return;
    }

    const result = await notificationService.processEventBatch(validation.data.events);
    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      correlationId,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(500).json(response);
  }
});

// GET /notifications - List all notifications
router.get('/', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const userId = req.query.userId as string | undefined;

  const notifs = userId
    ? notificationService.getNotificationsByUser(userId)
    : notificationService.getAllNotifications();

  const response: ApiResponse<{ notifications: typeof notifs }> = {
    success: true,
    data: { notifications: notifs },
    correlationId,
  };
  res.json(response);
});

// GET /notifications/:id - Get notification by ID
router.get('/:id', (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const notification = notificationService.getNotification(req.params.id);

  if (!notification) {
    const response: ApiResponse<null> = {
      success: false,
      error: `Notification ${req.params.id} not found`,
      correlationId,
    };
    res.status(404).json(response);
    return;
  }

  const response: ApiResponse<{ notification: typeof notification }> = {
    success: true,
    data: { notification },
    correlationId,
  };
  res.json(response);
});

// GET /notifications/debug/consumer-stats - Consumer stats
router.get('/debug/consumer-stats', (_req: Request, res: Response) => {
  const correlationId = _req.headers['x-correlation-id'] as string;
  const response: ApiResponse<{ stats: ReturnType<typeof notificationService.getConsumerStats>; history: unknown[] }> = {
    success: true,
    data: {
      stats: notificationService.getConsumerStats(),
      history: notificationService.getConsumerHistory(),
    },
    correlationId,
  };
  res.json(response);
});

export { router as notificationRoutes };
