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
  /** v2: cierre con pagos detallados (mixto, USD, fiado parcial) */
  "SALE_COMPLETED_V2",
  /** v2: abono/pago aplicado posterior a una venta existente (fiado) */
  "SALE_PAYMENT_APPLIED",
  /** v2: devolución parcial (y ajuste de stock/contabilidad) */
  "SALE_RETURNED",
  /** v2: edición de una venta ya realizada (ajusta stock/contabilidad) */
  "SALE_EDITED",
  /** v2 (opcional): clientes mínimos para fiado */
  "CUSTOMER_UPSERTED",
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
};

export type ProductAddedPayload = {
  saleId: string;
  productId: string;
  /** Alternativa para compatibilidad: resolver producto por SKU. */
  sku?: string;
  quantity: number;
  /** Compat legacy: ignorado en servidor salvo override explícito. */
  unitPriceCents?: number;
  /** v2: precio final negociado (CUP céntimos) por unidad. */
  unitPriceCupCentsOverride?: number;
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

export type PaymentInput = {
  /** Canal/método: cash, transfer, usd_cash, etc. */
  method: string;
  /** Moneda original capturada. */
  currency: "CUP" | "USD";
  /** Si currency=CUP: importe en CUP céntimos. */
  amountCupCents?: number;
  /** Si currency=USD: importe en USD centavos. */
  amountUsdCents?: number;
  /** Tasa CUP por 1 USD usada en el tablet (opcional). */
  usdRateCup?: number;
  /** Timestamp ms del pago (si difiere del cierre de venta). */
  paidAt?: number;
};

export type SaleCompletedV2Payload = {
  saleId: string;
  /** Múltiples pagos para soportar pago mixto y/o fiado parcial. */
  payments: PaymentInput[];
  /**
   * Opcional: cómo fijar precios al cerrar (si no se envía, el servidor puede inferirlo).
   * - "CUP": usar PVP CUP (priceCents)
   * - "USD": usar PVP USD convertido a CUP (priceUsdCents -> CUP)
   */
  priceList?: "CUP" | "USD";
  /** Compat: etiqueta libre para auditoría. */
  note?: string;
};

export type SalePaymentAppliedPayload = {
  /** Identificador de venta en el cliente (igual que saleId del flujo offline). */
  saleId: string;
  /** Uno o más pagos aplicados (abonos). */
  payments: PaymentInput[];
  note?: string;
};

export type SaleReturnedPayload = {
  saleId: string;
  lines: { productId: string; quantity: number }[];
  reason?: string;
  /** Timestamp ms del acto de devolución (si difiere del batch). */
  returnedAt?: number;
};

export type SaleEditedPayload = {
  saleId: string;
  /**
   * Nuevo estado de líneas (replace): el servidor calcula deltas vs. lo guardado.
   * Si quieres editar solo una línea, reenvía también las demás.
   */
  lines: { productId: string; quantity: number; unitPriceCupCentsOverride?: number }[];
  note?: string;
};

export type CustomerUpsertedPayload = {
  externalId?: string;
  name?: string;
  phone?: string;
  email?: string;
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
