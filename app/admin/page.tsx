"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  Clock,
  ClipboardList,
  Cpu,
  DollarSign,
  Package,
  ShoppingCart,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { ActivityFeed, type ActivityItem } from "@/components/admin/activity-feed";
import { DashboardCharts } from "@/components/admin/dashboard-charts";
import { WeeklyProgress, TaskProgress } from "@/components/admin/crextio-widgets";
import { cn } from "@/lib/utils";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";

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

  // Sin auto-refresh: solo carga inicial y acciones manuales del usuario.

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
        {/* Accesos rápidos (primero visible) */}
        <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-tl-ink">Accesos rápidos</p>
              <p className="mt-1 text-xs text-tl-muted">Atajos directos a los módulos más usados.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/inventario"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              >
                <Boxes className="h-4 w-4" aria-hidden />
                Inventario
              </Link>
              <Link
                href="/admin/control-diario"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              >
                <ClipboardList className="h-4 w-4" aria-hidden />
                Control diario
              </Link>
              <Link
                href="/admin/ventas"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              >
                <ShoppingCart className="h-4 w-4" aria-hidden />
                Ventas
              </Link>
              <Link
                href="/admin/control-diario/cuadre"
                className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm no-underline"
              >
                <ShieldAlert className="h-4 w-4" aria-hidden />
                Cuadre
              </Link>
            </div>
          </div>
        </section>

        {/* Welcome header - Crextio style */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="tl-welcome-header">
              Bienvenido, Administrador
            </h1>
            
            {/* Quick stats row - Crextio style */}
            <div className="mt-6 flex flex-wrap items-center gap-6">
              {/* Percentage badges */}
              <div className="flex gap-2">
                <span className="tl-percent-badge dark">
                  {data?.level1.ventasHoy ?? 0} hoy
                </span>
                <span className="tl-percent-badge accent">
                  {Math.round((data?.level1.ventasHoy ?? 0) / Math.max(data?.level1.ventasMes ?? 1, 1) * 100)}%
                </span>
              </div>
              
              {/* Progress bar pills */}
              <div className="hidden items-center gap-3 sm:flex">
                <span className="text-xs text-tl-muted">Avance mes</span>
                <div className="tl-progress-pills w-32">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "tl-progress-pill",
                        i < Math.min(Math.round((data?.level1.ventasMes ?? 0) / 100), 10) && "filled"
                      )} 
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          
          {/* Large stat numbers - Crextio style */}
          <div className="flex flex-wrap items-center gap-6 lg:justify-end">
            <div className="text-left sm:text-right">
              <p className="tl-stat-number">{data?.level1.ventasMes ?? 0}</p>
              <p className="flex items-center justify-end gap-1.5 text-xs text-tl-muted">
                <Users className="h-4 w-4" aria-hidden />
                Ventas mes
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="tl-stat-number">{data?.level1.productosTop.length ?? 0}</p>
              <p className="flex items-center justify-end gap-1.5 text-xs text-tl-muted">
                <Boxes className="h-4 w-4" aria-hidden />
                Productos
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="tl-stat-number">{data?.level2.rendimientoDispositivoMes.length ?? 0}</p>
              <p className="flex items-center justify-end gap-1.5 text-xs text-tl-muted">
                <Cpu className="h-4 w-4" aria-hidden />
                Dispositivos
              </p>
            </div>
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
            <Link href="/admin/historial?preset=today" className="block">
              <KpiCard
                label="Ventas hoy"
                value={String(data?.level1.ventasHoy ?? 0)}
                variant="default"
                icon={<ShoppingCart className="h-4 w-4" />}
                actionable
              />
            </Link>
            <KpiCard
              label="Ingresos hoy"
              value={<CupUsdMoney cents={data?.level1.ingresosHoyCents ?? 0} />}
              hint="Total facturado hoy"
              variant="success"
              icon={<DollarSign className="h-4 w-4" />}
            />
            <KpiCard
              label="Ticket medio"
              value={<CupUsdMoney cents={data?.level1.ticketMedioHoyCents ?? 0} />}
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
              value={<CupUsdMoney cents={data?.level1.ingresosMesCents ?? 0} />}
            />
            <KpiCard
              label="Ingresos totales"
              value={<CupUsdMoney cents={data?.level1.ingresosTotalesCents ?? 0} />}
            />
            <Link href="/admin/alertas?fraud=1" className="block">
              <KpiCard
                label="Eventos fraude"
                value={String(data?.level1.eventosFraudulentos ?? 0)}
                variant={data?.level1.eventosFraudulentos ? "danger" : "default"}
                icon={data?.level1.eventosFraudulentos ? <AlertTriangle className="h-4 w-4" /> : undefined}
                actionable
              />
            </Link>
          </div>
        </section>

        {/* Crextio-style Progress Widgets */}
        <section>
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Weekly Progress */}
            <WeeklyProgress
              data={[
                { day: "L", value: 2.5 },
                { day: "M", value: 4.2 },
                { day: "X", value: 5.5, isToday: true },
                { day: "J", value: 3.8 },
                { day: "V", value: 6.1 },
                { day: "S", value: 1.2 },
                { day: "D", value: 0 },
              ]}
              label="Progreso"
              total={`${((data?.level1.ventasHoy ?? 0) / 10).toFixed(1)}h`}
              subtitle="Actividad esta semana"
            />
            
            {/* Task Progress */}
            <TaskProgress
              title="Tareas pendientes"
              completedCount={2}
              totalCount={8}
              tasks={[
                { id: "1", title: "Revisar stock bajo", time: "Hoy, 08:30", completed: true },
                { id: "2", title: "Sync con servidor", time: "Hoy, 10:30", completed: true },
                { id: "3", title: "Actualizar precios", time: "Hoy, 13:00", completed: false },
                { id: "4", title: "Revisar alertas", time: "Hoy, 14:45", completed: false },
                { id: "5", title: "Backup datos", time: "Hoy, 16:30", completed: false },
              ]}
              className="lg:col-span-2"
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
                          <div className="flex justify-end font-semibold text-tl-ink">
                            <CupUsdMoney cents={p.subtotalCents} compact />
                          </div>
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
                  <div className="text-sm text-tl-muted">
                    <CupUsdMoney cents={d.ingresosCents} compact />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminShell>
  );
}
