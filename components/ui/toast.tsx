"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "warning" | "info";

export type ToastInput = {
  kind: ToastKind;
  title: string;
  description?: string;
  /**
   * Duración en ms. Recomendado 3000–5000ms (skill).
   * `null` = no auto-dismiss (solo manual).
   */
  durationMs?: number | null;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastItem = ToastInput & {
  id: string;
  createdAt: number;
};

type ToastApi = {
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const timersRef = React.useRef<Map<string, number>>(new Map());

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timers = timersRef.current;
    const t = timers.get(id);
    if (t) window.clearTimeout(t);
    timers.delete(id);
  }, []);

  const clear = React.useCallback(() => {
    setItems([]);
    const timers = timersRef.current;
    for (const t of timers.values()) window.clearTimeout(t);
    timers.clear();
  }, []);

  const push = React.useCallback(
    (input: ToastInput) => {
      const id = newId();
      const durationMs =
        input.durationMs === undefined ? 4200 : input.durationMs;

      const next: ToastItem = {
        id,
        createdAt: Date.now(),
        ...input,
        durationMs,
      };

      setItems((prev) => {
        const capped = prev.length >= 5 ? prev.slice(prev.length - 4) : prev;
        return [...capped, next];
      });

      if (durationMs != null && durationMs > 0) {
        const t = window.setTimeout(() => dismiss(id), durationMs);
        timersRef.current.set(id, t);
      }
      return id;
    },
    [dismiss],
  );

  const api = React.useMemo<ToastApi>(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  // Escape para limpiar sin robar foco (no focus-trap).
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && items.length > 0) clear();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, clear]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-3 z-[70] flex flex-col items-center gap-2 px-3 sm:bottom-4 sm:items-end sm:px-4"
        aria-live="polite"
        aria-relevant="additions removals"
      >
        {items.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider />");
  }
  return ctx;
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const tone =
    toast.kind === "success"
      ? { border: "border-tl-success/25", bg: "bg-tl-success-subtle", fg: "text-tl-success" }
      : toast.kind === "error"
        ? { border: "border-tl-danger/25", bg: "bg-tl-danger-subtle", fg: "text-tl-danger" }
        : toast.kind === "warning"
          ? { border: "border-tl-warning/25", bg: "bg-tl-warning-subtle", fg: "text-tl-warning" }
          : { border: "border-tl-info/25", bg: "bg-tl-info-subtle", fg: "text-tl-info" };

  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-lg",
        "tl-glass",
        tone.border,
      )}
      role="status"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full", tone.fg.replace("text-", "bg-"))} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-tl-ink">{toast.title}</p>
          {toast.description ? <p className="mt-0.5 text-xs text-tl-muted">{toast.description}</p> : null}
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className={cn(
                "mt-2 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                "border-tl-line bg-tl-canvas-inset text-tl-ink",
                "tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle",
              )}
              onClick={() => {
                toast.onAction?.();
                onDismiss();
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-tl-muted tl-interactive tl-press tl-focus hover:bg-tl-canvas-subtle"
          onClick={onDismiss}
          aria-label="Cerrar notificación"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className={cn("h-0.5 w-full", tone.bg)} aria-hidden />
    </div>
  );
}

