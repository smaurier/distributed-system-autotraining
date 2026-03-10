// Order types
export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  status: OrderStatus;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'shipped' | 'cancelled' | 'refunded';

// Payment types
export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  status: PaymentStatus;
  idempotencyKey: string;
  createdAt: string;
}

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

// Inventory types
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface StockReservation {
  id: string;
  orderId: string;
  items: { productId: string; quantity: number }[];
  status: 'reserved' | 'confirmed' | 'released';
}

// API types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  correlationId: string;
}

// Health check
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  uptime: number;
  checks: Record<string, boolean>;
}
