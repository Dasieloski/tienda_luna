"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Copy,
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

type SessionMe = {
  typ: string;
  storeId: string;
  deviceId?: string;
  role?: string | null;
  userId?: string;
  isLocalStorePlaceholder?: boolean;
};

export default function SettingsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionMe, setSessionMe] = useState<SessionMe | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [overviewRes, meRes] = await Promise.all([
        fetch("/api/stats/overview", { credentials: "include" }),
        fetch("/api/session/me", { credentials: "include" }),
      ]);
      if (overviewRes.ok) {
        const json = (await overviewRes.json()) as Overview;
        setData(json);
        setLastSync(new Date());
      }
      if (meRes.ok) {
        setSessionMe((await meRes.json()) as SessionMe);
      } else {
        setSessionMe(null);
      }
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

        {/* storeId para APK / integraciones */}
        {sessionMe && (
          <div className="tl-glass rounded-xl p-5">
            <h2 className="text-sm font-semibold text-tl-ink">Tienda (`storeId`) para la APK</h2>
            <p className="mt-1 text-xs text-tl-muted">
              Es el identificador de tu tienda en la base de datos. Debe coincidir con el{" "}
              <code className="font-mono text-tl-accent">storeId</code> del body de{" "}
              <code className="font-mono text-tl-accent">POST /api/sync/batch</code> y con el JWT
              del dispositivo.
            </p>
            {sessionMe.isLocalStorePlaceholder && (
              <p className="mt-3 rounded-lg border border-tl-warning/30 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
                Estás usando el marcador local sin BD real (
                <code className="font-mono">__local_sin_bd__</code>). En Vercel define{" "}
                <code className="font-mono">STATIC_ADMIN_STORE_ID</code> con el{" "}
                <code className="font-mono">Store.id</code> real o quita{" "}
                <code className="font-mono">STATIC_ADMIN_SKIP_DB</code> para que el login tome la
                primera tienda de la base.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="block flex-1 break-all rounded-lg bg-tl-canvas-inset px-3 py-2 font-mono text-xs text-tl-ink">
                {sessionMe.storeId}
              </code>
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive shrink-0 !px-3 !py-2 text-xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sessionMe.storeId);
                    setCopyMsg("Copiado al portapapeles.");
                    window.setTimeout(() => setCopyMsg(null), 2000);
                  } catch {
                    setCopyMsg("No se pudo copiar (permiso del navegador).");
                    window.setTimeout(() => setCopyMsg(null), 2500);
                  }
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copiar
              </button>
            </div>
            {copyMsg && <p className="mt-2 text-xs text-tl-success">{copyMsg}</p>}
            <p className="mt-3 text-xs text-tl-muted">
              También lo devuelve <code className="font-mono">POST /api/auth/login</code> en el
              campo <code className="font-mono">storeId</code> del JSON.
            </p>
          </div>
        )}

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
