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
  Users,
  Wallet,
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
    grossPlusHalfProfitCents?: number;
    salesCount: number;
    linesWithCost: number;
    linesWithoutCost: number;
  };
  error?: string;
};

type OwnerSaleLineDto = {
  id: string;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  quantity: number;
  unitCostCents: number;
  subtotalCents: number;
};

type OwnerSalesSummaryPayload = {
  meta: { dbAvailable: boolean; tzOffsetMinutes?: number; note?: string; message?: string };
  window: { mode: "day" | "month"; key: string } | null;
  totals: { OSMAR: number; ALEX: number; totalCents: number; count: number };
  ledger?: {
    window: { pendingCents: number; pendingCount: number; paidCents: number; paidCount: number };
    all: { pendingCents: number; pendingCount: number; paidCents: number; paidCount: number };
  };
  sales: {
    id: string;
    owner: "OSMAR" | "ALEX";
    status: "PENDING_PAYMENT" | "PAID";
    totalCents: number;
    createdAt: string;
    paidAt: string | null;
    paidSaleId: string | null;
    lineCount: number;
    lines: OwnerSaleLineDto[];
  }[];
};

type AdminSearchPayload = {
  meta: { dbAvailable: boolean };
  q: string;
  products: {
    id: string;
    sku: string;
    name: string;
    priceCents: number;
    costCents: number | null;
    stockQty: number;
    active: boolean;
    deletedAt: string | null;
  }[];
};

type EconomyCalendarDay = {
  day: string; // YYYY-MM-DD (local tienda)
  revenueCents: number;
  saleCount: number;
  marginCents: number;
  ticketAvgCents: number;
  avgUnitCostCents: number | null;
  unitsTotal: number;
  topProduct: { id: string; name: string; qty: number; revenueCents: number } | null;
};

