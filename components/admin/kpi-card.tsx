"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "info";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  variant?: Variant;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
}

const variantStyles: Record<Variant, { border: string; glow: string; accent: string }> = {
  default: {
    border: "hover:border-tl-accent/30",
    glow: "group-hover:opacity-100",
    accent: "text-tl-accent",
  },
  success: {
    border: "hover:border-tl-success/30",
    glow: "bg-tl-success/10 group-hover:opacity-100",
    accent: "text-tl-success",
  },
  warning: {
    border: "hover:border-tl-warning/30",
    glow: "bg-tl-warning/10 group-hover:opacity-100",
    accent: "text-tl-warning",
  },
  danger: {
    border: "hover:border-tl-danger/30",
    glow: "bg-tl-danger/10 group-hover:opacity-100",
    accent: "text-tl-danger",
  },
  info: {
    border: "hover:border-tl-info/30",
    glow: "bg-tl-info/10 group-hover:opacity-100",
    accent: "text-tl-info",
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
}: KpiCardProps) {
  const styles = variantStyles[variant];

  return (
    <div
      className={cn(
        "tl-glass group relative overflow-hidden rounded-xl p-5 transition-all duration-300",
        "hover:-translate-y-0.5 hover:shadow-lg",
        styles.border,
        className
      )}
    >
      {/* Ambient glow */}
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-500",
          variant === "default" ? "bg-tl-accent/10" : styles.glow
        )}
        aria-hidden
      />

      <div className="relative">
        {/* Header with label and optional icon */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">
            {label}
          </p>
          {icon && (
            <div className={cn("shrink-0", styles.accent)}>
              {icon}
            </div>
          )}
        </div>

        {/* Value */}
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-tl-ink">
          {value}
        </p>

        {/* Hint and trend row */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {hint && (
            <p className="text-xs text-tl-muted">{hint}</p>
          )}
          {trend && trendValue && (
            <div
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                trend === "up" && "text-tl-success",
                trend === "down" && "text-tl-danger",
                trend === "neutral" && "text-tl-muted"
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
