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
  /** Catálogo desde tablet/POS (misma auth que sync batch) */
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_DELETED",
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

/** Alta de producto offline; el servidor valida y persiste (SKU único por tienda). */
export type ProductCreatedPayload = {
  sku: string;
  name: string;
  priceCents: number;
  priceUsdCents?: number;
  unitsPerBox?: number;
  wholesaleCupCents?: number | null;
  supplierName?: string | null;
  stockQty?: number;
  lowStockAt?: number;
};

/** Actualización parcial: solo enviar campos que cambian. */
export type ProductUpdatedPayload = {
  productId: string;
  sku?: string;
  name?: string;
  priceCents?: number;
  priceUsdCents?: number;
  unitsPerBox?: number;
  wholesaleCupCents?: number | null;
  supplierName?: string | null;
  stockQty?: number;
  lowStockAt?: number;
  active?: boolean;
};

/** Baja lógica: `active = false` (no borra filas referenciadas por ventas). */
export type ProductDeletedPayload = {
  productId: string;
};
