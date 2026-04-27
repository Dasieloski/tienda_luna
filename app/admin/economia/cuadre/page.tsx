"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Calendar,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  ThumbsUp,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { formatCup } from "@/lib/money";
import { cn } from "@/lib/utils";

type Finding = {
  code: string;
  severity: "INFO" | "WARN" | "ERROR";
  title: string;
  detail: string;
  suggestion?: string;
};

type ApiPayload = {
  meta: { dbAvailable: boolean; message?: string; tzOffsetMinutes?: number };
  dayYmd: string;
  utcRange: { from: string; to: string };
  computed: {
    totals: {
      cashExpectedCents: number;
      transferExpectedCents: number;
      usdChannelExpectedCents: number;
      salesCount: number;
      unknownPaymentMethodSales: number;
    };
    byDevice: {
      deviceId: string;
      salesCount: number;
      cashExpectedCents: number;
      transferExpectedCents: number;
      usdChannelExpectedCents: number;
      unknownPaymentMethodSales: number;
    }[];
    findings: Finding[];
  };
  audit: null | {
    id: string;
    status: "CORRECT" | "INCORRECT";
    category: string | null;
    observation: string | null;
    counted: { cashCountedCents: number; transferCountedCents: number; usdChannelCountedCents: number };
    expectedSnapshot: { cashExpectedCents: number; transferExpectedCents: number; usdChannelExpectedCents: number };
    diffTotalCents: number;
    updatedAt: string;
    notes: { id: string; category: string | null; message: string; actorUserId: string; createdAt: string }[];
    findings: { id: string; code: string; severity: string; title: string; detail: string; suggestion?: string; createdAt: string }[];
    revisions: { id: string; actorUserId: string; action: string; createdAt: string }[];
  };
};

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function moneyOrDash(cents: number | null | undefined) {
  if (cents == null) return "—";
  return formatCup(cents);
}

function severityColor(s: Finding["severity"]) {
  if (s === "ERROR") return "border-tl-warning/35 bg-tl-warning-subtle text-tl-warning";
  if (s === "WARN") return "border-amber-500/25 bg-amber-500/[0.08] text-amber-700";
  return "border-tl-line-subtle bg-tl-canvas-inset text-tl-muted";
}

