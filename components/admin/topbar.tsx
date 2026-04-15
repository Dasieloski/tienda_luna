"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  RefreshCw,
  Search,
  Settings,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SyncStatus = "online" | "offline" | "syncing";

interface TopbarProps {
  lastSync: Date | null;
  onRefresh: () => void;
  isSyncing?: boolean;
  title?: string;
}

export function Topbar({
  lastSync,
  onRefresh,
  isSyncing = false,
  title = "Dashboard",
}: TopbarProps) {
  const [status, setStatus] = useState<SyncStatus>("online");
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    function updateStatus() {
      setStatus(navigator.onLine ? (isSyncing ? "syncing" : "online") : "offline");
    }
    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, [isSyncing]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.getElementById("tl-global-search");
        if (searchInput) searchInput.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const statusConfig = {
    online: {
      icon: Wifi,
      label: "En línea",
      className: "bg-tl-success-subtle text-tl-success",
    },
    offline: {
      icon: WifiOff,
      label: "Sin conexión",
      className: "bg-tl-danger-subtle text-tl-danger",
    },
    syncing: {
      icon: RefreshCw,
      label: "Sincronizando",
      className: "bg-tl-info-subtle text-tl-info",
    },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  return (
    <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between gap-4 bg-tl-canvas px-6">
      {/* Left: Title and quick nav */}
      <div className="flex items-center gap-6">
        <h1 className="text-2xl font-bold text-tl-ink">{title}</h1>
        
        {/* Top nav pills */}
        <nav className="hidden items-center gap-1 md:flex">
          <Link href="/admin" className="tl-badge-dark">
            Dashboard
          </Link>
          <Link
            href="/admin/ventas"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-tl-muted transition-colors hover:bg-tl-canvas-subtle hover:text-tl-ink"
          >
            Ventas
          </Link>
          <Link
            href="/admin/inventario"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-tl-muted transition-colors hover:bg-tl-canvas-subtle hover:text-tl-ink"
          >
            Inventario
          </Link>
          <Link
            href="/admin/analitica"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-tl-muted transition-colors hover:bg-tl-canvas-subtle hover:text-tl-ink"
          >
            Analítica
          </Link>
        </nav>
      </div>

      {/* Right: Search, status, actions */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden lg:block">
          <Search
            className={cn(
              "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors",
              searchFocused ? "text-tl-accent" : "text-tl-muted"
            )}
            aria-hidden
          />
          <input
            id="tl-global-search"
            type="search"
            placeholder="Buscar..."
            className="tl-input w-64 py-2.5 pl-10 pr-16"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-tl-canvas-subtle px-2 py-0.5 text-[10px] font-medium text-tl-muted">
            ⌘K
          </kbd>
        </div>

        {/* Status badge */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-2",
            currentStatus.className
          )}
        >
          <StatusIcon
            className={cn("h-4 w-4", status === "syncing" && "tl-spin")}
            aria-hidden
          />
          <span className="text-xs font-semibold">{currentStatus.label}</span>
        </div>

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isSyncing}
          className="tl-btn-secondary h-10 w-10 p-0"
          title="Actualizar"
        >
          <RefreshCw
            className={cn("h-4 w-4", isSyncing && "tl-spin")}
            aria-hidden
          />
          <span className="sr-only">Actualizar</span>
        </button>

        {/* Notifications */}
        <button
          type="button"
          className="tl-btn-secondary relative h-10 w-10 p-0"
          title="Notificaciones"
        >
          <Bell className="h-4 w-4" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-tl-danger text-[10px] font-bold text-white">
            3
          </span>
          <span className="sr-only">Notificaciones</span>
        </button>

        {/* Settings */}
        <Link
          href="/admin/config"
          className="tl-btn-secondary h-10 w-10 p-0"
          title="Configuración"
        >
          <Settings className="h-4 w-4" aria-hidden />
          <span className="sr-only">Configuración</span>
        </Link>

        {/* User avatar */}
        <button
          type="button"
          className="tl-avatar h-10 w-10"
          title="Perfil"
        >
          <Users className="h-5 w-5 text-tl-muted" aria-hidden />
        </button>
      </div>
    </header>
  );
}
