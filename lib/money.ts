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

/** CUP como texto explícito (evita símbolos ambiguos tipo $ en algunos locales). */
export function formatCupAmountLabel(cents: number | undefined | null) {
  const value = (cents ?? 0) / 100;
  const num = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `CUP ${num}`;
}

/** Solo moneda de venta (CUP); mismo formato que en pares CUP/USD. */
export function formatCup(cents: number | undefined | null) {
  return formatCupAmountLabel(cents);
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

/** Texto plano (exportaciones, títulos). En UI preferir `<CupUsdMoney />` para resaltar USD. */
export function formatCupAndUsdLabel(cents: number | undefined | null) {
  return `${formatCupAmountLabel(cents)} · ${formatUsdFromCupCents(cents)}`;
}

