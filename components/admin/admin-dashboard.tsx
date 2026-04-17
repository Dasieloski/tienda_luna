"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart2,
  Boxes,
  ChevronRight,
  Cpu,
  LayoutGrid,
  Radio,
  RefreshCw,
  Settings2,
  ShoppingCart,
} from "lucide-react";
import { DashboardCharts } from "@/components/admin/dashboard-charts";
import { cn } from "@/lib/utils";
import { formatCup } from "@/lib/money";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";

const TABS = [
  { id: "vista" as const, label: "Vista general", icon: LayoutGrid },
  { id: "vivo" as const, label: "Ventas en vivo", icon: Radio },
  { id: "productos" as const, label: "Productos", icon: Boxes },
  { id: "analitica" as const, label: "Analítica", icon: BarChart2 },
  { id: "config" as const, label: "Configuración", icon: Settings2 },
];

type TabId = (typeof TABS)[number]["id"];

type Overview = {
  level1: {
    ventasHoy: number;
    ingresosHoyCents: number;
    ventasMes: number;
    ingresosMesCents: number;
    ingresosTotalesCents: number;
    ticketMedioHoyCents: number;
    ticketMedioMesCents: number;
    horaPicoHoy: { hora: number | null; ventas: number; ingresosCents: number };
    productosTop: {
      productId: string;
      nombre: string;
      sku?: string;
      unidades: number;
      subtotalCents: number;
    }[];
    stockActual: {
      id: string;
      sku: string;
      nombre: string;
      stock: number;
      umbral: number | null;
    }[];
    eventosFraudulentos: number;
  };
  level2: {
    rotacionInventario30d: number;
    margenAprox30d: number;
    ventasPorHoraHoy: { hora: number; ventas: number; ingresosCents: number }[];
    rendimientoDispositivoMes: { deviceId: string; ventas: number; ingresosCents: number }[];
  };
  level3: {
    alertasStock: {
      productId: string;
      sku: string;
      nombre: string;
      stock: number;
      umbral: number | null;
    }[];
    anomalias: {
      id: string;
      type: string;
      deviceId: string;
      status: string;
      isFraud: boolean;
      fraudReason: string | null;
      serverTimestamp: string;
    }[];
    demandaHeuristica30d: { productId: string; unidades: number }[];
    dashboardLayout: unknown;
  };
  generatedAt: string;
  meta?: {
    dbAvailable?: boolean;
    hint?: string;
    message?: string;
  };
};

type RecentSale = {
  id: string;
  deviceId: string;
  totalCents: number;
  status: string;
  completedAt: string;
  lines: {
    id: string;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    productName: string;
    sku: string;
  }[];
};

type ProductRow = {
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
};

