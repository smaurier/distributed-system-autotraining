export interface Command {
  id: string;
  type: string;
  timestamp: string;
  correlationId: string;
  payload: unknown;
}

export interface CreateOrderCommand extends Command {
  type: 'order.create';
  payload: { userId: string; items: { productId: string; quantity: number }[] };
}

export interface CancelOrderCommand extends Command {
  type: 'order.cancel';
  payload: { orderId: string; reason: string };
}

export interface ProcessPaymentCommand extends Command {
  type: 'payment.process';
  payload: { orderId: string; amount: number; idempotencyKey: string };
}

export interface ReserveStockCommand extends Command {
  type: 'stock.reserve';
  payload: { orderId: string; items: { productId: string; quantity: number }[] };
}

export interface ReleaseStockCommand extends Command {
  type: 'stock.release';
  payload: { reservationId: string; orderId: string };
}

export type AppCommand =
  | CreateOrderCommand
  | CancelOrderCommand
  | ProcessPaymentCommand
  | ReserveStockCommand
  | ReleaseStockCommand;
