/**
 * Tipos de dominio enviados por la app offline.
 * El servidor no confía en precios ni cantidades sin validar stock y catálogo.
 */
export const DOMAIN_EVENT_TYPES = [
  "SALE_CREATED",
  "PRODUCT_ADDED_TO_CART",
  "STOCK_DECREASED",
  "SALE_CANCELLED",
  "SALE_COMPLETED",
  /** Eventos generados solo en servidor (compensación / auditoría) */
  "SALE_REJECTED",
  "SALE_PARTIALLY_FULFILLED",
  "STOCK_ADJUSTED_SERVER",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export type ClientSyncEvent = {
  id: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
};

export type SaleCreatedPayload = {
  saleId: string;
  customerId?: string;
};

export type ProductAddedPayload = {
  saleId: string;
  productId: string;
  quantity: number;
  unitPriceCents?: number;
};

export type StockDecreasedPayload = {
  productId: string;
  quantity: number;
  reason?: string;
  saleId?: string;
};

export type SaleCancelledPayload = {
  saleId: string;
};

export type SaleCompletedPayload = {
  saleId: string;
  paymentMethod?: string;
};