type AuditEvent = {
  id: string;
  type: string;
  status: string;
  deviceId: string;
  isFraud: boolean;
  fraudReason: string | null;
  serverTimestamp: string;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 scroll-mt-32 border-b border-white/10 pb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500 first:mt-0">
      {children}
    </h2>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "violet" | "cyan" | "amber" | "emerald";
}) {
  const ring =
    accent === "cyan"
      ? "hover:shadow-cyan-500/10 hover:border-cyan-500/25"
      : accent === "amber"
        ? "hover:shadow-amber-500/10 hover:border-amber-500/25"
        : accent === "emerald"
          ? "hover:shadow-emerald-500/10 hover:border-emerald-500/25"
          : "hover:shadow-violet-500/10 hover:border-violet-400/25";
  return (
    <div
      className={cn(
        "group tl-card-hover tl-interactive relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] via-zinc-900/40 to-black/30 p-5 shadow-lg ring-1 ring-white/5 transition-[border-color,box-shadow] duration-200",
        ring,
      )}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl transition-opacity group-hover:opacity-100" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function AdminDashboard() {
  const [tab, setTab] = useState<TabId>("vista");
  const [data, setData] = useState<Overview | null>(null);
  const [salesLive, setSalesLive] = useState<RecentSale[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const topSaleRef = useRef<string | null>(null);
  const [highlightSale, setHighlightSale] = useState(false);

  const [formSku, setFormSku] = useState("");
  const [formName, setFormName] = useState("");
  const [formPriceCup, setFormPriceCup] = useState("");
  const [formPriceUsd, setFormPriceUsd] = useState("");
  const [formUnitsBox, setFormUnitsBox] = useState("1");
  const [formWholesaleCup, setFormWholesaleCup] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formStock, setFormStock] = useState("0");
  const [formLow, setFormLow] = useState("5");
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    const res = await fetch("/api/stats/overview", { credentials: "include" });
    if (!res.ok) {
      setErr("No se pudo cargar el resumen (¿sesión admin?).");
      return;
    }
    const json = (await res.json()) as Overview;
    setData(json);
    setErr(null);
    setLastSync(new Date());
    setPulse(true);
    setTimeout(() => setPulse(false), 600);
  }, []);

  const loadSales = useCallback(async () => {
    const res = await fetch("/api/admin/sales/recent?limit=40", { credentials: "include" });
    if (!res.ok) return;
    const json = (await res.json()) as { sales: RecentSale[] };
    const next = json.sales ?? [];
    if (next[0] && topSaleRef.current && next[0].id !== topSaleRef.current) {
      setHighlightSale(true);
      setTimeout(() => setHighlightSale(false), 900);
    }
    topSaleRef.current = next[0]?.id ?? null;
    setSalesLive(next);
  }, []);

  const loadProducts = useCallback(async () => {
    const res = await fetch("/api/products", { credentials: "include" });
    if (!res.ok) return;
    const json = (await res.json()) as { products: ProductRow[] };
    setProducts(json.products ?? []);
  }, []);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/events?limit=40", { credentials: "include" });
    if (!res.ok) return;
    const json = (await res.json()) as { events: AuditEvent[] };
    setEvents(json.events ?? []);
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadSales();
    void loadProducts();
    void loadEvents();
  }, [loadOverview, loadSales, loadProducts, loadEvents]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadOverview();
      void loadSales();
      if (tab === "analitica") void loadEvents();
      if (tab === "productos") void loadProducts();
    }, 5000);
    return () => clearInterval(id);
  }, [loadOverview, loadSales, loadEvents, loadProducts, tab]);

  async function onCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormMsg(null);
    const cup = parseFloat(formPriceCup.replace(",", "."));
    const priceCents = Math.round(cup * 100);
    const usdParsed =
      formPriceUsd.trim() === ""
        ? 0
        : Math.round(parseFloat(formPriceUsd.replace(",", ".")) * 100);
    let wholesaleCupCents: number | null = null;
    if (formWholesaleCup.trim() !== "") {
      const w = Math.round(parseFloat(formWholesaleCup.replace(",", ".")) * 100);
      if (Number.isNaN(w) || w < 0) {
        setFormMsg("Precio mayorista no válido.");
        setFormBusy(false);
        return;
      }
      wholesaleCupCents = w;
    }
    const unitsPerBox = Math.max(1, parseInt(formUnitsBox, 10) || 1);
    if (Number.isNaN(priceCents) || priceCents < 0) {
      setFormMsg("Precio en CUP no válido.");
      setFormBusy(false);
      return;
    }
    if (Number.isNaN(usdParsed) || usdParsed < 0) {
      setFormMsg("Precio en USD no válido.");
      setFormBusy(false);
      return;
    }
    const res = await fetch("/api/products", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: formSku.trim(),
        name: formName.trim(),
        priceCents,
        priceUsdCents: usdParsed,
        unitsPerBox,
        wholesaleCupCents,
        supplierName: formSupplier.trim() || null,
        stockQty: parseInt(formStock, 10) || 0,
        lowStockAt: parseInt(formLow, 10) || 5,
      }),
    });
    setFormBusy(false);
    if (!res.ok) {
      setFormMsg("No se pudo crear (SKU duplicado o error de servidor).");
      return;
    }
    setFormMsg("Producto creado correctamente.");
    setFormSku("");
    setFormName("");
    setFormPriceCup("");
    setFormPriceUsd("");
    setFormUnitsBox("1");
    setFormWholesaleCup("");
    setFormSupplier("");
    setFormStock("0");
    setFormLow("5");
    void loadProducts();
    void loadOverview();
  }

  const dbOk = data?.meta?.dbAvailable !== false;

  const horaPicoLabel = useMemo(() => {
    if (!data) return "—";
    const h = data.level1.horaPicoHoy.hora;
    if (h == null) return "Sin ventas hoy";
    return `${String(h).padStart(2, "0")}:00 · ${data.level1.horaPicoHoy.ventas} tickets`;
  }, [data]);

  if (err && !data) {
    return <p className="text-red-400">{err}</p>;
  }
  if (!data) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-zinc-400">
        <RefreshCw className="h-8 w-8 animate-spin text-violet-400" aria-hidden />
        <p className="text-sm">Sincronizando métricas…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Sub-navegación tipo cockpit */}
      <div className="sticky top-[calc(4.25rem+1px)] z-30 -mx-4 border-b border-white/10 bg-zinc-950/90 px-2 py-3 backdrop-blur-xl sm:-mx-6 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-200 sm:text-sm",
                  active
                    ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-900/40 ring-1 ring-white/20"
                    : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10 hover:text-zinc-200",
                )}
              >
                <Icon className={cn("h-4 w-4", active && "motion-safe:animate-pulse")} aria-hidden />
                {t.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
            <Activity
              className={cn("h-4 w-4 text-emerald-400", pulse && "motion-safe:scale-110 motion-safe:text-emerald-300")}
              aria-hidden
            />
            {lastSync ? (
              <span className="tabular-nums">Actualizado {lastSync.toLocaleTimeString("es-ES")}</span>
            ) : (
              <span>En espera</span>
            )}
            <button
              type="button"
              onClick={() => {
                void loadOverview();
                void loadSales();
                void loadProducts();
                void loadEvents();
              }}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Sync
            </button>
          </div>
        </div>
      </div>

      {!dbOk ? (
        <div
          role="status"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 ring-1 ring-amber-500/20"
        >
          <p className="font-medium text-amber-50">Sin base de datos enlazada a esta sesión</p>
          <p className="mt-1 text-amber-100/90">
            {data.meta?.hint ??
              data.meta?.message ??
              "Configura STATIC_ADMIN_STORE_ID o revisa DATABASE_URL. Los datos y gráficas aparecerán en cuanto haya tienda en BD."}
          </p>
        </div>
      ) : null}

      {/* —— Vista general —— */}
      {tab === "vista" && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
                Centro de comando
              </h1>
              <p className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
                <Cpu className="h-4 w-4 text-violet-400" aria-hidden />
                Pulso operativo · {new Date(data.generatedAt).toLocaleString("es-ES")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Ventas hoy" value={String(data.level1.ventasHoy)} accent="violet" />
            <Kpi
              label="Ingresos hoy"
              value={<CupUsdMoney cents={data.level1.ingresosHoyCents} />}
              hint="CUP / USD"
              accent="emerald"
            />
            <Kpi
              label="Ticket medio hoy"
              value={<CupUsdMoney cents={data.level1.ticketMedioHoyCents} />}
              hint="Importe medio por venta"
              accent="cyan"
            />
            <Kpi
              label="Hora pico hoy"
              value={horaPicoLabel}
              hint={
                data.level1.horaPicoHoy.hora != null
                  ? <CupUsdMoney cents={data.level1.horaPicoHoy.ingresosCents} />
                  : undefined
              }
              accent="amber"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Ventas mes" value={String(data.level1.ventasMes)} />
            <Kpi label="Ingresos mes" value={<CupUsdMoney cents={data.level1.ingresosMesCents} />} />
            <Kpi
              label="Ticket medio mes"
              value={<CupUsdMoney cents={data.level1.ticketMedioMesCents} />}
            />
            <Kpi
              label="Ingresos totales"
              value={<CupUsdMoney cents={data.level1.ingresosTotalesCents} />}
            />
            <Kpi label="Eventos fraude" value={String(data.level1.eventosFraudulentos)} accent="amber" />
            <Kpi label="Margen aprox. 30d" value={<CupUsdMoney cents={data.level2.margenAprox30d} />} />
            <Kpi label="Rotación inventario" value={data.level2.rotacionInventario30d.toFixed(2)} />
          </div>

          <DashboardCharts
            hourly={data.level2.ventasPorHoraHoy}
            topProducts={data.level1.productosTop}
            devices={data.level2.rendimientoDispositivoMes}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-5 ring-1 ring-white/5">
              <h3 className="text-sm font-semibold text-white">Productos más vendidos</h3>
              <ul className="mt-4 space-y-3">
                {data.level1.productosTop.length === 0 ? (
                  <li className="text-sm text-zinc-500">Sin datos aún.</li>
                ) : (
                  data.level1.productosTop.map((p, i) => (
                    <li
                      key={p.productId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 text-sm transition-colors hover:border-violet-500/20"
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20 text-xs font-bold text-violet-200">
                          {i + 1}
                        </span>
                        <span className="font-medium text-zinc-200">{p.nombre}</span>
                      </span>
                      <span className="text-right text-zinc-400">
                        {p.unidades} u. ·{" "}
                        <span className="inline-flex justify-end">
                          <TablePriceCupCell cupCents={p.subtotalCents} compact inverse />
                        </span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-5 ring-1 ring-white/5">
              <h3 className="text-sm font-semibold text-white">Stock en tiempo casi real</h3>
              <ul className="mt-4 max-h-72 space-y-2 overflow-auto pr-1 text-sm">
                {data.level1.stockActual.map((p) => (
                  <li
                    key={p.id}
                    className="flex justify-between gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2"
                  >
                    <span className="text-zinc-200">{p.nombre}</span>
                    <span className="tabular-nums text-zinc-400">
                      {p.stock}
                      {p.umbral != null && p.stock <= p.umbral ? (
                        <span className="ml-2 text-amber-400">bajo</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* —— Ventas en vivo —— */}
      {tab === "vivo" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Ventas en vivo</h1>
              <p className="mt-1 text-sm text-zinc-500">Tabla auto‑actualizada cada 5s · últimas en cabecera</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Stream activo
            </span>
          </div>

          <div
            className={cn(
              "overflow-x-auto rounded-2xl border border-white/10 shadow-xl ring-1 ring-white/5 transition-shadow duration-500",
              highlightSale && "ring-violet-500/40 shadow-violet-500/10",
            )}
          >
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 border-b border-white/10 bg-zinc-900/95 text-[11px] uppercase tracking-wider text-zinc-500 backdrop-blur">
                <tr>
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Dispositivo</th>
                  <th className="px-4 py-3">Líneas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {salesLive.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                      No hay ventas recientes o la BD no está conectada.
                    </td>
                  </tr>
                ) : (
                  salesLive.map((s, idx) => (
                    <tr
                      key={s.id}
                      className={cn(
                        "transition-colors hover:bg-white/[0.04]",
                        idx === 0 && highlightSale && "bg-violet-500/10 motion-safe:animate-pulse",
                      )}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-400">
                        {new Date(s.completedAt).toLocaleString("es-ES")}
                      </td>
                      <td className="px-4 py-3 text-right align-top font-semibold text-white">
                        <TablePriceCupCell cupCents={s.totalCents} compact inverse />
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{s.status}</span>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-zinc-400">{s.deviceId}</td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {s.lines
                          .map((l) => `${l.quantity}× ${l.productName}`)
                          .slice(0, 3)
                          .join(" · ")}
                        {s.lines.length > 3 ? "…" : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* —— Productos —— */}
      {tab === "productos" && (
        <div className="space-y-10">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Catálogo</h1>
            <p className="mt-1 text-sm text-zinc-500">Listado de productos y altas rápidas.</p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-x-auto rounded-2xl border border-white/10 ring-1 ring-white/5">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-white/10 bg-white/[0.04] text-[11px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3 text-right">PVP</th>
                    <th className="px-4 py-3">Ud/caja</th>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Mayorista</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Umbral</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5 font-medium text-zinc-200">{p.name}</td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <TablePriceCupCell
                          cupCents={p.priceCents}
                          explicitUsdCents={p.priceUsdCents}
                          compact
                          inverse
                        />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-400">
                        {p.unitsPerBox ?? 1}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">{p.supplierName ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-400">
                        {p.wholesaleCupCents != null ? formatCup(p.wholesaleCupCents) : "—"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{p.stockQty}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-500">{p.lowStockAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="h-fit rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/10 to-zinc-950/80 p-5 ring-1 ring-violet-500/20">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShoppingCart className="h-4 w-4 text-violet-300" aria-hidden />
                Nuevo producto
              </h2>
              <form onSubmit={onCreateProduct} className="mt-4 space-y-3">
                <div>
                  <label className="text-xs text-zinc-400" htmlFor="np-sku">
                    SKU
                  </label>
                  <input
                    id="np-sku"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400" htmlFor="np-name">
                    Nombre
                  </label>
                  <input
                    id="np-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-zinc-400" htmlFor="np-price-cup">
                      PVP (CUP)
                    </label>
                    <input
                      id="np-price-cup"
                      inputMode="decimal"
                      value={formPriceCup}
                      onChange={(e) => setFormPriceCup(e.target.value)}
                      placeholder="250,00"
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400" htmlFor="np-price-usd">
                      PVP (USD)
                    </label>
                    <input
                      id="np-price-usd"
                      inputMode="decimal"
                      value={formPriceUsd}
                      onChange={(e) => setFormPriceUsd(e.target.value)}
                      placeholder="opcional"
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-zinc-400" htmlFor="np-box">
                      Ud/caja
                    </label>
                    <input
                      id="np-box"
                      type="number"
                      min={1}
                      value={formUnitsBox}
                      onChange={(e) => setFormUnitsBox(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400" htmlFor="np-wh">
                      Mayorista (CUP)
                    </label>
                    <input
                      id="np-wh"
                      inputMode="decimal"
                      value={formWholesaleCup}
                      onChange={(e) => setFormWholesaleCup(e.target.value)}
                      placeholder="opcional"
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-400" htmlFor="np-sup">
                    Proveedor
                  </label>
                  <input
                    id="np-sup"
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-zinc-400" htmlFor="np-st">
                      Stock
                    </label>
                    <input
                      id="np-st"
                      type="number"
                      min={0}
                      value={formStock}
                      onChange={(e) => setFormStock(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400" htmlFor="np-low">
                      Alerta stock
                    </label>
                    <input
                      id="np-low"
                      type="number"
                      min={0}
                      value={formLow}
                      onChange={(e) => setFormLow(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                </div>
                {formMsg ? <p className="text-xs text-violet-300">{formMsg}</p> : null}
                <button
                  type="submit"
                  disabled={formBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-95 disabled:opacity-50"
                >
                  {formBusy ? "Guardando…" : "Crear producto"}
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* —— Analítica —— */}
      {tab === "analitica" && (
        <div className="space-y-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">Analítica profunda</h1>

          <SectionTitle>Demanda · alertas</SectionTitle>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4 ring-1 ring-white/5">
              <h3 className="text-sm font-medium text-zinc-200">Demanda 30d (unidades)</h3>
              <ul className="mt-3 space-y-1 text-sm text-zinc-400">
                {data.level3.demandaHeuristica30d.map((d) => (
                  <li key={d.productId} className="flex justify-between">
                    <span className="font-mono text-xs text-zinc-300">{d.productId}</span>
                    <span>{d.unidades} u.</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4 ring-1 ring-white/5">
              <h3 className="text-sm font-medium text-zinc-200">Alertas de stock</h3>
              <ul className="mt-3 space-y-2 text-sm text-zinc-400">
                {data.level3.alertasStock.length === 0 ? (
                  <li>Sin alertas.</li>
                ) : (
                  data.level3.alertasStock.map((a) => (
                    <li key={a.productId} className="flex justify-between">
                      <span className="text-zinc-200">{a.nombre}</span>
                      <span className="text-amber-400">
                        {a.stock} ≤ {a.umbral}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <SectionTitle>Anomalías</SectionTitle>
          <ul className="space-y-2 text-sm text-zinc-400">
            {data.level3.anomalias.map((a) => (
              <li key={a.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-zinc-200">{a.type}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(a.serverTimestamp).toLocaleString("es-ES")}
                  </span>
                </div>
                <div className="mt-1 text-xs">
                  {a.isFraud ? <span className="text-red-400">fraude</span> : null}{" "}
                  <span className="text-zinc-500">{a.status}</span> ·{" "}
                  <span className="font-mono text-zinc-400">{a.deviceId}</span>
                </div>
                {a.fraudReason ? <p className="mt-1 text-xs text-amber-300">{a.fraudReason}</p> : null}
              </li>
            ))}
          </ul>

          <SectionTitle>Auditoría · eventos</SectionTitle>
          <div className="overflow-x-auto rounded-2xl border border-white/10 ring-1 ring-white/5">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Fraude</th>
                  <th className="px-3 py-2">Dispositivo</th>
                  <th className="px-3 py-2">Servidor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-zinc-300">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-white/[0.03]">
                    <td className="px-3 py-2">{e.type}</td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2">{e.isFraud ? "sí" : "no"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.deviceId}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {new Date(e.serverTimestamp).toLocaleString("es-ES")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* —— Configuración —— */}
      {tab === "config" && (
        <div className="space-y-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">Configuración</h1>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 ring-1 ring-white/5">
              <h2 className="text-sm font-semibold text-white">Estado de datos</h2>
              <dl className="mt-3 space-y-2 text-sm text-zinc-400">
                <div className="flex justify-between gap-2">
                  <dt>Base de datos</dt>
                  <dd className={dbOk ? "text-emerald-400" : "text-amber-400"}>{dbOk ? "Conectada" : "No enlazada"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Última sync métricas</dt>
                  <dd className="tabular-nums text-zinc-300">
                    {lastSync ? lastSync.toLocaleString("es-ES") : "—"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 ring-1 ring-white/5">
              <h2 className="text-sm font-semibold text-white">Layout dashboard (JSON)</h2>
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-zinc-400">
                {JSON.stringify(data.level3.dashboardLayout, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-zinc-500">
                Personalización vía{" "}
                <code className="text-zinc-300">PATCH /api/admin/dashboard-layout</code>
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 ring-1 ring-violet-500/20">
            <h2 className="text-sm font-semibold text-violet-200">Más información</h2>
            <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-zinc-400">
              <li>El panel refresca métricas y ventas cada 5 segundos cuando está abierto.</li>
              <li>Los gráficos animan al montar y al recibir nuevos datos del resumen.</li>
              <li>
                Sesión admin estática: revisa{" "}
                <code className="text-zinc-300">lib/static-admin-auth.ts</code> y variables{" "}
                <code className="text-zinc-300">STATIC_ADMIN_*</code>.
              </li>
              <li>
                Volver al sitio público:{" "}
                <Link href="/" className="text-violet-300 underline-offset-2 hover:underline">
                  Inicio
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
