"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarIcon as Calendar, FileTextIcon as FileText, RefreshCwIcon as RefreshCw } from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { formatCup } from "@/lib/money";
import { cn } from "@/lib/utils";

type MarginRangePayload = {
  meta: { dbAvailable: boolean; message?: string; fromInclusive?: string; toInclusive?: string };
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
  maxDays?: number;
};

type ProductMatrixResponse = {
  meta: { dbAvailable: boolean; message?: string };
  range: { from: string; to: string } | null;
  suppliers: { id: string; name: string; active: boolean }[];
  rows: {
    productId: string;
    name: string;
    sku: string;
    supplierId: string | null;
    supplierName: string | null;
    qtyTotal: number;
    revenueCents: number;
    revenueCashCents: number;
    revenueTransferCents: number;
    profitCents: number;
    marginPct: number | null;
    linesMissingCost: number;
    bySupplierPayableCents: Record<string, number>;
    bySupplierMissingCostLines: Record<string, number>;
  }[];
  totals: {
    qtyTotal: number;
    revenueCents: number;
    revenueCashCents: number;
    revenueTransferCents: number;
    costCents: number;
    profitCents: number;
    linesMissingCost: number;
    bySupplierPayableCents: Record<string, number>;
    bySupplierMissingCostLines: Record<string, number>;
  };
};

type SupplierDebtResponse = {
  meta: { dbAvailable: boolean; message?: string };
  range: { from: string; to: string } | null;
  suppliers: {
    supplierId: string | null;
    supplierName: string;
    pendingCents: number;
    pendingInRangeCents?: number;
  }[];
};

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentYearRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), 0, 1);
  return { from: toInputDate(from), to: toInputDate(now) };
}