export default function CashClosingAuditPage() {
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const expected = data?.computed?.totals ?? null;
  const expectedTotal =
    (expected?.cashExpectedCents ?? 0) + (expected?.transferExpectedCents ?? 0) + (expected?.usdChannelExpectedCents ?? 0);

  const [status, setStatus] = useState<"CORRECT" | "INCORRECT">("CORRECT");
  const [cashCounted, setCashCounted] = useState("0");
  const [transferCounted, setTransferCounted] = useState("0");
  const [usdCounted, setUsdCounted] = useState("0");
  const [category, setCategory] = useState<string>("DESYNC");
  const [observation, setObservation] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const countedTotal = useMemo(() => {
    const c = Math.max(0, Math.round(Number(cashCounted || "0")));
    const t = Math.max(0, Math.round(Number(transferCounted || "0")));
    const u = Math.max(0, Math.round(Number(usdCounted || "0")));
    return c + t + u;
  }, [cashCounted, transferCounted, usdCounted]);

  const diffTotal = countedTotal - expectedTotal;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ date });
      const res = await fetch(`/api/admin/cash-closing/day?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as ApiPayload;
      if (!res.ok || json.meta?.dbAvailable === false) {
        setErr(json.meta?.message ?? "No se pudo cargar el cuadre.");
        setData(null);
        return;
      }
      setData(json);

      if (json.audit) {
        setStatus(json.audit.status);
        setCashCounted(String(json.audit.counted.cashCountedCents));
        setTransferCounted(String(json.audit.counted.transferCountedCents));
        setUsdCounted(String(json.audit.counted.usdChannelCountedCents));
        setCategory(json.audit.category ?? "DESYNC");
        setObservation(json.audit.observation ?? "");
      } else {
        setStatus("CORRECT");
        setCashCounted(String(json.computed?.totals?.cashExpectedCents ?? 0));
        setTransferCounted(String(json.computed?.totals?.transferExpectedCents ?? 0));
        setUsdCounted(String(json.computed?.totals?.usdChannelExpectedCents ?? 0));
        setCategory("DESYNC");
        setObservation("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!data) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/cash-closing/day", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          date,
          status,
          cashCountedCents: Math.max(0, Math.round(Number(cashCounted || "0"))),
          transferCountedCents: Math.max(0, Math.round(Number(transferCounted || "0"))),
          usdChannelCountedCents: Math.max(0, Math.round(Number(usdCounted || "0"))),
          category: status === "INCORRECT" ? category : null,
          observation: status === "INCORRECT" ? observation : null,
          note: note.trim() ? note.trim() : null,
        }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setErr(json?.error ?? "No se pudo guardar.");
        return;
      }
      setNote("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Auditoría de cuadre">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Auditoría y detección de errores de cuadre</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Compara esperado vs contado, revisa diferencias por dispositivo y muestra causas probables con acciones sugeridas.
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
              href="/admin/economia"
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
            >
              <ClipboardList className="h-4 w-4" aria-hidden />
              Volver a Economía
            </Link>
          </div>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-3">
          <KpiCard
            label="Esperado (total)"
            value={<CupUsdMoney cents={expectedTotal} />}
            hint={`${expected?.salesCount ?? 0} ventas · según sistema`}
            icon={<Banknote className="h-4 w-4" />}
            variant="info"
          />
          <KpiCard
            label="Contado (total)"
            value={<CupUsdMoney cents={countedTotal} />}
            hint="Lo que registras físicamente"
            icon={<BadgeCheck className="h-4 w-4" />}
            variant="default"
          />
          <KpiCard
            label="Diferencia"
            value={<CupUsdMoney cents={diffTotal} />}
            hint={diffTotal === 0 ? "Cuadre exacto" : diffTotal > 0 ? "Sobra" : "Falta"}
            icon={diffTotal === 0 ? <ThumbsUp className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            variant={diffTotal === 0 ? "success" : "warning"}
          />
        </section>

        <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-tl-ink">Validar cuadre</h2>
              <p className="mt-1 text-xs text-tl-muted">
                Si marcas incorrecto, la observación es obligatoria y se guarda historial inmutable de cambios.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Estado
                <select className="tl-input h-10 px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as any)}>
                  <option value="CORRECT">✅ Cuadre correcto</option>
                  <option value="INCORRECT">❌ Cuadre incorrecto</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Efectivo (CUP)
                <input className="tl-input h-10 w-[160px] px-3 text-sm tabular-nums" value={cashCounted} onChange={(e) => setCashCounted(e.target.value)} inputMode="numeric" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Transferencia (CUP)
                <input className="tl-input h-10 w-[160px] px-3 text-sm tabular-nums" value={transferCounted} onChange={(e) => setTransferCounted(e.target.value)} inputMode="numeric" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                USD canal (CUP)
                <input className="tl-input h-10 w-[160px] px-3 text-sm tabular-nums" value={usdCounted} onChange={(e) => setUsdCounted(e.target.value)} inputMode="numeric" />
              </label>
              <button type="button" className="tl-btn tl-btn-primary inline-flex h-10 items-center gap-2 self-end" onClick={() => void save()} disabled={saving || loading || !data}>
                <BadgeCheck className={cn("h-4 w-4", saving && "animate-pulse")} aria-hidden />
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>

          {status === "INCORRECT" ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Categoría
                <select className="tl-input h-10 px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="CASH_SHORT">Falta de efectivo</option>
                  <option value="CASH_OVER">Sobra efectivo</option>
                  <option value="HUMAN_ERROR">Error humano</option>
                  <option value="DESYNC">Desincronización</option>
                  <option value="TZ_DRIFT">Desfase horario</option>
                  <option value="SYSTEM_BUG">Fallo del sistema</option>
                  <option value="OTHER">Otro</option>
                </select>
              </label>
              <label className="lg:col-span-2 flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Observaciones (obligatorio)
                <input className="tl-input h-10 px-3 text-sm" value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Qué pasó, dónde viste el error, etc." />
              </label>
            </div>
          ) : null}

          <div className="mt-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
              Nota adicional (historial)
              <input className="tl-input h-10 px-3 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Acciones tomadas, hipótesis, etc." />
            </label>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-semibold text-tl-ink">Comparación por dispositivo</h2>
            <p className="mt-1 text-xs text-tl-muted">Sirve para detectar ventas faltantes, duplicaciones o desfases por sync.</p>

            <div className="mt-3 overflow-x-auto tl-glass rounded-xl">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                  <tr>
                    <th className="px-3 py-2">Dispositivo</th>
                    <th className="px-3 py-2 text-right">Ventas</th>
                    <th className="px-3 py-2 text-right">Efectivo</th>
                    <th className="px-3 py-2 text-right">Transfer.</th>
                    <th className="px-3 py-2 text-right">USD (CUP)</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Eventos sin enlace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tl-line-subtle">
                  {(data?.computed?.byDevice ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-tl-muted">
                        Sin ventas para el día.
                      </td>
                    </tr>
                  ) : (
                    (data?.computed?.byDevice ?? []).map((d) => {
                      const tot = d.cashExpectedCents + d.transferExpectedCents + d.usdChannelExpectedCents;
                      return (
                        <tr key={d.deviceId}>
                          <td className="px-3 py-2 font-mono text-xs text-tl-ink">{d.deviceId}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-tl-ink">{d.salesCount}</td>
                          <td className="px-3 py-2 text-right"><TablePriceCupCell cupCents={d.cashExpectedCents} compact /></td>
                          <td className="px-3 py-2 text-right"><TablePriceCupCell cupCents={d.transferExpectedCents} compact /></td>
                          <td className="px-3 py-2 text-right"><TablePriceCupCell cupCents={d.usdChannelExpectedCents} compact /></td>
                          <td className="px-3 py-2 text-right"><TablePriceCupCell cupCents={tot} compact /></td>
                          <td className="px-3 py-2 text-right tabular-nums text-tl-muted">{d.unknownPaymentMethodSales}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-semibold text-tl-ink">Detección inteligente (causas + soluciones)</h2>
            <p className="mt-1 text-xs text-tl-muted">
              Hallazgos automáticos basados en patrones del día. Se enfocan en sync, enlaces de eventos, y consistencia.
            </p>

            <div className="mt-3 space-y-3">
              {(data?.computed?.findings ?? []).length === 0 ? (
                <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas px-4 py-3 text-sm text-tl-muted">
                  No se detectaron inconsistencias automáticas para este día.
                </div>
              ) : (
                (data?.computed?.findings ?? []).map((f) => (
                  <div key={`${f.code}-${f.title}`} className={cn("rounded-xl border px-4 py-3 text-sm", severityColor(f.severity))}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-tl-ink">{f.title}</p>
                        <p className="mt-1 text-xs leading-relaxed">{f.detail}</p>
                        {f.suggestion ? (
                          <p className="mt-2 text-xs">
                            <span className="font-semibold">Acción sugerida:</span> {f.suggestion}
                          </p>
                        ) : null}
                      </div>
                      <AlertTriangle className={cn("h-5 w-5 shrink-0", f.severity === "ERROR" ? "text-tl-warning" : "text-amber-700")} aria-hidden />
                    </div>
                  </div>
                ))
              )}
            </div>

            {data?.computed?.totals?.unknownPaymentMethodSales ? (
              <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-xs text-amber-700">
                <p className="font-semibold">Nota</p>
                <p className="mt-1">
                  El esperado por método depende del `paymentMethod` del evento. Si faltan enlaces evento↔venta, parte del total puede quedar
                  “sin clasificar”. Eso es una señal de sync o de ventas sin evento.
                </p>
                <p className="mt-2 font-mono">unknownPaymentMethodSales: {String(data.computed.totals.unknownPaymentMethodSales)}</p>
              </div>
            ) : null}
          </div>
        </section>

        {data?.audit ? (
          <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-semibold text-tl-ink">Trazabilidad</h2>
            <p className="mt-1 text-xs text-tl-muted">Historial de notas y revisiones (inmutable).</p>

            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Notas</p>
                <div className="mt-2 space-y-2">
                  {data.audit.notes.length === 0 ? (
                    <p className="text-sm text-tl-muted">—</p>
                  ) : (
                    data.audit.notes.map((n) => (
                      <div key={n.id} className="rounded-lg border border-tl-line-subtle bg-tl-canvas-inset px-3 py-2 text-xs">
                        <p className="text-tl-ink">{n.message}</p>
                        <p className="mt-1 font-mono text-[10px] text-tl-muted">
                          {new Date(n.createdAt).toLocaleString("es-ES")} · actor {n.actorUserId}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Revisiones</p>
                <div className="mt-2 space-y-2">
                  {data.audit.revisions.length === 0 ? (
                    <p className="text-sm text-tl-muted">—</p>
                  ) : (
                    data.audit.revisions.map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-lg border border-tl-line-subtle bg-tl-canvas-inset px-3 py-2 text-xs">
                        <span className="font-mono text-[10px] text-tl-muted">
                          {new Date(r.createdAt).toLocaleString("es-ES")}
                        </span>
                        <span className="text-tl-ink">{r.action}</span>
                        <span className="font-mono text-[10px] text-tl-muted">{r.actorUserId}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </AdminShell>
  );
}

