"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, FileText, RefreshCw, Truck } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { formatCupAndUsdLabel } from "@/lib/money";
import { cn } from "@/lib/utils";

type SupplierRow = {
  supplier: string;
  products: number;
  units: number;
  revenueCents: number;
  profitCents: number;
  linesMissingCost: number;
};

type SupplierTopProduct = {
  supplier: string;
  productId: string;
  name: string;
  sku: string;
  units: number;
  revenueCents: number;
};

type SuppliersResponse = {
  meta: { dbAvailable: boolean; message?: string };
  from: string | null;
  to: string | null;
  suppliers: SupplierRow[];
  topProducts: SupplierTopProduct[];
};

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function SuppliersPage() {
  const todayInput = useMemo(() => toInputDate(new Date()), []);
  const [mode, setMode] = useState<"days" | "range">("days");
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState(() => todayInput);
  const [to, setTo] = useState(() => todayInput);

  const [data, setData] = useState<SuppliersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (mode === "range") {
        params.set("from", from);
        params.set("to", to);
      } else {
        params.set("days", String(days));
      }
      const res = await fetch(`/api/admin/suppliers/summary?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as SuppliersResponse;
      setData(json);
      if (!res.ok || json.meta?.dbAvailable === false) {
        setError(json.meta?.message ?? "No se pudo cargar proveedores.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red al cargar proveedores.");
    } finally {
      setLoading(false);
    }
  }, [mode, days, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handleRefresh() {
      void load();
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [load]);

  const suppliersFiltered = useMemo(() => {
    const list = data?.suppliers ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.supplier.toLowerCase().includes(q));
  }, [data, query]);

  const topByRevenue = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.revenueCents - a.revenueCents);
    return s[0] ?? null;
  }, [data]);

  const topByProfit = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.profitCents - a.profitCents);
    return s[0] ?? null;
  }, [data]);

  const topByProducts = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.products - a.products);
    return s[0] ?? null;
  }, [data]);

  const topProductsBySupplier = useMemo(() => {
    const m = new Map<string, SupplierTopProduct[]>();
    for (const p of data?.topProducts ?? []) {
      const arr = m.get(p.supplier) ?? [];
      arr.push(p);
      m.set(p.supplier, arr);
    }
    return m;
  }, [data]);

  return (
    <AdminShell title="Proveedores">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Proveedores</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Ranking por proveedor: productos, unidades vendidas, ingresos y ganancia estimada (según costo).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="tl-glass flex items-center gap-2 rounded-xl px-3 py-2">
              <button
                type="button"
                className={cn(
                  "tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs",
                  mode === "days" && "ring-1 ring-tl-accent/30",
                )}
                onClick={() => setMode("days")}
              >
                Últimos días
              </button>
              <button
                type="button"
                className={cn(
                  "tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs",
                  mode === "range" && "ring-1 ring-tl-accent/30",
                )}
                onClick={() => setMode("range")}
              >
                Rango
              </button>
            </div>

            {mode === "days" ? (
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                <Calendar className="h-4 w-4" aria-hidden />
                <select
                  className="tl-input h-9 px-3 py-1 text-xs sm:text-sm"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={7}>7 días</option>
                  <option value={30}>30 días</option>
                  <option value={90}>90 días</option>
                  <option value={180}>180 días</option>
                </select>
              </label>
            ) : (
              <>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  <Calendar className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Desde</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  <span className="hidden sm:inline">Hasta</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
                  />
                </label>
              </>
            )}

            <button
              type="button"
              onClick={() => void load()}
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
              disabled={loading}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Proveedores activos"
              value={String(data?.suppliers.length ?? 0)}
              icon={<Truck className="h-4 w-4" />}
            />
            <KpiCard
              label="Top ingresos"
              value={topByRevenue ? formatCupAndUsdLabel(topByRevenue.revenueCents) : "—"}
              hint={topByRevenue?.supplier}
              variant="info"
            />
            <KpiCard
              label="Top ganancia"
              value={topByProfit ? formatCupAndUsdLabel(topByProfit.profitCents) : "—"}
              hint={topByProfit?.supplier}
              variant="success"
            />
            <KpiCard
              label="Más productos"
              value={topByProducts ? String(topByProducts.products) : "—"}
              hint={topByProducts?.supplier}
            />
          </div>
        </section>

        <section className="tl-glass rounded-xl p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-tl-muted" aria-hidden />
              <p className="text-sm font-semibold text-tl-ink">Resumen por proveedor</p>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar proveedor…"
              className="tl-input h-9 w-full sm:w-[260px]"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3 text-right">Productos</th>
                  <th className="px-4 py-3 text-right">Unidades vendidas</th>
                  <th className="px-4 py-3 text-right">Ingresos</th>
                  <th className="px-4 py-3 text-right">Ganancia (estim.)</th>
                  <th className="px-4 py-3 text-right">Costos faltantes</th>
                  <th className="px-4 py-3">Top productos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="tl-skeleton h-3 rounded-md" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : suppliersFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-tl-muted">
                      No hay datos para el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  suppliersFiltered.map((s) => {
                    const tops = topProductsBySupplier.get(s.supplier) ?? [];
                    return (
                      <tr key={s.supplier}>
                        <td className="px-4 py-3 font-medium text-tl-ink">{s.supplier}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                          {s.products.toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                          {s.units.toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                          {formatCupAndUsdLabel(s.revenueCents)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                          {formatCupAndUsdLabel(s.profitCents)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-muted">
                          {s.linesMissingCost > 0 ? s.linesMissingCost.toLocaleString("es-ES") : "0"}
                        </td>
                        <td className="px-4 py-3">
                          {tops.length === 0 ? (
                            <span className="text-xs text-tl-muted">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {tops.map((p) => (
                                <li key={p.productId} className="flex items-center justify-between gap-3">
                                  <span className="truncate text-xs text-tl-ink">
                                    {p.name}
                                    {p.sku ? (
                                      <span className="ml-2 font-mono text-[10px] text-tl-muted">
                                        {p.sku}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-xs tabular-nums text-tl-muted">
                                    {p.units} u · {formatCupAndUsdLabel(p.revenueCents)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-xs text-tl-muted">
            La ganancia es estimada: \(\sum (precio\_venta - costo) \times cantidad\). Si un producto no
            tiene costo (`costCents`), esa línea se cuenta en “Costos faltantes” y no aporta ganancia.
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

