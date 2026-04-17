"use client";

import { cn } from "@/lib/utils";
import { formatCupAmountLabel, formatUsdFromCupCents } from "@/lib/money";

/** Muestra importe en CUP explícito + equivalente USD (verde) para tarjetas y tablas. */
export function CupUsdMoney({
  cents,
  className,
  compact,
}: {
  cents: number | null | undefined;
  className?: string;
  /** Tipografía más pequeña en celdas densas */
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 tabular-nums",
        compact ? "text-xs sm:text-sm" : "text-sm sm:text-base",
        className,
      )}
    >
      <span className="min-w-0 font-semibold text-tl-ink">{formatCupAmountLabel(cents)}</span>
      <span className="text-tl-muted/70" aria-hidden>
        ·
      </span>
      <span className="font-semibold text-tl-success">{formatUsdFromCupCents(cents)}</span>
    </span>
  );
}
