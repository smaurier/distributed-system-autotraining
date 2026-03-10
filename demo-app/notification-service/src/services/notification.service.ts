import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { DomainEvent, OrderCreatedEvent, OrderCancelledEvent, PaymentProcessedEvent } from '../../../shared/types/events.js';
import { eventConsumer } from '../lib/event-consumer.js';

const logger = pino({ name: 'notification-service' });

interface Notification {
  id: string;
  userId: string;
  type: 'email' | 'sms';
  subject: string;
  body: string;
  status: 'sent' | 'failed';
  correlationId: string;
  createdAt: string;
}

// In-memory notification store
const notifications: Map<string, Notification> = new Map();

export class NotificationService {
  constructor() {
    this.registerEventHandlers();
  }

  /** Register handlers for domain events */
  private registerEventHandlers(): void {
    eventConsumer.on('order.created', async (event: DomainEvent) => {
      const orderEvent = event as OrderCreatedEvent;
      await this.sendOrderConfirmation(
        orderEvent.payload.userId,
        orderEvent.payload.orderId,
        orderEvent.payload.totalAmount,
        orderEvent.correlationId
      );
    });

    eventConsumer.on('order.cancelled', async (event: DomainEvent) => {
      const cancelEvent = event as OrderCancelledEvent;
      await this.sendOrderCancellation(
        cancelEvent.payload.orderId,
        cancelEvent.payload.reason,
        cancelEvent.correlationId
      );
    });

    eventConsumer.on('payment.processed', async (event: DomainEvent) => {
      const paymentEvent = event as PaymentProcessedEvent;
      await this.sendPaymentNotification(
        paymentEvent.payload.orderId,
        paymentEvent.payload.amount,
        paymentEvent.payload.status,
        paymentEvent.correlationId
      );
    });

    logger.info('Event handlers registered for notification service');
  }

  /** Send order confirmation notification */
  async sendOrderConfirmation(
    userId: string,
    orderId: string,
    totalAmount: number,
    correlationId: string
  ): Promise<Notification> {
    const notification = this.createNotification(
      userId,
      'email',
      'Order Confirmation',
      `Your order ${orderId} has been confirmed. Total: $${totalAmount.toFixed(2)}. Thank you for your purchase!`,
      correlationId
    );

    logger.info(
      { notificationId: notification.id, userId, orderId, correlationId },
      'Order confirmation notification sent'
    );

    return notification;
  }

  /** Send order cancellation notification */
  async sendOrderCancellation(
    orderId: string,
    reason: string,
    correlationId: string
  ): Promise<Notification> {
    // In a real system, we'd look up the userId from the order
    const userId = 'unknown';
    const notification = this.createNotification(
      userId,
      'email',
      'Order Cancelled',
      `Your order ${orderId} has been cancelled. Reason: ${reason}. If you have any questions, please contact support.`,
      correlationId
    );

    logger.info(
      { notificationId: notification.id, orderId, reason, correlationId },
      'Order cancellation notification sent'
    );

    return notification;
  }

  /** Send payment notification */
  async sendPaymentNotification(
    orderId: string,
    amount: number,
    status: 'completed' | 'failed',
    correlationId: string
  ): Promise<Notification> {
    const userId = 'unknown';
    const subject = status === 'completed' ? 'Payment Successful' : 'Payment Failed';
    const body =
      status === 'completed'
        ? `Payment of $${amount.toFixed(2)} for order ${orderId} was successful.`
        : `Payment of $${amount.toFixed(2)} for order ${orderId} has failed. Please try again or use a different payment method.`;

    const notification = this.createNotification(userId, 'email', subject, body, correlationId);

    logger.info(
      { notificationId: notification.id, orderId, amount, status, correlationId },
      'Payment notification sent'
    );

    return notification;
  }

  /** Send a generic notification */
  async sendNotification(
    userId: string,
    type: 'email' | 'sms',
    subject: string,
    body: string,
    correlationId: string
  ): Promise<Notification> {
    const notification = this.createNotification(userId, type, subject, body, correlationId);

    logger.info(
      { notificationId: notification.id, userId, type, subject, correlationId },
      'Notification sent'
    );

    return notification;
  }

  /** Process an incoming domain event */
  async processEvent(event: DomainEvent): Promise<{ processed: boolean; duplicate: boolean }> {
    return eventConsumer.process(event);
  }

  /** Process a batch of events */
  async processEventBatch(events: DomainEvent[]): Promise<{
    processed: number;
    duplicates: number;
    failed: number;
  }> {
    return eventConsumer.processBatch(events);
  }

  /** Get all notifications */
  getAllNotifications(): Notification[] {
    return Array.from(notifications.values());
  }

  /** Get notifications for a specific user */
  getNotificationsByUser(userId: string): Notification[] {
    return Array.from(notifications.values()).filter((n) => n.userId === userId);
  }

  /** Get notification by ID */
  getNotification(notificationId: string): Notification | undefined {
    return notifications.get(notificationId);
  }

  /** Get consumer stats */
  getConsumerStats(): { totalProcessed: number; handlers: Record<string, number> } {
    return eventConsumer.getStats();
  }

  /** Get consumer history */
  getConsumerHistory(): unknown[] {
    return eventConsumer.getHistory();
  }

  private createNotification(
    userId: string,
    type: 'email' | 'sms',
    subject: string,
    body: string,
    correlationId: string
  ): Notification {
    const notification: Notification = {
      id: uuidv4(),
      userId,
      type,
      subject,
      body,
      status: 'sent',
      correlationId,
      createdAt: new Date().toISOString(),
    };

    notifications.set(notification.id, notification);
    return notification;
  }
}

export const notificationService = new NotificationService();
