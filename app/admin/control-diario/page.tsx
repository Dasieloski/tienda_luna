"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote,
  Calendar,
  ClipboardList,
  CreditCard,
  DollarSign,
  Download,
  FileDown,
  ListChecks,
  ShieldAlert,
  PackageSearch,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { formatCup } from "@/lib/money";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/admin/kpi-card";

type DailyRow = {
  productId: string;
  name: string;
  sku: string;
  priceCents: number;
  priceUsdCents: number;
  qty: number;
  efectivoCents: number;
  transferenciaCents: number;
  usdCents: number;
};

type ProfitDay = {
  soldRevenueCents: number;
  supplierCostCents: number;
  marginCents: number;
  marginPct: number | null;
  salesCount: number;
  linesWithCost: number;
  linesWithoutCost: number;
};

type DailyReportResponse = {
  meta: {
    dbAvailable: boolean;
    message?: string;
  };
  date: string | null;
  rows: DailyRow[];
  profitDay?: ProfitDay | null;
};

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function DailyControlSalesTable({
  rows,
  firstRowNumber,
  loading,
  footerSource,
}: {
  rows: DailyRow[];
  firstRowNumber: number;
  loading: boolean;
  footerSource: DailyRow[];
}) {
  return (
    <table className="w-full min-w-[820px] text-left text-sm">
      <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
        <tr>
          <th className="px-3 py-2 text-center">No.</th>
          <th className="px-3 py-2">Producto</th>
          <th className="px-3 py-2 text-right">PVP (CUP)</th>
          <th className="px-3 py-2 text-center">Cant.</th>
          <th className="px-3 py-2 text-right">CUP efectivo</th>
          <th className="px-3 py-2 text-right">CUP transf.</th>
          <th className="px-3 py-2 text-right">Canal USD (CUP)</th>
          <th className="px-3 py-2 text-right">Subtotal</th>
          <th className="px-3 py-2 text-center">OK</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          Array.from({ length: 10 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: 9 }).map((__, j) => (
                <td key={j} className="px-3 py-2">
                  <div className="tl-skeleton h-3 rounded-md" />
                </td>
              ))}
            </tr>
          ))
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={9} className="px-4 py-8 text-center text-sm text-tl-muted">
              No hay filas para el filtro seleccionado.
            </td>
          </tr>
        ) : (
          rows.map((row, idx) => {
            const subtotal = row.efectivoCents + row.transferenciaCents + row.usdCents;
            return (
              <tr key={row.productId}>
                <td className="px-3 py-2 text-center text-xs text-tl-muted">{firstRowNumber + idx}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium text-tl-ink">{row.name}</span>
                    {row.sku && (
                      <span className="text-xs font-mono text-tl-muted">{row.sku}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <TablePriceCupCell
                    cupCents={row.priceCents}
                    explicitUsdCents={row.priceUsdCents}
                    compact
                  />
                </td>
                <td className="px-3 py-2 text-center text-sm tabular-nums text-tl-ink">{row.qty}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-tl-ink">
                  {formatCup(row.efectivoCents)}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-tl-ink">
                  {formatCup(row.transferenciaCents)}
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <TablePriceCupCell cupCents={row.usdCents} compact />
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <TablePriceCupCell cupCents={subtotal} compact />
                </td>
                <td className="px-3 py-2 text-center text-xs text-tl-muted">—</td>
              </tr>
            );
          })
        )}
      </tbody>
      {footerSource.length > 0 && !loading && (
        <tfoot>
          <tr className="border-t border-tl-line-subtle bg-tl-canvas-subtle">
            <td className="px-3 py-2 text-center text-xs font-semibold text-tl-muted">#</td>
            <td className="px-3 py-2 text-sm font-semibold text-tl-ink">TOTAL</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-tl-ink">
              {formatCup(footerSource.reduce((a, r) => a + r.efectivoCents, 0))}
            </td>
            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-tl-ink">
              {formatCup(footerSource.reduce((a, r) => a + r.transferenciaCents, 0))}
            </td>
            <td className="px-3 py-2 text-right align-top">
              <TablePriceCupCell cupCents={footerSource.reduce((a, r) => a + r.usdCents, 0)} compact />
            </td>
            <td className="px-3 py-2 text-right align-top">
              <TablePriceCupCell
                cupCents={footerSource.reduce(
                  (a, r) => a + r.efectivoCents + r.transferenciaCents + r.usdCents,
                  0,
                )}
                compact
              />
            </td>
            <td className="px-3 py-2" />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export default function DailyControlPage() {
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [profitDay, setProfitDay] = useState<ProfitDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProfitDay(null);
    try {
      const params = new URLSearchParams();
      params.set("date", date);
      const res = await fetch(`/api/admin/daily-report?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as DailyReportResponse;
      if (!res.ok || !json.meta?.dbAvailable) {
        setRows([]);
        setError(json.meta?.message ?? "No se pudo cargar el control diario.");
        return;
      }
      setRows(json.rows ?? []);
      setProfitDay(json.profitDay ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el control diario.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let totalCup = 0;
    let totalUsdCup = 0;
    let efectivoCup = 0;
    let transferenciaCup = 0;
    for (const r of rows) {
      totalCup += r.efectivoCents + r.transferenciaCents + r.usdCents;
      totalUsdCup += r.usdCents;
      efectivoCup += r.efectivoCents;
      transferenciaCup += r.transferenciaCents;
    }
    return {
      totalCup,
      totalUsdCup,
      efectivoCup,
      transferenciaCup,
    };
  }, [rows]);

  const topProductoDia = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((best, cur) => (cur.qty > best.qty ? cur : best), rows[0]!);
  }, [rows]);

  const topIngresoDia = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((best, cur) => {
      const bestSubtotal = best.efectivoCents + best.transferenciaCents + best.usdCents;
      const curSubtotal = cur.efectivoCents + cur.transferenciaCents + cur.usdCents;
      return curSubtotal > bestSubtotal ? cur : best;
    }, rows[0]!);
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const paged = useMemo(() => {
    const start = (pageSafe - 1) * limit;
    return rows.slice(start, start + limit);
  }, [rows, pageSafe]);

  useEffect(() => {
    setPage(1);
  }, [date]);

  const columns: Column<DailyRow>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Producto",
        sortable: true,
        filter: { kind: "text", placeholder: "Filtrar por nombre o SKU…" },
        sortValue: (row) => row.name,
        render: (row) => (
          <div className="flex flex-col">
            <span className="font-medium text-tl-ink">{row.name}</span>
            {row.sku ? <span className="text-xs font-mono text-tl-muted">{row.sku}</span> : null}
          </div>
        ),
      },
      {
        key: "priceCents",
        label: "PVP",
        sortable: true,
        align: "right",
        width: "120px",
        render: (row) => (
          <TablePriceCupCell cupCents={row.priceCents} explicitUsdCents={row.priceUsdCents} compact />
        ),
      },
      {
        key: "qty",
        label: "Cant.",
        sortable: true,
        align: "right",
        width: "80px",
        filter: { kind: "numberRange", placeholderMin: "Min", placeholderMax: "Max" },
        render: (row) => <span className="tabular-nums text-tl-ink">{row.qty}</span>,
      },
      {
        key: "efectivoCents",
        label: "Efectivo",
        sortable: true,
        align: "right",
        width: "130px",
        render: (row) => <span className="tabular-nums text-tl-ink">{formatCup(row.efectivoCents)}</span>,
      },
      {
        key: "transferenciaCents",
        label: "Transfer.",
        sortable: true,
        align: "right",
        width: "130px",
        render: (row) => <span className="tabular-nums text-tl-ink">{formatCup(row.transferenciaCents)}</span>,
      },
      {
        key: "usdCents",
        label: "USD (CUP)",
        sortable: true,
        align: "right",
        width: "130px",
        render: (row) => <TablePriceCupCell cupCents={row.usdCents} compact />,
      },
      {
        key: "subtotal",
        label: "Subtotal",
        sortable: true,
        align: "right",
        width: "130px",
        sortValue: (row) => row.efectivoCents + row.transferenciaCents + row.usdCents,
        render: (row) => (
          <TablePriceCupCell cupCents={row.efectivoCents + row.transferenciaCents + row.usdCents} compact />
        ),
      },
    ],
    [],
  );

  return (
    <AdminShell title="Control diario">
      <div className="space-y-6 tl-print-area">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Control diario de ventas</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Hoja diaria con desglose por producto y método de pago (CUP efectivo, transferencia y
              USD).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 tl-no-print">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              <Calendar className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Fecha</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
              />
            </label>
            <Link
              href="/admin/control-diario/cuadre"
              className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              title="Abrir auditoría de cuadre"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden />
              Cuadre
            </Link>
            <Link
              href="/admin/control-diario/incidencias"
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              title="Incidencias diarias del POS"
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              Incidencias
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
              Actualizar
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
              onClick={() => window.print()}
            >
              <Download className="h-4 w-4" aria-hidden />
              Imprimir / PDF
            </button>
            <a
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              href={`/api/admin/daily-report/export?date=${encodeURIComponent(date)}`}
            >
              <FileDown className="h-4 w-4" aria-hidden />
              Exportar CSV
            </a>
          </div>
        </div>

        <div className="tl-print-only">
          <p className="text-lg font-semibold text-tl-ink">
            Control diario · {new Date(date).toLocaleDateString("es-ES")}
          </p>
          <p className="mt-1 text-sm text-tl-muted">Tabla de ventas por producto y forma de pago.</p>
          {profitDay && !loading ? (
            <p className="mt-2 text-sm font-semibold text-tl-ink">
              Ganancia neta del día (ventas cerradas, PVP − proveedor): {formatCup(profitDay.marginCents)} ·{" "}
              {profitDay.marginPct != null ? `${profitDay.marginPct.toFixed(1)} %` : "—"} · {profitDay.salesCount} tickets
            </p>
          ) : null}
        </div>

        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        {/* Cards / KPIs */}
        <section className="tl-no-print">
          {profitDay && !error ? (
            <div className="relative mb-6 overflow-hidden rounded-2xl border-2 border-tl-success/45 bg-gradient-to-br from-tl-success-subtle via-tl-canvas-inset to-tl-canvas p-6 shadow-lg ring-1 ring-tl-success/30 sm:p-7">
              <div
                className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-tl-success/20 blur-3xl"
                aria-hidden
              />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tl-success/25 text-tl-success">
                    <TrendingUp className="h-6 w-6" aria-hidden />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-tl-success">
                      Ganancia neta del día
                    </p>
                    <p className="mt-1 text-sm text-tl-muted">
                      Ventas cerradas en la fecha del control. Lo vendido en líneas menos el coste de proveedor
                      registrado en catálogo (misma regla que Economía).
                    </p>
                    <div className="mt-3">
                      <CupUsdMoney cents={profitDay.marginCents} className="!text-2xl !font-bold sm:!text-4xl" />
                    </div>
                  </div>
                </div>
                <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 sm:text-right">
                  <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas/80 px-3 py-2 sm:text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-tl-muted">Vendido (líneas)</p>
                    <CupUsdMoney cents={profitDay.soldRevenueCents} compact />
                  </div>
                  <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas/80 px-3 py-2 sm:text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-tl-muted">A proveedor</p>
                    <CupUsdMoney cents={profitDay.supplierCostCents} compact />
                  </div>
                  <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas/80 px-3 py-2 sm:col-span-2 sm:text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-tl-muted">
                      Margen sobre venta · tickets
                    </p>
                    <p className="text-base font-bold tabular-nums text-tl-ink">
                      {profitDay.marginPct != null ? `${profitDay.marginPct.toFixed(1)} %` : "—"} ·{" "}
                      <span className="font-medium text-tl-muted">
                        {profitDay.salesCount.toLocaleString("es-ES")} ventas
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-tl-muted">
                      Líneas con coste: {profitDay.linesWithCost.toLocaleString("es-ES")} · sin coste en catálogo:{" "}
                      {profitDay.linesWithoutCost.toLocaleString("es-ES")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Caja CUP (total)"
              value={formatCup(totals.totalCup)}
              hint="Efectivo + transferencia + USD (en CUP)"
              icon={<Banknote className="h-4 w-4" />}
            />
            <KpiCard
              label="Efectivo CUP"
              value={formatCup(totals.efectivoCup)}
              icon={<Banknote className="h-4 w-4" />}
              variant="success"
            />
            <KpiCard
              label="Transferencia CUP"
              value={formatCup(totals.transferenciaCup)}
              icon={<CreditCard className="h-4 w-4" />}
              variant="info"
            />
            <KpiCard
              label="USD del día"
              value={<CupUsdMoney cents={totals.totalUsdCup} />}
              hint="Ventas marcadas USD"
              icon={<DollarSign className="h-4 w-4" />}
              variant="warning"
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Producto más vendido</p>
              <p className="mt-1 text-lg font-bold text-tl-ink">
                {topProductoDia ? topProductoDia.name : "—"}
              </p>
              <p className="mt-1 text-sm text-tl-muted">
                {topProductoDia ? `${topProductoDia.qty} unidades` : "Sin ventas"}
              </p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Mayor ingreso</p>
              <p className="mt-1 text-lg font-bold text-tl-ink">
                {topIngresoDia ? topIngresoDia.name : "—"}
              </p>
              <p className="mt-1 text-sm text-tl-muted">
                {topIngresoDia
                  ? formatCup(
                      topIngresoDia.efectivoCents + topIngresoDia.transferenciaCents + topIngresoDia.usdCents,
                    )
                  : "Sin ventas"}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between tl-no-print">
            <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-tl-muted" aria-hidden />
            <p className="text-sm font-semibold text-tl-ink">
              Día {new Date(date).toLocaleDateString("es-ES")}
            </p>
            </div>
          </div>

          <div className="tl-no-print">
            <DataTable
              columns={columns}
              data={paged}
              keyExtractor={(r) => r.productId}
              searchable
              searchPlaceholder="Buscar por producto o SKU…"
              searchKeys={["name", "sku"]}
              emptyMessage="No hay filas para el filtro seleccionado."
              loading={loading}
              skeletonRows={10}
              maxHeight="calc(100vh - 520px)"
              pagination={{
                page: pageSafe,
                totalPages,
                onPageChange: setPage,
                summary: `${rows.length.toLocaleString("es-ES")} filas · página ${pageSafe} de ${totalPages}`,
              }}
            />
          </div>

          <div className="tl-print-only tl-print-table-wrap tl-print-wide tl-glass rounded-xl">
            {!loading && (
              <DailyControlSalesTable
                rows={rows}
                firstRowNumber={1}
                loading={false}
                footerSource={rows}
              />
            )}
          </div>
        </section>

        <section className="tl-no-print text-xs text-tl-muted">
          <p>
            Esta vista resume los datos a partir de las ventas registradas en el sistema para la
            fecha seleccionada. <strong className="text-tl-ink">Imprimir / PDF</strong> incluye{" "}
            <strong className="text-tl-ink">todas las filas</strong> del filtro actual (no solo la
            página en pantalla) y usa orientación horizontal automática en el diálogo de impresión.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}

