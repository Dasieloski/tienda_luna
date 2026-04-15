"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Command,
  Home,
  LogIn,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SyncStatus = "online" | "offline" | "syncing";

interface TopbarProps {
  lastSync: Date | null;
  onRefresh: () => void;
  isSyncing?: boolean;
}

export function Topbar({ lastSync, onRefresh, isSyncing = false }: TopbarProps) {
  const [status, setStatus] = useState<SyncStatus>("online");
  const [searchFocused, setSearchFocused] = useState(false);

  // Monitor online status
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

  // Keyboard shortcut: Cmd/Ctrl + K for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.getElementById("tl-global-search");
        if (searchInput) {
          searchInput.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const statusConfig = {
    online: {
      icon: Wifi,
      label: "En línea",
      color: "text-tl-success",
      bg: "bg-tl-success-subtle",
    },
    offline: {
      icon: WifiOff,
      label: "Sin conexión",
      color: "text-tl-danger",
      bg: "bg-tl-danger-subtle",
    },
    syncing: {
      icon: RefreshCw,
      label: "Sincronizando",
      color: "text-tl-info",
      bg: "bg-tl-info-subtle",
    },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-tl-line bg-tl-canvas/80 px-6 backdrop-blur-xl">
      {/* Gradient accent line */}
      <div className="tl-accent-line absolute inset-x-0 bottom-0" />

      {/* Global search */}
      <div className="relative flex-1 max-w-md">
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
          className="tl-input pl-10 pr-20"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none items-center gap-1 rounded border border-tl-line bg-tl-canvas-subtle px-1.5 py-0.5 text-[10px] font-medium text-tl-muted sm:flex">
          <Command className="h-3 w-3" aria-hidden />
          <span>K</span>
        </kbd>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-3">
        {/* Sync status */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5",
            currentStatus.bg
          )}
        >
          <StatusIcon
            className={cn(
              "h-4 w-4",
              currentStatus.color,
              status === "syncing" && "tl-spin"
            )}
            aria-hidden
          />
          <span className={cn("text-xs font-medium", currentStatus.color)}>
            {currentStatus.label}
          </span>
        </div>

        {/* Last sync time */}
        {lastSync && (
          <span className="hidden text-xs text-tl-muted md:inline">
            {lastSync.toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}

        {/* Refresh button */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isSyncing}
          className="tl-btn-secondary h-9 w-9 p-0"
          title="Actualizar datos"
        >
          <RefreshCw
            className={cn("h-4 w-4", isSyncing && "tl-spin")}
            aria-hidden
          />
          <span className="sr-only">Actualizar</span>
        </button>

        {/* Divider */}
        <div className="hidden h-8 w-px bg-tl-line md:block" />

        {/* Quick links */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Accesos rápidos">
          <Link
            href="/"
            className="tl-btn-secondary h-9 w-9 p-0"
            title="Ir al sitio"
          >
            <Home className="h-4 w-4" aria-hidden />
            <span className="sr-only">Sitio</span>
          </Link>
          <Link
            href="/admin/login"
            className="tl-btn-secondary h-9 w-9 p-0"
            title="Sesión"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            <span className="sr-only">Sesión</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
