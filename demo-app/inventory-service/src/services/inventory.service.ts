import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { Product, StockReservation } from '../../../shared/types/index.js';
import type { StockReservedEvent, StockReleasedEvent } from '../../../shared/types/events.js';
import { stockStore } from '../lib/stock-store.js';

const logger = pino({ name: 'inventory-service' });

export class InventoryService {
  /** Reserve stock for an order */
  async reserveStock(
    orderId: string,
    items: { productId: string; quantity: number }[],
    correlationId: string
  ): Promise<{
    reservation: StockReservation;
    items: { productId: string; quantity: number; price: number }[];
    event: StockReservedEvent;
  }> {
    const reservationId = uuidv4();

    logger.info({ orderId, items, reservationId, correlationId }, 'Reserving stock');

    const result = stockStore.reserveStock(reservationId, orderId, items);

    const event: StockReservedEvent = {
      id: uuidv4(),
      type: 'stock.reserved',
      timestamp: new Date().toISOString(),
      correlationId,
      payload: {
        reservationId: result.reservation.id,
        orderId,
        items: result.reservation.items,
      },
    };

    logger.info(
      { reservationId, orderId, correlationId },
      'Stock reserved successfully'
    );

    return { ...result, event };
  }

  /** Release a stock reservation */
  async releaseStock(
    reservationId: string | undefined,
    orderId: string,
    reason: string,
    correlationId: string
  ): Promise<{ reservations: StockReservation[]; event: StockReleasedEvent }> {
    logger.info({ reservationId, orderId, reason, correlationId }, 'Releasing stock');

    let released: StockReservation[];

    if (reservationId) {
      const reservation = stockStore.releaseReservation(reservationId);
      released = [reservation];
    } else {
      released = stockStore.releaseByOrderId(orderId);
    }

    const actualReservationId = reservationId || (released.length > 0 ? released[0].id : 'unknown');

    const event: StockReleasedEvent = {
      id: uuidv4(),
      type: 'stock.released',
      timestamp: new Date().toISOString(),
      correlationId,
      payload: {
        reservationId: actualReservationId,
        orderId,
        reason,
      },
    };

    logger.info(
      { reservationId: actualReservationId, orderId, releasedCount: released.length, correlationId },
      'Stock released successfully'
    );

    return { reservations: released, event };
  }

  /** Confirm a reservation */
  async confirmReservation(
    reservationId: string,
    correlationId: string
  ): Promise<StockReservation> {
    logger.info({ reservationId, correlationId }, 'Confirming reservation');
    return stockStore.confirmReservation(reservationId);
  }

  /** Check stock availability */
  checkAvailability(items: { productId: string; quantity: number }[]): {
    available: boolean;
    unavailable: { productId: string; requested: number; available: number }[];
  } {
    return stockStore.checkAvailability(items);
  }

  /** Get a product */
  getProduct(productId: string): Product | undefined {
    return stockStore.getProduct(productId);
  }

  /** Get all products */
  getAllProducts(): Product[] {
    return stockStore.getAllProducts();
  }

  /** Get reservation by ID */
  getReservation(reservationId: string): StockReservation | undefined {
    return stockStore.getReservation(reservationId);
  }

  /** Get all reservations */
  getAllReservations(): StockReservation[] {
    return stockStore.getAllReservations();
  }

  /** Update stock (admin) */
  updateStock(productId: string, newStock: number): Product {
    return stockStore.updateStock(productId, newStock);
  }
}

export const inventoryService = new InventoryService();
