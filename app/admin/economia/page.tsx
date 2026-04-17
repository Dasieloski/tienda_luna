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
        `El dispositivo “${topD.deviceId}” concentra el ${topD.pctOfRevenue.toFixed(1)} % de los ingresos de los últimos 30 días entre los terminales listados.`,
      );
    }
    if (marT && marT.revenueCents > 0 && marT.linesWithCost > 0 && marT.marginPct != null) {
      out.push(
        `Hoy (UTC), el margen bruto estimado sobre líneas con coste ronda el ${marT.marginPct.toFixed(1)} % del ingreso de esas líneas.`,
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
      <div className="space-y-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Economía de la tienda</h1>
            <p className="mt-2 max-w-3xl text-sm text-tl-muted">
              Resumen de ingresos por día, método de pago y tendencias. Los importes en dólares son orientativos según el cambio configurado
              en la tienda.
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
              Suma del PVP vendido en líneas menos el coste de proveedor registrado en cada producto (misma regla que
              el detalle por periodo más abajo).
            </p>
            <div className="relative mt-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div>
                <p className="text-xs text-tl-muted">Tu ganancia (bruta)</p>
                <div className="mt-1">
                  <CupUsdMoney cents={mar.marginCents} className="!text-2xl !font-bold sm:!text-4xl" />
                </div>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="text-xs text-tl-muted">Vendido (líneas)</p>
                  <CupUsdMoney cents={mar.revenueCents} compact />
                </div>
                <div>
                  <p className="text-xs text-tl-muted">A proveedor</p>
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
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-tl-ink">1. Caja del día seleccionado</h2>
          <p className="text-sm text-tl-muted">
            Ventas cerradas en la fecha del calendario. Los totales por método se agrupan según cómo quedó registrado el pago en caja.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ventas (día)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">{totals.ventas.toLocaleString("es-ES")}</p>
              <p className="mt-2 text-xs text-tl-muted">Número de tickets registrados ese día.</p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ingreso bruto (día)</p>
              <div className="mt-1 text-xl font-bold text-tl-ink sm:text-2xl">
                <CupUsdMoney cents={totals.totalCents} />
              </div>
              <p className="mt-2 text-xs text-tl-muted">Suma de lo vendido; el equivalente en USD usa el cambio de la tienda.</p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Total en CUP (suma métodos)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">{formatCup(cajaCup)}</p>
              <p className="mt-2 text-xs text-tl-muted">Suma de efectivo, transferencias y ventas marcadas como dólares (todo en CUP).</p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Equivalente USD (caja)</p>
              <p className="mt-1 text-2xl font-bold text-tl-success tabular-nums">{formatUsdFromCupCents(cajaCup)}</p>
              <p className="mt-2 text-xs text-tl-muted">Mismo total expresado en dólares al cambio actual.</p>
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
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ventas en USD (registradas)</p>
                <div className="text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.usdCents} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-tl-line-subtle pt-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-tl-ink">
                <PieChart className="h-5 w-5 text-tl-accent" aria-hidden />
                Proveedor y ganancia por periodo
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-tl-muted">
                Suma de lo vendido en líneas cerradas (subtotal), el coste estimado que corresponde a proveedor según
                el precio de compra guardado en cada producto, y la ganancia bruta (diferencia exacta en esas líneas).
                Las fechas son días calendario en{" "}
                <span className="font-medium text-tl-ink">UTC</span> (igual que el resto de analíticas del servidor).
              </p>
            </div>
          </div>

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
            <div className="relative overflow-hidden rounded-2xl border-2 border-tl-success/40 bg-gradient-to-br from-tl-success-subtle/90 via-tl-canvas-inset to-tl-canvas p-6 ring-1 ring-tl-success/25 sm:p-7">
              <p className="text-xs font-bold uppercase tracking-wider text-tl-success">
                Resultado ({marginRange.meta.fromInclusive} → {marginRange.meta.toInclusive})
              </p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-tl-muted">Lo vendido (líneas)</p>
                  <div className="mt-1 text-xl font-bold text-tl-ink sm:text-2xl">
                    <CupUsdMoney cents={marginRange.totals.soldRevenueCents} />
                  </div>
                  <p className="mt-1 text-[11px] text-tl-muted">Suma de subtotales de artículos en ventas cerradas.</p>
                </div>
                <div>
                  <p className="text-xs text-tl-muted">Corresponde a proveedor (coste)</p>
                  <div className="mt-1 text-xl font-bold text-tl-ink sm:text-2xl">
                    <CupUsdMoney cents={marginRange.totals.supplierCostCents} />
                  </div>
                  <p className="mt-1 text-[11px] text-tl-muted">
                    Unidades × precio de compra en catálogo; líneas sin coste no suman aquí.
                  </p>
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-tl-success">Ganancia de la tienda</p>
                  <div className="mt-1 text-2xl font-bold text-tl-success sm:text-3xl">
                    <CupUsdMoney cents={marginRange.totals.marginCents} />
                  </div>
                  <p className="mt-1 text-[11px] text-tl-muted">Vendido − coste proveedor (líneas con coste en catálogo).</p>
                </div>
                <div>
                  <p className="text-xs text-tl-muted">Margen % sobre lo vendido</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink sm:text-3xl">
                    {marginRange.totals.marginPct != null ? `${marginRange.totals.marginPct.toFixed(1)} %` : "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-tl-muted">
                    {marginRange.totals.salesCount.toLocaleString("es-ES")} ventas cerradas en el periodo.
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs text-tl-muted">
                Líneas de ticket con coste en catálogo: {marginRange.totals.linesWithCost.toLocaleString("es-ES")} · sin
                coste (solo cuentan al “vendido”): {marginRange.totals.linesWithoutCost.toLocaleString("es-ES")}
              </p>
              {marginRange.meta.note ? <p className="mt-2 text-xs text-tl-muted">{marginRange.meta.note}</p> : null}
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
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-tl-ink">2. Ingresos y actividad</h2>
            {analytics.meta.note ? (
              <p className="max-w-4xl text-sm text-tl-muted">{analytics.meta.note}</p>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <InterpretBlock title="Ingreso de hoy (servidor)">
                <p>
                  <CupUsdMoney cents={t.today.revenueCents} /> en {t.today.saleCount} ventas.
                </p>
                <p className="text-tl-muted">Puede no coincidir con el día que eliges arriba si la tienda está en otra zona horaria.</p>
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
                  <CupUsdMoney cents={avg.dailyRevenueLast30Cents} /> de media por día (últimos 30 días).
                </p>
              </InterpretBlock>
              <InterpretBlock title="Promedio de ingreso diario (últimos 7 días)">
                <p>
                  <CupUsdMoney cents={avg.dailyRevenueLast7Cents} /> de media por día (últimos 7 días).
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
                <p className="text-tl-muted">Comparación del mes en curso frente al mes anterior.</p>
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
                {proj?.method ? (
                  <p className="text-xs text-tl-muted">Proyección simple según el ritmo de los últimos 7 días.</p>
                ) : null}
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
                <p className="text-tl-muted">Cada venta cuenta como una transacción.</p>
              </InterpretBlock>
            </div>

            {analytics?.meta?.dbAvailable && (mar || marToday || marMonth) && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-tl-ink">Márgenes (venta − coste proveedor en catálogo)</h3>
                  <p className="mt-1 text-xs text-tl-muted">
                    Solo entra al coste lo que tengas guardado como precio de compra por unidad en cada producto; el
                    resto de líneas no suma al coste estimado. Las ventas de productos inactivos o archivados siguen
                    contando igual.
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  {[
                    { key: "today", title: "Margen hoy (UTC)", m: marToday, hint: marToday?.note },
                    { key: "month", title: "Margen mes en curso (UTC)", m: marMonth, hint: marMonth?.note },
                    { key: "30d", title: "Margen últimos 30 días", m: mar, hint: mar?.note },
                  ].map(({ key, title, m, hint }) => (
                    <div key={key} className="tl-glass rounded-xl p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">{title}</p>
                      {hint ? <p className="mt-1 text-[11px] leading-snug text-tl-muted">{hint}</p> : null}
                      {!m || m.revenueCents <= 0 ? (
                        <p className="mt-4 text-sm text-tl-muted">Sin ventas cerradas en este periodo.</p>
                      ) : (
                        <>
                          <div className="mt-4 rounded-xl border border-tl-success/25 bg-tl-success-subtle/40 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-tl-success">
                              Ganancia tienda
                            </p>
                            <div className="mt-1">
                              <CupUsdMoney cents={m.marginCents} className="!text-xl !font-bold sm:!text-2xl" />
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div>
                              <p className="text-xs text-tl-muted">Ingreso líneas</p>
                              <CupUsdMoney cents={m.revenueCents} />
                            </div>
                            <div>
                              <p className="text-xs text-tl-muted">Proveedor (coste)</p>
                              <CupUsdMoney cents={m.estimatedCostCents} />
                            </div>
                            <div>
                              <p className="text-xs text-tl-muted">% sobre ingreso</p>
                              <p className="text-lg font-bold text-tl-ink">
                                {m.marginPct != null ? `${m.marginPct.toFixed(1)} %` : "—"}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-tl-muted">
                            Líneas con costo: {m.linesWithCost.toLocaleString("es-ES")} · sin costo:{" "}
                            {m.linesWithoutCost.toLocaleString("es-ES")}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
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
                        <td className="px-4 py-2 text-right align-top">
                          <TablePriceCupCell cupCents={p.revenueCents} compact />
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
                        <td className="px-4 py-2 text-right align-top">
                          <TablePriceCupCell cupCents={d.revenueCents} compact />
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
                  Distribución horaria de ingresos (últimos 30 días, en CUP)
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

            <div className="tl-glass overflow-x-auto rounded-xl">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="border-b border-tl-line px-4 py-2 text-left text-xs font-semibold text-tl-ink">
                  Estacionalidad semanal (últimos 365 días)
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
              <div className="tl-glass rounded-xl border border-tl-line-subtle p-4">
                <h3 className="text-sm font-semibold text-tl-ink">Conclusiones</h3>
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
          <h2 className="text-lg font-semibold text-tl-ink">3. Detalle por método de pago (día seleccionado)</h2>
          <p className="mt-1 max-w-3xl text-sm text-tl-muted">
            Cada fila es el texto del método tal como lo registró la caja al cerrar la venta.
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
