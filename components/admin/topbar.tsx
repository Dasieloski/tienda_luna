"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bell,
  Clock,
  Landmark,
  Menu,
  RefreshCw,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TopbarProps {
  title?: string;
  onMenuClick?: () => void;
  usdRateCup?: number | null;
  onUsdRateCupChange?: (next: number) => void;
}

export function Topbar({
  title = "Dashboard",
  onMenuClick,
  usdRateCup,
  onUsdRateCupChange,
}: TopbarProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => (usdRateCup ?? 250).toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = useMemo(() => {
    const r = usdRateCup ?? 250;
    return `Cambio: ${r}`;
  }, [usdRateCup]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("El cambio debe ser un número mayor que 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/exchange-rate", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usdRateCup: Math.round(n) }),
      });
      const json = (await res.json()) as { usdRateCup?: number; hint?: string; error?: string };
      if (!res.ok) {
        setError(json.hint ?? json.error ?? "No se pudo guardar el cambio.");
        return;
      }
      const next = Number(json.usdRateCup);
      if (Number.isFinite(next) && next > 0) {
        onUsdRateCupChange?.(next);
        setValue(String(next));
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-tl-line-subtle bg-tl-canvas/95 px-4 py-3 backdrop-blur sm:px-5 lg:min-h-20 lg:px-6">
      {/* Left: Logo and quick nav */}
      <div className="flex min-w-0 items-center gap-3 lg:gap-6">
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-tl-line bg-tl-canvas-inset text-tl-ink lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        {/* Logo pill */}
        <div className="hidden h-10 items-center rounded-full border border-tl-line bg-tl-canvas-inset px-4 tl-interactive tl-hover-lift sm:flex">
          <span className="truncate text-sm font-semibold text-tl-ink">Tienda Luna</span>
        </div>
        
        {/* Top nav pills - Crextio style */}
        <nav className="hidden items-center rounded-full bg-tl-canvas-inset p-1 xl:flex">
          <Link 
            href="/admin" 
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Dashboard" && "active"
            )}
          >
            Dashboard
          </Link>
          <Link
            href="/admin/ventas"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Ventas" && "active"
            )}
          >
            Ventas
          </Link>
          <Link
            href="/admin/historial"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Historial" && "active"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4 text-tl-accent" aria-hidden />
              Historial
            </span>
          </Link>
          <Link
            href="/admin/inventario"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Inventario" && "active"
            )}
          >
            Inventario
          </Link>
          <Link
            href="/admin/analitica"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Analítica" && "active"
            )}
          >
            Analítica
          </Link>
          <Link
            href="/admin/economia"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Economía" && "active"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Landmark className="h-4 w-4 text-tl-accent" aria-hidden />
              Economía
            </span>
          </Link>
          <Link
            href="/admin/alertas"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Alertas" && "active"
            )}
          >
            Alertas
          </Link>
          <Link
            href="/admin/config"
            className={cn(
              "tl-nav-pill tl-interactive tl-hover-lift tl-press tl-focus",
              title === "Configuración" && "active"
            )}
          >
            Config
          </Link>
        </nav>
      </div>

      {/* Right: Settings, status, actions */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Exchange rate (always accessible) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setValue(String(usdRateCup ?? 250));
              setError(null);
              setOpen((v) => !v);
            }}
            className="flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-2 text-sm font-semibold text-tl-ink tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
            title="Cambiar tasa CUP/USD"
          >
            <RefreshCw className="h-4 w-4 text-tl-muted" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">Cambio</span>
          </button>

          {open && (
            <div className="absolute right-0 top-12 z-50 w-[320px] max-w-[90vw] rounded-2xl border border-tl-line bg-tl-canvas p-4 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-tl-ink">Tipo de cambio</p>
                  <p className="mt-1 text-xs text-tl-muted">
                    Define cuántos CUP equivalen a 1 USD. Esto afecta el segundo valor mostrado en los cards.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  CUP por 1 USD
                </label>
                <input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="tl-input h-10"
                  placeholder="Ej: 520"
                />
                <p className="text-xs text-tl-muted">
                  Ejemplo: {formatExample(1872000, Number(value) || (usdRateCup ?? 250))}
                </p>
                {error && (
                  <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
                    {error}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
                    disabled={saving}
                  >
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Settings button with icon */}
        <Link
          href="/admin/config"
          className="flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-2 text-sm font-medium text-tl-ink tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle sm:px-4"
        >
          <Settings className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Ajustes</span>
        </Link>

        {/* Notifications */}
        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-tl-line bg-tl-canvas-inset tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
          title="Notificaciones"
        >
          <Bell className="h-4 w-4 text-tl-ink" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-tl-danger text-[10px] font-bold text-white">
            3
          </span>
          <span className="sr-only">Notificaciones</span>
        </button>

        {/* User avatar */}
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-tl-line bg-tl-canvas-inset tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
          title="Perfil"
        >
          <Users className="h-5 w-5 text-tl-muted" aria-hidden />
        </button>
      </div>
    </header>
  );
}

function formatExample(cupCents: number, rateCup: number) {
  const cup = cupCents / 100;
  const rate = Number.isFinite(rateCup) && rateCup > 0 ? rateCup : 1;
  const usd = cup / rate;
  const cupLabel = new Intl.NumberFormat("es-CU", {
    style: "currency",
    currency: "CUP",
    maximumFractionDigits: 2,
  }).format(cup);
  const usdLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(usd);
  return `${cupLabel} · ${usdLabel}`;
}
