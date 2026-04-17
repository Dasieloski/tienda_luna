"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Banknote,
  Calendar,
  CreditCard,
  DollarSign,
  FileDown,
  PieChart,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
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
    window?: string;
    revenueCents: number;
    estimatedCostCents: number;
    marginCents: number;
    marginPct: number | null;
    linesWithCost: number;
    linesWithoutCost: number;
    note?: string;
  };
  marginTodayFromCost?: {
    window?: string;
    revenueCents: number;
    estimatedCostCents: number;
    marginCents: number;
    marginPct: number | null;
    linesWithCost: number;
    linesWithoutCost: number;
    note?: string;
  };
  marginMonthFromCost?: {
    window?: string;
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

type MarginRangePayload = {
  meta: {
    dbAvailable: boolean;
    timezone?: string;
    fromInclusive?: string;
    toInclusive?: string;
    note?: string;
    message?: string;
  };
  totals?: {
    soldRevenueCents: number;
    supplierCostCents: number;
    marginCents: number;
    marginPct: number | null;
    salesCount: number;
    linesWithCost: number;
    linesWithoutCost: number;
  };
  error?: string;
};

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToYmd(ymd: string, deltaDays: number) {
  const [y, mo, da] = ymd.split("-").map(Number) as [number, number, number];
  const x = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0, 0));
  x.setUTCDate(x.getUTCDate() + deltaDays);
  return x.toISOString().slice(0, 10);
}

function initialMarginRangeUtc() {
  const to = utcTodayYmd();
  const from = addDaysToYmd(to, -29);
  return { from, to };
}

type RangePresetId =
  | "last7"
  | "last30"
  | "last90"
  | "last365"
  | "curMonth"
  | "prevMonth"
  | "curQuarter"
  | "prevQuarter"
  | "curYear";

function rangeForPreset(id: RangePresetId): { from: string; to: string } {
  const to = utcTodayYmd();
  const [Y, M] = to.split("-").map(Number) as [number, number];

  switch (id) {
    case "last7":
      return { from: addDaysToYmd(to, -6), to };
    case "last30":
      return { from: addDaysToYmd(to, -29), to };
    case "last90":
      return { from: addDaysToYmd(to, -89), to };
    case "last365":
      return { from: addDaysToYmd(to, -364), to };
    case "curMonth":
      return { from: `${Y}-${String(M).padStart(2, "0")}-01`, to };
    case "prevMonth": {
      const ref = new Date(Date.UTC(Y, M - 2, 1));
      const y = ref.getUTCFullYear();
      const m = ref.getUTCMonth();
      const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const last = new Date(Date.UTC(y, m + 1, 0));
      return { from, to: last.toISOString().slice(0, 10) };
    }
    case "curQuarter": {
      const q = Math.floor((M - 1) / 3);
      const startMonth = q * 3 + 1;
      const from = `${Y}-${String(startMonth).padStart(2, "0")}-01`;
      return { from, to };
    }
    case "prevQuarter": {
      const curQ = Math.floor((M - 1) / 3);
      let py = Y;
      let pq = curQ - 1;
      if (pq < 0) {
        pq = 3;
        py -= 1;
      }
      const sm = pq * 3 + 1;
      const from = `${py}-${String(sm).padStart(2, "0")}-01`;
      const last = new Date(Date.UTC(py, (pq + 1) * 3, 0));
      return { from, to: last.toISOString().slice(0, 10) };
    }
    case "curYear":
      return { from: `${Y}-01-01`, to };
    default:
      return initialMarginRangeUtc();
  }
}

