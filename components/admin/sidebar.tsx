"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronLeft,
  LayoutDashboard,
  Monitor,
  Radio,
  Settings,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    section: "Principal",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/ventas", label: "Ventas", icon: Radio },
    ],
  },
  {
    section: "Gestión",
    items: [
      { href: "/admin/inventario", label: "Inventario", icon: Boxes },
      { href: "/admin/analitica", label: "Analítica", icon: BarChart3 },
    ],
  },
  {
    section: "Sistema",
    items: [
      { href: "/admin/alertas", label: "Alertas", icon: AlertTriangle },
      { href: "/admin/config", label: "Configuración", icon: Settings },
    ],
  },
];

const DEVICES = [
  { name: "Caja Principal", version: "v2.1", status: "online" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tl-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("tl-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-full flex-col bg-tl-canvas-inset transition-all duration-300",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
      style={{ borderRadius: "0 24px 24px 0", boxShadow: "var(--tl-shadow)" }}
    >
      {/* Logo */}
      <div className="flex h-20 shrink-0 items-center gap-3 px-5">
        <Link
          href="/admin"
          className="group flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-tl-canvas-subtle"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tl-accent shadow-sm">
            <Store className="h-6 w-6 text-tl-accent-fg" aria-hidden />
          </span>
          {!collapsed && (
            <span className="text-lg font-bold text-tl-ink">Tienda Luna</span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((group) => (
          <div key={group.section} className="mb-4">
            {!collapsed && (
              <h3 className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-tl-muted">
                {group.section}
              </h3>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname.startsWith(item.href));

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "tl-nav-item",
                        isActive && "active",
                        collapsed && "justify-center px-0"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className="h-5 w-5 shrink-0" aria-hidden />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Devices section - Collapsible */}
      {!collapsed && (
        <div className="shrink-0 border-t border-tl-line px-3 py-3">
          <button
            type="button"
            onClick={() => setDevicesOpen(!devicesOpen)}
            className="tl-collapse-trigger w-full"
          >
            <span>Dispositivos</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                devicesOpen && "rotate-180"
              )}
              aria-hidden
            />
          </button>
          {devicesOpen && (
            <div className="mt-2 space-y-2">
              {DEVICES.map((device) => (
                <div
                  key={device.name}
                  className="flex items-center gap-3 rounded-xl bg-tl-canvas-subtle px-4 py-3"
                >
                  <Monitor className="h-5 w-5 text-tl-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-tl-ink">
                      {device.name}
                    </p>
                    <p className="text-xs text-tl-muted">{device.version}</p>
                  </div>
                  <span className="h-2 w-2 rounded-full bg-tl-success" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-tl-line p-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "tl-nav-item w-full",
            collapsed && "justify-center px-0"
          )}
          title="Colapsar (Cmd+B)"
        >
          <ChevronLeft
            className={cn(
              "h-5 w-5 transition-transform duration-300",
              collapsed && "rotate-180"
            )}
            aria-hidden
          />
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}
