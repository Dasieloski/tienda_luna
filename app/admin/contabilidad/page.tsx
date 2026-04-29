"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  Landmark,
  LineChart,
  PencilLine,
  PieChart,
  Plus,
  ReceiptText,
  RefreshCw,
  Scale,
  Trash2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { formatCup } from "@/lib/money";
import { cn } from "@/lib/utils";

type DashboardPayload = {
  meta: { dbAvailable: boolean; tzOffsetMinutes?: number; message?: string };
  month: string | null;
  windowUtc?: { from: string; to: string };
  revenue?: { grossSalesCents: number; saleCount: number; paymentCount?: number };
  margin?: { revenueWithCostCents: number; cogsCents: number; grossProfitCents: number; note?: string };
  expenses?: {
    cash: { totalCents: number; count: number; basedOn: string };
    accrual: { totalCents: number; count: number; basedOn: string };
  };
  incomeChannels?: {
    totalCents: number;
    cashCents: number;
    transferCents: number;
    usdChannelCents: number;
    otherCents: number;
  };
  expensesByCategory?: { category: string; totalCents: number }[];
  adjustments?: { accountingEntriesCents: number; count: number };
  net?: { netProfitCents: number; netCashFlowCents: number };
  comparison?: {
    previousMonth: string;
    previous: {
      grossSalesCents: number;
      grossProfitCents: number;
      accrualExpensesCents: number;
      netProfitCents: number;
      netCashFlowCents: number;
    };
    pctVsPrevious: {
      grossSales: number | null;
      grossProfit: number | null;
      accrualExpenses: number | null;
      netProfit: number | null;
      netCashFlow: number | null;
    };
  };
  recentAccountingEntries?: {
    id: string;
    postedAt: string;
    impactMonth: string | null;
    entryType: string;
    amountCents: number;
    description: string;
  }[];
  rule?: { ventasNoSeModificanPorGastos: boolean; note?: string };
};

