export const USD_RATE_CUP = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");

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
  const rate = USD_RATE_CUP > 0 ? USD_RATE_CUP : 1;
  const usd = cup / rate;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(usd);
}

export function formatCupAndUsdLabel(cents: number | undefined | null) {
  return `${formatCup(cents)} · ${formatUsdFromCupCents(cents)}`;
}