export default function AdminResumenPage() {
  const defaultRange = useMemo(() => currentYearRange(), []);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  const [marginRange, setMarginRange] = useState<MarginRangePayload | null>(null);
  const [matrixData, setMatrixData] = useState<ProductMatrixResponse | null>(null);
  const [debtData, setDebtData] = useState<SupplierDebtResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matrixQuery, setMatrixQuery] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date(from + "T12:00:00");
      const end = new Date(to + "T12:00:00");
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setError("Fechas no válidas.");
        setMarginRange(null);
        setMatrixData(null);
        setDebtData(null);
        return;
      }
      if (start > end) {
        setError("La fecha inicial no puede ser posterior a la final.");
        setMarginRange(null);
        setMatrixData(null);
        setDebtData(null);
        return;
      }

      const [mrRes, mxRes, dbRes] = await Promise.all([
        fetch(`/api/admin/economy/margin-range?${new URLSearchParams({ from, to }).toString()}`, { credentials: "include" }),
        fetch(`/api/admin/suppliers/product-matrix?${new URLSearchParams({ from, to, includeInactiveSuppliers: "1" }).toString()}`, {
          credentials: "include",
        }),
        fetch(`/api/admin/suppliers/debt?${new URLSearchParams({ from, to }).toString()}`, { credentials: "include" }),
      ]);

      const [mrJson, mxJson, dbJson] = (await Promise.all([mrRes.json(), mxRes.json(), dbRes.json()])) as [
        MarginRangePayload,
        ProductMatrixResponse,
        SupplierDebtResponse,
      ];

      setMarginRange(mrJson);
      setMatrixData(mxJson);
      setDebtData(dbJson);

      if (!mrRes.ok) {
        if (mrJson?.error === "RANGE_TOO_LONG") {
          setError(`El rango máximo permitido es ${String(mrJson.maxDays ?? 400)} días.`);
        } else if (mrJson?.error === "INVALID_RANGE") {
          setError("La fecha inicial no puede ser posterior a la final.");
        } else {
          setError("No se pudo cargar el resumen del rango.");
        }
        return;
      }

      const anyDbDown =
        mrJson?.meta?.dbAvailable === false || mxJson?.meta?.dbAvailable === false || dbJson?.meta?.dbAvailable === false;
      if (anyDbDown) {
        setError(mrJson?.meta?.message ?? mxJson?.meta?.message ?? dbJson?.meta?.message ?? "Base de datos no disponible.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setMarginRange(null);
      setMatrixData(null);
      setDebtData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const totals = useMemo(() => {
    const vendidoTotal = matrixData?.totals?.revenueCents ?? 0;
    const ganancia = marginRange?.totals?.marginCents ?? matrixData?.totals?.profitCents ?? 0;
    const margenPct = marginRange?.totals?.marginPct ?? null;
    const vendidoConCoste = marginRange?.totals?.soldRevenueCents ?? 0;
    return { vendidoTotal, ganancia, margenPct, vendidoConCoste };
  }, [marginRange?.totals, matrixData?.totals]);

  const tableSuppliers = matrixData?.suppliers ?? [];
  const visibleMatrixSuppliers = tableSuppliers; // simple: mostrar todos

  const tableRows = useMemo(() => {
    const rows = matrixData?.rows ?? [];
    const q = matrixQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${r.sku ?? ""}`.toLowerCase().includes(q));
  }, [matrixData?.rows, matrixQuery]);

  const supplierCards = useMemo(() => {
    const list = debtData?.suppliers ?? [];
    return list
      .slice()
      .sort((a, b) => (b.pendingCents ?? 0) - (a.pendingCents ?? 0))
      .filter((s) => (s.supplierName ?? "").trim().length > 0);
  }, [debtData?.suppliers]);

  return (
    <AdminShell title="Resumen">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Resumen</h1>
            <p className="mt-2 max-w-3xl text-sm text-tl-muted">
              Vista rápida: vendido, ganancia, margen, deudas por proveedor y la tabla de productos × proveedores.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" aria-hidden />
                Desde
              </span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="tl-input h-10 w-[150px] px-3 text-sm normal-case font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Hasta
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="tl-input h-10 w-[150px] px-3 text-sm normal-case font-normal"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="tl-btn tl-btn-secondary inline-flex h-10 items-center gap-2"
              disabled={loading}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
              {loading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            variant="info"
            label="Vendido total"
            value={<CupUsdMoney cents={totals.vendidoTotal} />}
            icon={<FileText className="h-5 w-5" aria-hidden />}
          />
          <KpiCard
            variant="success"
            label="Ganancia de la tienda"
            value={<CupUsdMoney cents={totals.ganancia} />}
            icon={<FileText className="h-5 w-5" aria-hidden />}
          />
          <KpiCard
            variant="default"
            label="Margen sobre venta"
            value={totals.margenPct != null ? `${totals.margenPct.toFixed(1)} %` : "—"}
            icon={<FileText className="h-5 w-5" aria-hidden />}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-tl-ink">Deuda por proveedor</h2>
            <p className="text-xs text-tl-muted">Valor principal: pendiente acumulado. En pequeño: pendiente en este rango.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {supplierCards.length === 0 ? (
              <div className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-5 text-sm text-tl-muted sm:col-span-2 lg:col-span-3">
                {loading ? "Cargando proveedores…" : "No hay proveedores con deuda para mostrar (o no hay datos)."}
              </div>
            ) : (
              supplierCards.map((s) => (
                <div key={`${s.supplierId ?? "null"}:${s.supplierName}`} className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4">
                  <p className="truncate text-sm font-semibold text-tl-ink" title={s.supplierName}>
                    {s.supplierName}
                  </p>
                  <div className="mt-2">
                    <CupUsdMoney cents={s.pendingCents ?? 0} />
                  </div>
                  <p className="mt-1 text-xs text-tl-muted">
                    En rango: <span className="tabular-nums">{(s.pendingInRangeCents ?? 0) ? <CupUsdMoney cents={s.pendingInRangeCents ?? 0} compact /> : "—"}</span>
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset shadow-sm">
          <div className="flex flex-col gap-3 border-b border-tl-line-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-tl-accent" aria-hidden />
              <div>
                <h2 className="text-base font-semibold text-tl-ink">Productos × Proveedores</h2>
                <p className="text-xs text-tl-muted">Misma tabla de proveedores. Búsqueda simple por nombre/SKU.</p>
              </div>
            </div>
            <input
              value={matrixQuery}
              onChange={(e) => setMatrixQuery(e.target.value)}
              placeholder="Buscar producto…"
              className="tl-input h-10 w-full sm:w-[320px]"
              type="search"
              aria-label="Buscar producto (matriz)"
            />
          </div>

          <div className="px-4 pb-4 sm:px-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] border-separate border-spacing-0 text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-tl-line bg-tl-canvas text-xs uppercase tracking-wide text-tl-muted">
                  <tr>
                    <th className="sticky left-0 z-20 bg-tl-canvas px-4 py-3 text-left border-b border-tl-line-subtle">
                      Producto
                    </th>
                    <th className="px-4 py-3 text-left border-b border-tl-line-subtle border-l border-tl-line-subtle bg-sky-500/5">
                      Ventas
                    </th>
                    {visibleMatrixSuppliers.map((s) => (
                      <th
                        key={s.id}
                        className="px-4 py-3 text-right border-b border-tl-line-subtle border-l border-tl-line-subtle whitespace-nowrap bg-amber-500/5"
                        title={s.name}
                      >
                        {s.name}
                        {!s.active ? <span className="ml-1 text-[10px] font-semibold text-tl-muted">(Inactivo)</span> : null}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right border-b border-tl-line-subtle border-l border-tl-line-subtle whitespace-nowrap">
                      Ganancia
                    </th>
                    <th className="px-4 py-3 text-right border-b border-tl-line-subtle whitespace-nowrap">% margen</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-tl-line-subtle">
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={7 + visibleMatrixSuppliers.length} className="px-3 py-8 text-center text-sm text-tl-muted">
                        {loading ? "Cargando…" : "No hay datos para mostrar (o no coincide la búsqueda)."}
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((r, idx) => (
                      <tr
                        key={r.productId}
                        className={cn(idx % 2 === 0 ? "bg-tl-canvas-inset/30" : "bg-transparent")}
                      >
                        <td className="sticky left-0 z-10 bg-tl-canvas-inset px-4 py-3 border-b border-tl-line-subtle">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-tl-ink">{r.name}</p>
                            <p className="truncate text-xs text-tl-muted">{r.sku || "—"}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 border-b border-tl-line-subtle border-l border-tl-line-subtle bg-sky-500/5">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold text-tl-muted">Unidades</span>
                              <span className="tabular-nums font-semibold text-tl-ink">{r.qtyTotal.toLocaleString("es-ES")}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs text-tl-muted">Efectivo</span>
                              <span className="tabular-nums text-tl-ink">
                                <TablePriceCupCell cupCents={r.revenueCashCents} compact />
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs text-tl-muted">Transfer.</span>
                              <span className="tabular-nums text-tl-ink">
                                <TablePriceCupCell cupCents={r.revenueTransferCents} compact />
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 pt-1 border-t border-tl-line-subtle">
                              <span className="text-[11px] font-semibold text-tl-muted">Total</span>
                              <span className="tabular-nums font-semibold text-tl-ink">
                                <TablePriceCupCell cupCents={r.revenueCashCents + r.revenueTransferCents} compact />
                              </span>
                            </div>
                          </div>
                        </td>

                        {visibleMatrixSuppliers.map((s) => {
                          const v = r.bySupplierPayableCents?.[s.id];
                          const missing = r.bySupplierMissingCostLines?.[s.id] ?? 0;
                          if (v == null) {
                            return (
                              <td
                                key={`${r.productId}:${s.id}`}
                                className="px-4 py-3 text-right text-xs text-tl-muted border-b border-tl-line-subtle border-l border-tl-line-subtle bg-amber-500/5"
                              >
                                —
                              </td>
                            );
                          }
                          return (
                            <td
                              key={`${r.productId}:${s.id}`}
                              className="px-4 py-3 text-right border-b border-tl-line-subtle border-l border-tl-line-subtle bg-amber-500/5"
                            >
                              {v === 0 && missing > 0 ? (
                                <span className="text-xs font-semibold text-tl-warning">Sin coste</span>
                              ) : (
                                <span className="text-amber-900 dark:text-amber-100/95">
                                  <TablePriceCupCell cupCents={v} compact />
                                </span>
                              )}
                            </td>
                          );
                        })}

                        <td className="px-4 py-3 text-right border-b border-tl-line-subtle border-l border-tl-line-subtle">
                          <TablePriceCupCell cupCents={r.profitCents} compact />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink border-b border-tl-line-subtle">
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-semibold">
                              {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1).replace(/\.0$/, "")}%`}
                            </span>
                            <span className="text-xs text-tl-muted">
                              <TablePriceCupCell cupCents={r.profitCents} compact />
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                <tfoot className="border-t border-tl-line bg-tl-canvas-inset text-sm">
                  <tr>
                    <td className="sticky left-0 z-20 bg-tl-canvas-inset px-4 py-3 font-semibold text-tl-ink border-t border-tl-line-subtle">
                      Totales
                    </td>
                    <td className="px-4 py-3 border-t border-tl-line-subtle border-l border-tl-line-subtle bg-sky-500/5">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-tl-muted">Unidades</span>
                          <span className="tabular-nums font-semibold text-tl-ink">
                            {(matrixData?.totals?.qtyTotal ?? 0).toLocaleString("es-ES")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-tl-muted">Efectivo</span>
                          <span className="tabular-nums font-semibold text-tl-ink">
                            <TablePriceCupCell cupCents={matrixData?.totals?.revenueCashCents ?? 0} compact />
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-tl-muted">Transfer.</span>
                          <span className="tabular-nums font-semibold text-tl-ink">
                            <TablePriceCupCell cupCents={matrixData?.totals?.revenueTransferCents ?? 0} compact />
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 pt-1 border-t border-tl-line-subtle">
                          <span className="text-[11px] font-semibold text-tl-muted">Total</span>
                          <span className="tabular-nums font-semibold text-tl-ink">
                            <TablePriceCupCell
                              cupCents={(matrixData?.totals?.revenueCashCents ?? 0) + (matrixData?.totals?.revenueTransferCents ?? 0)}
                              compact
                            />
                          </span>
                        </div>
                      </div>
                    </td>
                    {visibleMatrixSuppliers.map((s) => (
                      <td
                        key={`tot:${s.id}`}
                        className="px-4 py-3 text-right font-semibold text-amber-900 dark:text-amber-100/95 border-t border-tl-line-subtle border-l border-tl-line-subtle bg-amber-500/5"
                      >
                        <TablePriceCupCell cupCents={matrixData?.totals?.bySupplierPayableCents?.[s.id] ?? 0} compact />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold text-tl-ink border-t border-tl-line-subtle border-l border-tl-line-subtle">
                      <TablePriceCupCell cupCents={matrixData?.totals?.profitCents ?? 0} compact />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-tl-ink border-t border-tl-line-subtle">
                      <div className="flex flex-col items-end gap-1">
                        <span>
                          {(() => {
                            const revenue = matrixData?.totals?.revenueCents ?? 0;
                            const profit = matrixData?.totals?.profitCents ?? 0;
                            if (revenue <= 0) return "—";
                            const pct = (profit / revenue) * 100;
                            return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
                          })()}
                        </span>
                        <span className="text-xs text-tl-muted">
                          <TablePriceCupCell cupCents={matrixData?.totals?.profitCents ?? 0} compact />
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

        </section>
      </div>
    </AdminShell>
  );
}

