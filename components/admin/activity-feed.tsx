"use client";

import {
  AlertTriangleIcon as AlertTriangle,
  CheckCircle2Icon as CheckCircle2,
  ClockIcon as Clock,
  CreditCardIcon as CreditCard,
  PackageIcon as Package,
  ShoppingCartIcon as ShoppingCart,
  XCircleIcon as XCircle,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type ActivityType =
  | "sale"
  | "refund"
  | "stock_alert"
  | "fraud_alert"
  | "sync"
  | "error"
  | "generic";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: Date;
  isFraud?: boolean;
  meta?: Record<string, string | number>;
}

interface ActivityFeedProps {
  items: ActivityItem[];
  maxItems?: number;
  className?: string;
}

const typeConfig: Record<
  ActivityType,
  { icon: typeof ShoppingCart; color: string; bg: string }
> = {
  sale: {
    icon: ShoppingCart,
    color: "text-tl-success",
    bg: "bg-tl-success-subtle",
  },
  refund: {
    icon: CreditCard,
    color: "text-tl-warning",
    bg: "bg-tl-warning-subtle",
  },
  stock_alert: {
    icon: Package,
    color: "text-tl-warning",
    bg: "bg-tl-warning-subtle",
  },
  fraud_alert: {
    icon: AlertTriangle,
    color: "text-tl-danger",
    bg: "bg-tl-danger-subtle",
  },
  sync: {
    icon: CheckCircle2,
    color: "text-tl-info",
    bg: "bg-tl-info-subtle",
  },
  error: {
    icon: XCircle,
    color: "text-tl-danger",
    bg: "bg-tl-danger-subtle",
  },
  generic: {
    icon: Clock,
    color: "text-tl-muted",
    bg: "bg-tl-canvas-subtle",
  },
};

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `hace ${diffMins}m`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function ActivityFeed({
  items,
  maxItems = 10,
  className,
}: ActivityFeedProps) {
  const displayItems = items.slice(0, maxItems);

  if (displayItems.length === 0) {
    return (
      <div
        className={cn(
          "tl-glass flex flex-col items-center justify-center rounded-xl p-8 text-center",
          className
        )}
      >
        <Clock className="mb-3 h-8 w-8 text-tl-muted" aria-hidden />
        <p className="text-sm text-tl-muted">Sin actividad reciente</p>
      </div>
    );
  }

  return (
    <div className={cn("tl-glass overflow-hidden rounded-xl", className)}>
      <div className="border-b border-tl-line px-4 py-3">
        <h3 className="text-sm font-semibold text-tl-ink">Actividad reciente</h3>
      </div>
      <div className="divide-y divide-tl-line-subtle">
        {displayItems.map((item, index) => {
          const config = typeConfig[item.type];
          const Icon = config.icon;

          return (
            <div
              key={item.id}
              className={cn(
                "tl-reveal flex items-start gap-3 p-4 transition-colors hover:bg-tl-canvas-subtle",
                item.isFraud && "bg-tl-danger-subtle/50"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  config.bg
                )}
              >
                <Icon className={cn("h-4 w-4", config.color)} aria-hidden />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-medium text-tl-ink",
                      item.isFraud && "text-tl-danger"
                    )}
                  >
                    {item.title}
                  </p>
                  <time className="shrink-0 text-xs text-tl-muted">
                    {formatTimeAgo(item.timestamp)}
                  </time>
                </div>
                {item.description && (
                  <p className="mt-0.5 text-xs text-tl-muted line-clamp-2">
                    {item.description}
                  </p>
                )}
                {item.isFraud && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-tl-danger">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    Fraude detectado
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
