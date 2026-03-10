import { Router, Request, Response } from 'express';
import { gatewayService } from '../services/gateway.service.js';
import type { ApiResponse } from '../../../shared/types/index.js';

const router = Router();

// ---- Order Service Proxy ----

// POST /api/orders
router.post('/orders', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('orders', '/orders', 'POST', req, req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/orders
router.get('/orders', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const result = await gatewayService.proxyRequest('orders', `/orders${queryString}`, 'GET', req);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/orders/:id
router.get('/orders/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('orders', `/orders/${req.params.id}`, 'GET', req);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/orders/:id/details - Aggregated view (order + payments)
router.get('/orders/:id/details', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const details = await gatewayService.getOrderDetails(req.params.id, req);
    const response: ApiResponse<typeof details> = {
      success: true,
      data: details,
      correlationId,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// PATCH /api/orders/:id/status
router.patch('/orders/:id/status', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest(
      'orders',
      `/orders/${req.params.id}/status`,
      'PATCH',
      req,
      req.body
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// POST /api/orders/:id/cancel
router.post('/orders/:id/cancel', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest(
      'orders',
      `/orders/${req.params.id}/cancel`,
      'POST',
      req,
      req.body
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// ---- Payment Service Proxy ----

// POST /api/payments/process
router.post('/payments/process', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('payments', '/payments/process', 'POST', req, req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// POST /api/payments/refund
router.post('/payments/refund', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('payments', '/payments/refund', 'POST', req, req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/payments
router.get('/payments', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const result = await gatewayService.proxyRequest('payments', `/payments${queryString}`, 'GET', req);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/payments/:id
router.get('/payments/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('payments', `/payments/${req.params.id}`, 'GET', req);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// ---- Inventory Service Proxy ----

// GET /api/inventory/products
router.get('/inventory/products', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('inventory', '/inventory/products', 'GET', req);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/inventory/products/:id
router.get('/inventory/products/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest(
      'inventory',
      `/inventory/products/${req.params.id}`,
      'GET',
      req
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// POST /api/inventory/reserve
router.post('/inventory/reserve', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('inventory', '/inventory/reserve', 'POST', req, req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// POST /api/inventory/release
router.post('/inventory/release', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('inventory', '/inventory/release', 'POST', req, req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// POST /api/inventory/check-availability
router.post('/inventory/check-availability', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest(
      'inventory',
      '/inventory/check-availability',
      'POST',
      req,
      req.body
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/inventory/reservations
router.get('/inventory/reservations', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest('inventory', '/inventory/reservations', 'GET', req);
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// ---- Notification Service Proxy ----

// POST /api/notifications/send
router.post('/notifications/send', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest(
      'notifications',
      '/notifications/send',
      'POST',
      req,
      req.body
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// POST /api/notifications/events
router.post('/notifications/events', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const result = await gatewayService.proxyRequest(
      'notifications',
      '/notifications/events',
      'POST',
      req,
      req.body
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// GET /api/notifications
router.get('/notifications', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const result = await gatewayService.proxyRequest(
      'notifications',
      `/notifications${queryString}`,
      'GET',
      req
    );
    res.status(result.status).json(result.data);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: (error as Error).message,
      correlationId,
    };
    res.status(502).json(response);
  }
});

// ---- Service Health Aggregation ----

// GET /api/health - Aggregated health from all services
router.get('/health', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;
  try {
    const health = await gatewayService.aggregateHealth();
    const overallStatus = health.gateway.status;
    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 207 : 503;

    const response: ApiResponse<typeof health> = {
      success: overallStatus !== 'unhealthy',
      data: health,
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

// GET /api/services - Service registry
router.get('/services', (_req: Request, res: Response) => {
  const correlationId = _req.headers['x-correlation-id'] as string;
  const response: ApiResponse<Record<string, unknown>> = {
    success: true,
    data: gatewayService.getServiceRegistry(),
    correlationId,
  };
  res.json(response);
});

export { router as proxyRoutes };
