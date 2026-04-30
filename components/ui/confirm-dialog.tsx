"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      maxWidthClassName="max-w-[520px]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn(
              "tl-btn !px-4 !py-2 text-sm",
              destructive ? "bg-tl-danger text-white hover:opacity-95" : "tl-btn-primary",
            )}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

