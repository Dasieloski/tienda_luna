"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarIcon as Calendar,
  CheckCircle2Icon as CheckCircle2,
  RefreshCwIcon as RefreshCw,
  ShieldAlertIcon as ShieldAlert,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Row = {
  id: string;
  dayYmd: string;
  status: "OPEN" | "ACK" | "RESOLVED";
  severity: "INFO" | "WARN" | "ERROR";
  title: string;
  message: string;
  tags: unknown;
  actorType: string;
  actorId: string;
  deviceId: string | null;
  ackedAt: string | null;
  ackedByUserId: string | null;
  ackNote: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiList = {
  meta: { dbAvailable: boolean };
  rows: Row[];
  nextCursor: string | null;
};

function badgeColor(status: Row["status"]) {
  if (status === "RESOLVED") return "bg-tl-success/15 text-tl-success border-tl-success/25";
  if (status === "ACK") return "bg-tl-accent/10 text-tl-accent border-tl-accent/20";
  return "bg-amber-500/[0.08] text-amber-700 border-amber-500/25";
}

function sevColor(sev: Row["severity"]) {
  if (sev === "ERROR") return "bg-tl-warning-subtle text-tl-warning border-tl-warning/20";
  if (sev === "WARN") return "bg-amber-500/[0.08] text-amber-700 border-amber-500/25";
  return "bg-tl-canvas-inset text-tl-muted border-tl-line-subtle";
}

export default function DailyIncidentsPage() {
  const toast = useToast();
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | Row["status"]>("");
  const [severity, setSeverity] = useState<"" | Row["severity"]>("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<Row | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteAction, setNoteAction] = useState<"ACK" | "RESOLVE">("ACK");
  const [noteIncidentId, setNoteIncidentId] = useState<string>("");
  const [noteValue, setNoteValue] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (severity && r.severity !== severity) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        r.message.toLowerCase().includes(needle) ||
        String(r.deviceId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, status, severity]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("year", year);
      params.set("limit", "120");
      const res = await fetch(`/api/admin/incidents?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as ApiList;
      if (!res.ok || json.meta?.dbAvailable === false) {
        setErr("No se pudieron cargar las incidencias.");
        setRows([]);
        return;
      }
      setRows(json.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchNow(id: string, action: "ACK" | "RESOLVE" | "REOPEN", note: string | null) {
    setErr(null);
    try {
      const res = await fetch("/api/admin/incidents", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ id, action, note }),
      });
      const raw: unknown = await res.json().catch(() => null);
      const obj = raw && typeof raw === "object" ? (raw as { error?: unknown }) : null;
      if (!res.ok) {
        const msg = typeof obj?.error === "string" ? obj.error : "No se pudo actualizar la incidencia.";
        setErr(msg);
        toast.push({ kind: "error", title: "No se pudo actualizar", description: msg });
        return;
      }
      await load();
      toast.push({
        kind: "success",
        title: action === "ACK" ? "Marcada como OK" : action === "RESOLVE" ? "Incidencia resuelta" : "Reabierta",
        durationMs: 2400,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      toast.push({
        kind: "error",
        title: "Error de red",
        description: e instanceof Error ? e.message : "Inténtalo de nuevo.",
      });
    }
  }

  async function patch(id: string, action: "ACK" | "RESOLVE" | "REOPEN") {
    if (action === "REOPEN") {
      await patchNow(id, action, null);
      return;
    }
    setNoteIncidentId(id);
    setNoteAction(action);
    setNoteValue("");
    setNoteOpen(true);
  }

  return (
    <AdminShell title="Incidencias diarias">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Incidencias diarias</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Reportes operativos escritos desde el POS. En la web puedes revisarlos, marcar OK y resolver.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              <Calendar className="h-4 w-4" aria-hidden />
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
                aria-label="Año"
              >
                {Array.from({ length: 6 }).map((_, i) => {
                  const y = new Date().getFullYear() - i;
                  return (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
              Actualizar
            </button>
            <Link
              href="/admin/control-diario"
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden />
              Volver
            </Link>
          </div>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 lg:grid-cols-4">
            <input
              className="tl-input h-10 px-3 text-sm lg:col-span-2"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por título, mensaje o dispositivo…"
            />
            <select
              className="tl-input h-10 px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | Row["status"])}
            >
              <option value="">Estado (todos)</option>
              <option value="OPEN">Pendiente</option>
              <option value="ACK">OK</option>
              <option value="RESOLVED">Resuelto</option>
            </select>
            <select
              className="tl-input h-10 px-3 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as "" | Row["severity"])}
            >
              <option value="">Severidad (todas)</option>
              <option value="INFO">Info</option>
              <option value="WARN">Warn</option>
              <option value="ERROR">Error</option>
            </select>
          </div>

          <div className="mt-4 overflow-x-auto tl-glass rounded-xl">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Severidad</th>
                  <th className="px-3 py-2">Dispositivo</th>
                  <th className="px-3 py-2">Título</th>
                  <th className="px-3 py-2">Mensaje</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2" colSpan={8}>
                        <div className="tl-skeleton h-4 w-full rounded-md" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-tl-muted">
                      Sin incidencias para el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono text-[11px] text-tl-muted">
                        {new Date(r.createdAt).toLocaleString("es-ES", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", badgeColor(r.status))}>
                          {r.status === "OPEN" ? "Pendiente" : r.status === "ACK" ? "OK" : "Resuelto"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", sevColor(r.severity))}>
                          {r.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-tl-ink">{r.deviceId ?? "—"}</td>
                      <td className="px-3 py-2 font-semibold text-tl-ink">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => {
                            setDetailRow(r);
                            setDetailOpen(true);
                          }}
                        >
                          {r.title}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs text-tl-muted">
                        <button
                          type="button"
                          className="block w-full max-w-[520px] truncate text-left underline-offset-2 hover:underline"
                          title="Ver mensaje completo"
                          onClick={() => {
                            setDetailRow(r);
                            setDetailOpen(true);
                          }}
                        >
                          {r.message}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void patch(r.id, "ACK");
                            }}
                            disabled={r.status === "RESOLVED"}
                            title="Marcar OK / revisado"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden />
                            OK
                          </button>
                          <button
                            type="button"
                            className="tl-btn tl-btn-primary !px-3 !py-1.5 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void patch(r.id, "RESOLVE");
                            }}
                            disabled={r.status === "RESOLVED"}
                            title="Marcar como resuelto"
                          >
                            Resolver
                          </button>
                          {r.status !== "OPEN" ? (
                            <button
                              type="button"
                              className="tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                void patch(r.id, "REOPEN");
                              }}
                            >
                              Reabrir
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Modal
        open={detailOpen}
        title={detailRow?.title ?? "Incidencia"}
        description={
          detailRow
            ? `${new Date(detailRow.createdAt).toLocaleString("es-ES")} · ${detailRow.deviceId ?? "—"} · ${detailRow.severity}`
            : undefined
        }
        onClose={() => setDetailOpen(false)}
        maxWidthClassName="max-w-[780px]"
      >
        <div className="grid gap-3">
          <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Mensaje</div>
            <div className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-sm text-tl-ink">
              {detailRow?.message ?? ""}
            </div>
          </div>
          {detailRow?.ackNote ? (
            <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Nota OK</div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm text-tl-ink">{detailRow.ackNote}</div>
            </div>
          ) : null}
          {detailRow?.resolutionNote ? (
            <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Nota de resolución</div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm text-tl-ink">{detailRow.resolutionNote}</div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={noteOpen}
        title={noteAction === "ACK" ? "Marcar OK / revisado" : "Resolver incidencia"}
        description="Puedes añadir una nota opcional para dejar trazabilidad."
        onClose={() => {
          if (noteBusy) return;
          setNoteOpen(false);
        }}
        maxWidthClassName="max-w-[560px]"
      >
        <div className="grid gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
            Nota (opcional)
            <textarea
              className="tl-input mt-1 min-h-[88px] w-full px-3 py-2 text-sm normal-case"
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder={noteAction === "ACK" ? "Ej: revisado, no procede." : "Ej: resuelto, se repuso inventario."}
              maxLength={240}
              disabled={noteBusy}
              autoFocus
            />
          </label>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
              onClick={() => setNoteOpen(false)}
              disabled={noteBusy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-primary !px-4 !py-2 text-sm"
              onClick={() => {
                const id = noteIncidentId;
                if (!id) return;
                void (async () => {
                  setNoteBusy(true);
                  try {
                    const note = noteValue.trim() ? noteValue.trim() : null;
                    await patchNow(id, noteAction, note);
                    setNoteOpen(false);
                  } finally {
                    setNoteBusy(false);
                  }
                })();
              }}
              disabled={noteBusy || !noteIncidentId}
            >
              {noteBusy ? "Guardando…" : noteAction === "ACK" ? "Marcar OK" : "Resolver"}
            </button>
          </div>
        </div>
      </Modal>
    </AdminShell>
  );
}

