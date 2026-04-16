"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "accent";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  variant?: Variant;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
  /** Show action arrow on hover */
  actionable?: boolean;
}

const variantStyles: Record<Variant, { bg: string; glow: string; accent: string }> = {
  default: {
    bg: "bg-tl-canvas-inset",
    glow: "bg-tl-accent/10",
    accent: "text-tl-accent",
  },
  success: {
    bg: "bg-tl-canvas-inset",
    glow: "bg-tl-success/10",
    accent: "text-tl-success",
  },
  warning: {
    bg: "bg-tl-canvas-inset",
    glow: "bg-tl-warning/10",
    accent: "text-tl-warning",
  },
  danger: {
    bg: "bg-tl-canvas-inset",
    glow: "bg-tl-danger/10",
    accent: "text-tl-danger",
  },
  info: {
    bg: "bg-tl-canvas-inset",
    glow: "bg-tl-info/10",
    accent: "text-tl-info",
  },
  accent: {
    bg: "bg-tl-accent",
    glow: "bg-tl-accent/20",
    accent: "text-tl-accent-fg",
  },
};

export function KpiCard({
  label,
  value,
  hint,
  variant = "default",
  trend,
  trendValue,
  icon,
  className,
  actionable = false,
}: KpiCardProps) {
  const styles = variantStyles[variant];
  const isAccentCard = variant === "accent";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-tl-line-subtle p-5 tl-card-hover",
        styles.bg,
        isAccentCard && "border-transparent text-tl-accent-fg",
        className
      )}
    >
      {/* Ambient glow on hover */}
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100",
          styles.glow
        )}
        aria-hidden
      />

      <div className="relative">
        {/* Header with label and action/icon */}
        <div className="flex items-start justify-between gap-2">
          <p className={cn(
            "text-xs font-semibold uppercase tracking-wider",
            isAccentCard ? "text-tl-accent-fg/70" : "text-tl-muted"
          )}>
            {label}
          </p>
          {actionable ? (
            <div className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors tl-interactive",
              isAccentCard 
                ? "bg-tl-accent-fg/10 text-tl-accent-fg" 
                : "bg-tl-canvas-subtle text-tl-muted group-hover:bg-tl-accent group-hover:text-tl-accent-fg"
            )}>
              <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" aria-hidden />
            </div>
          ) : icon && (
            <div className={cn("shrink-0 transition-transform duration-200 group-hover:scale-105", styles.accent)}>
              {icon}
            </div>
          )}
        </div>

        {/* Value - large and prominent */}
        <p
          className={cn(
            "mt-3 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl",
            isAccentCard ? "text-tl-accent-fg" : "text-tl-ink",
          )}
        >
          {value}
        </p>

        {/* Hint and trend row */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {hint && (
            <p className={cn(
              "text-xs",
              isAccentCard ? "text-tl-accent-fg/70" : "text-tl-muted"
            )}>
              {hint}
            </p>
          )}
          {trend && trendValue && (
            <div
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                trend === "up" && "bg-tl-success-subtle text-tl-success",
                trend === "down" && "bg-tl-danger-subtle text-tl-danger",
                trend === "neutral" && "bg-tl-canvas-subtle text-tl-muted"
              )}
            >
              {trend === "up" && <ArrowUp className="h-3 w-3" aria-hidden />}
              {trend === "down" && <ArrowDown className="h-3 w-3" aria-hidden />}
              {trend === "neutral" && <Minus className="h-3 w-3" aria-hidden />}
              <span>{trendValue}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 
 * Compact stat card - Crextio style large number display 
 */
interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, icon, className }: StatCardProps) {
  return (
    <div className={cn("group flex items-center gap-3", className)}>
      {icon && (
        <span className="text-tl-muted transition-transform duration-200 group-hover:scale-105">{icon}</span>
      )}
      <div>
        <span className="text-4xl font-bold tabular-nums tracking-tight text-tl-ink">
          {value}
        </span>
        <p className="text-xs text-tl-muted">{label}</p>
      </div>
    </div>
  );
}
