export interface DomainEvent {
  id: string;
  type: string;
  timestamp: string;
  correlationId: string;
  payload: unknown;
}

export interface OrderCreatedEvent extends DomainEvent {
  type: 'order.created';
  payload: {
    orderId: string;
    userId: string;
    items: { productId: string; quantity: number; price: number }[];
    totalAmount: number;
  };
}

export interface OrderCancelledEvent extends DomainEvent {
  type: 'order.cancelled';
  payload: { orderId: string; reason: string };
}

export interface PaymentProcessedEvent extends DomainEvent {
  type: 'payment.processed';
  payload: {
    paymentId: string;
    orderId: string;
    amount: number;
    status: 'completed' | 'failed';
  };
}

export interface StockReservedEvent extends DomainEvent {
  type: 'stock.reserved';
  payload: {
    reservationId: string;
    orderId: string;
    items: { productId: string; quantity: number }[];
  };
}

export interface StockReleasedEvent extends DomainEvent {
  type: 'stock.released';
  payload: { reservationId: string; orderId: string; reason: string };
}

export interface NotificationSentEvent extends DomainEvent {
  type: 'notification.sent';
  payload: { userId: string; type: 'email' | 'sms'; subject: string };
}

export type AppEvent =
  | OrderCreatedEvent
  | OrderCancelledEvent
  | PaymentProcessedEvent
  | StockReservedEvent
  | StockReleasedEvent
  | NotificationSentEvent;