type AccountingSummaryPayload = {
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

function utcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function rangeIso(fromYmd: string, toYmd: string) {
  return {
    from: `${fromYmd}T00:00:00.000Z`,
    to: `${toYmd}T23:59:59.999Z`,
  };
}

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} %`;
}

const tipStyle = {
  backgroundColor: "var(--tl-canvas-inset)",
  border: "1px solid var(--tl-line)",
  borderRadius: "8px",
  fontSize: "12px",
  padding: "8px 12px",
  color: "var(--tl-ink)",
};

type AccountingEntryRow = {
  id: string;
  postedAt: string;
  impactMonth: string | null;
  entryType: string;
  amountCents: number;
  currency: string;
  originalAmount: number | null;
  usdRateCup: number | null;
  description: string;
  notes: string | null;
  relatedExpenseId: string | null;
  relatedSaleId: string | null;
  createdAt: string;
};

const ENTRY_TYPE_OPTIONS = [
  { value: "ADJUSTMENT", label: "Ajuste" },
  { value: "ACCRUAL", label: "Devengo / acumulación" },
  { value: "RECLASS", label: "Reclasificación" },
  { value: "NOTE", label: "Nota / memo" },
] as const;

type TabId = "resumen" | "estado" | "cashflow" | "categorias" | "asientos" | "rango";

const TABS: { id: TabId; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "estado", label: "Estado de resultados" },
  { id: "cashflow", label: "Flujo de caja" },
  { id: "categorias", label: "Gastos por categoría" },
  { id: "asientos", label: "Asientos" },
  { id: "rango", label: "Rango & dueños" },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToDatetimeLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultDatetimeLocalNow() {
  return isoToDatetimeLocal(new Date().toISOString());
}

export default function ContabilidadPage() {
  const defaultMonth = useMemo(() => utcMonth(), []);
  const [month, setMonth] = useState(defaultMonth);
  const [tab, setTab] = useState<TabId>("resumen");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("month", month);
      const res = await fetch(`/api/admin/accounting/dashboard?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as DashboardPayload;
      setData(json);
      if (!res.ok) setErr("No se pudo cargar contabilidad.");
      else if (json.meta?.dbAvailable === false) setErr(json.meta?.message ?? "Base de datos no disponible.");
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const revenue = data?.revenue ?? { grossSalesCents: 0, saleCount: 0 };
  const margin = data?.margin ?? { revenueWithCostCents: 0, cogsCents: 0, grossProfitCents: 0 };
  const expCash = data?.expenses?.cash ?? { totalCents: 0, count: 0, basedOn: "occurredAt" };
  const expAccrual = data?.expenses?.accrual ?? { totalCents: 0, count: 0, basedOn: "impactMonth||occurredAt" };
  const adj = data?.adjustments ?? { accountingEntriesCents: 0, count: 0 };
  const net = data?.net ?? { netProfitCents: 0, netCashFlowCents: 0 };
  const channels = data?.incomeChannels ?? {
    totalCents: 0,
    cashCents: 0,
    transferCents: 0,
    usdChannelCents: 0,
    otherCents: 0,
  };
  const byCat = useMemo(() => data?.expensesByCategory ?? [], [data?.expensesByCategory]);
  const cmp = data?.comparison;

  const comparisonBars = useMemo(() => {
    if (!cmp) return [];
    const p = cmp.previous;
    return [
      { name: "Ventas brutas", actual: revenue.grossSalesCents, anterior: p.grossSalesCents },
      { name: "Margen bruto", actual: margin.grossProfitCents, anterior: p.grossProfitCents },
      { name: "Gastos (impacto)", actual: expAccrual.totalCents, anterior: p.accrualExpensesCents },
      { name: "Utilidad neta", actual: net.netProfitCents, anterior: p.netProfitCents },
      { name: "Cash flow neto", actual: net.netCashFlowCents, anterior: p.netCashFlowCents },
    ];
  }, [cmp, revenue.grossSalesCents, margin.grossProfitCents, expAccrual.totalCents, net.netProfitCents, net.netCashFlowCents]);

  const categoryChartData = useMemo(
    () => byCat.map((c) => ({ name: c.category.length > 22 ? `${c.category.slice(0, 20)}…` : c.category, totalCents: c.totalCents })),
    [byCat],
  );

  const today = useMemo(() => utcTodayYmd(), []);
  const [fromDay, setFromDay] = useState(() => today);
  const [toDay, setToDay] = useState(() => today);
  const [rangeData, setRangeData] = useState<AccountingSummaryPayload | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeErr, setRangeErr] = useState<string | null>(null);

  const loadRange = useCallback(async () => {
    setRangeLoading(true);
    setRangeErr(null);
    try {
      const { from, to } = rangeIso(fromDay, toDay);
      const res = await fetch(`/api/admin/accounting/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        credentials: "include",
      });
      const json = (await res.json()) as AccountingSummaryPayload;
      setRangeData(json);
      if (!res.ok) setRangeErr("No se pudo cargar el rango.");
      else if (json.meta?.dbAvailable === false) setRangeErr(json.meta.message ?? "Sin base de datos.");
    } catch (e) {
      setRangeErr(e instanceof Error ? e.message : "Error de red.");
      setRangeData(null);
    } finally {
      setRangeLoading(false);
    }
  }, [fromDay, toDay]);

  useEffect(() => {
    if (tab === "rango") void loadRange();
  }, [tab, loadRange]);

  const rangeIncome = rangeData?.income ?? {
    totalCents: 0,
    cashCents: 0,
    transferCents: 0,
    usdChannelCents: 0,
    otherCents: 0,
  };
  const rangeExp = rangeData?.expenses ?? { totalCents: 0, osmarCents: 0, alexCents: 0 };
  const rangeMargin = rangeData?.margin ?? { revenueCents: 0, estimatedCostCents: 0, grossMarginCents: 0 };
  const rangeNet = rangeData?.net ?? { netProfitCents: 0, owners: { OSMAR: 0, ALEX: 0 } };

  const [ledgerEntries, setLedgerEntries] = useState<AccountingEntryRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerErr, setLedgerErr] = useState<string | null>(null);
  const [ledgerEntryTypeFilter, setLedgerEntryTypeFilter] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);

  const [formEntryType, setFormEntryType] = useState("ADJUSTMENT");
  const [formPostedLocal, setFormPostedLocal] = useState(defaultDatetimeLocalNow);
  const [formImpactMonth, setFormImpactMonth] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formCurrency, setFormCurrency] = useState<"CUP" | "USD">("CUP");
  const [formSign, setFormSign] = useState<1 | -1>(-1);
  const [formAmountMajor, setFormAmountMajor] = useState("");

  const resetEntryForm = useCallback(() => {
    setEditingEntryId(null);
    setFormEntryType("ADJUSTMENT");
    setFormPostedLocal(defaultDatetimeLocalNow());
    setFormImpactMonth("");
    setFormDescription("");
    setFormNotes("");
    setFormCurrency("CUP");
    setFormSign(-1);
    setFormAmountMajor("");
  }, []);

  const fillEntryForm = useCallback((row: AccountingEntryRow) => {
    setEditingEntryId(row.id);
    setFormEntryType(row.entryType);
    setFormPostedLocal(isoToDatetimeLocal(row.postedAt));
    setFormImpactMonth(row.impactMonth ?? "");
    setFormDescription(row.description);
    setFormNotes(row.notes ?? "");
    setFormCurrency(row.currency === "USD" ? "USD" : "CUP");
    if (row.currency === "USD") {
      const usd = row.originalAmount ?? 0;
      setFormSign(usd < 0 ? -1 : 1);
      setFormAmountMajor(String(Math.abs(usd) / 100));
    } else {
      setFormSign(row.amountCents < 0 ? -1 : 1);
      setFormAmountMajor(String(Math.abs(row.amountCents) / 100));
    }
  }, []);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    setLedgerErr(null);
    try {
      const q = new URLSearchParams();
      q.set("limit", "200");
      if (ledgerEntryTypeFilter) q.set("entryType", ledgerEntryTypeFilter);
      const res = await fetch(`/api/admin/accounting/entries?${q}`, { credentials: "include" });
      const json = (await res.json()) as {
        entries?: AccountingEntryRow[];
        meta?: { dbAvailable?: boolean; message?: string };
      };
      if (!res.ok) {
        setLedgerErr("No se pudo cargar asientos.");
        setLedgerEntries([]);
        return;
      }
      if (json.meta?.dbAvailable === false) {
        setLedgerErr(json.meta?.message ?? "Base de datos no disponible.");
        setLedgerEntries([]);
        return;
      }
      setLedgerEntries(json.entries ?? []);
    } catch (e) {
      setLedgerErr(e instanceof Error ? e.message : "Error de red.");
      setLedgerEntries([]);
    } finally {
      setLedgerLoading(false);
    }
  }, [ledgerEntryTypeFilter]);

  useEffect(() => {
    if (tab === "asientos") void loadLedger();
  }, [tab, loadLedger]);

  const submitEntry = async () => {
    if (!formDescription.trim()) {
      setLedgerErr("Describe el asiento.");
      return;
    }
    const rawDigits = formAmountMajor.trim().replace(",", ".").replace(/[^\d.]/g, "");
    const mag = Number(rawDigits);
    if (!Number.isFinite(mag) || mag <= 0) {
      setLedgerErr("Indica un importe mayor que cero.");
      return;
    }
    const signedCup = formCurrency === "CUP" ? Math.round(mag * 100) * formSign : undefined;
    const signedUsd = formCurrency === "USD" ? Math.round(mag * 100) * formSign : undefined;
    const postedIso = new Date(formPostedLocal).toISOString();

    setSavingEntry(true);
    setLedgerErr(null);
    try {
      const body: Record<string, unknown> = {
        entryType: formEntryType,
        postedAt: postedIso,
        impactMonth: formImpactMonth.trim() ? formImpactMonth.trim() : null,
        description: formDescription.trim(),
        notes: formNotes.trim() ? formNotes.trim() : null,
        currency: formCurrency,
        ...(formCurrency === "CUP" ? { amountCupSignedCents: signedCup } : { amountUsdSignedCents: signedUsd }),
      };

      const headers = { "content-type": "application/json", "x-tl-csrf": "1" };
      const url =
        editingEntryId != null ? `/api/admin/accounting/entries/${encodeURIComponent(editingEntryId)}` : "/api/admin/accounting/entries";
      const method = editingEntryId != null ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setLedgerErr(editingEntryId ? "No se pudo actualizar." : "No se pudo crear.");
        return;
      }
      resetEntryForm();
      await loadLedger();
      await load();
    } catch (e) {
      setLedgerErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setSavingEntry(false);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm("¿Eliminar este asiento contable?")) return;
    setLedgerErr(null);
    try {
      const res = await fetch(`/api/admin/accounting/entries/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-tl-csrf": "1" },
      });
      if (!res.ok) {
        setLedgerErr("No se pudo eliminar.");
        return;
      }
      if (editingEntryId === id) resetEntryForm();
      await loadLedger();
      await load();
    } catch (e) {
      setLedgerErr(e instanceof Error ? e.message : "Error de red.");
    }
  };

  if (loading && !data) {
    return (
      <AdminShell title="Contabilidad">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 rounded-full border-2 border-tl-accent border-t-transparent tl-spin" />
          <p className="text-sm text-tl-muted">Cargando contabilidad…</p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Contabilidad">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="relative overflow-hidden rounded-3xl border border-tl-line-subtle bg-gradient-to-br from-tl-canvas via-tl-canvas-inset to-tl-canvas p-6 shadow-sm sm:p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-tl-accent/12 blur-3xl" aria-hidden />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tl-accent">Finanzas</p>
              <h1 className="tl-welcome-header mt-1">Contabilidad profesional</h1>
              <p className="mt-2 max-w-2xl text-sm text-tl-muted">
                Estado de resultados y flujo de caja por periodo. Las ventas brutas no cambian por gastos; Economía sigue siendo la vista operativa diaria.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/admin/gastos"
                  className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs no-underline"
                >
                  <ReceiptText className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                  Gastos
                </Link>
                <Link
                  href="/admin/economia"
                  className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs no-underline"
                >
                  <Landmark className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                  Economía (sin mezclar)
                </Link>
                <Link
                  href="/admin/cambios"
                  className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs no-underline"
                >
                  <ArrowRightLeft className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                  Cambios USD→CUP
                </Link>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                <Calendar className="h-4 w-4" aria-hidden />
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="tl-input h-9 w-[150px] px-3 py-1 text-xs sm:text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => void load()}
                className={cn(
                  "tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
                )}
                disabled={refreshing}
              >
                <RefreshCw className={cn("mr-1.5 inline h-4 w-4", refreshing && "animate-spin")} aria-hidden />
                {refreshing ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
          </div>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-2 shadow-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-tl-accent text-tl-accent-fg shadow-sm"
                  : "text-tl-muted hover:bg-tl-canvas hover:text-tl-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* --- Resumen --- */}
        {tab === "resumen" ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <KpiCard
                variant="info"
                label="Ventas brutas (mes)"
                value={<CupUsdMoney cents={revenue.grossSalesCents} />}
                hint={`${revenue.saleCount.toLocaleString("es-ES")} ventas · intactas ante gastos`}
                icon={<LineChart className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="default"
                label="Utilidad bruta"
                value={<CupUsdMoney cents={margin.grossProfitCents} />}
                hint="Ingreso con coste − COGS (catálogo)"
                icon={<Scale className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant={net.netProfitCents >= 0 ? "success" : "warning"}
                label="Utilidad neta (periodificada)"
                value={<CupUsdMoney cents={net.netProfitCents} />}
                hint="Margen bruto − gastos (impacto) ± ajustes"
                icon={<FileSpreadsheet className="h-5 w-5" aria-hidden />}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-4">
              <KpiCard
                variant="warning"
                label="Gastos (caja)"
                value={<CupUsdMoney cents={expCash.totalCents} compact />}
                hint={`${expCash.count} registros · ${expCash.basedOn}`}
                icon={<ReceiptText className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="warning"
                label="Gastos (impacto)"
                value={<CupUsdMoney cents={expAccrual.totalCents} compact />}
                hint={`${expAccrual.count} registros · ${expAccrual.basedOn}`}
                icon={<PieChart className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="accent"
                label="Ajustes contables"
                value={<CupUsdMoney cents={adj.accountingEntriesCents} compact />}
                hint={`${adj.count} asientos en el mes`}
                icon={<BarChart3 className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="success"
                label="Cash flow neto"
                value={<CupUsdMoney cents={net.netCashFlowCents} compact />}
                hint="SalePayment − Expense (occurredAt)"
                icon={<ArrowRightLeft className="h-5 w-5" aria-hidden />}
              />
            </section>

            {cmp ? (
              <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-tl-ink">Comparación vs mes anterior ({cmp.previousMonth})</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {(
                    [
                      { label: "Ventas", pct: cmp.pctVsPrevious.grossSales },
                      { label: "Margen bruto", pct: cmp.pctVsPrevious.grossProfit },
                      { label: "Gastos impacto", pct: cmp.pctVsPrevious.accrualExpenses },
                      { label: "Utilidad neta", pct: cmp.pctVsPrevious.netProfit },
                      { label: "Cash flow", pct: cmp.pctVsPrevious.netCashFlow },
                    ] satisfies { label: string; pct: number | null }[]
                  ).map(({ label, pct }) => (
                    <div key={String(label)} className="rounded-xl border border-tl-line-subtle bg-tl-canvas px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-tl-muted">{label}</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-tl-ink">{fmtPct(pct)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 h-[280px] w-full">
                  {comparisonBars.some((d) => d.actual !== 0 || d.anterior !== 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparisonBars} margin={{ top: 8, right: 12, left: 0, bottom: 40 }}>
                        <CartesianGrid stroke="var(--tl-line-subtle)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--tl-muted)" }} angle={-18} textAnchor="end" height={56} />
                        <YAxis tick={{ fontSize: 10, fill: "var(--tl-muted)" }} width={44} tickFormatter={(v) => `${Math.round(v / 100)}`} />
                        <Tooltip
                          contentStyle={tipStyle}
                          formatter={(value) => formatCup(typeof value === "number" ? value : Number(value ?? 0))}
                          labelFormatter={(l) => String(l)}
                        />
                        <Bar dataKey="actual" name="Mes actual" fill="var(--tl-accent)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="anterior" name="Mes anterior" fill="var(--tl-muted)" opacity={0.55} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="flex h-full items-center justify-center text-sm text-tl-muted">Sin datos para comparar en estos meses.</p>
                  )}
                </div>
              </section>
            ) : null}

            {categoryChartData.length > 0 ? (
              <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-tl-ink">
                  <BarChart3 className="h-4 w-4 text-tl-accent" aria-hidden />
                  Gastos por categoría (impacto del mes)
                </h2>
                <div className="mt-4 h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={categoryChartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                      <CartesianGrid stroke="var(--tl-line-subtle)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "var(--tl-muted)" }} tickFormatter={(v) => `${Math.round(v / 100)}`} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: "var(--tl-muted)" }} />
                      <Tooltip contentStyle={tipStyle} formatter={(v) => formatCup(typeof v === "number" ? v : Number(v ?? 0))} />
                      <Bar dataKey="totalCents" fill="var(--tl-warning)" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            ) : null}

            {(data?.recentAccountingEntries?.length ?? 0) > 0 ? (
              <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-tl-ink">Movimientos contables recientes</h2>
                    <p className="mt-1 text-xs text-tl-muted">Asientos en AccountingEntry (ajustes manuales).</p>
                  </div>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-2 text-xs"
                    onClick={() => setTab("asientos")}
                  >
                    <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                    Gestionar asientos
                  </button>
                </div>
                <div className="mt-4 overflow-x-auto tl-glass rounded-xl">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                      <tr>
                        <th className="px-4 py-3">Fecha</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Impacto</th>
                        <th className="px-4 py-3">Importe</th>
                        <th className="px-4 py-3">Descripción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-tl-line-subtle">
                      {(data?.recentAccountingEntries ?? []).map((r) => (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-tl-muted">
                            {new Date(r.postedAt).toLocaleString("es-ES")}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{r.entryType}</td>
                          <td className="px-4 py-3 tabular-nums text-tl-muted">{r.impactMonth ?? "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <TablePriceCupCell cupCents={r.amountCents} compact />
                          </td>
                          <td className="max-w-[280px] truncate px-4 py-3 text-tl-ink" title={r.description}>
                            {r.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {data?.rule?.note ? (
              <section className="rounded-2xl border border-tl-info/25 bg-gradient-to-br from-tl-info/8 to-tl-canvas-inset p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-info">Regla crítica</p>
                <p className="mt-2 text-sm text-tl-ink-secondary">{data.rule.note}</p>
              </section>
            ) : null}
          </>
        ) : null}

        {/* --- Estado de resultados --- */}
        {tab === "estado" ? (
          <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-tl-ink">Estado de resultados simplificado</h2>
            <p className="mt-1 text-xs text-tl-muted">Mes {month}. COGS y margen solo sobre líneas con coste en catálogo.</p>
            <div className="mx-auto mt-6 max-w-xl space-y-0 divide-y divide-tl-line-subtle rounded-2xl border border-tl-line-subtle bg-tl-canvas">
              <RowStatement label="Ingresos por ventas (bruto)" value={revenue.grossSalesCents} emphasize />
              <RowStatement label="Costo de ventas (COGS)" value={-margin.cogsCents} />
              <RowStatement label="Utilidad bruta" value={margin.grossProfitCents} sub />
              <RowStatement label="Gastos operativos (impacto del mes)" value={-expAccrual.totalCents} />
              <RowStatement label="Ajustes contables" value={adj.accountingEntriesCents} />
              <RowStatement label="Utilidad neta" value={net.netProfitCents} emphasize accent />
            </div>
          </section>
        ) : null}

        {/* --- Flujo de caja --- */}
        {tab === "cashflow" ? (
          <div className="space-y-6">
            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-tl-ink">Flujo de caja (operativo)</h2>
              <p className="mt-2 text-sm text-tl-muted">
                Entradas: cobros registrados en <span className="font-mono text-xs">SalePayment</span> del mes. Salidas:{" "}
                <span className="font-mono text-xs">Expense</span> por fecha real (<span className="font-mono">occurredAt</span>). No altera las ventas
                brutas del mes.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  variant="success"
                  label="Entradas (pagos)"
                  value={<CupUsdMoney cents={channels.totalCents} />}
                  hint={`${revenue.paymentCount?.toLocaleString("es-ES") ?? "—"} pagos`}
                />
                <KpiCard variant="warning" label="Salidas (gastos caja)" value={<CupUsdMoney cents={expCash.totalCents} compact />} />
                <KpiCard
                  variant={net.netCashFlowCents >= 0 ? "accent" : "warning"}
                  label="Neto operativo"
                  value={<CupUsdMoney cents={net.netCashFlowCents} />}
                />
                <KpiCard variant="default" label="Ventas brutas (referencia)" value={<CupUsdMoney cents={revenue.grossSalesCents} compact />} hint="Sale COMPLETED" />
              </div>
            </section>
            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-tl-ink">Entradas por canal</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard variant="default" label="Efectivo" value={<CupUsdMoney cents={channels.cashCents} compact />} />
                <KpiCard variant="default" label="Transferencia" value={<CupUsdMoney cents={channels.transferCents} compact />} />
                <KpiCard variant="default" label="USD (canal)" value={<CupUsdMoney cents={channels.usdChannelCents} compact />} />
                <KpiCard variant="default" label="Otros" value={<CupUsdMoney cents={channels.otherCents} compact />} />
              </div>
            </section>
          </div>
        ) : null}

        {/* --- Gastos por categoría --- */}
        {tab === "categorias" ? (
          <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-tl-ink">Gastos por categoría</h2>
            <p className="mt-1 text-xs text-tl-muted">Agregado por periodo de impacto contable del mes seleccionado.</p>
            <div className="mt-4 overflow-x-auto tl-glass rounded-xl">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                  <tr>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tl-line-subtle">
                  {byCat.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-8 text-center text-tl-muted">
                        Sin gastos con impacto en este mes.
                      </td>
                    </tr>
                  ) : (
                    byCat.map((r) => (
                      <tr key={r.category}>
                        <td className="px-4 py-3 text-tl-ink">{r.category}</td>
                        <td className="px-4 py-3 text-right align-top">
                          <TablePriceCupCell cupCents={r.totalCents} compact />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* --- Asientos (CRUD) --- */}
        {tab === "asientos" ? (
          <div className="space-y-6">
            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-tl-ink">{editingEntryId ? "Editar asiento" : "Nuevo asiento"}</h2>
              <p className="mt-1 text-xs text-tl-muted">
                Positivo aumenta utilidad neta en el mes de impacto; negativo la reduce. No modifica ventas ni caja registradas en POS.
              </p>
              {ledgerErr ? (
                <div className="mt-4 rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">{ledgerErr}</div>
              ) : null}
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Tipo
                  <select
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={formEntryType}
                    onChange={(e) => setFormEntryType(e.target.value)}
                  >
                    {ENTRY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Fecha contable (posting)
                  <input
                    type="datetime-local"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={formPostedLocal}
                    onChange={(e) => setFormPostedLocal(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Mes impacto (opcional)
                  <input
                    type="month"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={formImpactMonth}
                    onChange={(e) => setFormImpactMonth(e.target.value)}
                  />
                </label>
                <label className="sm:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Descripción
                  <input
                    type="text"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Ej. Ajuste inventario físico"
                    maxLength={500}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Divisa de entrada
                  <select
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value === "USD" ? "USD" : "CUP")}
                  >
                    <option value="CUP">CUP</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Naturaleza
                  <select
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={formSign === 1 ? "in" : "out"}
                    onChange={(e) => setFormSign(e.target.value === "in" ? 1 : -1)}
                  >
                    <option value="out">Egreso (−)</option>
                    <option value="in">Ingreso (+)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Importe ({formCurrency === "USD" ? "USD" : "CUP"}, mayor · 100 centavos)
                  <input
                    type="text"
                    inputMode="decimal"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal tabular-nums"
                    value={formAmountMajor}
                    onChange={(e) => setFormAmountMajor(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="sm:col-span-3 flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Notas internas (opcional)
                  <textarea
                    className="tl-input min-h-[72px] px-3 py-2 text-sm normal-case font-normal"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    maxLength={1000}
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={savingEntry}
                  className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-4 !py-2 text-sm"
                  onClick={() => void submitEntry()}
                >
                  {savingEntry ? "Guardando…" : editingEntryId ? "Guardar cambios" : "Registrar asiento"}
                </button>
                {editingEntryId ? (
                  <button
                    type="button"
                    disabled={savingEntry}
                    className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-4 !py-2 text-sm"
                    onClick={() => resetEntryForm()}
                  >
                    Cancelar edición
                  </button>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-tl-ink">Listado</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="tl-input h-9 px-3 text-xs normal-case"
                    value={ledgerEntryTypeFilter}
                    onChange={(e) => setLedgerEntryTypeFilter(e.target.value)}
                  >
                    <option value="">Todos los tipos</option>
                    {ENTRY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-2 text-xs"
                    disabled={ledgerLoading}
                    onClick={() => void loadLedger()}
                  >
                    <RefreshCw className={cn("mr-1 inline h-3.5 w-3.5", ledgerLoading && "animate-spin")} aria-hidden />
                    Actualizar
                  </button>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto tl-glass rounded-xl">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Impacto</th>
                      <th className="px-4 py-3 text-right">Importe CUP</th>
                      <th className="px-4 py-3">Descripción</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tl-line-subtle">
                    {ledgerLoading && ledgerEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-tl-muted">
                          Cargando…
                        </td>
                      </tr>
                    ) : ledgerEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-tl-muted">
                          No hay asientos. Crea uno arriba o cambia el filtro.
                        </td>
                      </tr>
                    ) : (
                      ledgerEntries.map((r) => (
                        <tr key={r.id} className={editingEntryId === r.id ? "bg-tl-accent/8" : undefined}>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-tl-muted">
                            {new Date(r.postedAt).toLocaleString("es-ES")}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{r.entryType}</td>
                          <td className="px-4 py-3 tabular-nums text-tl-muted">{r.impactMonth ?? "—"}</td>
                          <td className="px-4 py-3 text-right align-top">
                            <TablePriceCupCell cupCents={r.amountCents} compact />
                            {r.currency === "USD" && r.originalAmount != null ? (
                              <p className="mt-0.5 text-[10px] text-tl-muted">
                                Entrada USD: {(r.originalAmount / 100).toFixed(2)} · tasa {r.usdRateCup ?? "—"}
                              </p>
                            ) : null}
                          </td>
                          <td className="max-w-[240px] truncate px-4 py-3 text-tl-ink" title={r.description}>
                            {r.description}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <button
                              type="button"
                              className="tl-interactive rounded-lg p-2 text-tl-muted hover:bg-tl-canvas-inset hover:text-tl-accent"
                              aria-label="Editar"
                              onClick={() => fillEntryForm(r)}
                            >
                              <PencilLine className="h-4 w-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="tl-interactive rounded-lg p-2 text-tl-muted hover:bg-tl-warning-subtle hover:text-tl-warning"
                              aria-label="Eliminar"
                              onClick={() => void deleteEntry(r.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {/* --- Rango & dueños --- */}
        {tab === "rango" ? (
          <div className="space-y-6">
            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-tl-ink">Análisis por rango (pagos + gastos)</h2>
              <p className="mt-1 text-xs text-tl-muted">
                Usa el mismo motor que <span className="font-mono">/api/admin/accounting/summary</span>: útil para cerrar quincenas o cruces con dueños.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Desde
                  <input
                    type="date"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={fromDay}
                    onChange={(e) => setFromDay(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Hasta
                  <input
                    type="date"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={toDay}
                    onChange={(e) => setToDay(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-4 !py-2 text-sm"
                  onClick={() => void loadRange()}
                  disabled={rangeLoading}
                >
                  {rangeLoading ? "Calculando…" : "Calcular"}
                </button>
              </div>
              {rangeErr ? (
                <div className="mt-4 rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">{rangeErr}</div>
              ) : null}
              {rangeData?.note ? <p className="mt-3 text-xs text-tl-muted">{rangeData.note}</p> : null}
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard variant="info" label="Ingresos (pagos)" value={<CupUsdMoney cents={rangeIncome.totalCents} />} />
              <KpiCard variant="warning" label="Egresos (gastos)" value={<CupUsdMoney cents={rangeExp.totalCents} />} />
              <KpiCard variant="success" label="Margen bruto" value={<CupUsdMoney cents={rangeMargin.grossMarginCents} />} />
              <KpiCard variant="accent" label="Ganancia neta estimada" value={<CupUsdMoney cents={rangeNet.netProfitCents} />} />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-tl-ink">Ingresos por canal</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <KpiCard variant="default" label="Efectivo" value={<CupUsdMoney cents={rangeIncome.cashCents} compact />} />
                  <KpiCard variant="default" label="Transferencia" value={<CupUsdMoney cents={rangeIncome.transferCents} compact />} />
                  <KpiCard variant="default" label="USD canal" value={<CupUsdMoney cents={rangeIncome.usdChannelCents} compact />} />
                  <KpiCard variant="default" label="Otros" value={<CupUsdMoney cents={rangeIncome.otherCents} compact />} />
                </div>
              </div>
              <div className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-tl-ink">Dueños</h3>
                <p className="mt-1 text-xs text-tl-muted">Gastos según reparto del gasto; ganancia neta 50/50 por defecto menos asignación.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <KpiCard variant="default" label="Gastos Osmar" value={<CupUsdMoney cents={rangeExp.osmarCents} compact />} />
                  <KpiCard variant="default" label="Gastos Álex" value={<CupUsdMoney cents={rangeExp.alexCents} compact />} />
                  <KpiCard variant="success" label="Resultado Osmar" value={<CupUsdMoney cents={rangeNet.owners.OSMAR} compact />} />
                  <KpiCard variant="success" label="Resultado Álex" value={<CupUsdMoney cents={rangeNet.owners.ALEX} compact />} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {data?.windowUtc ? (
          <p className="text-center text-[11px] text-tl-muted">
            Ventana UTC del mes (referencia): {data.windowUtc.from.slice(0, 16)} → {data.windowUtc.to.slice(0, 16)}
          </p>
        ) : null}
      </div>
    </AdminShell>
  );
}

function RowStatement({
  label,
  value,
  emphasize,
  accent,
  sub,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
  accent?: boolean;
  sub?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-5 py-4",
        emphasize && "bg-tl-canvas-inset/80",
        sub && "text-sm",
      )}
    >
      <span className={cn("text-tl-ink", emphasize && "font-semibold", accent && "text-lg font-bold")}>{label}</span>
      <span className={cn("tabular-nums font-semibold", accent ? "text-lg text-tl-accent" : "text-tl-ink")}>
        <CupUsdMoney cents={value} compact />
      </span>
    </div>
  );
}
