"use client";

import { useCallback, useRef, useState } from "react";
import {
  ArchiveRestoreIcon as ArchiveRestore,
  ArrowUpIcon as ArrowUp,
  AlertTriangleIcon as AlertTriangle,
  CheckCircle2Icon as CheckCircle2,
  DatabaseIcon as Database,
  DownloadIcon as Download,
  XLucideIcon as X,
  InfoIcon as Info,
  Loader2Icon as Loader2,
  PackageIcon as Package,
  RefreshCwIcon as RefreshCw,
  SaveIcon as Save,
  ShieldAlertIcon as ShieldAlert,
} from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

type BackupPreview = {
  metadata: {
    appName: string;
    version: string;
    createdAt: string;
    generatedBy: string;
    totalTables: number;
    totalRecords: number;
  };
  recordCounts: Record<string, number>;
  computedTotalRecords: number;
  tableList: string[];
};

type Phase =
  | { kind: "idle" }
  | { kind: "generating"; message: string }
  | { kind: "downloading" }
  | { kind: "previewing" }
  | { kind: "preview"; data: BackupPreview }
  | { kind: "restoring" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return iso;
  }
}

export function BackupSection() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [previewData, setPreviewData] = useState<BackupPreview | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const clearUpload = useCallback(() => {
    setUploadedFile(null);
    setPreviewData(null);
    setPhase({ kind: "idle" });
  }, []);

  const handleGenerate = useCallback(async () => {
    setPhase({ kind: "generating", message: "Recolectando datos de todas las tablas..." });
    try {
      const res = await fetch("/api/admin/backup/generate", {
        method: "POST",
        credentials: "include",
        headers: { "x-tl-csrf": "1" },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        setPhase({ kind: "error", message: err.error ?? "Error al generar el backup." });
        toast.push({ kind: "error", title: "Error", description: err.error ?? "No se pudo generar el backup." });
        return;
      }

      setPhase({ kind: "downloading" });

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?(.+?)"?$/);
      const filename = match?.[1] ?? `backup-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setPhase({ kind: "done", message: "Backup generado y descargado correctamente." });
      toast.push({
        kind: "success",
        title: "Backup generado",
        description: `Archivo ${filename} descargado.`,
        durationMs: 5000,
      });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Error de red." });
      toast.push({ kind: "error", title: "Error", description: "Error de conexión al generar el backup." });
    }
  }, [toast]);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".zip")) {
      toast.push({ kind: "warning", title: "Formato inválido", description: "Solo se aceptan archivos .zip" });
      return;
    }
    setUploadedFile(file);
    setPreviewData(null);
    setPhase({ kind: "idle" });
  }, [toast]);

  const handlePreview = useCallback(async () => {
    if (!uploadedFile) return;
    setPhase({ kind: "previewing" });
    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const res = await fetch("/api/admin/backup/preview", {
        method: "POST",
        credentials: "include",
        headers: { "x-tl-csrf": "1" },
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        setPhase({ kind: "error", message: json.error ?? "Error al analizar el backup." });
        toast.push({ kind: "error", title: "Error", description: json.error });
        return;
      }

      setPreviewData(json as BackupPreview);
      setShowPreviewModal(true);
      setPhase({ kind: "preview", data: json as BackupPreview });
    } catch {
      setPhase({ kind: "error", message: "Error de conexión al analizar el backup." });
      toast.push({ kind: "error", title: "Error", description: "Error de red." });
    }
  }, [uploadedFile, toast]);

  const handleRestore = useCallback(async () => {
    if (!uploadedFile) return;
    setShowConfirmRestore(false);
    setShowPreviewModal(false);
    setPhase({ kind: "restoring" });

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        credentials: "include",
        headers: { "x-tl-csrf": "1" },
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        setPhase({ kind: "error", message: json.error ?? "La restauración falló." });
        toast.push({
          kind: "error",
          title: "Restauración fallida",
          description: json.detail ?? json.error ?? "Se revirtieron todos los cambios.",
          durationMs: 8000,
        });
        return;
      }

      setPhase({
        kind: "done",
        message: `Restauración completada. ${json.totalRecordsRestored} registros restaurados.`,
      });
      setUploadedFile(null);
      setPreviewData(null);
      toast.push({
        kind: "success",
        title: "Base de datos restaurada",
        description: `${json.totalRecordsRestored} registros restaurados correctamente.`,
        durationMs: 6000,
      });
    } catch {
      setPhase({ kind: "error", message: "Error de conexión durante la restauración." });
      toast.push({ kind: "error", title: "Error", description: "Error de red." });
    }
  }, [uploadedFile, toast]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const isGenerating = phase.kind === "generating" || phase.kind === "downloading";
  const isProcessing = phase.kind === "previewing" || phase.kind === "restoring";
  const isBusy = isGenerating || isProcessing;

  return (
    <>
      <div className="tl-glass rounded-xl p-5">
        <h2 className="text-sm font-semibold text-tl-ink">Copias de Seguridad</h2>
        <p className="mt-1 text-xs text-tl-muted">
          Genera y restaura copias completas de la base de datos. Solo accesible para administradores.
        </p>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          {/* Generar Backup */}
          <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-accent-subtle">
                <Database className="h-5 w-5 text-tl-accent" aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-tl-ink">Generar Backup</h3>
                <p className="text-xs text-tl-muted">Exporta todas las tablas en un archivo ZIP</p>
              </div>
            </div>

            <button
              type="button"
              className="tl-btn tl-btn-primary tl-interactive mt-4 w-full !px-4 !py-2.5 text-sm"
              onClick={handleGenerate}
              disabled={isBusy}
            >
              {isGenerating ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {phase.kind === "generating" ? phase.message : "Descargando..."}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Download className="h-4 w-4" aria-hidden />
                  Generar Backup
                </span>
              )}
            </button>

            {isGenerating && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-tl-canvas-subtle">
                  <div className="h-full animate-pulse rounded-full bg-tl-accent" style={{ width: "60%" }} />
                </div>
                <p className="mt-1.5 text-center text-[11px] text-tl-muted">
                  {phase.kind === "generating"
                    ? "Recolectando y comprimiendo datos..."
                    : "Preparando descarga..."}
                </p>
              </div>
            )}

            {phase.kind === "done" && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-tl-success-subtle px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-tl-success" aria-hidden />
                <p className="text-xs text-tl-success">{phase.message}</p>
              </div>
            )}

            {phase.kind === "error" && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-tl-danger-subtle px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tl-danger" aria-hidden />
                <p className="text-xs text-tl-danger">{phase.message}</p>
              </div>
            )}
          </div>

          {/* Restaurar Backup */}
          <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-info-subtle">
                <Save className="h-5 w-5 text-tl-info" aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-tl-ink">Restaurar Backup</h3>
                <p className="text-xs text-tl-muted">Carga un archivo ZIP para restaurar la base de datos</p>
              </div>
            </div>

            {/* Drag & Drop zone */}
            <div
              className={cn(
                "relative mt-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                dragActive
                  ? "border-tl-accent bg-tl-accent-subtle"
                  : "border-tl-line bg-tl-canvas-subtle/50",
                isBusy && "pointer-events-none opacity-60",
              )}
              onDragEnter={(e) => {
                handleDrag(e);
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                handleDrag(e);
                setDragActive(false);
              }}
              onDragOver={handleDrag}
              onDrop={(e) => {
                handleDrag(e);
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileSelect(file);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={isBusy}
                aria-label="Seleccionar archivo de backup"
              />

              {uploadedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <Package className="h-8 w-8 text-tl-accent" aria-hidden />
                  <p className="text-sm font-semibold text-tl-ink">{uploadedFile.name}</p>
                  <p className="text-xs text-tl-muted">
                    {(uploadedFile.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-tl-muted hover:text-tl-danger tl-interactive"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearUpload();
                    }}
                    disabled={isBusy}
                  >
                    <X className="h-3 w-3" aria-hidden />
                    Quitar
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <ArrowUp className="h-8 w-8 text-tl-muted" aria-hidden />
                  <p className="text-sm text-tl-muted">
                    Arrastra un archivo <span className="font-semibold text-tl-ink">.zip</span> aquí
                  </p>
                  <p className="text-[11px] text-tl-muted">o haz clic para seleccionarlo</p>
                </div>
              )}
            </div>

            {uploadedFile && !isBusy && (
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive mt-3 w-full !px-4 !py-2.5 text-sm"
                onClick={handlePreview}
              >
                <span className="flex items-center justify-center gap-2">
                  <Info className="h-4 w-4" aria-hidden />
                  Analizar Backup
                </span>
              </button>
            )}

            {phase.kind === "previewing" && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-tl-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Analizando backup...
              </div>
            )}

            {phase.kind === "restoring" && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-tl-canvas-subtle">
                  <div className="h-full animate-pulse rounded-full bg-tl-info" style={{ width: "75%" }} />
                </div>
                <p className="mt-1.5 text-center text-[11px] text-tl-muted">
                  Restaurando datos... No cierres esta página.
                </p>
              </div>
            )}

            {phase.kind === "done" && previewData === null && uploadedFile === null && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-tl-success-subtle px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-tl-success" aria-hidden />
                <p className="text-xs text-tl-success">{phase.message}</p>
              </div>
            )}

            {phase.kind === "error" && uploadedFile === null && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-tl-danger-subtle px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tl-danger" aria-hidden />
                <p className="text-xs text-tl-danger">{phase.message}</p>
              </div>
            )}
          </div>
        </div>

        {/* Info footer */}
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-tl-warning" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-tl-warning">Operación restringida</p>
            <p className="mt-0.5 text-xs text-tl-warning/80">
              La restauración reemplaza <strong>todos</strong> los datos actuales. Solo se ejecuta dentro
              de una transacción: si algo falla, se revierte completamente sin dejar la base de datos en
              un estado inconsistente. Cada operación queda registrada en la auditoría del sistema.
            </p>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal
        open={showPreviewModal}
        title="Vista previa del Backup"
        description="Revisa la información antes de restaurar"
        onClose={() => setShowPreviewModal(false)}
        maxWidthClassName="max-w-[640px]"
      >
        {previewData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-tl-canvas-subtle px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-tl-muted">Aplicación</p>
                <p className="mt-0.5 text-sm font-semibold text-tl-ink">{previewData.metadata.appName}</p>
              </div>
              <div className="rounded-lg bg-tl-canvas-subtle px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-tl-muted">Versión</p>
                <p className="mt-0.5 text-sm font-semibold text-tl-ink">{previewData.metadata.version}</p>
              </div>
              <div className="rounded-lg bg-tl-canvas-subtle px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-tl-muted">Fecha de creación</p>
                <p className="mt-0.5 text-sm font-semibold text-tl-ink">
                  {formatDateTime(previewData.metadata.createdAt)}
                </p>
              </div>
              <div className="rounded-lg bg-tl-canvas-subtle px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-tl-muted">Generado por</p>
                <p className="mt-0.5 text-sm font-semibold text-tl-ink">{previewData.metadata.generatedBy}</p>
              </div>
              <div className="rounded-lg bg-tl-canvas-subtle px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-tl-muted">Total tablas</p>
                <p className="mt-0.5 text-sm font-semibold text-tl-ink">{previewData.metadata.totalTables}</p>
              </div>
              <div className="rounded-lg bg-tl-canvas-subtle px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wider text-tl-muted">Total registros</p>
                <p className="mt-0.5 text-sm font-semibold text-tl-ink">
                  {previewData.computedTotalRecords.toLocaleString("es-ES")}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Registros por entidad
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-tl-line-subtle">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-tl-line-subtle bg-tl-canvas-subtle">
                      <th className="px-3 py-2 text-left font-semibold text-tl-ink">Entidad</th>
                      <th className="px-3 py-2 text-right font-semibold text-tl-ink">Registros</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tl-line-subtle">
                    {previewData.tableList.map((table) => (
                      <tr key={table} className="hover:bg-tl-canvas-subtle/50">
                        <td className="px-3 py-1.5 font-mono text-tl-ink">{table}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-tl-muted">
                          {(previewData.recordCounts[table] ?? 0).toLocaleString("es-ES")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-tl-danger-subtle px-3 py-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-tl-danger" aria-hidden />
              <p className="text-xs text-tl-danger">
                Al restaurar este backup se <strong>reemplazarán todos los datos actuales</strong> de la base de datos.
                Asegúrate de haber generado un backup reciente antes de continuar.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
                onClick={() => setShowPreviewModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="tl-btn bg-tl-danger text-white hover:opacity-95 !px-4 !py-2 text-sm"
                onClick={() => {
                  setShowPreviewModal(false);
                  setShowConfirmRestore(true);
                }}
              >
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Restaurar Backup
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Confirm Restore Dialog */}
      <ConfirmDialog
        open={showConfirmRestore}
        title="¿Restaurar base de datos?"
        description={
          previewData
            ? `Se restaurarán ${previewData.computedTotalRecords.toLocaleString("es-ES")} registros de ${previewData.tableList.length} tablas. Esta acción reemplazará todos los datos actuales y no se puede deshacer.`
            : "Esta acción reemplazará todos los datos actuales y no se puede deshacer."
        }
        confirmLabel="Sí, restaurar ahora"
        cancelLabel="Cancelar"
        destructive
        busy={phase.kind === "restoring"}
        onConfirm={handleRestore}
        onClose={() => setShowConfirmRestore(false)}
      />
    </>
  );
}
