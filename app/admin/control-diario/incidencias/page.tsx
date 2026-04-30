"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  dayYmd: string;
  status: "OPEN" | "ACK" | "RESOLVED";
  severity: "INFO" | "WARN" | "ERROR";
  title: string;
  message: string;
  tags: any;
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

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | Row["status"]>("");
  const [severity, setSeverity] = useState<"" | Row["severity"]>("");

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
      params.set("date", date);
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
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, action: "ACK" | "RESOLVE" | "REOPEN") {
    setErr(null);
    try {
      const note =
        action === "ACK"
          ? window.prompt("Nota (opcional) para OK / revisado:", "") ?? ""
          : action === "RESOLVE"
            ? window.prompt("Nota (opcional) de resolución:", "") ?? ""
            : "";
      const res = await fetch("/api/admin/incidents", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ id, action, note: note.trim() ? note.trim() : null }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setErr(json?.error ?? "No se pudo actualizar la incidencia.");
        return;
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    }
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
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
              />
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
            <select className="tl-input h-10 px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="">Estado (todos)</option>
              <option value="OPEN">Pendiente</option>
              <option value="ACK">OK</option>
              <option value="RESOLVED">Resuelto</option>
            </select>
            <select className="tl-input h-10 px-3 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
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
                  <th className="px-3 py-2">Hora</th>
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
                      <td className="px-3 py-2" colSpan={7}>
                        <div className="tl-skeleton h-4 w-full rounded-md" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-tl-muted">
                      Sin incidencias para el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono text-[11px] text-tl-muted">
                        {new Date(r.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
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
                      <td className="px-3 py-2 font-semibold text-tl-ink">{r.title}</td>
                      <td className="px-3 py-2 text-xs text-tl-muted">
                        <div className="max-w-[520px] truncate" title={r.message}>
                          {r.message}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs"
                            onClick={() => void patch(r.id, "ACK")}
                            disabled={r.status === "RESOLVED"}
                            title="Marcar OK / revisado"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden />
                            OK
                          </button>
                          <button
                            type="button"
                            className="tl-btn tl-btn-primary !px-3 !py-1.5 text-xs"
                            onClick={() => void patch(r.id, "RESOLVE")}
                            disabled={r.status === "RESOLVED"}
                            title="Marcar como resuelto"
                          >
                            Resolver
                          </button>
                          {r.status !== "OPEN" ? (
                            <button type="button" className="tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs" onClick={() => void patch(r.id, "REOPEN")}>
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
    </AdminShell>
  );
}