type EconomyCalendarPayload = {
  meta: {
    dbAvailable: boolean;
    year?: number;
    tzOffsetMinutes?: number;
    note?: string;
    message?: string;
  };
  year: number | null;
  days: EconomyCalendarDay[];
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

const DOW_SHORT_ES = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function ymd(y: number, m1: number, d: number) {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m1: number) {
  return new Date(y, m1, 0).getDate();
}

function isoDow1to7(date: Date) {
  const dow0 = date.getDay(); // 0=Dom..6=Sáb
  return dow0 === 0 ? 7 : dow0;
}

function ownerLabel(o: "OSMAR" | "ALEX") {
  return o === "OSMAR" ? "Osmar" : "Álex";
}

function CalendarDayCell({ day, data }: { day: string; data: EconomyCalendarDay | null }) {
  const has = data != null && (data.revenueCents > 0 || data.marginCents !== 0 || data.saleCount > 0);
  const rev = data?.revenueCents ?? 0;
  const mar = data?.marginCents ?? 0;
  const top = data?.topProduct ?? null;
  const avgCost = data?.avgUnitCostCents ?? null;

  return (
    <div className="group relative">
      <div
        className={cn(
          "min-h-[74px] rounded-xl border p-2 transition-colors",
          has ? "border-tl-line bg-tl-canvas-inset" : "border-tl-line-subtle bg-tl-canvas",
          "hover:border-tl-accent/35 hover:bg-tl-canvas-inset",
        )}
        title={has ? "Pasa el cursor para más detalles" : "Sin ventas"}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold tabular-nums text-tl-muted">{day.slice(-2)}</span>
          {data?.saleCount ? (
            <span className="rounded-full bg-tl-canvas-subtle px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-tl-muted">
              {data.saleCount}
            </span>
          ) : null}
        </div>
        <div className="mt-1 space-y-0.5">
          <div className="text-[11px] leading-tight text-tl-ink">
            <span className="text-tl-muted">Ing:</span>{" "}
            <span className="font-semibold tabular-nums">{rev > 0 ? formatCup(rev) : "—"}</span>
          </div>
          <div className="text-[11px] leading-tight text-tl-ink">
            <span className="text-tl-muted">Gan:</span>{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                mar > 0 ? "text-tl-success" : mar < 0 ? "text-tl-warning" : "text-tl-muted",
              )}
            >
              {mar !== 0 ? formatCup(mar) : "—"}
            </span>
          </div>
        </div>
      </div>

      {has ? (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-[280px] -translate-x-1/2 translate-y-1 rounded-2xl border border-tl-line bg-tl-canvas px-3 py-2 text-xs text-tl-ink shadow-lg opacity-0 invisible transition-[opacity,transform] duration-150 ease-out group-hover:visible group-hover:opacity-100 group-hover:translate-y-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold tabular-nums">{day}</p>
            <p className="text-[11px] text-tl-muted">
              {formatUsdFromCupCents(rev)} · gan {formatUsdFromCupCents(mar)}
            </p>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase text-tl-muted">Ingreso</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatCup(rev)}</p>
            </div>
            <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase text-tl-muted">Ganancia</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatCup(mar)}</p>
            </div>
            <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase text-tl-muted">Ticket medio</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatCup(data?.ticketAvgCents ?? 0)}</p>
            </div>
            <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase text-tl-muted">Compra media (ud)</p>
              <p className="mt-0.5 font-semibold tabular-nums">{avgCost != null ? formatCup(avgCost) : "—"}</p>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase text-tl-muted">Top producto</p>
            {top ? (
              <p className="mt-0.5">
                <span className="font-semibold">{top.name}</span>{" "}
                <span className="tabular-nums text-tl-muted">× {top.qty}</span>{" "}
                <span className="tabular-nums text-tl-muted">· {formatCup(top.revenueCents)}</span>
              </p>
            ) : (
              <p className="mt-0.5 text-tl-muted">—</p>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-tl-muted">
            <span>Unidades vendidas: {String(data?.unitsTotal ?? 0)}</span>
            <span>Ventas: {String(data?.saleCount ?? 0)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MonthGrid({
  year,
  month1,
  byDay,
}: {
  year: number;
  month1: number; // 1-12
  byDay: Map<string, EconomyCalendarDay>;
}) {
  const totalDays = daysInMonth(year, month1);
  const first = new Date(year, month1 - 1, 1);
  const isoFirst = isoDow1to7(first); // 1..7
  const leading = isoFirst - 1;

  const cells: { key: string; day: string | null }[] = [];
  for (let i = 0; i < leading; i += 1) cells.push({ key: `p${i}`, day: null });
  for (let d = 1; d <= totalDays; d += 1) {
    cells.push({ key: `d${d}`, day: ymd(year, month1, d) });
  }
  while (cells.length % 7 !== 0) cells.push({ key: `t${cells.length}`, day: null });

  const monthLabel = MONTHS_ES[month1 - 1] ?? `Mes ${month1}`;

  return (
    <div className="relative overflow-visible rounded-3xl border border-tl-line-subtle bg-gradient-to-br from-tl-canvas via-tl-canvas-inset to-tl-canvas p-4 shadow-sm">
      <div
        className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-tl-accent/15 blur-3xl"
        aria-hidden
      />
      <div className="relative">
        <p className="text-sm font-semibold text-tl-ink">
          {monthLabel} <span className="tabular-nums text-tl-muted">{year}</span>
        </p>
        <p className="text-xs text-tl-muted">Ingreso bruto + ganancia estimada por día</p>
      </div>

      <div className="relative mt-4 grid grid-cols-7 gap-2 overflow-visible">
        {DOW_SHORT_ES.map((d) => (
          <div key={d} className="px-1 text-center text-[10px] font-semibold uppercase text-tl-muted">
            {d}
          </div>
        ))}
        {cells.map((c) =>
          c.day ? (
            <CalendarDayCell key={c.key} day={c.day} data={byDay.get(c.day) ?? null} />
          ) : (
            <div key={c.key} className="min-h-[74px] rounded-xl border border-transparent bg-transparent" />
          ),
        )}
      </div>
    </div>
  );
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
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth1, setCalendarMonth1] = useState(() => new Date().getMonth() + 1);
  const [calendar, setCalendar] = useState<EconomyCalendarPayload | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarErr, setCalendarErr] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState(defaultMarginRangeUtc.from);
  const [rangeTo, setRangeTo] = useState(defaultMarginRangeUtc.to);
  const [marginRange, setMarginRange] = useState<MarginRangePayload | null>(null);
  const [marginRangeLoading, setMarginRangeLoading] = useState(false);
  const [marginRangeErr, setMarginRangeErr] = useState<string | null>(null);
  const [ownerMode, setOwnerMode] = useState<"day" | "month">("day");
  const [ownerDay, setOwnerDay] = useState(today);
  const [ownerMonth, setOwnerMonth] = useState(() => today.slice(0, 7));
  const [ownerSummary, setOwnerSummary] = useState<OwnerSalesSummaryPayload | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerErr, setOwnerErr] = useState<string | null>(null);
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [ownerModalWho, setOwnerModalWho] = useState<"OSMAR" | "ALEX">("OSMAR");
  const [ownerModalQ, setOwnerModalQ] = useState("");
  const [ownerModalHits, setOwnerModalHits] = useState<AdminSearchPayload["products"]>([]);
  const [ownerModalLines, setOwnerModalLines] = useState<{ productId: string; sku: string; name: string; unitPriceCents: number; stockQty: number; quantity: number }[]>([]);
  const [ownerModalBusy, setOwnerModalBusy] = useState(false);
  const [ownerModalMsg, setOwnerModalMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"general" | "owners">("general");
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

  const loadCalendar = useCallback(async (year: number) => {
    setCalendarLoading(true);
    setCalendarErr(null);
    try {
      const params = new URLSearchParams();
      params.set("year", String(year));
      const res = await fetch(`/api/admin/economy/calendar?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as EconomyCalendarPayload;
      setCalendar(json);
      if (!res.ok) {
        setCalendarErr(json.meta?.message ?? "No se pudo cargar el calendario.");
      } else if (json.meta?.dbAvailable === false && json.meta?.message) {
        setCalendarErr(json.meta.message);
      }
    } catch (e) {
      setCalendar(null);
      setCalendarErr(e instanceof Error ? e.message : "Error de red al cargar calendario.");
    } finally {
      setCalendarLoading(false);
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

  const loadOwnerSummary = useCallback(async () => {
    setOwnerLoading(true);
    setOwnerErr(null);
    try {
      const params = new URLSearchParams();
      params.set("mode", ownerMode);
      if (ownerMode === "day") params.set("date", ownerDay);
      else params.set("month", ownerMonth);
      const res = await fetch(`/api/admin/owner-sales/summary?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as OwnerSalesSummaryPayload;
      setOwnerSummary(json);
      if (!res.ok) {
        setOwnerErr(json.meta?.message ?? "No se pudo cargar el consumo de dueños.");
      } else if (json.meta?.dbAvailable === false && json.meta?.message) {
        setOwnerErr(json.meta.message);
      }
    } catch (e) {
      setOwnerSummary(null);
      setOwnerErr(e instanceof Error ? e.message : "Error de red al cargar consumo de dueños.");
    } finally {
      setOwnerLoading(false);
    }
  }, [ownerDay, ownerMode, ownerMonth]);

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
    void loadCalendar(calendarYear);
  }, [calendarYear, loadCalendar]);

  useEffect(() => {
    void fetchMarginRange(defaultMarginRangeUtc.from, defaultMarginRangeUtc.to);
  }, [fetchMarginRange, defaultMarginRangeUtc.from, defaultMarginRangeUtc.to]);

  useEffect(() => {
    void loadOwnerSummary();
  }, [loadOwnerSummary]);

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

  const calendarByDay = useMemo(() => {
    const m = new Map<string, EconomyCalendarDay>();
    for (const d of calendar?.days ?? []) m.set(d.day, d);
    return m;
  }, [calendar?.days]);

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
                if (tab === "owners") {
                  void loadOwnerSummary();
                } else {
                  void loadSummary();
                  void loadAnalytics();
                  void loadCalendar(calendarYear);
                  void fetchMarginRange(rangeFrom, rangeTo);
                }
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

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              "tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
              tab === "general" && "bg-tl-canvas-subtle",
            )}
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            type="button"
            className={cn(
              "tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
              tab === "owners" && "bg-tl-canvas-subtle",
            )}
            onClick={() => setTab("owners")}
          >
            Dueños
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        {tab === "owners" ? (
          <>
            {/* Consumo de dueños */}
            <section className="space-y-4">
              <EconomySectionHeader
                title="Consumo de dueños (no cuenta como ingreso)"
                subtitle="Estas salidas descuentan stock, pero NO aparecen en ingreso del día, ganancia ni analítica. Solo se ven aquí."
                icon={<Users className="h-5 w-5 text-tl-accent" aria-hidden />}
              />

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Ventana
                  <select
                    className="tl-input h-9 w-[160px] px-3 py-1 text-xs sm:text-sm normal-case font-normal"
                    value={ownerMode}
                    onChange={(e) => setOwnerMode(e.target.value as "day" | "month")}
                  >
                    <option value="day">Diario</option>
                    <option value="month">Mensual</option>
                  </select>
                </label>
                {ownerMode === "day" ? (
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Día
                    <input
                      type="date"
                      value={ownerDay}
                      onChange={(e) => setOwnerDay(e.target.value)}
                      className="tl-input h-9 w-[160px] px-3 py-1 text-xs sm:text-sm normal-case font-normal"
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Mes
                    <input
                      type="month"
                      value={ownerMonth}
                      onChange={(e) => setOwnerMonth(e.target.value)}
                      className="tl-input h-9 w-[160px] px-3 py-1 text-xs sm:text-sm normal-case font-normal"
                    />
                  </label>
                )}

                <button
                  type="button"
                  className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
                  onClick={() => void loadOwnerSummary()}
                  disabled={ownerLoading}
                >
                  {ownerLoading ? "Cargando…" : "Actualizar"}
                </button>

                <button
                  type="button"
                  className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
                  onClick={() => {
                    setOwnerModalOpen(true);
                    setOwnerModalMsg(null);
                    setOwnerModalQ("");
                    setOwnerModalHits([]);
                    setOwnerModalLines([]);
                  }}
                >
                  Registrar consumo
                </button>
              </div>

              {ownerErr ? (
                <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                  {ownerErr}
                </div>
              ) : null}

              {ownerSummary?.meta?.note ? <p className="text-xs text-tl-muted">{ownerSummary.meta.note}</p> : null}

              {ownerSummary?.ledger ? (
                <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-4 py-3 text-xs text-tl-muted">
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <span className="tabular-nums">
                      Pendiente (ventana): <span className="font-semibold text-tl-ink">{formatCup(ownerSummary.ledger.window.pendingCents)}</span>{" "}
                      · {ownerSummary.ledger.window.pendingCount} registro(s)
                    </span>
                    <span className="tabular-nums">
                      Pagado (ventana): <span className="font-semibold text-tl-ink">{formatCup(ownerSummary.ledger.window.paidCents)}</span>{" "}
                      · {ownerSummary.ledger.window.paidCount} registro(s)
                    </span>
                    <span className="tabular-nums">
                      Pendiente (total): <span className="font-semibold text-tl-ink">{formatCup(ownerSummary.ledger.all.pendingCents)}</span>{" "}
                      · {ownerSummary.ledger.all.pendingCount} registro(s)
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  variant="default"
                  label="Osmar"
                  value={<CupUsdMoney cents={ownerSummary?.totals?.OSMAR ?? 0} />}
                  hint={`${(ownerSummary?.sales ?? []).filter((s) => s.owner === "OSMAR" && s.status === "PENDING_PAYMENT").length} pendiente(s)`}
                  icon={<Users className="h-5 w-5" aria-hidden />}
                />
                <KpiCard
                  variant="default"
                  label="Álex"
                  value={<CupUsdMoney cents={ownerSummary?.totals?.ALEX ?? 0} />}
                  hint={`${(ownerSummary?.sales ?? []).filter((s) => s.owner === "ALEX" && s.status === "PENDING_PAYMENT").length} pendiente(s)`}
                  icon={<Users className="h-5 w-5" aria-hidden />}
                />
                <KpiCard
                  variant="info"
                  label="Total"
                  value={<CupUsdMoney cents={ownerSummary?.totals?.totalCents ?? 0} />}
                  hint={`${ownerSummary?.totals?.count ?? 0} deuda(s) pendiente(s)`}
                  icon={<PieChart className="h-5 w-5" aria-hidden />}
                />
              </div>

              <div className="mt-3 overflow-x-auto tl-glass rounded-xl">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Dueño</th>
                      <th className="px-4 py-3 text-right">Líneas</th>
                      <th className="px-4 py-3 min-w-[280px]">Productos</th>
                      <th className="px-4 py-3 text-right">Total (CUP)</th>
                      <th className="px-4 py-3 text-right">Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tl-line-subtle">
                    {(ownerSummary?.sales ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-sm text-tl-muted">
                          No hay consumos registrados en esta ventana.
                        </td>
                      </tr>
                    ) : (
                      (ownerSummary?.sales ?? []).map((s) => {
                        const detailLines = s.lines ?? [];
                        const isPending = s.status === "PENDING_PAYMENT";
                        return (
                          <tr key={s.id}>
                            <td className="px-4 py-3 tabular-nums text-tl-ink align-top">
                              {new Date(s.createdAt).toLocaleString("es-ES")}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                                  isPending
                                    ? "bg-tl-warning-subtle text-tl-warning border border-tl-warning/20"
                                    : "bg-tl-success-subtle text-tl-success border border-tl-success/20",
                                )}
                              >
                                {isPending ? "Pendiente" : "Pagada"}
                              </span>
                              {!isPending && s.paidAt ? (
                                <div className="mt-1 text-[11px] tabular-nums text-tl-muted">
                                  {new Date(s.paidAt).toLocaleString("es-ES")}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-tl-ink align-top">{ownerLabel(s.owner)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-tl-muted align-top">{s.lineCount}</td>
                            <td className="px-4 py-3 align-top text-tl-ink-secondary">
                              {detailLines.length === 0 ? (
                                <span className="text-xs text-tl-muted">Sin detalle de líneas en BD.</span>
                              ) : (
                                <details className="group max-w-md">
                                  <summary className="cursor-pointer list-none text-xs font-semibold text-tl-accent hover:underline [&::-webkit-details-marker]:hidden">
                                    Ver {detailLines.length} producto{detailLines.length === 1 ? "" : "s"}
                                  </summary>
                                  <ul className="mt-2 space-y-2 rounded-lg border border-tl-line-subtle bg-tl-canvas-inset p-3 text-xs">
                                    {detailLines.map((l) => {
                                      const name = l.productName?.trim() || "Sin nombre en registro";
                                      const sku = l.productSku?.trim() || "—";
                                      return (
                                        <li
                                          key={l.id}
                                          className="border-b border-tl-line-subtle/60 pb-2 last:border-0 last:pb-0"
                                        >
                                          <div className="font-medium text-tl-ink">{name}</div>
                                          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                            <span className="font-mono text-tl-muted">SKU {sku}</span>
                                            <span className="tabular-nums text-tl-muted">
                                              {l.quantity} ud × {formatCup(l.unitCostCents)}
                                            </span>
                                          </div>
                                          <div className="mt-1 text-right tabular-nums text-tl-ink">
                                            Subtotal: <TablePriceCupCell cupCents={l.subtotalCents} compact />
                                          </div>
                                          {!l.productName?.trim() && !l.productSku?.trim() && l.productId ? (
                                            <div className="mt-1 font-mono text-[10px] text-tl-muted">id: {l.productId}</div>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </details>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right align-top">
                              <TablePriceCupCell cupCents={s.totalCents} compact />
                            </td>
                            <td className="px-4 py-3 text-right align-top">
                              {isPending ? (
                                <button
                                  type="button"
                                  className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
                                  onClick={async () => {
                                    setOwnerErr(null);
                                    try {
                                      const res = await fetch("/api/admin/owner-sales/pay", {
                                        method: "POST",
                                        credentials: "include",
                                        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                                        body: JSON.stringify({ ownerSaleId: s.id }),
                                      });
                                      const json = (await res.json()) as any;
                                      if (!res.ok) {
                                        setOwnerErr(json?.error ?? "No se pudo marcar como pagada.");
                                        return;
                                      }
                                      await loadOwnerSummary();
                                    } catch (e) {
                                      setOwnerErr(e instanceof Error ? e.message : "Error de red al pagar.");
                                    }
                                  }}
                                >
                                  Pagar
                                </button>
                              ) : (
                                <span className="text-xs text-tl-muted">{s.paidSaleId ? "Registrada" : "—"}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Modal registrar consumo (reusa el que ya existía) */}
              {ownerModalOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-50 bg-black/35"
                    onClick={() => setOwnerModalOpen(false)}
                    aria-label="Cerrar modal"
                  />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-[720px] rounded-2xl border border-tl-line bg-tl-canvas shadow-xl">
                      <div className="flex items-start justify-between gap-3 border-b border-tl-line px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-tl-ink">Registrar consumo</p>
                          <p className="mt-0.5 text-xs text-tl-muted">Se descuenta stock y queda trazabilidad.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOwnerModalOpen(false)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
                        >
                          Cerrar
                        </button>
                      </div>
                      <div className="p-4 space-y-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                            Dueño
                            <select
                              className="tl-input h-10 normal-case font-normal"
                              value={ownerModalWho}
                              onChange={(e) => setOwnerModalWho(e.target.value as "OSMAR" | "ALEX")}
                              disabled={ownerModalBusy}
                            >
                              <option value="OSMAR">Osmar</option>
                              <option value="ALEX">Álex</option>
                            </select>
                          </label>
                          <label className="sm:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                            Buscar producto
                            <div className="flex gap-2">
                              <input
                                className="tl-input h-10 flex-1 normal-case font-normal"
                                placeholder="SKU o nombre…"
                                value={ownerModalQ}
                                onChange={(e) => setOwnerModalQ(e.target.value)}
                                disabled={ownerModalBusy}
                              />
                              <button
                                type="button"
                                className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                                disabled={ownerModalBusy || !ownerModalQ.trim()}
                                onClick={async () => {
                                  setOwnerModalMsg(null);
                                  const q = ownerModalQ.trim();
                                  if (!q) return;
                                  try {
                                    const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}&limit=10`, {
                                      credentials: "include",
                                    });
                                    const json = (await res.json()) as AdminSearchPayload;
                                    setOwnerModalHits((json.products ?? []).filter((p) => p.active && !p.deletedAt));
                                  } catch (e) {
                                    setOwnerModalHits([]);
                                    setOwnerModalMsg(e instanceof Error ? e.message : "Error de red al buscar productos.");
                                  }
                                }}
                              >
                                Buscar
                              </button>
                            </div>
                          </label>
                        </div>

                        {ownerModalMsg ? (
                          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
                            {ownerModalMsg}
                          </div>
                        ) : null}

                        {ownerModalHits.length > 0 ? (
                          <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Resultados</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {ownerModalHits.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className="rounded-xl border border-tl-line bg-tl-canvas px-3 py-2 text-left hover:bg-tl-canvas-subtle"
                                  onClick={() => {
                                    setOwnerModalLines((prev) => {
                                      const ix = prev.findIndex((x) => x.productId === p.id);
                                      if (ix >= 0) {
                                        const next = [...prev];
                                        next[ix] = { ...next[ix]!, quantity: next[ix]!.quantity + 1 };
                                        return next;
                                      }
                                      return [
                                        ...prev,
                                        {
                                          productId: p.id,
                                          sku: p.sku,
                                          name: p.name,
                                          unitPriceCents: p.costCents ?? 0,
                                          stockQty: p.stockQty,
                                          quantity: 1,
                                        },
                                      ];
                                    });
                                  }}
                                >
                                  <p className="truncate text-sm font-semibold text-tl-ink">{p.name}</p>
                                  <p className="mt-0.5 text-xs text-tl-muted">
                                    SKU {p.sku} · stock {p.stockQty} · costo {formatCup(p.costCents ?? 0)}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-tl-ink">Líneas</p>
                            <p className="text-xs text-tl-muted">
                              Total: {formatCup(ownerModalLines.reduce((a, l) => a + l.quantity * l.unitPriceCents, 0))}
                            </p>
                          </div>
                          {ownerModalLines.length === 0 ? (
                            <p className="mt-2 text-sm text-tl-muted">Añade productos desde la búsqueda.</p>
                          ) : (
                            <div className="mt-3 space-y-2">
                              {ownerModalLines.map((l) => (
                                <div
                                  key={l.productId}
                                  className="flex flex-col gap-2 rounded-xl border border-tl-line bg-tl-canvas p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-tl-ink">{l.name}</p>
                                    <p className="text-xs text-tl-muted">
                                      SKU {l.sku} · stock {l.stockQty} · costo {formatCup(l.unitPriceCents)} / ud
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min={1}
                                      className="tl-input h-9 w-[100px]"
                                      value={l.quantity}
                                      onChange={(e) => {
                                        const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                                        setOwnerModalLines((prev) =>
                                          prev.map((x) => (x.productId === l.productId ? { ...x, quantity: n } : x)),
                                        );
                                      }}
                                      disabled={ownerModalBusy}
                                    />
                                    <button
                                      type="button"
                                      className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                                      onClick={() =>
                                        setOwnerModalLines((prev) => prev.filter((x) => x.productId !== l.productId))
                                      }
                                      disabled={ownerModalBusy}
                                    >
                                      Quitar
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                              onClick={() => setOwnerModalOpen(false)}
                              disabled={ownerModalBusy}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
                              disabled={ownerModalBusy || ownerModalLines.length === 0}
                              onClick={async () => {
                                setOwnerModalBusy(true);
                                setOwnerModalMsg(null);
                                try {
                                  const res = await fetch("/api/admin/owner-sales/create", {
                                    method: "POST",
                                    credentials: "include",
                                    headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                                    body: JSON.stringify({
                                      owner: ownerModalWho,
                                      lines: ownerModalLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                                    }),
                                  });
                                  const json = (await res.json()) as any;
                                  if (!res.ok) {
                                    if (json?.error === "INSUFFICIENT_STOCK") {
                                      setOwnerModalMsg("Stock insuficiente en uno o más productos. Revisa cantidades.");
                                    } else if (json?.error === "MISSING_COST") {
                                      setOwnerModalMsg("Falta el costo proveedor en uno o más productos. Actualiza el costo antes de registrar la deuda.");
                                    } else {
                                      setOwnerModalMsg(json?.error ?? "No se pudo registrar el consumo.");
                                    }
                                    return;
                                  }
                                  setOwnerModalOpen(false);
                                  await loadOwnerSummary();
                                } catch (e) {
                                  setOwnerModalMsg(e instanceof Error ? e.message : "Error de red al guardar.");
                                } finally {
                                  setOwnerModalBusy(false);
                                }
                              }}
                            >
                              {ownerModalBusy ? "Guardando…" : "Guardar"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </section>
          </>
        ) : null}

        {tab === "general" ? (
          <>
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

        {/* Calendario anual: ingreso + ganancia por día */}
        <section className="space-y-4 border-t border-tl-line-subtle pt-10">
          <EconomySectionHeader
            title="Calendario de ingresos y ganancia"
            subtitle="Cada día muestra ingreso bruto y ganancia estimada. Pasa el cursor por encima para ver USD, top producto y promedios."
            icon={<Calendar className="h-5 w-5 text-tl-accent" aria-hidden />}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-1.5 text-xs"
                onClick={() => {
                  setCalendarMonth1((m) => {
                    if (m > 1) return m - 1;
                    setCalendarYear((y) => y - 1);
                    return 12;
                  });
                }}
                disabled={calendarLoading}
                title="Mes anterior"
              >
                ←
              </button>
              <div className="rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-1 text-sm font-semibold text-tl-ink">
                {MONTHS_ES[calendarMonth1 - 1] ?? `Mes ${calendarMonth1}`}{" "}
                <span className="tabular-nums text-tl-muted">{calendarYear}</span>
              </div>
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-1.5 text-xs"
                onClick={() => {
                  setCalendarMonth1((m) => {
                    if (m < 12) return m + 1;
                    setCalendarYear((y) => y + 1);
                    return 1;
                  });
                }}
                disabled={calendarLoading}
                title="Mes siguiente"
              >
                →
              </button>
            </div>

            <button
              type="button"
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-1.5 text-xs"
              onClick={() => void loadCalendar(calendarYear)}
              disabled={calendarLoading}
              title="Actualizar mes"
            >
              {calendarLoading ? "Cargando…" : "Actualizar"}
            </button>
          </div>

          {calendarErr ? (
            <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
              {calendarErr}
            </div>
          ) : null}

          {calendar?.meta?.note ? <p className="text-xs text-tl-muted">{calendar.meta.note}</p> : null}

          {calendar?.meta?.dbAvailable === false ? (
            <p className="text-sm text-tl-muted">Base de datos no disponible para calendario.</p>
          ) : null}

          <div className="transition-[transform,opacity] duration-200 ease-out">
            <MonthGrid year={calendarYear} month1={calendarMonth1} byDay={calendarByDay} />
          </div>
        </section>

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
                <KpiCard
                  variant="accent"
                  label="Bruto + 50% ganancia"
                  value={
                    marginRange.totals.grossPlusHalfProfitCents != null ? (
                      <CupUsdMoney cents={marginRange.totals.grossPlusHalfProfitCents} />
                    ) : (
                      "—"
                    )
                  }
                  hint="Bruto (con coste) + mitad de la ganancia"
                  icon={<Wallet className="h-5 w-5" aria-hidden />}
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
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
