/** Tasa CUP por 1 USD (misma convención que `NEXT_PUBLIC_USD_RATE_CUP`). */
export function usdRateCup() {
  const r = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/** Convierte centavos de USD a céntimos CUP usando la tasa. */
export function cupCentsFromUsdCents(usdCents: number): number {
  if (!Number.isFinite(usdCents) || usdCents <= 0) return 0;
  const r = usdRateCup();
  return Math.round((usdCents / 100) * r * 100);
}

/**
 * Precio unitario en céntimos CUP que usa el servidor al cerrar la venta.
 * - Pagos en USD: `priceUsdCents` → CUP; si no hay USD explícito, se usa `priceCents` (lista solo en CUP).
 * - Pagos por transferencia (CUP): `transferPriceCents`; si no existe/está en 0, se cae a `priceCents`.
 * - Resto (efectivo CUP): `priceCents`.
 */
export function unitPriceCupCentsForSale(
  product: { priceCents: number; transferPriceCents?: number; priceUsdCents: number },
  paymentMethodRaw: string | undefined,
): number {
  const m = (paymentMethodRaw ?? "").toLowerCase();
  const isUsd =
    m.includes("usd") ||
    m.includes("dolar") ||
    m.includes("dólar") ||
    m.includes("cash_usd");
  const isTransfer =
    m.includes("transfer") ||
    m.includes("transf") ||
    m.includes("bank") ||
    m.includes("banco");
  if (!isUsd) {
    if (isTransfer) {
      const tp = typeof product.transferPriceCents === "number" ? product.transferPriceCents : 0;
      return tp > 0 ? tp : product.priceCents;
    }
    return product.priceCents;
  }
  if (product.priceUsdCents > 0) {
    return cupCentsFromUsdCents(product.priceUsdCents);
  }
  return product.priceCents;
}

/**
 * Precio unitario en CUP (céntimos) para persistir en `SaleLine`.
 * Overrides ≤ 0 del cliente se ignoran y se usa `fallbackCupCents` (lista vigente en servidor,
 * histórico de la línea o catálogo). Así un precio de venta erróneo en el POS no genera
 * líneas a 0 CUP; los cambios de `Product.priceCents` solo afectan líneas nuevas donde aplique el fallback.
 */
export function resolveSaleLineUnitPriceCupCents(
  overrideCupCents: number | undefined | null,
  fallbackCupCents: number,
): number {
  if (
    typeof overrideCupCents === "number" &&
    Number.isInteger(overrideCupCents) &&
    overrideCupCents > 0
  ) {
    return overrideCupCents;
  }
  return fallbackCupCents;
}
