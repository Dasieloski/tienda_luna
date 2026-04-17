"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Calendar, ClipboardList, CreditCard, DollarSign, Download, FileDown, PackageSearch, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { formatCup, formatUsdCents, formatUsdFromCupCents } from "@/lib/money";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
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

type DailyReportResponse = {
  meta: {
    dbAvailable: boolean;
    message?: string;
  };
  date: string | null;
  rows: DailyRow[];
};

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function DailyControlPage() {
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.sku ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const paged = useMemo(() => {
    const start = (pageSafe - 1) * limit;
    return filtered.slice(start, start + limit);
  }, [filtered, pageSafe]);

  useEffect(() => {
    setPage(1);
  }, [q, date]);

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
        </div>

        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        {/* Cards / KPIs */}
        <section className="tl-no-print">
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
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-[320px]">
                <PackageSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tl-muted" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="tl-input h-9 pl-10"
                  placeholder="Filtrar por producto o SKU…"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto tl-glass rounded-xl">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-3 py-2 text-center">No.</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Precio USD</th>
                  <th className="px-3 py-2 text-right">Precio CUP</th>
                  <th className="px-3 py-2 text-center">Cant.</th>
                  <th className="px-3 py-2 text-right">CUP efectivo</th>
                  <th className="px-3 py-2 text-right">CUP transf.</th>
                  <th className="px-3 py-2 text-right">USD</th>
                  <th className="px-3 py-2 text-right">Subtotal (CUP)</th>
                  <th className="px-3 py-2 text-center">OK</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 10 }).map((__, j) => (
                        <td key={j} className="px-3 py-2">
                          <div className="tl-skeleton h-3 rounded-md" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : paged.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-sm text-tl-muted"
                    >
                      No hay filas para el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  paged.map((row, idx) => {
                    const subtotal =
                      row.efectivoCents + row.transferenciaCents + row.usdCents;
                    return (
                      <tr key={row.productId}>
                        <td className="px-3 py-2 text-center text-xs text-tl-muted">
                          {(pageSafe - 1) * limit + idx + 1}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-medium text-tl-ink">{row.name}</span>
                            {row.sku && (
                              <span className="text-xs font-mono text-tl-muted">
                                {row.sku}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-tl-ink-secondary">
                          {row.priceUsdCents > 0
                            ? formatUsdCents(row.priceUsdCents)
                            : formatUsdFromCupCents(row.priceCents)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-tl-ink-secondary">
                          {formatCup(row.priceCents)}
                        </td>
                        <td className="px-3 py-2 text-center text-sm tabular-nums text-tl-ink">
                          {row.qty}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-tl-ink">
                          {formatCup(row.efectivoCents)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-tl-ink">
                          {formatCup(row.transferenciaCents)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-tl-ink">
                          <div className="flex justify-end">
                            <CupUsdMoney cents={row.usdCents} compact />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-tl-ink">
                          {formatCup(subtotal)}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-tl-muted">
                          {/* Campo reservado para futura conciliación manual */}
                          —
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filtered.length > 0 && !loading && (
                <tfoot>
                  <tr className="border-t border-tl-line-subtle bg-tl-canvas-subtle">
                    <td className="px-3 py-2 text-center text-xs font-semibold text-tl-muted">
                      #
                    </td>
                    <td className="px-3 py-2 text-sm font-semibold text-tl-ink">
                      TOTAL
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-tl-ink">
                      {formatCup(
                        filtered.reduce((a, r) => a + r.efectivoCents, 0),
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-tl-ink">
                      {formatCup(
                        filtered.reduce((a, r) => a + r.transferenciaCents, 0),
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold text-tl-ink">
                      <div className="flex justify-end">
                        <CupUsdMoney cents={filtered.reduce((a, r) => a + r.usdCents, 0)} compact />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-tl-ink">
                      {formatCup(
                        filtered.reduce(
                          (a, r) => a + r.efectivoCents + r.transferenciaCents + r.usdCents,
                          0,
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination (50 estándar) */}
          {!loading && filtered.length > 0 && (
            <div className="tl-no-print tl-table-pagination">
              <p className="text-xs text-tl-muted">
                {filtered.length.toLocaleString("es-ES")} filas · página {pageSafe} de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="tl-table-pagination__btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe <= 1}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="tl-table-pagination__btn"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe >= totalPages}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="text-xs text-tl-muted">
          <p>
            Esta vista resume los datos a partir de las ventas registradas en el sistema para la
            fecha seleccionada. Si quieres un formato idéntico a la hoja física, puedes imprimir
            esta página en horizontal desde el navegador.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}

