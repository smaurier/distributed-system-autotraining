import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { Order, OrderItem, OrderStatus } from '../../../shared/types/index.js';
import type { OrderCreatedEvent, OrderCancelledEvent } from '../../../shared/types/events.js';
import { outbox } from '../lib/outbox.js';
import { CircuitBreaker, CircuitBreakerOpenError } from '../lib/circuit-breaker.js';

const logger = pino({ name: 'order-service' });

// In-memory order store
const orders: Map<string, Order> = new Map();

// Circuit breakers for downstream services
const inventoryCircuitBreaker = new CircuitBreaker('inventory-service', {
  failureThreshold: 3,
  resetTimeoutMs: 15000,
  halfOpenMaxAttempts: 2,
});

const paymentCircuitBreaker = new CircuitBreaker('payment-service', {
  failureThreshold: 3,
  resetTimeoutMs: 15000,
  halfOpenMaxAttempts: 2,
});

const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002';

export class OrderService {
  /** Create a new order with saga orchestration */
  async createOrder(
    userId: string,
    items: { productId: string; quantity: number }[],
    correlationId: string
  ): Promise<Order> {
    const orderId = uuidv4();
    const now = new Date().toISOString();

    // Step 1: Create order in pending state
    const order: Order = {
      id: orderId,
      userId,
      items: items.map((item) => ({ ...item, price: 0 })),
      status: 'pending',
      totalAmount: 0,
      createdAt: now,
      updatedAt: now,
    };
    orders.set(orderId, order);
    logger.info({ orderId, userId, correlationId }, 'Order created in pending state');

    // Step 2: Reserve stock via inventory service (saga step)
    let reservationId: string | null = null;
    try {
      const reservation = await inventoryCircuitBreaker.execute(async () => {
        const response = await fetch(`${INVENTORY_SERVICE_URL}/inventory/reserve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify({ orderId, items }),
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(
            `Inventory reservation failed: ${(errorBody as { error?: string }).error || response.statusText}`
          );
        }
        return response.json() as Promise<{
          success: boolean;
          data: { reservation: { id: string; items: { productId: string; quantity: number; price: number }[] } };
        }>;
      });

      if (reservation.success && reservation.data) {
        reservationId = reservation.data.reservation.id;
        // Update order items with prices from inventory
        const reservedItems: OrderItem[] = reservation.data.reservation.items.map(
          (item: { productId: string; quantity: number; price: number }) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          })
        );
        order.items = reservedItems;
        order.totalAmount = reservedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        order.status = 'confirmed';
        order.updatedAt = new Date().toISOString();
        orders.set(orderId, order);
        logger.info({ orderId, reservationId, correlationId }, 'Stock reserved successfully');
      }
    } catch (error) {
      // Compensating transaction: cancel the order
      order.status = 'cancelled';
      order.updatedAt = new Date().toISOString();
      orders.set(orderId, order);

      if (error instanceof CircuitBreakerOpenError) {
        logger.warn({ orderId, correlationId }, 'Inventory circuit breaker is open');
      } else {
        logger.error({ orderId, correlationId, error }, 'Failed to reserve stock');
      }

      throw new Error(`Order creation failed: could not reserve stock - ${(error as Error).message}`);
    }

    // Step 3: Process payment (saga step)
    try {
      const idempotencyKey = `order-${orderId}-payment`;
      await paymentCircuitBreaker.execute(async () => {
        const response = await fetch(`${PAYMENT_SERVICE_URL}/payments/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify({
            orderId,
            amount: order.totalAmount,
            idempotencyKey,
          }),
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(
            `Payment processing failed: ${(errorBody as { error?: string }).error || response.statusText}`
          );
        }
        return response.json();
      });

      order.status = 'paid';
      order.updatedAt = new Date().toISOString();
      orders.set(orderId, order);
      logger.info({ orderId, correlationId }, 'Payment processed successfully');
    } catch (error) {
      // Compensating transaction: release stock reservation
      if (reservationId) {
        try {
          await fetch(`${INVENTORY_SERVICE_URL}/inventory/release`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-correlation-id': correlationId,
            },
            body: JSON.stringify({ reservationId, orderId }),
          });
          logger.info({ orderId, reservationId, correlationId }, 'Stock reservation released (compensation)');
        } catch (releaseError) {
          logger.error(
            { orderId, reservationId, correlationId, error: releaseError },
            'Failed to release stock reservation during compensation'
          );
        }
      }

      order.status = 'cancelled';
      order.updatedAt = new Date().toISOString();
      orders.set(orderId, order);

      if (error instanceof CircuitBreakerOpenError) {
        logger.warn({ orderId, correlationId }, 'Payment circuit breaker is open');
      }

      throw new Error(`Order creation failed: payment error - ${(error as Error).message}`);
    }

    // Step 4: Publish OrderCreated event via outbox
    const event: OrderCreatedEvent = {
      id: uuidv4(),
      type: 'order.created',
      timestamp: new Date().toISOString(),
      correlationId,
      payload: {
        orderId: order.id,
        userId: order.userId,
        items: order.items,
        totalAmount: order.totalAmount,
      },
    };
    outbox.add(event);

    return order;
  }

  /** Cancel an order with compensating transactions */
  async cancelOrder(orderId: string, reason: string, correlationId: string): Promise<Order> {
    const order = orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new Error(`Order ${orderId} is already ${order.status}`);
    }

    if (order.status === 'shipped') {
      throw new Error(`Cannot cancel shipped order ${orderId}`);
    }

    // Release stock if it was reserved
    if (order.status === 'confirmed' || order.status === 'paid') {
      try {
        await fetch(`${INVENTORY_SERVICE_URL}/inventory/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify({ orderId, reason }),
        });
        logger.info({ orderId, correlationId }, 'Stock released for cancelled order');
      } catch (error) {
        logger.error({ orderId, correlationId, error }, 'Failed to release stock for cancelled order');
      }
    }

    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();
    orders.set(orderId, order);

    // Publish OrderCancelled event via outbox
    const event: OrderCancelledEvent = {
      id: uuidv4(),
      type: 'order.cancelled',
      timestamp: new Date().toISOString(),
      correlationId,
      payload: { orderId, reason },
    };
    outbox.add(event);

    logger.info({ orderId, reason, correlationId }, 'Order cancelled');
    return order;
  }

  /** Get an order by ID */
  getOrder(orderId: string): Order | undefined {
    return orders.get(orderId);
  }

  /** Get all orders, optionally filtered by userId */
  getOrders(userId?: string): Order[] {
    const allOrders = Array.from(orders.values());
    if (userId) {
      return allOrders.filter((order) => order.userId === userId);
    }
    return allOrders;
  }

  /** Update order status */
  updateOrderStatus(orderId: string, status: OrderStatus): Order {
    const order = orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    orders.set(orderId, order);
    logger.info({ orderId, status }, 'Order status updated');
    return order;
  }

  /** Get circuit breaker stats */
  getCircuitBreakerStats(): Record<string, unknown> {
    return {
      inventory: inventoryCircuitBreaker.getStats(),
      payment: paymentCircuitBreaker.getStats(),
    };
  }
}

export const orderService = new OrderService();
