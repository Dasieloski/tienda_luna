"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Database,
  ExternalLink,
  Home,
  Info,
  Settings,
  XCircle,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";

type Overview = {
  level3: {
    dashboardLayout: unknown;
  };
  generatedAt: string;
  meta?: {
    dbAvailable?: boolean;
    hint?: string;
    message?: string;
  };
};

export default function SettingsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/overview", { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as Overview;
      setData(json);
      setLastSync(new Date());
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

  const dbOk = data?.meta?.dbAvailable !== false;

  if (loading) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Settings className="h-8 w-8 text-tl-accent tl-pulse" aria-hidden />
            <p className="text-sm text-tl-muted">Cargando configuración...</p>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Configuración">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="tl-welcome-header">Configuración</h1>
          <p className="mt-1 text-sm text-tl-muted">
            Estado del sistema e información de la sesión
          </p>
        </div>

        {/* Status cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Database status */}
          <div className="tl-glass rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg",
                  dbOk ? "bg-tl-success-subtle" : "bg-tl-warning-subtle"
                )}
              >
                <Database
                  className={cn("h-5 w-5", dbOk ? "text-tl-success" : "text-tl-warning")}
                  aria-hidden
                />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-tl-ink">Base de datos</h2>
                <div className="mt-1 flex items-center gap-2">
                  {dbOk ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-tl-success" aria-hidden />
                      <span className="text-sm text-tl-success">Conectada</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-tl-warning" aria-hidden />
                      <span className="text-sm text-tl-warning">No enlazada</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {!dbOk && data?.meta?.hint && (
              <p className="mt-3 text-xs text-tl-muted">{data.meta.hint}</p>
            )}
          </div>

          {/* Sync status */}
          <div className="tl-glass rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-info-subtle">
                <Info className="h-5 w-5 text-tl-info" aria-hidden />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-tl-ink">Sincronización</h2>
                <p className="mt-1 text-sm text-tl-muted">
                  {lastSync
                    ? `Última: ${lastSync.toLocaleString("es-ES")}`
                    : "Sin sincronizar"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-tl-muted">
              El panel refresca métricas y ventas cada 5 segundos automáticamente.
            </p>
          </div>
        </div>

        {/* Dashboard layout */}
        <div className="tl-glass rounded-xl p-5">
          <h2 className="text-sm font-semibold text-tl-ink">Layout del dashboard (JSON)</h2>
          <p className="mt-1 text-xs text-tl-muted">
            Configuración personalizable vía{" "}
            <code className="rounded bg-tl-canvas-subtle px-1 py-0.5 font-mono text-tl-accent">
              PATCH /api/admin/dashboard-layout
            </code>
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-tl-canvas-inset p-4 text-xs text-tl-muted">
            {JSON.stringify(data?.level3.dashboardLayout, null, 2)}
          </pre>
        </div>

        {/* Info card */}
        <div className="tl-glass tl-gradient-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-tl-accent">Información del sistema</h2>
          <ul className="mt-4 space-y-3 text-sm text-tl-muted">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tl-accent" />
              El panel utiliza autenticación estática. Revisa{" "}
              <code className="rounded bg-tl-canvas-subtle px-1 py-0.5 font-mono text-xs text-tl-accent">
                lib/static-admin-auth.ts
              </code>{" "}
              y las variables{" "}
              <code className="rounded bg-tl-canvas-subtle px-1 py-0.5 font-mono text-xs text-tl-accent">
                STATIC_ADMIN_*
              </code>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tl-accent" />
              Los gráficos animan al montar y al recibir nuevos datos del resumen.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tl-accent" />
              Atajos de teclado: <kbd className="rounded border border-tl-line bg-tl-canvas-subtle px-1.5 py-0.5 text-xs">Cmd+B</kbd> para colapsar sidebar,{" "}
              <kbd className="rounded border border-tl-line bg-tl-canvas-subtle px-1.5 py-0.5 text-xs">Cmd+K</kbd> para búsqueda global.
            </li>
          </ul>
        </div>

        {/* Navigation */}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="tl-btn-secondary"
          >
            <Home className="h-4 w-4" aria-hidden />
            Volver al sitio
            <ExternalLink className="h-3 w-3 text-tl-muted" aria-hidden />
          </Link>
        </div>
      </div>
    </AdminShell>
  );
}
