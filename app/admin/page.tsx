"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Cpu,
  DollarSign,
  Package,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { ActivityFeed, type ActivityItem } from "@/components/admin/activity-feed";
import { DashboardCharts } from "@/components/admin/dashboard-charts";
import { cn } from "@/lib/utils";

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
    clientesFrecuentes: {
      customerId: string | null;
      nombre: string | null;
      telefono: string | null;
      compras: number;
      totalCents: number;
    }[];
    ventasPorHoraHoy: { hora: number; ventas: number; ingresosCents: number }[];
    rendimientoDispositivoMes: { deviceId: string; ventas: number; ingresosCents: number }[];
  };
  level3: {
    cohortesClientesNuevos: { mes: string; clientes: number }[];
    ltvTop: { customerId: string; pedidos: number; totalCents: number }[];
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

function money(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-tl-ink">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-tl-muted">{description}</p>}
    </div>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/overview", { credentials: "include" });
      if (!res.ok) {
        setError("No se pudo cargar el resumen.");
        return;
      }
      const json = (await res.json()) as Overview;
      setData(json);
      setError(null);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Listen for refresh events from shell
  useEffect(() => {
    function handleRefresh() {
      void loadOverview();
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [loadOverview]);

  // Build activity items from anomalies
  const activityItems = useMemo<ActivityItem[]>(() => {
    if (!data) return [];
    return data.level3.anomalias.slice(0, 10).map((a) => ({
      id: a.id,
      type: a.isFraud ? "fraud_alert" : "generic",
      title: a.type,
      description: `Dispositivo: ${a.deviceId}`,
      timestamp: new Date(a.serverTimestamp),
      isFraud: a.isFraud,
    }));
  }, [data]);

  // Peak hour label
  const horaPicoLabel = useMemo(() => {
    if (!data) return "—";
    const h = data.level1.horaPicoHoy.hora;
    if (h == null) return "Sin ventas hoy";
    return `${String(h).padStart(2, "0")}:00`;
  }, [data]);

  const dbOk = data?.meta?.dbAvailable !== false;

  if (loading) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-tl-accent border-t-transparent tl-spin" />
          <p className="text-sm text-tl-muted">Sincronizando métricas...</p>
        </div>
      </AdminShell>
    );
  }

  if (error && !data) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <AlertTriangle className="h-10 w-10 text-tl-danger" aria-hidden />
          <p className="text-sm text-tl-danger">{error}</p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-8">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-tl-ink sm:text-3xl">
              Centro de comando
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-tl-muted">
              <Cpu className="h-4 w-4 text-tl-accent" aria-hidden />
              Pulso operativo{" "}
              {data && (
                <span className="tabular-nums">
                  {new Date(data.generatedAt).toLocaleString("es-ES")}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Database warning */}
        {!dbOk && (
          <div className="tl-glass flex items-start gap-3 rounded-xl border-tl-warning/30 bg-tl-warning-subtle p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-tl-warning" aria-hidden />
            <div>
              <p className="font-medium text-tl-warning">Sin base de datos enlazada</p>
              <p className="mt-1 text-sm text-tl-muted">
                {data?.meta?.hint ?? data?.meta?.message ?? "Configura STATIC_ADMIN_STORE_ID o revisa DATABASE_URL."}
              </p>
            </div>
          </div>
        )}

        {/* Primary KPIs */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Ventas hoy"
              value={String(data?.level1.ventasHoy ?? 0)}
              variant="default"
              icon={<ShoppingCart className="h-4 w-4" />}
            />
            <KpiCard
              label="Ingresos hoy"
              value={money(data?.level1.ingresosHoyCents ?? 0)}
              hint="EUR facturado"
              variant="success"
              icon={<DollarSign className="h-4 w-4" />}
            />
            <KpiCard
              label="Ticket medio"
              value={money(data?.level1.ticketMedioHoyCents ?? 0)}
              hint="Importe medio"
              variant="info"
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <KpiCard
              label="Hora pico"
              value={horaPicoLabel}
              hint={
                data?.level1.horaPicoHoy.hora != null
                  ? `${data.level1.horaPicoHoy.ventas} tickets`
                  : undefined
              }
              variant="warning"
              icon={<Clock className="h-4 w-4" />}
            />
          </div>
        </section>

        {/* Secondary KPIs */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Ventas mes"
              value={String(data?.level1.ventasMes ?? 0)}
            />
            <KpiCard
              label="Ingresos mes"
              value={money(data?.level1.ingresosMesCents ?? 0)}
            />
            <KpiCard
              label="Ingresos totales"
              value={money(data?.level1.ingresosTotalesCents ?? 0)}
            />
            <KpiCard
              label="Eventos fraude"
              value={String(data?.level1.eventosFraudulentos ?? 0)}
              variant={data?.level1.eventosFraudulentos ? "danger" : "default"}
              icon={data?.level1.eventosFraudulentos ? <AlertTriangle className="h-4 w-4" /> : undefined}
            />
          </div>
        </section>

        {/* Charts */}
        {data && (
          <section>
            <SectionHeader
              title="Rendimiento"
              description="Visualización de ingresos, productos y dispositivos"
            />
            <DashboardCharts
              hourly={data.level2.ventasPorHoraHoy}
              topProducts={data.level1.productosTop}
              devices={data.level2.rendimientoDispositivoMes}
            />
          </section>
        )}

        {/* Two-column layout: Top products + Stock / Activity feed */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column - Products and Stock */}
          <div className="space-y-6 lg:col-span-2">
            {/* Top products */}
            <section>
              <SectionHeader title="Productos más vendidos" />
              <div className="tl-glass overflow-hidden rounded-xl">
                {!data?.level1.productosTop.length ? (
                  <div className="flex items-center justify-center p-8 text-sm text-tl-muted">
                    Sin datos aún
                  </div>
                ) : (
                  <ul className="divide-y divide-tl-line-subtle">
                    {data.level1.productosTop.map((p, i) => (
                      <li
                        key={p.productId}
                        className="tl-reveal flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-tl-canvas-subtle"
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tl-accent-subtle text-xs font-bold text-tl-accent">
                            {i + 1}
                          </span>
                          <div>
                            <p className="font-medium text-tl-ink">{p.nombre}</p>
                            {p.sku && (
                              <p className="text-xs font-mono text-tl-muted">{p.sku}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums text-tl-ink">
                            {money(p.subtotalCents)}
                          </p>
                          <p className="text-xs text-tl-muted">{p.unidades} u.</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Stock alerts */}
            {data?.level3.alertasStock && data.level3.alertasStock.length > 0 && (
              <section>
                <SectionHeader
                  title="Alertas de stock"
                  description="Productos con inventario bajo"
                />
                <div className="tl-glass overflow-hidden rounded-xl border-tl-warning/20">
                  <ul className="divide-y divide-tl-line-subtle">
                    {data.level3.alertasStock.map((a) => (
                      <li
                        key={a.productId}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <Package className="h-5 w-5 text-tl-warning" aria-hidden />
                          <div>
                            <p className="font-medium text-tl-ink">{a.nombre}</p>
                            <p className="text-xs font-mono text-tl-muted">{a.sku}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "font-semibold tabular-nums",
                            a.stock <= (a.umbral ?? 0) ? "text-tl-warning" : "text-tl-ink"
                          )}>
                            {a.stock} u.
                          </p>
                          <p className="text-xs text-tl-muted">
                            umbral: {a.umbral ?? "—"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </div>

          {/* Right column - Activity feed */}
          <div className="lg:col-span-1">
            <SectionHeader title="Actividad" description="Eventos recientes" />
            <ActivityFeed items={activityItems} maxItems={8} />
          </div>
        </div>

        {/* Device performance */}
        {data?.level2.rendimientoDispositivoMes && data.level2.rendimientoDispositivoMes.length > 0 && (
          <section>
            <SectionHeader
              title="Rendimiento por dispositivo"
              description="Ventas registradas por terminal este mes"
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.level2.rendimientoDispositivoMes.slice(0, 4).map((d) => (
                <div
                  key={d.deviceId}
                  className="tl-glass rounded-xl p-4"
                >
                  <p className="truncate text-xs font-mono text-tl-muted" title={d.deviceId}>
                    {d.deviceId}
                  </p>
                  <p className="mt-2 text-xl font-bold tabular-nums text-tl-ink">
                    {d.ventas}
                  </p>
                  <p className="text-sm text-tl-muted">
                    {money(d.ingresosCents)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminShell>
  );
}
