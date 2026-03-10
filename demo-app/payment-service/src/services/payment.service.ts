import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { Payment, PaymentStatus } from '../../../shared/types/index.js';
import type { PaymentProcessedEvent } from '../../../shared/types/events.js';
import { idempotencyStore } from '../lib/idempotency.js';

const logger = pino({ name: 'payment-service' });

// In-memory payment store
const payments: Map<string, Payment> = new Map();

export class PaymentService {
  /**
   * Process a payment with idempotency.
   * If the same idempotencyKey is used, the original result is returned.
   */
  async processPayment(
    orderId: string,
    amount: number,
    idempotencyKey: string,
    correlationId: string
  ): Promise<{ payment: Payment; event: PaymentProcessedEvent; alreadyProcessed: boolean }> {
    // Check idempotency: if we already processed this key, return the cached result
    const existingResult = idempotencyStore.get<{ payment: Payment; event: PaymentProcessedEvent }>(
      idempotencyKey
    );
    if (existingResult) {
      logger.info(
        { idempotencyKey, paymentId: existingResult.payment.id, correlationId },
        'Returning idempotent cached result'
      );
      return { ...existingResult, alreadyProcessed: true };
    }

    const paymentId = uuidv4();
    const now = new Date().toISOString();

    // Create the payment record
    const payment: Payment = {
      id: paymentId,
      orderId,
      amount,
      status: 'pending',
      idempotencyKey,
      createdAt: now,
    };

    // Simulate payment processing with a small chance of failure
    const simulateFailure = process.env.SIMULATE_PAYMENT_FAILURE === 'true';
    const failureRate = parseFloat(process.env.PAYMENT_FAILURE_RATE || '0.1');
    const shouldFail = simulateFailure && Math.random() < failureRate;

    if (shouldFail) {
      payment.status = 'failed';
      payments.set(paymentId, payment);
      logger.warn({ paymentId, orderId, amount, correlationId }, 'Payment processing failed (simulated)');
    } else if (amount <= 0) {
      payment.status = 'failed';
      payments.set(paymentId, payment);
      logger.error({ paymentId, orderId, amount, correlationId }, 'Payment failed: invalid amount');
    } else {
      payment.status = 'completed';
      payments.set(paymentId, payment);
      logger.info({ paymentId, orderId, amount, correlationId }, 'Payment processed successfully');
    }

    // Build the domain event
    const event: PaymentProcessedEvent = {
      id: uuidv4(),
      type: 'payment.processed',
      timestamp: new Date().toISOString(),
      correlationId,
      payload: {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        status: payment.status as 'completed' | 'failed',
      },
    };

    // Store in idempotency cache
    idempotencyStore.set(idempotencyKey, { payment, event });

    return { payment, event, alreadyProcessed: false };
  }

  /** Get a payment by ID */
  getPayment(paymentId: string): Payment | undefined {
    return payments.get(paymentId);
  }

  /** Get all payments for an order */
  getPaymentsByOrder(orderId: string): Payment[] {
    return Array.from(payments.values()).filter((p) => p.orderId === orderId);
  }

  /** Get all payments */
  getAllPayments(): Payment[] {
    return Array.from(payments.values());
  }

  /** Refund a payment */
  async refundPayment(paymentId: string, correlationId: string): Promise<Payment> {
    const payment = payments.get(paymentId);
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    if (payment.status !== 'completed') {
      throw new Error(`Cannot refund payment ${paymentId} with status ${payment.status}`);
    }

    payment.status = 'refunded';
    payments.set(paymentId, payment);
    logger.info({ paymentId, orderId: payment.orderId, correlationId }, 'Payment refunded');

    return payment;
  }
}

export const paymentService = new PaymentService();
