import pino from 'pino';
import type { Product, StockReservation } from '../../../shared/types/index.js';

const logger = pino({ name: 'stock-store' });

// Initial product catalog
const INITIAL_PRODUCTS: Product[] = [
  { id: 'prod-001', name: 'Wireless Headphones', price: 79.99, stock: 100 },
  { id: 'prod-002', name: 'USB-C Hub', price: 49.99, stock: 200 },
  { id: 'prod-003', name: 'Mechanical Keyboard', price: 129.99, stock: 75 },
  { id: 'prod-004', name: 'Monitor Stand', price: 39.99, stock: 150 },
  { id: 'prod-005', name: 'Webcam HD', price: 59.99, stock: 120 },
  { id: 'prod-006', name: 'Mouse Pad XL', price: 19.99, stock: 300 },
  { id: 'prod-007', name: 'Laptop Stand', price: 44.99, stock: 90 },
  { id: 'prod-008', name: 'Desk Lamp LED', price: 34.99, stock: 180 },
  { id: 'prod-009', name: 'Cable Management Kit', price: 14.99, stock: 250 },
  { id: 'prod-010', name: 'Portable SSD 1TB', price: 89.99, stock: 60 },
];

export class StockStore {
  private products: Map<string, Product> = new Map();
  private reservations: Map<string, StockReservation> = new Map();

  constructor() {
    // Initialize with product catalog
    for (const product of INITIAL_PRODUCTS) {
      this.products.set(product.id, { ...product });
    }
    logger.info({ productCount: this.products.size }, 'Stock store initialized');
  }

  /** Get a product by ID */
  getProduct(productId: string): Product | undefined {
    return this.products.get(productId);
  }

  /** Get all products */
  getAllProducts(): Product[] {
    return Array.from(this.products.values());
  }

  /** Check if stock is available for the given items */
  checkAvailability(items: { productId: string; quantity: number }[]): {
    available: boolean;
    unavailable: { productId: string; requested: number; available: number }[];
  } {
    const unavailable: { productId: string; requested: number; available: number }[] = [];

    for (const item of items) {
      const product = this.products.get(item.productId);
      if (!product) {
        unavailable.push({ productId: item.productId, requested: item.quantity, available: 0 });
      } else if (product.stock < item.quantity) {
        unavailable.push({
          productId: item.productId,
          requested: item.quantity,
          available: product.stock,
        });
      }
    }

    return { available: unavailable.length === 0, unavailable };
  }

  /** Reserve stock for an order. Returns items with prices. */
  reserveStock(
    reservationId: string,
    orderId: string,
    items: { productId: string; quantity: number }[]
  ): { reservation: StockReservation; items: { productId: string; quantity: number; price: number }[] } {
    // Validate all items first (atomic check)
    const availability = this.checkAvailability(items);
    if (!availability.available) {
      const details = availability.unavailable
        .map((u) => `${u.productId}: requested=${u.requested}, available=${u.available}`)
        .join('; ');
      throw new Error(`Insufficient stock: ${details}`);
    }

    // Deduct stock
    const itemsWithPrices: { productId: string; quantity: number; price: number }[] = [];
    for (const item of items) {
      const product = this.products.get(item.productId)!;
      product.stock -= item.quantity;
      itemsWithPrices.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
      });
      logger.info(
        { productId: item.productId, reserved: item.quantity, remaining: product.stock },
        'Stock reserved'
      );
    }

    // Create reservation record
    const reservation: StockReservation = {
      id: reservationId,
      orderId,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      status: 'reserved',
    };
    this.reservations.set(reservationId, reservation);

    return { reservation, items: itemsWithPrices };
  }

  /** Release a stock reservation (return items to stock) */
  releaseReservation(reservationId: string): StockReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    if (reservation.status === 'released') {
      logger.warn({ reservationId }, 'Reservation already released');
      return reservation;
    }

    // Return stock
    for (const item of reservation.items) {
      const product = this.products.get(item.productId);
      if (product) {
        product.stock += item.quantity;
        logger.info(
          { productId: item.productId, released: item.quantity, newStock: product.stock },
          'Stock released'
        );
      }
    }

    reservation.status = 'released';
    this.reservations.set(reservationId, reservation);
    return reservation;
  }

  /** Release reservations by orderId */
  releaseByOrderId(orderId: string): StockReservation[] {
    const released: StockReservation[] = [];
    for (const reservation of this.reservations.values()) {
      if (reservation.orderId === orderId && reservation.status === 'reserved') {
        this.releaseReservation(reservation.id);
        released.push(reservation);
      }
    }
    return released;
  }

  /** Confirm a reservation (finalize the stock deduction) */
  confirmReservation(reservationId: string): StockReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }
    reservation.status = 'confirmed';
    this.reservations.set(reservationId, reservation);
    logger.info({ reservationId }, 'Reservation confirmed');
    return reservation;
  }

  /** Get a reservation by ID */
  getReservation(reservationId: string): StockReservation | undefined {
    return this.reservations.get(reservationId);
  }

  /** Get all reservations */
  getAllReservations(): StockReservation[] {
    return Array.from(this.reservations.values());
  }

  /** Update product stock directly (for admin) */
  updateStock(productId: string, newStock: number): Product {
    const product = this.products.get(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }
    product.stock = newStock;
    this.products.set(productId, product);
    logger.info({ productId, newStock }, 'Stock updated directly');
    return product;
  }
}

// Singleton instance
export const stockStore = new StockStore();
