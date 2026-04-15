"use client";

import Link from "next/link";
import {
  Bell,
  Clock,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TopbarProps {
  title?: string;
}

export function Topbar({
  title = "Dashboard",
}: TopbarProps) {

  return (
    <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between gap-4 bg-tl-canvas px-6">
      {/* Left: Logo and quick nav */}
      <div className="flex items-center gap-6">
        {/* Logo pill */}
        <div className="flex h-10 items-center rounded-full border border-tl-line bg-tl-canvas-inset px-4 tl-interactive tl-hover-lift">
          <span className="text-sm font-semibold text-tl-ink">Tienda Luna</span>
        </div>
        
        {/* Top nav pills - Crextio style */}
        <nav className="hidden items-center rounded-full bg-tl-canvas-inset p-1 md:flex">
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
      <div className="flex items-center gap-2">
        {/* Settings button with icon */}
        <Link
          href="/admin/config"
          className="flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-4 py-2 text-sm font-medium text-tl-ink tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
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
