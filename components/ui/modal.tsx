"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  /** Evita cerrar al click en scrim (para flujos críticos). */
  closeOnOverlayClick?: boolean;
  /** Ancho máximo. */
  maxWidthClassName?: string;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  closeOnOverlayClick = true,
  maxWidthClassName = "max-w-[560px]",
}: ModalProps) {
  const titleId = React.useId();
  const descId = React.useId();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const lastActiveRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    document.documentElement.style.overflow = "hidden";

    const t = window.setTimeout(() => {
      const root = panelRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
      );
      (focusables[0] ?? root).focus?.();
    }, 0);

    return () => {
      window.clearTimeout(t);
      document.documentElement.style.overflow = "";
      lastActiveRef.current?.focus?.();
      lastActiveRef.current = null;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!active || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        className="fixed inset-0 bg-black/45"
        aria-label="Cerrar modal"
        onClick={closeOnOverlayClick ? onClose : undefined}
      />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={cn(
            "w-full overflow-hidden rounded-2xl border border-tl-line bg-tl-canvas shadow-xl",
            maxWidthClassName,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-tl-line px-4 py-3">
            <div className="min-w-0">
              <p id={titleId} className="truncate text-sm font-semibold text-tl-ink">
                {title}
              </p>
              {description ? (
                <p id={descId} className="mt-0.5 text-xs text-tl-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-tl-muted tl-interactive tl-press tl-focus hover:bg-tl-canvas-subtle"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

