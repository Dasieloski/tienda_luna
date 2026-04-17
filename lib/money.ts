declare global {
  // eslint-disable-next-line no-var
  var __TL_USD_RATE_CUP__: number | undefined;
}

export function getUsdRateCup(): number {
  const runtime = typeof globalThis !== "undefined" ? globalThis.__TL_USD_RATE_CUP__ : undefined;
  const env = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  const r = runtime ?? env;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

export function formatCup(cents: number | undefined | null) {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("es-CU", {
    style: "currency",
    currency: "CUP",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatUsdFromCupCents(cents: number | undefined | null) {
  const cup = (cents ?? 0) / 100;
  const rate = getUsdRateCup();
  const usd = cup / rate;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(usd);
}

/** Formatea un importe almacenado en centavos de dólar (199 → US$1.99). */
export function formatUsdCents(usdCents: number | undefined | null) {
  const value = (usdCents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCupAndUsdLabel(cents: number | undefined | null) {
  return `${formatCup(cents)} · ${formatUsdFromCupCents(cents)}`;
}

