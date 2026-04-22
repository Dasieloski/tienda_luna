"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminShell } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";

type ProductOption = {
  id: string;
  sku: string;
  name: string;
};

type ProductInsight = {
  meta?: { dbAvailable?: boolean; tzOffsetMinutes?: number; note?: string; message?: string };
  range?: { fromDay: string; toDay: string };
  product: {
    id: string;
    sku: string;
    name: string;
    priceCents: number;
    priceUsdCents: number;
    unitsPerBox: number;
    wholesaleCupCents: number | null;
    costCents: number | null;
    supplierName: string | null;
    stockQty: number;
    lowStockAt: number;
    active: boolean;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  kpis?: {
    unitsSold?: number;
    revenueCents?: number;
    marginCentsApprox?: number;
    salesCount?: number;
  };
  series?: { day: string; units: number; revenueCents: number; marginCentsApprox: number }[];
  priceHistory?: {
    at: string;
    action: string;
    priceCents: number | null;
    priceUsdCents: number | null;
    costCents: number | null;
    wholesaleCupCents: number | null;
  }[];
  inventoryMovements?: {
    id: string;
    createdAt: string;
    delta: number;
    beforeQty: number;
    afterQty: number;
    reason: string;
    actorType: string;
    actorId: string;
  }[];
  milestones?: { productCreatedAt?: string; firstStockIncreaseAt?: string | null };
};

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortIso(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const tipStyle = {
  backgroundColor: "var(--tl-canvas-inset)",
  border: "1px solid var(--tl-line)",
  borderRadius: "10px",
  fontSize: "12px",
  padding: "10px 12px",
  color: "var(--tl-ink)",
} as const;

export default function ProductosPage() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [fromDay, setFromDay] = useState(() => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return ymdLocal(d);
  });
  const [toDay, setToDay] = useState(() => ymdLocal(new Date()));

  const [loadingList, setLoadingList] = useState(true);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [insight, setInsight] = useState<ProductInsight | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      setLoadingList(true);
      try {
        const res = await fetch("/api/products", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setErr("No se pudo cargar el catálogo.");
          return;
        }
        const json = (await res.json()) as { products?: { id: string; sku: string; name: string }[] };
        const opts = (json.products ?? []).map((p) => ({ id: p.id, sku: p.sku, name: p.name }));
        opts.sort((a, b) => a.name.localeCompare(b.name));
        if (cancelled) return;
        setProducts(opts);
        if (!selectedId && opts[0]) setSelectedId(opts[0].id);
        setErr(null);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }
    void loadProducts();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInsight() {
    if (!selectedId) return;
    setLoadingInsight(true);
    try {
      const qs = new URLSearchParams({ productId: selectedId, fromDay, toDay });
      const res = await fetch(`/api/admin/products/insights?${qs.toString()}`, { credentials: "include" });
      const json = (await res.json()) as ProductInsight & { error?: string };
      if (!res.ok || (json as any).error) {
        setInsight(null);
        setErr("No se pudo cargar la analítica del producto.");
        return;
      }
      setInsight(json);
      setErr(null);
    } finally {
      setLoadingInsight(false);
    }
  }

  useEffect(() => {
    void loadInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, fromDay, toDay]);

  const chartData = useMemo(() => {
    const s = insight?.series ?? [];
    return s.map((r) => ({
      day: r.day.slice(5), // MM-DD
      ingresos: Math.round((r.revenueCents ?? 0) / 100),
      unidades: r.units ?? 0,
      margen: Math.round((r.marginCentsApprox ?? 0) / 100),
    }));
  }, [insight]);

  const k = insight?.kpis ?? {};
  const showCharts = chartData.length > 0;

  return (
    <AdminShell title="Productos">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="tl-welcome-header">Productos</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Comportamiento histórico por producto (ventas, ingresos, margen aproximado, precio y stock).
            </p>
          </div>
          <button
            type="button"
            className={cn(
              "tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2",
              loadingInsight && "opacity-80"
            )}
            onClick={() => void loadInsight()}
            disabled={!selectedId || loadingInsight}
          >
            <RefreshCw className={cn("h-4 w-4", loadingInsight && "animate-spin")} aria-hidden />
            Actualizar
          </button>
        </div>

        <div className="tl-glass rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="product">
                Producto
              </label>
              <select
                id="product"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="tl-input mt-1 h-9 text-sm"
                disabled={loadingList}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku}
                  </option>
                ))}
              </select>
              {loadingList ? (
                <p className="mt-2 text-xs text-tl-muted">Cargando catálogo…</p>
              ) : null}
            </div>
            <div className="min-w-[160px]">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="fromDay">
                Desde
              </label>
              <input
                id="fromDay"
                type="date"
                value={fromDay}
                onChange={(e) => setFromDay(e.target.value)}
                className="tl-input mt-1 h-9 text-sm"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="toDay">
                Hasta
              </label>
              <input
                id="toDay"
                type="date"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
                className="tl-input mt-1 h-9 text-sm"
              />
            </div>
          </div>
        </div>

        {err ? (
          <div className="tl-glass rounded-xl border border-tl-danger/20 bg-tl-danger-subtle p-4 text-sm text-tl-danger">
            {err}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Unidades vendidas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">{k.unitsSold ?? 0}</p>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Ingresos</p>
            <div className="mt-1 text-2xl font-bold text-tl-ink">
              <CupUsdMoney cents={k.revenueCents ?? 0} />
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Margen (aprox)</p>
            <div className="mt-1 text-2xl font-bold text-tl-ink">
              <CupUsdMoney cents={k.marginCentsApprox ?? 0} />
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Tickets con el producto</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">{k.salesCount ?? 0}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-tl-ink">
                <BarChart3 className="h-4 w-4 text-tl-accent" aria-hidden />
                Ingresos por día
              </h2>
              <p className="text-xs text-tl-muted">{insight?.range ? `${insight.range.fromDay} → ${insight.range.toDay}` : ""}</p>
            </div>
            <div className="mt-4 h-[260px]">
              {showCharts ? (
                <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--tl-accent)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--tl-accent)" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--tl-line-subtle)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--tl-muted)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--tl-muted)" }} width={36} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(value: any, name: any) => {
                        if (name === "ingresos" || name === "margen") return [`${value} CUP`, name];
                        return [value, name];
                      }}
                    />
                    <Area type="monotone" dataKey="ingresos" stroke="var(--tl-accent)" fill="url(#revFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-tl-line bg-tl-canvas-inset text-sm text-tl-muted">
                  Sin datos en el rango
                </div>
              )}
            </div>
          </div>

          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-tl-ink">
                <Boxes className="h-4 w-4 text-tl-accent" aria-hidden />
                Unidades por día
              </h2>
              <p className="text-xs text-tl-muted">
                {insight?.meta?.note ? "Margen: coste actual × unidades históricas" : ""}
              </p>
            </div>
            <div className="mt-4 h-[260px]">
              {showCharts ? (
                <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="unitsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--tl-success)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--tl-success)" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--tl-line-subtle)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--tl-muted)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--tl-muted)" }} width={36} />
                    <Tooltip contentStyle={tipStyle} />
                    <Area type="monotone" dataKey="unidades" stroke="var(--tl-success)" fill="url(#unitsFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-tl-line bg-tl-canvas-inset text-sm text-tl-muted">
                  Sin datos en el rango
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="tl-glass rounded-xl p-4">
            <h2 className="text-sm font-semibold text-tl-ink">Historial de precio (según auditoría)</h2>
            <p className="mt-1 text-xs text-tl-muted">
              Solo refleja cambios guardados en el panel (no reconstruye el precio “usado” en ventas antiguas).
            </p>
            <div className="mt-4 max-h-[360px] overflow-auto rounded-lg border border-tl-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-tl-canvas-inset text-xs text-tl-muted">
                  <tr>
                    <th className="p-2 text-left">Fecha</th>
                    <th className="p-2 text-left">Acción</th>
                    <th className="p-2 text-right">PVP (CUP)</th>
                    <th className="p-2 text-right">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {(insight?.priceHistory ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-tl-muted">
                        Sin cambios de precio en el rango.
                      </td>
                    </tr>
                  ) : (
                    (insight?.priceHistory ?? []).slice().reverse().map((p) => (
                      <tr key={`${p.at}-${p.action}`} className="border-t border-tl-line-subtle">
                        <td className="p-2 text-xs text-tl-muted">{shortIso(p.at)}</td>
                        <td className="p-2 text-xs text-tl-muted">{p.action}</td>
                        <td className="p-2 text-right">
                          {p.priceCents == null ? "—" : <CupUsdMoney cents={p.priceCents} />}
                        </td>
                        <td className="p-2 text-right">
                          {p.costCents == null ? "—" : <CupUsdMoney cents={p.costCents} />}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tl-glass rounded-xl p-4">
            <h2 className="text-sm font-semibold text-tl-ink">Movimientos de inventario (últimos 60)</h2>
            <p className="mt-1 text-xs text-tl-muted">
              Entradas/salidas y decrementos por ventas dentro del rango.
            </p>
            <div className="mt-4 max-h-[360px] overflow-auto rounded-lg border border-tl-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-tl-canvas-inset text-xs text-tl-muted">
                  <tr>
                    <th className="p-2 text-left">Fecha</th>
                    <th className="p-2 text-left">Motivo</th>
                    <th className="p-2 text-right">Δ</th>
                    <th className="p-2 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {(insight?.inventoryMovements ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-tl-muted">
                        Sin movimientos en el rango.
                      </td>
                    </tr>
                  ) : (
                    (insight?.inventoryMovements ?? []).map((m) => (
                      <tr key={m.id} className="border-t border-tl-line-subtle">
                        <td className="p-2 text-xs text-tl-muted">{shortIso(m.createdAt)}</td>
                        <td className="p-2 text-xs text-tl-muted">{m.reason}</td>
                        <td className={cn("p-2 text-right tabular-nums", m.delta >= 0 ? "text-tl-success" : "text-tl-danger")}>
                          {m.delta >= 0 ? `+${m.delta}` : String(m.delta)}
                        </td>
                        <td className="p-2 text-right tabular-nums text-tl-ink-secondary">
                          {m.beforeQty} → {m.afterQty}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {insight?.meta?.note ? (
          <div className="rounded-xl border border-tl-line bg-tl-canvas-inset p-4 text-xs text-tl-muted">
            {insight.meta.note}
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}

