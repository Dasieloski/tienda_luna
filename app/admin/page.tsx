"use client";

import { useEffect, useState } from "react";

type Overview = {
  level1: {
    ventasHoy: number;
    ingresosHoyCents: number;
    ventasMes: number;
    ingresosMesCents: number;
    ingresosTotalesCents: number;
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
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 border-b border-zinc-800 pb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
      {children}
    </h2>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [events, setEvents] = useState<
    {
      id: string;
      type: string;
      status: string;
      deviceId: string;
      isFraud: boolean;
      fraudReason: string | null;
      serverTimestamp: string;
    }[]
  >([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/stats/overview", { credentials: "include" });
      if (!res.ok) {
        if (!cancelled) setErr("No se pudo cargar el resumen (¿sesión admin?).");
        return;
      }
      const json = (await res.json()) as Overview;
      if (!cancelled) setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/events?limit=30", { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as { events: typeof events };
      if (!cancelled) setEvents(json.events);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <p className="text-red-400">{err}</p>;
  }
  if (!data) {
    return <p className="text-zinc-400">Cargando métricas…</p>;
  }

  const dbOk = data.meta?.dbAvailable !== false;

  return (
    <div className="space-y-2">
      {!dbOk ? (
        <div
          role="status"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          <p className="font-medium text-amber-50">Sin datos de base de datos</p>
          <p className="mt-1 text-amber-100/90">
            {data.meta?.hint ??
              data.meta?.message ??
              "Las métricas se muestran vacías hasta que la conexión a PostgreSQL/Supabase funcione o configures STATIC_ADMIN_STORE_ID."}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-400">
            Actualizado {new Date(data.generatedAt).toLocaleString("es-ES")}
          </p>
        </div>
      </div>

      <SectionTitle>Nivel 1 — Operación diaria</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ventas hoy" value={String(data.level1.ventasHoy)} />
        <Metric label="Ingresos hoy" value={money(data.level1.ingresosHoyCents)} />
        <Metric label="Ventas mes" value={String(data.level1.ventasMes)} />
        <Metric label="Ingresos mes" value={money(data.level1.ingresosMesCents)} />
        <Metric label="Ingresos totales" value={money(data.level1.ingresosTotalesCents)} />
        <Metric label="Eventos marcados fraude" value={String(data.level1.eventosFraudulentos)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Productos más vendidos</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-400">
            {data.level1.productosTop.length === 0 ? (
              <li>Sin datos aún.</li>
            ) : (
              data.level1.productosTop.map((p) => (
                <li key={p.productId} className="flex justify-between gap-2">
                  <span className="text-zinc-200">{p.nombre}</span>
                  <span>
                    {p.unidades} u. · {money(p.subtotalCents)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Stock actual</h3>
          <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-sm text-zinc-400">
            {data.level1.stockActual.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="text-zinc-200">{p.nombre}</span>
                <span>
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

      <SectionTitle>Nivel 2 — Inventario y canales</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Rotación inventario (30d, heurística)"
          value={data.level2.rotacionInventario30d.toFixed(2)}
        />
        <Metric label="Margen aprox. 30d" value={money(data.level2.margenAprox30d)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Clientes frecuentes</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-400">
            {data.level2.clientesFrecuentes.map((c) => (
              <li key={c.customerId ?? "x"} className="flex justify-between gap-2">
                <span className="text-zinc-200">{c.nombre ?? c.customerId}</span>
                <span>
                  {c.compras} ped. · {money(c.totalCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Ventas por hora (hoy)</h3>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-400">
            {data.level2.ventasPorHoraHoy.map((h) => (
              <li key={h.hora} className="flex justify-between rounded-lg bg-zinc-950/60 px-2 py-1">
                <span className="text-zinc-300">{h.hora}:00</span>
                <span>
                  {h.ventas} · {money(h.ingresosCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">Rendimiento por dispositivo (mes)</h3>
        <ul className="mt-3 space-y-2 text-sm text-zinc-400">
          {data.level2.rendimientoDispositivoMes.map((d) => (
            <li key={d.deviceId} className="flex justify-between gap-2">
              <span className="truncate font-mono text-xs text-zinc-300">{d.deviceId}</span>
              <span>
                {d.ventas} ventas · {money(d.ingresosCents)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <SectionTitle>Nivel 3 — SaaS / inteligencia</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Cohortes (clientes nuevos)</h3>
          <ul className="mt-3 space-y-1 text-sm text-zinc-400">
            {data.level3.cohortesClientesNuevos.map((c) => (
              <li key={c.mes} className="flex justify-between">
                <span>{c.mes}</span>
                <span>{c.clientes}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">LTV aproximado (top clientes)</h3>
          <ul className="mt-3 space-y-1 text-sm text-zinc-400">
            {data.level3.ltvTop.map((l) => (
              <li key={l.customerId} className="flex justify-between gap-2">
                <span className="truncate font-mono text-xs text-zinc-300">{l.customerId}</span>
                <span>
                  {l.pedidos} ped. · {money(l.totalCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-200">Demanda heurística (30d)</h3>
          <ul className="mt-3 space-y-1 text-sm text-zinc-400">
            {data.level3.demandaHeuristica30d.map((d) => (
              <li key={d.productId} className="flex justify-between font-mono text-xs">
                <span className="text-zinc-300">{d.productId}</span>
                <span>{d.unidades} u.</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">Anomalías recientes</h3>
        <ul className="mt-3 space-y-2 text-sm text-zinc-400">
          {data.level3.anomalias.map((a) => (
            <li key={a.id} className="rounded-lg bg-zinc-950/50 px-2 py-2">
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
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">Layout dashboard (JSON almacenado)</h3>
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-zinc-400">
          {JSON.stringify(data.level3.dashboardLayout, null, 2)}
        </pre>
        <p className="mt-2 text-xs text-zinc-500">
          Personalización vía <code className="text-zinc-300">PATCH /api/admin/dashboard-layout</code>
        </p>
      </div>

      <SectionTitle>Auditoría — últimos eventos</SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Fraude</th>
              <th className="px-3 py-2">Dispositivo</th>
              <th className="px-3 py-2">Servidor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 text-zinc-300">
            {events.map((e) => (
              <tr key={e.id} className="hover:bg-zinc-900/40">
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
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
