"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, TrendingUp, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { formatCupAndUsdLabel } from "@/lib/money";

type Overview = {
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
  };
  level3: {
    cohortesClientesNuevos: { mes: string; clientes: number }[];
    ltvTop: { customerId: string; pedidos: number; totalCents: number }[];
    demandaHeuristica30d: { productId: string; unidades: number }[];
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

export default function AnalyticsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/overview", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function handleRefresh() {
      void loadData();
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [loadData]);

  if (loading) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <BarChart3 className="h-8 w-8 text-tl-accent tl-pulse" aria-hidden />
            <p className="text-sm text-tl-muted">Cargando analíticas...</p>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Analítica">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="tl-welcome-header">Analítica</h1>
          <p className="mt-1 text-sm text-tl-muted">
            Métricas avanzadas y comportamiento de clientes
          </p>
        </div>

        {/* KPIs */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Rotación inventario"
              value={(data?.level2.rotacionInventario30d ?? 0).toFixed(2)}
              hint="Heurística 30d"
              variant="info"
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <KpiCard
              label="Margen aprox. 30d"
              value={formatCupAndUsdLabel(data?.level2.margenAprox30d ?? 0)}
              variant="success"
            />
            <KpiCard
              label="Clientes frecuentes"
              value={String(data?.level2.clientesFrecuentes.length ?? 0)}
              icon={<Users className="h-4 w-4" />}
            />
          </div>
        </section>

        {/* Clients and Cohorts */}
        <section>
          <SectionHeader title="Clientes y cohortes" />
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Frequent clients */}
            <div className="tl-glass overflow-hidden rounded-xl">
              <div className="border-b border-tl-line px-4 py-3">
                <h3 className="text-sm font-semibold text-tl-ink">Clientes frecuentes</h3>
              </div>
              <ul className="divide-y divide-tl-line-subtle">
                {data?.level2.clientesFrecuentes.length === 0 ? (
                  <li className="p-4 text-sm text-tl-muted">Sin datos aún</li>
                ) : (
                  data?.level2.clientesFrecuentes.map((c) => (
                    <li
                      key={c.customerId ?? "anon"}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-tl-ink">{c.nombre ?? "Anónimo"}</p>
                        {c.telefono && (
                          <p className="text-xs text-tl-muted">{c.telefono}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums text-tl-ink">
                          {formatCupAndUsdLabel(c.totalCents)}
                        </p>
                        <p className="text-xs text-tl-muted">{c.compras} pedidos</p>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {/* Cohorts */}
            <div className="tl-glass overflow-hidden rounded-xl">
              <div className="border-b border-tl-line px-4 py-3">
                <h3 className="text-sm font-semibold text-tl-ink">Cohortes (clientes nuevos)</h3>
              </div>
              <ul className="divide-y divide-tl-line-subtle">
                {data?.level3.cohortesClientesNuevos.length === 0 ? (
                  <li className="p-4 text-sm text-tl-muted">Sin datos aún</li>
                ) : (
                  data?.level3.cohortesClientesNuevos.map((c) => (
                    <li
                      key={c.mes}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <span className="text-tl-ink">{c.mes}</span>
                      <span className="font-semibold tabular-nums text-tl-ink">
                        {c.clientes}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>

        {/* LTV and Demand */}
        <section>
          <SectionHeader title="LTV y demanda" />
          <div className="grid gap-6 lg:grid-cols-2">
            {/* LTV */}
            <div className="tl-glass overflow-hidden rounded-xl">
              <div className="border-b border-tl-line px-4 py-3">
                <h3 className="text-sm font-semibold text-tl-ink">LTV aproximado</h3>
              </div>
              <ul className="divide-y divide-tl-line-subtle max-h-64 overflow-auto">
                {data?.level3.ltvTop.length === 0 ? (
                  <li className="p-4 text-sm text-tl-muted">Sin datos aún</li>
                ) : (
                  data?.level3.ltvTop.map((l) => (
                    <li
                      key={l.customerId}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <span className="truncate font-mono text-xs text-tl-muted">
                        {l.customerId}
                      </span>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums text-tl-ink">
                          {formatCupAndUsdLabel(l.totalCents)}
                        </p>
                        <p className="text-xs text-tl-muted">{l.pedidos} pedidos</p>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {/* Demand */}
            <div className="tl-glass overflow-hidden rounded-xl">
              <div className="border-b border-tl-line px-4 py-3">
                <h3 className="text-sm font-semibold text-tl-ink">Demanda 30d (unidades)</h3>
              </div>
              <ul className="divide-y divide-tl-line-subtle max-h-64 overflow-auto">
                {data?.level3.demandaHeuristica30d.length === 0 ? (
                  <li className="p-4 text-sm text-tl-muted">Sin datos aún</li>
                ) : (
                  data?.level3.demandaHeuristica30d.map((d) => (
                    <li
                      key={d.productId}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <span className="truncate font-mono text-xs text-tl-muted">
                        {d.productId}
                      </span>
                      <span className="font-semibold tabular-nums text-tl-ink">
                        {d.unidades} u.
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
