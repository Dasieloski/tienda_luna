"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Colors aligned with Crextio design system - warm tones
const GOLD = "#f5c518";      // Primary accent
const CHARCOAL = "#2d2d2d";  // Secondary
const CREAM = "#eae7e1";     // Background
const SAND = "#d4cfc5";      // Muted
const WARM_GRAY = "#8a8a8a"; // Text muted

type Hourly = { hora: number; ventas: number; ingresosCents: number };
type TopP = { nombre: string; unidades: number; subtotalCents: number };
type Dev = { deviceId: string; ventas: number; ingresosCents: number };

function ChartFrame({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`tl-glass relative overflow-hidden rounded-xl p-4 sm:p-5 ${className}`}>
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-tl-accent/10 blur-3xl"
        aria-hidden
      />
      <div className="relative">
        <h3 className="text-sm font-semibold tracking-tight text-tl-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-tl-muted">{subtitle}</p>}
        <div className="mt-4 h-[220px] w-full sm:h-[240px] lg:h-[260px]">{children}</div>
      </div>
    </div>
  );
}

const tipStyle = {
  backgroundColor: "var(--tl-canvas-inset)",
  border: "1px solid var(--tl-line)",
  borderRadius: "8px",
  fontSize: "12px",
  padding: "8px 12px",
  color: "var(--tl-ink)",
};

export function DashboardCharts({
  hourly,
  topProducts,
  devices,
}: {
  hourly: Hourly[];
  topProducts: TopP[];
  devices: Dev[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const hourlyChart = useMemo(
    () =>
      hourly.map((h) => ({
        label: `${String(h.hora).padStart(2, "0")}:00`,
        ingresos: Math.round(h.ingresosCents / 100),
        ventas: h.ventas,
      })),
    [hourly]
  );

  const productsChart = useMemo(
    () =>
      topProducts.slice(0, 6).map((p) => ({
        nombre: p.nombre.length > 18 ? `${p.nombre.slice(0, 16)}...` : p.nombre,
        unidades: p.unidades,
        ingresos: Math.round(p.subtotalCents / 100),
      })),
    [topProducts]
  );

  const pieData = useMemo(() => {
    const slice = topProducts.slice(0, 5).filter((p) => p.subtotalCents > 0);
    if (slice.length === 0) {
      return [{ name: "Sin datos", value: 100, fill: SAND }];
    }
    const sum = slice.reduce((a, p) => a + p.subtotalCents, 0) || 1;
    // Crextio-style warm color palette
    const pieColors = [GOLD, CHARCOAL, "#d4a017", "#4a4a4a", SAND];
    return slice.map((p, i) => ({
      name: p.nombre.length > 14 ? `${p.nombre.slice(0, 12)}...` : p.nombre,
      value: Math.round((p.subtotalCents / sum) * 100),
      fill: pieColors[i % 5],
    }));
  }, [topProducts]);

  const devicesChart = useMemo(
    () =>
      devices.slice(0, 8).map((d) => ({
        id: d.deviceId.length > 10 ? `${d.deviceId.slice(0, 8)}...` : d.deviceId,
        ventas: d.ventas,
        ingresos: Math.round(d.ingresosCents / 100),
      })),
    [devices]
  );

  if (!mounted) {
    return (
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[340px] animate-pulse rounded-xl bg-tl-canvas-subtle"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
      <ChartFrame
        title="Ingresos por hora (hoy)"
        subtitle="Actualización en vivo"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={hourlyChart}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="tlFillIngresos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GOLD} stopOpacity={0.4} />
                <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 6"
              stroke="var(--tl-line)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--tl-muted)", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--tl-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={tipStyle}
              formatter={(v, name) => {
                const n = typeof v === "number" ? v : Number(v);
                const label = String(name);
                return [
                  label === "ingresos" ? `${n} EUR` : n,
                  label === "ingresos" ? "Ingresos" : "Ventas",
                ];
              }}
            />
            <Area
              type="monotone"
              dataKey="ingresos"
              stroke={GOLD}
              strokeWidth={2}
              fill="url(#tlFillIngresos)"
              animationDuration={1200}
              isAnimationActive
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Unidades - top referencias"
        subtitle="Histórico acumulado por producto"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={productsChart}
            margin={{ top: 8, right: 8, left: -8, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 6"
              stroke="var(--tl-line)"
              vertical={false}
            />
            <XAxis
              dataKey="nombre"
              tick={{ fill: "var(--tl-muted)", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-18}
              textAnchor="end"
              height={64}
            />
            <YAxis
              tick={{ fill: "var(--tl-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={tipStyle}
              formatter={(v) => [
                `${typeof v === "number" ? v : Number(v)} u.`,
                "Unidades",
              ]}
            />
            <Bar
              dataKey="unidades"
              radius={[6, 6, 0, 0]}
              animationDuration={1000}
              isAnimationActive
            >
              {productsChart.map((_, i) => (
                <Cell key={i} fill={i % 2 === 0 ? GOLD : CHARCOAL} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Mix de ingresos (top 5)"
        subtitle="% sobre el subtotal de referencias"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={72}
              paddingAngle={3}
              animationDuration={1100}
              isAnimationActive
            >
              {pieData.map((e, i) => (
                <Cell key={i} fill={e.fill} stroke="var(--tl-canvas)" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tipStyle}
              formatter={(v) => [
                `${typeof v === "number" ? v : Number(v)}%`,
                "Peso",
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Dispositivos (mes)"
        subtitle="Ventas registradas por terminal"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={devicesChart}
            margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 6"
              stroke="var(--tl-line)"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: "var(--tl-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="id"
              width={72}
              tick={{ fill: "var(--tl-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tipStyle}
              formatter={(v) => [typeof v === "number" ? v : Number(v), "Ventas"]}
            />
            <Bar
              dataKey="ventas"
              radius={[0, 6, 6, 0]}
              fill={GOLD}
              animationDuration={1000}
              isAnimationActive
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
