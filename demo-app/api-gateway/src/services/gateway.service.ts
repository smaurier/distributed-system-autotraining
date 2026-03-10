import pino from 'pino';
import { buildProxyHeaders } from '../lib/correlation.js';
import type { Request } from 'express';
import type { HealthStatus } from '../../../shared/types/index.js';

const logger = pino({ name: 'gateway-service' });

// Service registry
interface ServiceConfig {
  name: string;
  url: string;
  healthPath: string;
}

const SERVICES: Record<string, ServiceConfig> = {
  orders: {
    name: 'order-service',
    url: process.env.ORDER_SERVICE_URL || 'http://localhost:3001',
    healthPath: '/health',
  },
  payments: {
    name: 'payment-service',
    url: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002',
    healthPath: '/health',
  },
  inventory: {
    name: 'inventory-service',
    url: process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003',
    healthPath: '/health',
  },
  notifications: {
    name: 'notification-service',
    url: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
    healthPath: '/health',
  },
};

export class GatewayService {
  /**
   * Proxy a request to a downstream service.
   * Returns the raw response from the downstream service.
   */
  async proxyRequest(
    serviceName: string,
    path: string,
    method: string,
    req: Request,
    body?: unknown
  ): Promise<{ status: number; data: unknown }> {
    const service = SERVICES[serviceName];
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const url = `${service.url}${path}`;
    const headers = buildProxyHeaders(req);
    const correlationId = req.headers['x-correlation-id'] as string;

    logger.info(
      { serviceName, url, method, correlationId },
      'Proxying request to downstream service'
    );

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.json().catch(() => null);

      logger.info(
        { serviceName, url, method, status: response.status, correlationId },
        'Downstream response received'
      );

      return { status: response.status, data };
    } catch (error) {
      logger.error(
        { serviceName, url, method, error, correlationId },
        'Failed to proxy request to downstream service'
      );
      throw new Error(`Service ${serviceName} is unavailable: ${(error as Error).message}`);
    }
  }

  /**
   * Aggregate health status from all downstream services.
   */
  async aggregateHealth(): Promise<{
    gateway: HealthStatus;
    services: Record<string, HealthStatus | { status: 'unhealthy'; error: string }>;
  }> {
    const gatewayHealth: HealthStatus = {
      status: 'healthy',
      service: 'api-gateway',
      uptime: 0, // Will be set by caller
      checks: { server: true },
    };

    const serviceHealths: Record<string, HealthStatus | { status: 'unhealthy'; error: string }> = {};

    const healthChecks = Object.entries(SERVICES).map(async ([key, config]) => {
      try {
        const response = await fetch(`${config.url}${config.healthPath}`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = (await response.json()) as HealthStatus;
        serviceHealths[key] = data;
      } catch (error) {
        serviceHealths[key] = {
          status: 'unhealthy',
          error: `Service unreachable: ${(error as Error).message}`,
        };
      }
    });

    await Promise.allSettled(healthChecks);

    // Determine overall gateway health
    const unhealthyServices = Object.values(serviceHealths).filter(
      (h) => h.status === 'unhealthy'
    );
    if (unhealthyServices.length === Object.keys(SERVICES).length) {
      gatewayHealth.status = 'unhealthy';
    } else if (unhealthyServices.length > 0) {
      gatewayHealth.status = 'degraded';
    }

    return { gateway: gatewayHealth, services: serviceHealths };
  }

  /**
   * Get the service registry.
   */
  getServiceRegistry(): Record<string, ServiceConfig> {
    return { ...SERVICES };
  }

  /**
   * Create an aggregated order view by fetching order + payment data.
   */
  async getOrderDetails(
    orderId: string,
    req: Request
  ): Promise<{ order: unknown; payments: unknown }> {
    const correlationId = req.headers['x-correlation-id'] as string;

    logger.info({ orderId, correlationId }, 'Aggregating order details');

    const [orderResult, paymentsResult] = await Promise.allSettled([
      this.proxyRequest('orders', `/orders/${orderId}`, 'GET', req),
      this.proxyRequest('payments', `/payments?orderId=${orderId}`, 'GET', req),
    ]);

    const order =
      orderResult.status === 'fulfilled' ? orderResult.value.data : { error: 'Order service unavailable' };
    const payments =
      paymentsResult.status === 'fulfilled'
        ? paymentsResult.value.data
        : { error: 'Payment service unavailable' };

    return { order, payments };
  }
}

export const gatewayService = new GatewayService();