const RANGE_PRESETS: { id: RangePresetId; label: string }[] = [
  { id: "last7", label: "Última semana" },
  { id: "last30", label: "Último mes" },
  { id: "last90", label: "Último trimestre" },
  { id: "last365", label: "Último año" },
  { id: "curMonth", label: "Mes en curso" },
  { id: "prevMonth", label: "Mes anterior" },
  { id: "curQuarter", label: "Trimestre en curso" },
  { id: "prevQuarter", label: "Trimestre anterior" },
  { id: "curYear", label: "Año en curso" },
];

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} %`;
}

/** Bloque de sección con título y subtítulo breve */
function EconomySectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-tl-ink">
        {icon}
        {title}
      </h2>
      {subtitle ? <p className="mt-1 max-w-3xl text-sm text-tl-muted">{subtitle}</p> : null}
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

  const defaultMarginRangeUtc = useMemo(() => initialMarginRangeUtc(), []);

  const [date, setDate] = useState(today);
  const [data, setData] = useState<EconomySummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [rangeFrom, setRangeFrom] = useState(defaultMarginRangeUtc.from);
  const [rangeTo, setRangeTo] = useState(defaultMarginRangeUtc.to);
  const [marginRange, setMarginRange] = useState<MarginRangePayload | null>(null);
  const [marginRangeLoading, setMarginRangeLoading] = useState(false);
  const [marginRangeErr, setMarginRangeErr] = useState<string | null>(null);
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

  const fetchMarginRange = useCallback(async (from: string, to: string) => {
    setMarginRangeLoading(true);
    setMarginRangeErr(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/admin/economy/margin-range?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as MarginRangePayload & { error?: string; maxDays?: number };
      if (!res.ok) {
        if (json.error === "RANGE_TOO_LONG") {
          setMarginRangeErr(`El rango máximo permitido es ${String(json.maxDays ?? 400)} días.`);
        } else if (json.error === "INVALID_RANGE") {
          setMarginRangeErr("La fecha inicial no puede ser posterior a la final.");
        } else {
          setMarginRangeErr("No se pudo cargar el periodo seleccionado.");
        }
        setMarginRange(null);
        return;
      }
      setMarginRange(json);
      if (json.meta?.dbAvailable === false && json.meta?.message) {
        setMarginRangeErr(json.meta.message);
      }
    } catch {
      setMarginRangeErr("Error de red al consultar el periodo.");
      setMarginRange(null);
    } finally {
      setMarginRangeLoading(false);
    }
  }, []);

  function applyRangePreset(id: RangePresetId) {
    const r = rangeForPreset(id);
    setRangeFrom(r.from);
    setRangeTo(r.to);
    void fetchMarginRange(r.from, r.to);
  }

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    void fetchMarginRange(defaultMarginRangeUtc.from, defaultMarginRangeUtc.to);
  }, [fetchMarginRange, defaultMarginRangeUtc.from, defaultMarginRangeUtc.to]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const conclusions = useMemo(() => {
    const out: string[] = [];
    if (!analytics?.meta?.dbAvailable) return out;
    const cmp = analytics.comparisons;
    const avg = analytics.averages;
    const peakH = analytics.peakHourLast30;
    const peakD = analytics.peakWeekday365d;
    const pay = analytics.paymentMixLast30 ?? [];
    const dev = analytics.devicesLast30 ?? [];
    const mar = analytics.marginFromCost;
    const marT = analytics.marginTodayFromCost;
    const marM = analytics.marginMonthFromCost;
    if (cmp?.momRevenuePct != null) {
      out.push(
        `Mes en curso vs. mes anterior: ingresos ${cmp.momRevenuePct >= 0 ? "superiores" : "inferiores"} en ${Math.abs(cmp.momRevenuePct).toFixed(1)} % (solo ventas cerradas).`,
      );
    }
    if (cmp?.trendShortVsLongPct != null && avg) {
      out.push(
        `Ritmo reciente (7 días) frente a base 30 días: ${cmp.trendShortVsLongPct >= 0 ? "alza" : "baja"} del ${Math.abs(cmp.trendShortVsLongPct).toFixed(1)} % en el promedio diario.`,
      );
    }
    if (peakH && peakH.revenueCents > 0) {
      out.push(
        `En los últimos 30 días el mayor volumen de ingresos se concentra alrededor de las ${String(peakH.hour).padStart(2, "0")}:00.`,
      );
    }
    if (peakD && peakD.revenueCents > 0) {
      out.push(`En el último año, el ${peakD.label} acumula más ingresos que el resto de la semana.`);
    }
    if (pay.length > 0) {
      const top = pay[0]!;
      out.push(
        `La forma de pago con mayor peso en ingresos (30 días) es “${top.method}” (${top.pctOfRevenue.toFixed(1)} % del total).`,
      );
    }
    if (dev.length > 0) {
      const topD = dev[0]!;
      out.push(
        `El terminal que más ingresa (últimos 30 días) aporta alrededor del ${topD.pctOfRevenue.toFixed(1)} % del total entre cajas registradas.`,
      );
    }
    if (marT && marT.revenueCents > 0 && marT.linesWithCost > 0 && marT.marginPct != null) {
      out.push(
        `Hoy, el margen bruto estimado en líneas con coste en catálogo ronda el ${marT.marginPct.toFixed(1)} % de lo vendido en esas líneas.`,
      );
    }
    if (marM && marM.revenueCents > 0 && marM.linesWithCost > 0 && marM.marginPct != null) {
      out.push(
        `En el mes en curso, el margen bruto estimado (misma regla) ronda el ${marM.marginPct.toFixed(1)} % del ingreso atribuible con coste.`,
      );
    }
    if (mar && mar.revenueCents > 0 && mar.linesWithCost > 0) {
      out.push(
        `Margen bruto estimado (precio de venta − costo en catálogo) en líneas con costo: ${mar.marginPct != null ? mar.marginPct.toFixed(1) + " % del ingreso de esas líneas." : "ver tabla de margen."}`,
      );
    }
    return out;
  }, [analytics]);

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
  const marToday = analytics?.marginTodayFromCost;
  const marMonth = analytics?.marginMonthFromCost;
  const pay = analytics?.paymentMixLast30 ?? [];
  const dev = analytics?.devicesLast30 ?? [];
  const hrs = analytics?.hourOfDayLast30 ?? [];
  const peakH = analytics?.peakHourLast30;
  const dow = analytics?.seasonalityByWeekday365d ?? [];
  const peakD = analytics?.peakWeekday365d;
  const months = analytics?.monthlySeries ?? [];

  return (
    <AdminShell title="Economía">
      <div className="mx-auto max-w-6xl space-y-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Economía de la tienda</h1>
            <p className="mt-2 max-w-3xl text-sm text-tl-muted">
              Ingresos, caja por día y tendencias. El equivalente en USD usa el cambio configurado en la tienda.
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
                void fetchMarginRange(rangeFrom, rangeTo);
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

        {analytics?.meta?.dbAvailable && mar && (
          <div className="relative overflow-hidden rounded-2xl border-2 border-tl-success/45 bg-gradient-to-br from-tl-success-subtle via-tl-canvas-inset to-tl-canvas p-6 shadow-lg ring-1 ring-tl-success/30 sm:p-8">
            <div
              className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-tl-success/25 blur-3xl"
              aria-hidden
            />
            <p className="relative text-xs font-bold uppercase tracking-[0.2em] text-tl-success">
              Ganancia de la tienda
            </p>
            <p className="relative mt-1 text-sm font-medium text-tl-ink">Últimos 30 días · ventas cerradas</p>
            <p className="relative mt-1 max-w-2xl text-xs text-tl-muted">
              Solo líneas con precio de compra en el producto: venta menos lo que pagas al proveedor por unidad. Lo que
              no tiene coste en catálogo no entra en este cálculo.
            </p>
            <div className="relative mt-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div>
                <p className="text-xs text-tl-muted">Ganancia neta (PVP − proveedor)</p>
                <div className="mt-1">
                  <CupUsdMoney cents={mar.marginCents} className="!text-2xl !font-bold sm:!text-4xl" />
                </div>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="text-xs text-tl-muted">Vendido (solo líneas con coste)</p>
                  <CupUsdMoney cents={mar.revenueCents} compact />
                </div>
                <div>
                  <p className="text-xs text-tl-muted">Coste a proveedor</p>
                  <CupUsdMoney cents={mar.estimatedCostCents} compact />
                </div>
                <div>
                  <p className="text-xs text-tl-muted">Margen sobre venta</p>
                  <p className="text-lg font-bold tabular-nums text-tl-ink">
                    {mar.marginPct != null ? `${mar.marginPct.toFixed(1)} %` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Día seleccionado */}
        <section className="space-y-4">
          <EconomySectionHeader
            title="Caja del día"
            subtitle="Ventas cerradas en la fecha del calendario. Abajo, cómo se reparte por forma de pago."
            icon={<Calendar className="h-5 w-5 text-tl-accent" aria-hidden />}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              variant="accent"
              label="Ventas del día"
              value={totals.ventas.toLocaleString("es-ES")}
              hint="Tickets registrados"
              icon={<ReceiptText className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="info"
              label="Ingreso del día"
              value={<CupUsdMoney cents={totals.totalCents} />}
              hint="Todo lo vendido ese día"
              icon={<PieChart className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="default"
              label="Total en CUP (caja)"
              value={formatCup(cajaCup)}
              hint="Efectivo + transferencias + USD en CUP"
              icon={<Banknote className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="success"
              label="Equivalente en USD"
              value={formatUsdFromCupCents(cajaCup)}
              hint="Al cambio actual"
              icon={<DollarSign className="h-5 w-5" aria-hidden />}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              variant="success"
              label="Efectivo CUP"
              value={<CupUsdMoney cents={totals.efectivoCents} />}
              icon={<Banknote className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="info"
              label="Transferencias CUP"
              value={<CupUsdMoney cents={totals.transferenciaCents} />}
              icon={<CreditCard className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="warning"
              label="Ventas en USD"
              value={<CupUsdMoney cents={totals.usdCents} />}
              hint="Como quedó en caja"
              icon={<DollarSign className="h-5 w-5" aria-hidden />}
            />
          </div>
        </section>

        <section className="space-y-4 border-t border-tl-line-subtle pt-10">
          <EconomySectionHeader
            title="Ganancia por rango de fechas"
            subtitle="Solo líneas con coste de proveedor en el catálogo: lo vendido menos lo que pagas al proveedor por unidad."
            icon={<PieChart className="h-5 w-5 text-tl-accent" aria-hidden />}
          />

          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-1.5 text-xs"
                onClick={() => applyRangePreset(p.id)}
                disabled={marginRangeLoading}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Desde
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm normal-case font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Hasta
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm normal-case font-normal"
              />
            </label>
            <button
              type="button"
              className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-4 !py-2 text-sm"
              disabled={marginRangeLoading}
              onClick={() => void fetchMarginRange(rangeFrom, rangeTo)}
            >
              {marginRangeLoading ? "Consultando…" : "Consultar"}
            </button>
          </div>

          {marginRangeErr && (
            <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
              {marginRangeErr}
            </div>
          )}

          {marginRange?.meta?.dbAvailable && marginRange.totals && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-tl-ink">
                Periodo:{" "}
                <span className="tabular-nums text-tl-muted">
                  {marginRange.meta.fromInclusive} → {marginRange.meta.toInclusive}
                </span>
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  variant="info"
                  label="Vendido (con coste)"
                  value={<CupUsdMoney cents={marginRange.totals.soldRevenueCents} />}
                  hint="Solo líneas con precio de compra"
                  icon={<PieChart className="h-5 w-5" aria-hidden />}
                />
                <KpiCard
                  variant="warning"
                  label="Coste proveedor"
                  value={<CupUsdMoney cents={marginRange.totals.supplierCostCents} />}
                  hint="Unidades × compra en catálogo"
                  icon={<Banknote className="h-5 w-5" aria-hidden />}
                />
                <KpiCard
                  variant="success"
                  label="Ganancia de la tienda"
                  value={<CupUsdMoney cents={marginRange.totals.marginCents} />}
                  hint="Vendido − coste"
                  icon={<TrendingUp className="h-5 w-5" aria-hidden />}
                />
                <KpiCard
                  variant="default"
                  label="Margen sobre venta"
                  value={marginRange.totals.marginPct != null ? `${marginRange.totals.marginPct.toFixed(1)} %` : "—"}
                  hint={`${marginRange.totals.salesCount.toLocaleString("es-ES")} ventas en el periodo`}
                  icon={<ReceiptText className="h-5 w-5" aria-hidden />}
                />
              </div>
              <p className="text-xs text-tl-muted">
                Líneas con coste en catálogo: {marginRange.totals.linesWithCost.toLocaleString("es-ES")} · sin coste
                registrado: {marginRange.totals.linesWithoutCost.toLocaleString("es-ES")}
              </p>
              {marginRange.meta.note ? (
                <p className="rounded-xl border border-tl-info/20 bg-tl-info/5 px-3 py-2 text-xs text-tl-ink-secondary">
                  {marginRange.meta.note}
                </p>
              ) : null}
            </div>
          )}

          {!marginRangeLoading &&
            marginRange?.meta?.dbAvailable &&
            marginRange.totals &&
            marginRange.totals.soldRevenueCents === 0 && (
              <p className="text-sm text-tl-muted">No hay ventas cerradas en ese rango de fechas.</p>
            )}
        </section>

        {/* Analítica agregada */}
        {analytics?.meta?.dbAvailable && t && avg && (
          <section className="space-y-6 border-t border-tl-line-subtle pt-10">
            <EconomySectionHeader
              title="Ingresos y tendencias"
              subtitle="Comparaciones y promedios sobre ventas cerradas. El bloque superior «Caja del día» usa la fecha que eliges en el calendario."
            />
            {analytics.meta.note ? (
              <p className="rounded-lg border border-tl-line-subtle bg-tl-canvas-inset px-3 py-2 text-xs text-tl-muted">
                {analytics.meta.note}
              </p>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <KpiCard
                variant="accent"
                label="Ingreso de hoy (en el sistema)"
                value={<CupUsdMoney cents={t.today.revenueCents} />}
                hint={`${t.today.saleCount.toLocaleString("es-ES")} ventas · si no cuadra con «Caja del día», revisa la fecha del calendario arriba`}
                icon={<Calendar className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="info"
                label="Mes en curso"
                value={<CupUsdMoney cents={t.currentMonth.revenueCents} />}
                hint="Ingreso acumulado del mes (ticket medio = ingreso ÷ ventas del mes)"
                icon={<PieChart className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="default"
                label="Mes anterior"
                value={<CupUsdMoney cents={t.previousMonth.revenueCents} />}
                hint={`${t.previousMonth.saleCount.toLocaleString("es-ES")} ventas`}
                icon={<ReceiptText className="h-5 w-5" aria-hidden />}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <KpiCard
                variant="default"
                label="Promedio diario (30 días)"
                value={<CupUsdMoney cents={avg.dailyRevenueLast30Cents} />}
                hint="Media de ingreso por día"
                icon={<TrendingUp className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="info"
                label="Promedio diario (7 días)"
                value={<CupUsdMoney cents={avg.dailyRevenueLast7Cents} />}
                hint="Última semana"
                icon={<TrendingUp className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="success"
                label="Promedio mensual reciente"
                value={<CupUsdMoney cents={avg.monthlyRevenueAvgRecentCents} />}
                hint={`${avg.monthsIncluded} mes(es) con ventas`}
                icon={<PieChart className="h-5 w-5" aria-hidden />}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <KpiCard
                variant={cmp?.momRevenuePct != null && cmp.momRevenuePct >= 0 ? "success" : "warning"}
                label="Ingresos: mes actual vs anterior"
                value={fmtPct(cmp?.momRevenuePct)}
                hint="Comparación de mes calendario"
                trend={cmp?.momRevenuePct != null ? (cmp.momRevenuePct >= 0 ? "up" : "down") : undefined}
                trendValue="Mes a mes"
                icon={
                  cmp?.momRevenuePct != null && cmp.momRevenuePct >= 0 ? (
                    <TrendingUp className="h-5 w-5" aria-hidden />
                  ) : (
                    <TrendingDown className="h-5 w-5" aria-hidden />
                  )
                }
              />
              <KpiCard
                variant="info"
                label="Cantidad de ventas: mes vs mes"
                value={fmtPct(cmp?.momSaleCountPct)}
                hint="Suben o bajan los tickets, no solo el ticket medio"
                icon={<ReceiptText className="h-5 w-5" aria-hidden />}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <KpiCard
                variant="default"
                label="Ritmo reciente (7 días vs 30)"
                value={fmtPct(cmp?.trendShortVsLongPct)}
                hint={
                  cmp?.shortLabel && cmp?.longLabel
                    ? `${cmp.shortLabel} frente a ${cmp.longLabel}`
                    : "Semana reciente frente a la media de 30 días"
                }
                icon={<TrendingUp className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="accent"
                label="Proyección de cierre de mes"
                value={proj?.monthEndRevenueCents != null ? <CupUsdMoney cents={proj.monthEndRevenueCents} /> : "—"}
                hint={proj?.method ? "Estimación según el ritmo de la última semana" : "Sin datos suficientes"}
                icon={<PieChart className="h-5 w-5" aria-hidden />}
              />
            </div>

            <div className="tl-glass overflow-x-auto rounded-xl border border-tl-accent/15">
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
                        <td className="px-4 py-3 tabular-nums text-tl-ink">{m.month}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{m.sales.toLocaleString("es-ES")}</td>
                        <td className="px-4 py-3 text-right align-top">
                          <TablePriceCupCell cupCents={m.revenueCents} compact />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {ext?.minDaily && ext?.maxDaily ? (
                <>
                  <KpiCard
                    variant="warning"
                    label="Día más flojo (90 días)"
                    value={<CupUsdMoney cents={ext.minDaily.revenueCents} compact />}
                    hint={`${ext.minDaily.date} · ${ext.minDaily.sales} ventas`}
                    icon={<TrendingDown className="h-5 w-5" aria-hidden />}
                  />
                  <KpiCard
                    variant="success"
                    label="Día más fuerte (90 días)"
                    value={<CupUsdMoney cents={ext.maxDaily.revenueCents} compact />}
                    hint={`${ext.maxDaily.date} · ${ext.maxDaily.sales} ventas`}
                    icon={<TrendingUp className="h-5 w-5" aria-hidden />}
                  />
                </>
              ) : (
                <div className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-5 text-sm text-tl-muted lg:col-span-2">
                  Aún no hay bastantes datos para mostrar el mejor y el peor día en esta ventana.
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <KpiCard
                variant="default"
                label="Ticket medio (30 días)"
                value={<CupUsdMoney cents={t.last30.ticketAvgCents} compact />}
                hint="Ingreso ÷ número de ventas"
                icon={<ReceiptText className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="info"
                label="Ticket medio (7 días)"
                value={<CupUsdMoney cents={t.last7.ticketAvgCents} compact />}
                hint="Última semana"
                icon={<ReceiptText className="h-5 w-5" aria-hidden />}
              />
            </div>

            {analytics?.meta?.dbAvailable && (mar || marToday || marMonth) && (
              <div className="space-y-4">
                <EconomySectionHeader
                  title="Ganancia por periodo (coste en catálogo)"
                  subtitle="Misma regla que arriba: solo líneas con precio de compra guardado en el producto."
                />
                <div className="grid gap-4 lg:grid-cols-3">
                  {(
                    [
                      { key: "today", title: "Hoy", variant: "accent" as const, m: marToday, note: marToday?.note },
                      { key: "month", title: "Mes en curso", variant: "info" as const, m: marMonth, note: marMonth?.note },
                      { key: "30d", title: "Últimos 30 días", variant: "success" as const, m: mar, note: mar?.note },
                    ] as const
                  ).map(({ key, title, variant, m, note }) =>
                    !m || m.revenueCents <= 0 ? (
                      <KpiCard
                        key={key}
                        variant="default"
                        label={title}
                        value="—"
                        hint="Sin ventas con coste en este periodo"
                        icon={<PieChart className="h-5 w-5" aria-hidden />}
                      />
                    ) : (
                      <div key={key} className="space-y-3">
                        <KpiCard
                          variant={variant}
                          label={`Ganancia · ${title}`}
                          value={<CupUsdMoney cents={m.marginCents} />}
                          hint={`${m.linesWithCost.toLocaleString("es-ES")} líneas con coste · ${m.linesWithoutCost.toLocaleString("es-ES")} sin coste en catálogo`}
                          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
                        />
                        <div className="grid grid-cols-2 gap-2 rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3 text-sm">
                          <div>
                            <p className="text-[10px] font-semibold uppercase text-tl-muted">Vendido</p>
                            <CupUsdMoney cents={m.revenueCents} compact />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase text-tl-muted">Proveedor</p>
                            <CupUsdMoney cents={m.estimatedCostCents} compact />
                          </div>
                          <div className="col-span-2 border-t border-tl-line-subtle pt-2">
                            <p className="text-[10px] font-semibold uppercase text-tl-muted">Margen sobre ingreso</p>
                            <p className="text-lg font-bold tabular-nums text-tl-ink">
                              {m.marginPct != null ? `${m.marginPct.toFixed(1)} %` : "—"}
                            </p>
                          </div>
                        </div>
                        {note ? <p className="text-[11px] leading-snug text-tl-muted">{note}</p> : null}
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            <EconomySectionHeader
              title="Formas de pago y terminales"
              subtitle="Últimos 30 días: dónde se concentra el ingreso."
            />

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="tl-glass overflow-x-auto rounded-xl border border-tl-success/15">
                <table className="w-full min-w-[360px] text-left text-sm">
                  <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                    Mezcla de métodos de pago (30 días)
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
                        <td className="px-4 py-2 text-sm text-tl-ink">{p.method}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.pctOfRevenue.toFixed(1)} %</td>
                        <td className="px-4 py-2 text-right align-top">
                          <TablePriceCupCell cupCents={p.revenueCents} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tl-glass overflow-x-auto rounded-xl border border-tl-info/15">
                <table className="w-full min-w-[360px] text-left text-sm">
                  <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                    Ingresos por terminal o caja (30 días)
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
                        <td className="max-w-[220px] truncate px-4 py-2 text-sm text-tl-ink" title={d.deviceId}>
                          {d.deviceId}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.pctOfRevenue.toFixed(1)} %</td>
                        <td className="px-4 py-2 text-right align-top">
                          <TablePriceCupCell cupCents={d.revenueCents} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <EconomySectionHeader
              title="Horarios y días de la semana"
              subtitle="Útil para turnos, aperturas y reposición."
            />

            <div className="tl-glass overflow-x-auto rounded-xl border border-tl-warning/15">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                  Ingresos por hora (últimos 30 días, CUP)
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
                  Pico en la tabla: hora {String(peakH.hour).padStart(2, "0")}:00 con {formatCup(peakH.revenueCents)} (
                  {formatUsdFromCupCents(peakH.revenueCents)}) y {peakH.sales} ventas.
                </p>
              )}
            </div>

            <div className="tl-glass overflow-x-auto rounded-xl border border-tl-accent/15">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                  Ingresos por día de la semana (último año)
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
                      <td className="px-4 py-2 text-right align-top">
                        <TablePriceCupCell cupCents={d.revenueCents} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {conclusions.length > 0 && (
              <div className="rounded-2xl border border-tl-info/25 bg-gradient-to-br from-tl-info/10 to-tl-canvas-inset p-5">
                <h3 className="text-sm font-semibold text-tl-ink">Ideas rápidas</h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-tl-ink-secondary">
                  {conclusions.slice(0, 5).map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tl-info" aria-hidden />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Detalle día: métodos exactos */}
        <section className="border-t border-tl-line-subtle pt-10">
          <EconomySectionHeader
            title="Detalle por método (día del calendario)"
            subtitle="Cada fila es el nombre del método tal como quedó al cerrar la venta en caja."
            icon={<CreditCard className="h-5 w-5 text-tl-accent" aria-hidden />}
          />

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
                      <td className="px-4 py-3 text-sm text-tl-ink align-top">
                        <TablePriceCupCell cupCents={b.totalCents} compact />
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
                Aquí no se incluyen gastos fijos, nómina ni impuestos: es una vista de ingresos por ventas. La proyección de fin de mes es
                orientativa.
              </p>
              <p className="mt-2">
                El equivalente en dólares usa el cambio configurado en la tienda. Si el método de pago no coincide con lo cobrado en
                efectivo, los totales por canal pueden diferir un poco de la caja física.
              </p>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
