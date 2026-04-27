"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, RefreshCw, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { cn } from "@/lib/utils";

type OwnerSalesSummaryPayload = {
  meta: { dbAvailable: boolean; note?: string; message?: string };
  window: { mode: "day" | "month"; key: string } | null;
  totals: { OSMAR: number; ALEX: number; totalCents: number; count: number };
  ledger?: {
    window: { pendingCents: number; pendingCount: number; paidCents: number; paidCount: number };
    all: { pendingCents: number; pendingCount: number; paidCents: number; paidCount: number };
  };
};

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export default function OwnersPage() {
  const today = useMemo(() => utcTodayYmd(), []);
  const [mode, setMode] = useState<"day" | "month">("day");
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<OwnerSalesSummaryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("mode", mode);
      if (mode === "day") params.set("date", day);
      else params.set("month", month);
      const res = await fetch(`/api/admin/owner-sales/summary?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as OwnerSalesSummaryPayload;
      setData(json);
      if (!res.ok) setErr(json.meta?.message ?? "No se pudo cargar.");
      else if (json.meta?.dbAvailable === false && json.meta?.message) setErr(json.meta.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [day, mode, month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell title="Dueños">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tl-welcome-header">Ingresos / gastos entre dueños</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Vista resumida del consumo/deuda de dueños (a costo proveedor) y su estado (pendiente/pagada).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
            Actualizar
          </button>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
              Ventana
              <select className="tl-input h-10 px-3 text-sm" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                <option value="day">Diario</option>
                <option value="month">Mensual</option>
              </select>
            </label>
            {mode === "day" ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Día
                <input type="date" className="tl-input h-10 px-3 text-sm" value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Mes
                <input type="month" className="tl-input h-10 px-3 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
              </label>
            )}
            <button type="button" onClick={() => void load()} className="tl-btn tl-btn-primary inline-flex h-10 items-center gap-2 self-end" disabled={loading}>
              <Landmark className="h-4 w-4" aria-hidden />
              Calcular
            </button>
          </div>
          {data?.meta?.note ? <p className="mt-3 text-xs text-tl-muted">{data.meta.note}</p> : null}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            variant="default"
            label="Pendiente (total)"
            value={<CupUsdMoney cents={data?.ledger?.all?.pendingCents ?? 0} />}
            hint={`${data?.ledger?.all?.pendingCount ?? 0} registro(s)`}
            icon={<Users className="h-5 w-5" aria-hidden />}
          />
          <KpiCard
            variant="warning"
            label="Pendiente (ventana)"
            value={<CupUsdMoney cents={data?.ledger?.window?.pendingCents ?? 0} />}
            hint={`${data?.ledger?.window?.pendingCount ?? 0} registro(s)`}
            icon={<Users className="h-5 w-5" aria-hidden />}
          />
          <KpiCard
            variant="success"
            label="Pagado (ventana)"
            value={<CupUsdMoney cents={data?.ledger?.window?.paidCents ?? 0} />}
            hint={`${data?.ledger?.window?.paidCount ?? 0} registro(s)`}
            icon={<Users className="h-5 w-5" aria-hidden />}
          />
          <KpiCard
            variant="info"
            label="Total dueños (pendiente ventana)"
            value={<CupUsdMoney cents={data?.totals?.totalCents ?? 0} />}
            hint={`${data?.totals?.count ?? 0} deuda(s)`}
            icon={<Users className="h-5 w-5" aria-hidden />}
          />
        </div>
      </div>
    </AdminShell>
  );
}

