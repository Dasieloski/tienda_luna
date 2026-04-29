"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { cn } from "@/lib/utils";

type AccountingPayload = {
  meta: { dbAvailable: boolean; message?: string };
  window?: { from: string; to: string };
  income?: {
    totalCents: number;
    cashCents: number;
    transferCents: number;
    usdChannelCents: number;
    otherCents: number;
  };
  expenses?: { totalCents: number; osmarCents: number; alexCents: number };
  margin?: { revenueCents: number; estimatedCostCents: number; grossMarginCents: number };
  net?: { netProfitCents: number; owners: { OSMAR: number; ALEX: number } };
  note?: string;
};

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function rangeIso(fromYmd: string, toYmd: string) {
  return {
    from: `${fromYmd}T00:00:00.000Z`,
    to: `${toYmd}T23:59:59.999Z`,
  };
}

export default function ContabilidadPage() {
  const today = useMemo(() => utcTodayYmd(), []);
  const [fromDay, setFromDay] = useState(() => today);
  const [toDay, setToDay] = useState(() => today);
  const [data, setData] = useState<AccountingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const { from, to } = rangeIso(fromDay, toDay);
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/admin/accounting/summary?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as AccountingPayload;
      setData(json);
      if (!res.ok) setErr("No se pudo cargar contabilidad.");
      else if (json.meta?.dbAvailable === false) setErr(json.meta.message ?? "Base de datos no disponible.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromDay, toDay]);

  useEffect(() => {
    void load();
  }, [load]);

  const income = data?.income ?? { totalCents: 0, cashCents: 0, transferCents: 0, usdChannelCents: 0, otherCents: 0 };
  const expenses = data?.expenses ?? { totalCents: 0, osmarCents: 0, alexCents: 0 };
  const margin = data?.margin ?? { revenueCents: 0, estimatedCostCents: 0, grossMarginCents: 0 };
  const net = data?.net ?? { netProfitCents: 0, owners: { OSMAR: 0, ALEX: 0 } };

  return (
    <AdminShell title="Contabilidad">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tl-welcome-header">Contabilidad</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Ingresos (por pagos), egresos (gastos), margen bruto (con coste) y ganancia neta estimada.
            </p>
          </div>
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <div className="tl-glass rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Desde
              <span className="inline-flex items-center gap-2">
                <Calendar className="h-4 w-4" aria-hidden />
                <input type="date" className="tl-input h-10 px-3 text-sm normal-case font-normal" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Hasta
              <span className="inline-flex items-center gap-2">
                <Calendar className="h-4 w-4" aria-hidden />
                <input type="date" className="tl-input h-10 px-3 text-sm normal-case font-normal" value={toDay} onChange={(e) => setToDay(e.target.value)} />
              </span>
            </label>
            <button
              type="button"
              className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-4 !py-2 text-sm"
              onClick={() => void load()}
              disabled={refreshing}
            >
              Calcular
            </button>
            {data?.note ? <div className="ml-auto text-xs text-tl-muted">{data.note}</div> : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard variant="info" label="Ingresos (pagos)" value={<CupUsdMoney cents={income.totalCents} />} hint="Suma de SalePayment en el rango" />
          <KpiCard variant="warning" label="Egresos (gastos)" value={<CupUsdMoney cents={expenses.totalCents} />} hint="Suma de Expense en el rango" />
          <KpiCard variant="success" label="Margen bruto" value={<CupUsdMoney cents={margin.grossMarginCents} />} hint="Venta (con coste) − coste proveedor" />
          <KpiCard variant="accent" label="Ganancia neta estimada" value={<CupUsdMoney cents={net.netProfitCents} />} hint="Margen bruto − gastos" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="tl-glass rounded-xl p-4">
            <h2 className="text-sm font-semibold text-tl-ink">Ingresos por canal</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <KpiCard variant="default" label="Efectivo" value={<CupUsdMoney cents={income.cashCents} compact />} />
              <KpiCard variant="default" label="Transferencia" value={<CupUsdMoney cents={income.transferCents} compact />} />
              <KpiCard variant="default" label="USD (canal)" value={<CupUsdMoney cents={income.usdChannelCents} compact />} />
              <KpiCard variant="default" label="Otros" value={<CupUsdMoney cents={income.otherCents} compact />} />
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <h2 className="text-sm font-semibold text-tl-ink">Dueños</h2>
            <p className="mt-1 text-xs text-tl-muted">
              Gastos se descuentan según reparto del gasto. Ganancia neta se divide 50/50 por defecto.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <KpiCard variant="default" label="Gastos asignados Osmar" value={<CupUsdMoney cents={expenses.osmarCents} compact />} />
              <KpiCard variant="default" label="Gastos asignados Álex" value={<CupUsdMoney cents={expenses.alexCents} compact />} />
              <KpiCard variant="success" label="Resultado Osmar" value={<CupUsdMoney cents={net.owners.OSMAR} compact />} />
              <KpiCard variant="success" label="Resultado Álex" value={<CupUsdMoney cents={net.owners.ALEX} compact />} />
            </div>
          </div>
        </div>

        {!loading && data?.meta?.dbAvailable === false ? (
          <p className="text-sm text-tl-muted">Base de datos no disponible.</p>
        ) : null}
      </div>
    </AdminShell>
  );
}

