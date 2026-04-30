"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2Icon as CheckCircle2,
  CopyIcon as Copy,
  DatabaseIcon as Database,
  ExternalLinkIcon as ExternalLink,
  HomeIcon as Home,
  InfoIcon as Info,
  SettingsLucideIcon as Settings,
  XCircleIcon as XCircle,
} from "@/components/ui/icons";
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
  const [refreshing, setRefreshing] = useState(false);
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaMsg, setTwoFaMsg] = useState<string | null>(null);
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaDisablePassword, setTwoFaDisablePassword] = useState("");
  const [twoFaDisableCode, setTwoFaDisableCode] = useState("");

  const loadData = useCallback(async () => {
    setRefreshing(true);
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
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-refresh liviano del estado (60s) solo si la pestaña está visible.
  useEffect(() => {
    let interval: number | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      void loadData();
    };

    interval = window.setInterval(tick, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (interval != null) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
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
              Esta pantalla refresca su estado cada 60 segundos. Las ventas se actualizan cada 5 segundos en la vista
              <span className="font-semibold"> Ventas</span>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                onClick={() => void loadData()}
                disabled={refreshing}
              >
                {refreshing ? "Actualizando..." : "Actualizar ahora"}
              </button>
            </div>
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
                <code className="font-mono">DATABASE_URL</code> / <code className="font-mono">DIRECT_URL</code> para que el panel
                pueda leer tu tienda real desde Postgres. Si el panel no ve una tienda en BD, algunas secciones
                aparecerán vacías.
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

        {/* 2FA (TOTP) */}
        {sessionMe?.typ === "user" && sessionMe.role === "ADMIN" ? (
          <div className="tl-glass rounded-xl p-5">
            <h2 className="text-sm font-semibold text-tl-ink">Seguridad (2FA)</h2>
            <p className="mt-1 text-xs text-tl-muted">
              Activa 2FA (código temporal) para proteger el panel. Requiere definir{" "}
              <code className="font-mono">TOTP_ENC_KEY</code> (base64, 32 bytes) en el entorno.
            </p>

            {twoFaMsg ? (
              <div className="mt-3 rounded-lg border border-tl-warning/20 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
                {twoFaMsg}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="tl-btn tl-btn-primary tl-interactive !px-3 !py-2 text-xs"
                disabled={twoFaBusy}
                onClick={async () => {
                  setTwoFaBusy(true);
                  setTwoFaMsg(null);
                  try {
                    const res = await fetch("/api/admin/2fa/setup", {
                      method: "POST",
                      credentials: "include",
                      headers: { "x-tl-csrf": "1" },
                    });
                    const json = (await res.json()) as any;
                    if (!res.ok) {
                      setTwoFaMsg(json?.error ?? "No se pudo iniciar la configuración de 2FA.");
                      return;
                    }
                    setTwoFaSetup({ secret: json.setup.secret, otpauth: json.setup.otpauth });
                  } catch (e) {
                    setTwoFaMsg(e instanceof Error ? e.message : "Error de red al configurar 2FA.");
                  } finally {
                    setTwoFaBusy(false);
                  }
                }}
              >
                Configurar 2FA
              </button>
            </div>

            {twoFaSetup ? (
              <div className="mt-4 rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Secreto</p>
                <code className="mt-2 block break-all rounded-lg bg-tl-canvas px-3 py-2 font-mono text-xs text-tl-ink">
                  {twoFaSetup.secret}
                </code>
                <p className="mt-2 text-[11px] text-tl-muted">
                  Si tu app lo permite, también puedes usar el enlace <span className="font-mono">otpauth</span>.
                </p>
                <code className="mt-1 block break-all rounded-lg bg-tl-canvas px-3 py-2 font-mono text-[10px] text-tl-muted">
                  {twoFaSetup.otpauth}
                </code>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Código
                    <input
                      className="tl-input h-9 w-[160px] px-3 py-1 text-sm"
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value)}
                      placeholder="123456"
                      disabled={twoFaBusy}
                    />
                  </label>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                    disabled={twoFaBusy || !twoFaCode.trim()}
                    onClick={async () => {
                      setTwoFaBusy(true);
                      setTwoFaMsg(null);
                      try {
                        const res = await fetch("/api/admin/2fa/verify", {
                          method: "POST",
                          credentials: "include",
                          headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                          body: JSON.stringify({ code: twoFaCode.trim() }),
                        });
                        const json = (await res.json()) as any;
                        if (!res.ok) {
                          setTwoFaMsg(json?.error ?? "Código inválido.");
                          return;
                        }
                        setTwoFaMsg("2FA activado. En el próximo inicio de sesión se pedirá el código.");
                        setTwoFaSetup(null);
                        setTwoFaCode("");
                      } catch (e) {
                        setTwoFaMsg(e instanceof Error ? e.message : "Error de red al verificar 2FA.");
                      } finally {
                        setTwoFaBusy(false);
                      }
                    }}
                  >
                    Activar
                  </button>
                </div>
              </div>
            ) : null}

            <details className="mt-4 rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-4">
              <summary className="cursor-pointer list-none text-xs font-semibold text-tl-accent hover:underline [&::-webkit-details-marker]:hidden">
                Desactivar 2FA
              </summary>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Password
                  <input
                    type="password"
                    className="tl-input h-9 w-[220px] px-3 py-1 text-sm"
                    value={twoFaDisablePassword}
                    onChange={(e) => setTwoFaDisablePassword(e.target.value)}
                    disabled={twoFaBusy}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Código
                  <input
                    className="tl-input h-9 w-[160px] px-3 py-1 text-sm"
                    value={twoFaDisableCode}
                    onChange={(e) => setTwoFaDisableCode(e.target.value)}
                    placeholder="123456"
                    disabled={twoFaBusy}
                  />
                </label>
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                  disabled={twoFaBusy || !twoFaDisablePassword.trim() || !twoFaDisableCode.trim()}
                  onClick={async () => {
                    setTwoFaBusy(true);
                    setTwoFaMsg(null);
                    try {
                      const res = await fetch("/api/admin/2fa/disable", {
                        method: "POST",
                        credentials: "include",
                        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                        body: JSON.stringify({ password: twoFaDisablePassword, code: twoFaDisableCode.trim() }),
                      });
                      const json = (await res.json()) as any;
                      if (!res.ok) {
                        setTwoFaMsg(json?.error ?? "No se pudo desactivar 2FA.");
                        return;
                      }
                      setTwoFaMsg("2FA desactivado.");
                      setTwoFaDisablePassword("");
                      setTwoFaDisableCode("");
                    } catch (e) {
                      setTwoFaMsg(e instanceof Error ? e.message : "Error de red al desactivar 2FA.");
                    } finally {
                      setTwoFaBusy(false);
                    }
                  }}
                >
                  Desactivar
                </button>
              </div>
            </details>
          </div>
        ) : null}

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
