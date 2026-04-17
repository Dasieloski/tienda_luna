"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { formatCup, formatUsdCents, formatUsdFromCupCents } from "@/lib/money";

/**
 * Celda de tabla: muestra importe en CUP; el equivalente USD solo en escritorio (hover)
 * o en móvil al expandir "Ver USD".
 */
export function TablePriceCupCell({
  cupCents,
  explicitUsdCents,
  compact,
  align = "right",
  inverse,
}: {
  cupCents: number;
  /** Si el producto tiene PVP en USD fijado en catálogo (>0), se usa para la etiqueta USD. */
  explicitUsdCents?: number | null;
  compact?: boolean;
  align?: "left" | "right";
  /** Tabla sobre fondo oscuro (dashboard). */
  inverse?: boolean;
}) {
  const usdLabel =
    explicitUsdCents != null && explicitUsdCents > 0
      ? formatUsdCents(explicitUsdCents)
      : formatUsdFromCupCents(cupCents);
  const tipId = useId();

  return (
    <div
      className={cn(
        "group relative inline-flex w-full min-w-0 flex-col",
        align === "right" && "items-end text-right",
        align === "left" && "items-start text-left",
      )}
    >
      <span
        className={cn(
          "tabular-nums font-semibold",
          compact ? "text-xs sm:text-sm" : "text-sm",
          inverse ? "text-zinc-100" : "text-tl-ink",
        )}
      >
        {formatCup(cupCents)}
      </span>
      <span id={tipId} className="sr-only">
        Equivalente aproximado en dólares: {usdLabel}
      </span>
      <div
        className={cn(
          "pointer-events-none absolute z-40 mt-1 hidden w-max max-w-[min(260px,80vw)] rounded-md border px-2 py-1 text-xs font-medium shadow-md md:block md:opacity-0 md:transition-opacity md:duration-150",
          "md:group-hover:pointer-events-auto md:group-hover:opacity-100",
          align === "right" && "right-0",
          align === "left" && "left-0",
          inverse
            ? "border-white/15 bg-zinc-950 text-emerald-300"
            : "border-tl-line-subtle bg-tl-canvas text-tl-success shadow-lg",
        )}
        aria-hidden
      >
        ≈ {usdLabel}
      </div>
      <details
        className={cn(
          "z-30 mt-0.5 w-full [&_summary::-webkit-details-marker]:hidden md:hidden",
          align === "right" && "text-right",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <summary
          className={cn(
            "inline-block cursor-pointer select-none text-[11px] font-medium underline-offset-2 hover:underline",
            inverse ? "text-violet-300" : "text-tl-accent",
          )}
        >
          Ver USD
        </summary>
        <p
          className={cn(
            "mt-1 rounded border px-2 py-1 text-left text-xs tabular-nums",
            inverse ? "border-white/10 bg-black/50 text-emerald-300" : "border-tl-line-subtle bg-tl-canvas-inset text-tl-success",
          )}
        >
          {usdLabel}
        </p>
      </details>
    </div>
  );
}
