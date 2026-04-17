"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Banknote,
  Calendar,
  CreditCard,
  DollarSign,
  FileDown,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { formatCup, formatUsdFromCupCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type EconomySummary = {
  meta: {
    dbAvailable: boolean;
    message?: string;
  };
  date?: string;
  totals: {
    ventas: number;
    totalCents: number;
    efectivoCents: number;
    transferenciaCents: number;
    usdCents: number;
  };
  buckets: {
    method: string;
    ventas: number;
    totalCents: number;
  }[];
};

type AnalyticsPayload = {
  meta: {
    dbAvailable: boolean;
    generatedAt?: string;
    windowDays?: number;
    note?: string;
    message?: string;
  };
  totals?: {
    lastWindow: { revenueCents: number; saleCount: number; days: number };
    last30: { revenueCents: number; saleCount: number; ticketAvgCents: number };
    last7: { revenueCents: number; saleCount: number; ticketAvgCents: number };
    today: { revenueCents: number; saleCount: number };
    currentMonth: { revenueCents: number; saleCount: number; ticketAvgCents: number };
    previousMonth: { revenueCents: number; saleCount: number };
  };
  averages?: {
    dailyRevenueLast30Cents: number;
    dailyRevenueLast7Cents: number;
    monthlyRevenueAvgRecentCents: number;
    monthsIncluded: number;
  };
  comparisons?: {
    momRevenuePct: number | null;
    momSaleCountPct: number | null;
    trendShortVsLongPct: number | null;
    shortLabel?: string;
    longLabel?: string;
  };
  extrema?: {
    last90Days: {
      minDaily: { date: string; revenueCents: number; sales: number } | null;
      maxDaily: { date: string; revenueCents: number; sales: number } | null;
    };
  };
  projection?: {
    monthEndRevenueCents: number | null;
    method?: string;
  };
  marginFromCost?: {
    revenueCents: number;
    estimatedCostCents: number;
    marginCents: number;
    marginPct: number | null;
    linesWithCost: number;
    linesWithoutCost: number;
    note?: string;
  };
  paymentMixLast30?: { method: string; revenueCents: number; sales: number; pctOfRevenue: number }[];
  devicesLast30?: { deviceId: string; revenueCents: number; sales: number; pctOfRevenue: number }[];
  hourOfDayLast30?: { hour: number; revenueCents: number; sales: number }[];
  peakHourLast30?: { hour: number; revenueCents: number; sales: number };
  seasonalityByWeekday365d?: { isoDow: number; label: string; revenueCents: number; sales: number }[];
  peakWeekday365d?: { isoDow: number; label: string; revenueCents: number; sales: number };
  monthlySeries?: { month: string; revenueCents: number; sales: number }[];
};

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} %`;
}

function InterpretBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-tl-ink-secondary">{children}</div>
    </div>
  );
}

export default function EconomyPage() {
  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const [date, setDate] = useState(today);
  const [data, setData] = useState<EconomySummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("date", date);
      const res = await fetch(`/api/admin/economy/summary?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const json = (await res.json()) as EconomySummary;
      if (!res.ok) {
        setError(json.meta?.message ?? "No se pudo cargar la economía del día.");
      }
      setData(json);
      if (json.meta?.dbAvailable === false && json.meta?.message) {
        setError(json.meta.message);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Error de red al cargar economía.");
    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, [date]);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/economy/analytics?windowDays=90", { credentials: "include" });
      const json = (await res.json()) as AnalyticsPayload;
      setAnalytics(json);
    } catch {
      setAnalytics(null);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (initialLoading && !data) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 rounded-full border-2 border-tl-accent border-t-transparent tl-spin" />
          <p className="text-sm text-tl-muted">Cargando economía de la tienda…</p>
        </div>
      </AdminShell>
    );
  }

  const totals = data?.totals ?? {
    ventas: 0,
    totalCents: 0,
    efectivoCents: 0,
    transferenciaCents: 0,
    usdCents: 0,
  };

  const cajaCup = totals.efectivoCents + totals.transferenciaCents + totals.usdCents;

  const t = analytics?.totals;
  const avg = analytics?.averages;
  const cmp = analytics?.comparisons;
  const ext = analytics?.extrema?.last90Days;
  const proj = analytics?.projection;
  const mar = analytics?.marginFromCost;
  const pay = analytics?.paymentMixLast30 ?? [];
  const dev = analytics?.devicesLast30 ?? [];
  const hrs = analytics?.hourOfDayLast30 ?? [];
  const peakH = analytics?.peakHourLast30;
  const dow = analytics?.seasonalityByWeekday365d ?? [];
  const peakD = analytics?.peakWeekday365d;
  const months = analytics?.monthlySeries ?? [];

  const conclusions = useMemo(() => {
    const out: string[] = [];
    if (!analytics?.meta?.dbAvailable) return out;
    if (cmp?.momRevenuePct != null) {
      out.push(
        `Mes en curso vs. mes anterior: ingresos ${cmp.momRevenuePct >= 0 ? "superiores" : "inferiores"} en ${Math.abs(cmp.momRevenuePct).toFixed(1)} % (solo ventas COMPLETED en base).`,
      );
    }
    if (cmp?.trendShortVsLongPct != null && avg) {
      out.push(
        `Ritmo reciente (7 días) frente a base 30 días: ${cmp.trendShortVsLongPct >= 0 ? "alza" : "baja"} del ${Math.abs(cmp.trendShortVsLongPct).toFixed(1)} % en el promedio diario.`,
      );
    }
    if (peakH && peakH.revenueCents > 0) {
      out.push(
        `En los últimos 30 días el mayor volumen de ingresos se concentra alrededor de las ${String(peakH.hour).padStart(2, "0")}:00 (hora del timestamp almacenado).`,
      );
    }
    if (peakD && peakD.revenueCents > 0) {
      out.push(`En el último año, el día ISO ${peakD.isoDow} (${peakD.label}) acumula más ingresos que el resto de la semana.`);
    }
    if (pay.length > 0) {
      const top = pay[0]!;
      out.push(
        `La forma de pago con mayor peso en ingresos (30 días) es “${top.method}” (${top.pctOfRevenue.toFixed(1)} % del total atribuible vía eventos SALE_COMPLETED).`,
      );
    }
    if (dev.length > 0) {
      const topD = dev[0]!;
      out.push(
        `El dispositivo “${topD.deviceId}” concentra el ${topD.pctOfRevenue.toFixed(1)} % de los ingresos de los últimos 30 días entre los terminales listados.`,
      );
    }
    if (mar && mar.revenueCents > 0 && mar.linesWithCost > 0) {
      out.push(
        `Margen bruto estimado (precio de venta − costo en catálogo) en líneas con costo: ${mar.marginPct != null ? mar.marginPct.toFixed(1) + " % del ingreso de esas líneas." : "ver tabla de margen."}`,
      );
    }
    return out;
  }, [analytics, cmp, dev, mar, pay, peakD, peakH]);

  return (
    <AdminShell title="Economía">
      <div className="space-y-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Economía de la tienda</h1>
            <p className="mt-2 max-w-3xl text-sm text-tl-muted">
              Panel técnico basado en <strong className="text-tl-ink">Sale</strong> (ventas completadas),
              enlaces a <strong className="text-tl-ink">Event</strong> tipo <code className="font-mono text-xs">SALE_COMPLETED</code> para
              método de pago, y <strong className="text-tl-ink">Product.costCents</strong> para márgenes estimados. No se modelan gastos
              operativos ni impuestos: cualquier indicador que no derive de esas tablas no aparece aquí.
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
            <a
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              href={`/api/admin/economy/export?date=${encodeURIComponent(date)}`}
              title="Exportar CSV"
            >
              <FileDown className="h-4 w-4" aria-hidden />
              Exportar CSV
            </a>
            <button
              type="button"
              onClick={() => {
                void loadSummary();
                void loadAnalytics();
              }}
              className={cn(
                "tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
              )}
              disabled={refreshing}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
              {refreshing ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        {/* Día seleccionado */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-tl-ink">1. Caja del día seleccionado</h2>
          <p className="text-sm text-tl-muted">
            Corresponde a ventas con <code className="font-mono text-xs">completedAt</code> dentro del día calendario elegido. Los importes
            vienen de <code className="font-mono text-xs">Sale.totalCents</code> agrupados por método inferido del texto de pago en el evento
            de cierre.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ventas (día)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">{totals.ventas.toLocaleString("es-ES")}</p>
              <p className="mt-2 text-xs text-tl-muted">Número de tickets con evento de cierre válido ese día.</p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ingreso bruto (día)</p>
              <div className="mt-1 text-xl font-bold text-tl-ink sm:text-2xl">
                <CupUsdMoney cents={totals.totalCents} />
              </div>
              <p className="mt-2 text-xs text-tl-muted">Suma de totales de venta; el USD en verde usa el cambio configurado en tienda.</p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Total en CUP (suma métodos)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">{formatCup(cajaCup)}</p>
              <p className="mt-2 text-xs text-tl-muted">Suma de buckets efectivo + transferencia + USD (cada uno en céntimos CUP almacenados).</p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Equivalente USD (caja)</p>
              <p className="mt-1 text-2xl font-bold text-tl-success tabular-nums">{formatUsdFromCupCents(cajaCup)}</p>
              <p className="mt-2 text-xs text-tl-muted">Mismo total anterior expresado en USD al cambio actual.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="tl-glass flex items-center gap-3 rounded-xl p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tl-success-subtle">
                <Banknote className="h-5 w-5 text-tl-success" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Efectivo CUP</p>
                <div className="text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.efectivoCents} />
                </div>
              </div>
            </div>
            <div className="tl-glass flex items-center gap-3 rounded-xl p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tl-accent-subtle">
                <CreditCard className="h-5 w-5 text-tl-accent" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Transferencias CUP</p>
                <div className="text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.transferenciaCents} />
                </div>
              </div>
            </div>
            <div className="tl-glass flex items-center gap-3 rounded-xl p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tl-warning-subtle">
                <DollarSign className="h-5 w-5 text-tl-warning" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ventas en USD (texto método)</p>
                <div className="text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.usdCents} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Analítica agregada */}
        {analytics?.meta?.dbAvailable && t && avg && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-tl-ink">2. Ingresos y actividad (histórico en base de datos)</h2>
            <p className="max-w-4xl text-sm text-tl-muted">{analytics.meta.note}</p>

            <div className="grid gap-4 lg:grid-cols-3">
              <InterpretBlock title="Ingreso diario total (hoy, UTC calendario servidor)">
                <p>
                  <CupUsdMoney cents={t.today.revenueCents} /> en {t.today.saleCount} ventas.
                </p>
                <p className="text-tl-muted">
                  Sirve para contrastar con el día elegido en la sección 1 (puede diferir si operas en otra zona horaria).
                </p>
              </InterpretBlock>
              <InterpretBlock title="Ingreso mensual total (mes calendario en curso)">
                <p>
                  <CupUsdMoney cents={t.currentMonth.revenueCents} /> · ticket medio{" "}
                  <CupUsdMoney cents={t.currentMonth.ticketAvgCents} />.
                </p>
                <p className="text-tl-muted">Ticket medio = ingreso del mes ÷ número de ventas del mes.</p>
              </InterpretBlock>
              <InterpretBlock title="Ingreso mensual (mes calendario anterior)">
                <p>
                  <CupUsdMoney cents={t.previousMonth.revenueCents} /> en {t.previousMonth.saleCount} ventas.
                </p>
                <p className="text-tl-muted">Base para la variación porcentual mes a mes.</p>
              </InterpretBlock>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <InterpretBlock title="Promedio de ingreso diario (últimos 30 días)">
                <p>
                  <CupUsdMoney cents={avg.dailyRevenueLast30Cents} /> por día calendario (ingreso total 30d ÷ 30).
                </p>
              </InterpretBlock>
              <InterpretBlock title="Promedio de ingreso diario (últimos 7 días)">
                <p>
                  <CupUsdMoney cents={avg.dailyRevenueLast7Cents} /> por día (ingreso 7d ÷ 7).
                </p>
              </InterpretBlock>
              <InterpretBlock title="Promedio de ingreso mensual (meses con datos recientes)">
                <p>
                  <CupUsdMoney cents={avg.monthlyRevenueAvgRecentCents} /> sobre {avg.monthsIncluded} mes(es) con al menos una venta
                  registrada.
                </p>
              </InterpretBlock>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <InterpretBlock title="Variación porcentual entre meses (ingresos)">
                <p className="flex items-center gap-2 text-lg font-semibold text-tl-ink">
                  {cmp?.momRevenuePct != null && cmp.momRevenuePct >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-tl-success" aria-hidden />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-tl-warning" aria-hidden />
                  )}
                  {fmtPct(cmp?.momRevenuePct)}
                </p>
                <p className="text-tl-muted">Comparación estricta mes en curso vs. mes anterior (misma fuente Sale).</p>
              </InterpretBlock>
              <InterpretBlock title="Variación en número de ventas (mes vs. mes)">
                <p className="text-lg font-semibold text-tl-ink">{fmtPct(cmp?.momSaleCountPct)}</p>
                <p className="text-tl-muted">Mide si el cambio de ingresos viene de más tickets o de tickets más altos.</p>
              </InterpretBlock>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <InterpretBlock title="Crecimiento o disminución de ritmo (7 vs. 30 días)">
                <p className="text-lg font-semibold text-tl-ink">{fmtPct(cmp?.trendShortVsLongPct)}</p>
                <p className="text-tl-muted">
                  {cmp?.shortLabel} frente a {cmp?.longLabel}. Valor positivo: la semana reciente va por encima del promedio mensual
                  reciente.
                </p>
              </InterpretBlock>
              <InterpretBlock title="Proyección simple de cierre de mes">
                <p className="text-lg font-semibold text-tl-ink">
                  {proj?.monthEndRevenueCents != null ? <CupUsdMoney cents={proj.monthEndRevenueCents} /> : "—"}
                </p>
                <p className="text-xs text-tl-muted">{proj?.method}</p>
              </InterpretBlock>
            </div>

            <div className="tl-glass overflow-x-auto rounded-xl">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="border-b border-tl-line bg-tl-canvas-inset px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                  Serie mensual de ingresos (desde hace ~6 meses)
                </caption>
                <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                  <tr>
                    <th className="px-4 py-3">Mes</th>
                    <th className="px-4 py-3 text-right">Ventas</th>
                    <th className="px-4 py-3 text-right">Ingreso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tl-line-subtle">
                  {months.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-tl-muted">
                        Sin ventas en el rango consultado.
                      </td>
                    </tr>
                  ) : (
                    months.map((m) => (
                      <tr key={m.month}>
                        <td className="px-4 py-3 font-mono text-tl-ink">{m.month}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{m.sales.toLocaleString("es-ES")}</td>
                        <td className="px-4 py-3 text-right">
                          <CupUsdMoney cents={m.revenueCents} compact />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <InterpretBlock title="Ingreso mínimo y máximo por día (últimos 90 días)">
                {ext?.minDaily && ext?.maxDaily ? (
                  <ul className="list-inside list-disc space-y-1">
                    <li>
                      Mínimo: {ext.minDaily.date} — <CupUsdMoney cents={ext.minDaily.revenueCents} compact /> (
                      {ext.minDaily.sales} ventas)
                    </li>
                    <li>
                      Máximo: {ext.maxDaily.date} — <CupUsdMoney cents={ext.maxDaily.revenueCents} compact /> (
                      {ext.maxDaily.sales} ventas)
                    </li>
                  </ul>
                ) : (
                  <p className="text-tl-muted">Datos insuficientes para calcular extremos diarios en la ventana.</p>
                )}
              </InterpretBlock>
              <InterpretBlock title="Ticket medio por transacción (últimos 30 y 7 días)">
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    30 días: <CupUsdMoney cents={t.last30.ticketAvgCents} compact />
                  </li>
                  <li>
                    7 días: <CupUsdMoney cents={t.last7.ticketAvgCents} compact />
                  </li>
                </ul>
                <p className="text-tl-muted">
                  Cada venta en base cuenta como una transacción; no hay identidad de cliente en el modelo actual.
                </p>
              </InterpretBlock>
            </div>

            {mar && mar.revenueCents > 0 && (
              <div className="tl-glass rounded-xl p-4">
                <h3 className="text-sm font-semibold text-tl-ink">Margen bruto estimado (líneas de venta con costo en catálogo)</h3>
                <p className="mt-1 text-xs text-tl-muted">{mar.note}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-tl-muted">Ingreso atribuible (30d)</p>
                    <CupUsdMoney cents={mar.revenueCents} />
                  </div>
                  <div>
                    <p className="text-xs text-tl-muted">Coste estimado</p>
                    <CupUsdMoney cents={mar.estimatedCostCents} />
                  </div>
                  <div>
                    <p className="text-xs text-tl-muted">Margen céntimos</p>
                    <CupUsdMoney cents={mar.marginCents} />
                  </div>
                  <div>
                    <p className="text-xs text-tl-muted">Margen % sobre ingreso</p>
                    <p className="text-lg font-bold text-tl-ink">{mar.marginPct != null ? `${mar.marginPct.toFixed(1)} %` : "—"}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-tl-muted">
                  Líneas con costo: {mar.linesWithCost.toLocaleString("es-ES")} · sin costo:{" "}
                  {mar.linesWithoutCost.toLocaleString("es-ES")}
                </p>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="tl-glass overflow-x-auto rounded-xl">
                <table className="w-full min-w-[360px] text-left text-sm">
                  <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                    Mezcla de métodos de pago (30 días, por ingreso)
                  </caption>
                  <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase text-tl-muted">
                    <tr>
                      <th className="px-4 py-3">Método</th>
                      <th className="px-4 py-3 text-right">%</th>
                      <th className="px-4 py-3 text-right">Ingreso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tl-line-subtle">
                    {pay.map((p) => (
                      <tr key={p.method}>
                        <td className="px-4 py-2 font-mono text-xs text-tl-ink">{p.method}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.pctOfRevenue.toFixed(1)} %</td>
                        <td className="px-4 py-2 text-right">
                          <CupUsdMoney cents={p.revenueCents} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tl-glass overflow-x-auto rounded-xl">
                <table className="w-full min-w-[360px] text-left text-sm">
                  <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                    Ingresos por dispositivo (30 días)
                  </caption>
                  <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase text-tl-muted">
                    <tr>
                      <th className="px-4 py-3">Dispositivo</th>
                      <th className="px-4 py-3 text-right">%</th>
                      <th className="px-4 py-3 text-right">Ingreso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tl-line-subtle">
                    {dev.map((d) => (
                      <tr key={d.deviceId}>
                        <td className="max-w-[200px] truncate px-4 py-2 font-mono text-xs text-tl-ink" title={d.deviceId}>
                          {d.deviceId}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.pctOfRevenue.toFixed(1)} %</td>
                        <td className="px-4 py-2 text-right">
                          <CupUsdMoney cents={d.revenueCents} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tl-glass overflow-x-auto rounded-xl">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                  Distribución horaria de ingresos (últimos 30 días; importe en CUP por celda)
                </caption>
                <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase text-tl-muted">
                  <tr>
                    <th className="px-4 py-3">Hora</th>
                    {hrs.map((h) => (
                      <th key={h.hour} className="px-2 py-3 text-center">
                        {String(h.hour).padStart(2, "0")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-2 text-tl-muted">Ingreso</td>
                    {hrs.map((h) => (
                      <td key={h.hour} className="max-w-[72px] px-1 py-2 text-center text-[10px] leading-tight text-tl-ink sm:text-xs">
                        {h.revenueCents > 0 ? formatCup(h.revenueCents) : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-4 py-2 text-tl-muted">Ventas</td>
                    {hrs.map((h) => (
                      <td key={h.hour} className="px-2 py-2 text-center text-xs tabular-nums text-tl-muted">
                        {h.sales > 0 ? h.sales : ""}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              {peakH && (
                <p className="border-t border-tl-line px-4 py-2 text-xs text-tl-muted">
                  Pico en la tabla: hora {String(peakH.hour).padStart(2, "0")}:00 con{" "}
                  <CupUsdMoney cents={peakH.revenueCents} compact /> y {peakH.sales} ventas.
                </p>
              )}
            </div>

            <div className="tl-glass overflow-x-auto rounded-xl">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                  Estacionalidad semanal (últimos 365 días, ISO día 1 = lunes)
                </caption>
                <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase text-tl-muted">
                  <tr>
                    <th className="px-4 py-3">Día</th>
                    <th className="px-4 py-3 text-right">Ventas</th>
                    <th className="px-4 py-3 text-right">Ingreso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tl-line-subtle">
                  {dow.map((d) => (
                    <tr key={d.isoDow}>
                      <td className="px-4 py-2">
                        {d.label}{" "}
                        {peakD?.isoDow === d.isoDow ? (
                          <span className="ml-2 rounded-full bg-tl-success-subtle px-2 py-0.5 text-[10px] font-semibold text-tl-success">
                            pico
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{d.sales.toLocaleString("es-ES")}</td>
                      <td className="px-4 py-2 text-right">
                        <CupUsdMoney cents={d.revenueCents} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {conclusions.length > 0 && (
              <div className="tl-glass rounded-xl border border-tl-line-subtle p-4">
                <h3 className="text-sm font-semibold text-tl-ink">Conclusiones automatizadas (solo hechos observados)</h3>
                <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-tl-ink-secondary">
                  {conclusions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Detalle día: métodos exactos */}
        <section>
          <h2 className="text-lg font-semibold text-tl-ink">3. Detalle por método exacto (día seleccionado)</h2>
          <p className="mt-1 max-w-3xl text-sm text-tl-muted">
            Cada fila es el literal de <code className="font-mono text-xs">paymentMethod</code> en el evento de cierre. Agrupa ingresos
            reales sin reinterpretar el significado comercial del string.
          </p>

          <div className="mt-3 overflow-x-auto tl-glass rounded-xl">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3">Ventas</th>
                  <th className="px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {(data?.buckets ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-tl-muted">
                      No hay ventas económicas registradas para esta fecha.
                    </td>
                  </tr>
                ) : (
                  data?.buckets.map((b) => (
                    <tr key={b.method}>
                      <td className="px-4 py-3 text-sm text-tl-ink">{b.method || "Sin especificar"}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-tl-ink">{b.ventas.toLocaleString("es-ES")}</td>
                      <td className="px-4 py-3 text-sm text-tl-ink">
                        <CupUsdMoney cents={b.totalCents} compact />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="tl-glass flex items-start gap-3 rounded-xl border-tl-line-subtle bg-tl-canvas-inset p-4">
            <ReceiptText className="mt-0.5 h-5 w-5 text-tl-muted" aria-hidden />
            <div className="text-xs leading-relaxed text-tl-muted">
              <p>
                Límites del modelo de datos: no existen tablas de gastos, nómina ni impuestos; “flujo de caja” y “beneficio neto” en sentido
                contable no se calculan aquí. La proyección de fin de mes es una extrapolación lineal del ritmo de 7 días y no sustituye un
                pronóstico financiero.
              </p>
              <p className="mt-2">
                El equivalente USD usa el cambio almacenado en la tienda (panel Cambio). Si el método de pago no refleja la moneda física
                cobrada, la agrupación efectivo / transferencia / USD puede desviarse de la caja real.
              </p>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
