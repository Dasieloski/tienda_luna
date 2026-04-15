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
  Clock,
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
      { href: "/admin/historial", label: "Historial", icon: Clock },
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

const sidebarEase = "cubic-bezier(0.22, 1, 0.36, 1)";

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
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "fixed left-0 top-0 z-40 flex h-full flex-col overflow-hidden bg-tl-canvas-inset",
        "will-change-[width]",
        "transition-[width,box-shadow] duration-300",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
      style={{
        borderRadius: "0 24px 24px 0",
        boxShadow: "var(--tl-shadow)",
        transitionTimingFunction: sidebarEase,
      }}
    >
      {/* Logo */}
      <div className="flex h-20 shrink-0 items-center gap-3 px-5">
        <Link
          href="/admin"
          className="group/logo tl-interactive flex min-w-0 max-w-full items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-tl-canvas-subtle"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tl-accent shadow-sm transition-transform duration-200 ease-out group-hover/logo:scale-[1.03]">
            <Store className="h-6 w-6 text-tl-accent-fg transition-transform duration-200 ease-out group-hover/logo:scale-105" aria-hidden />
          </span>
          <span
            className={cn(
              "min-w-0 overflow-hidden text-lg font-bold text-tl-ink transition-[opacity,transform,max-width] duration-300",
              collapsed ? "max-w-0 translate-x-1 opacity-0" : "max-w-[200px] translate-x-0 opacity-100"
            )}
            style={{ transitionTimingFunction: sidebarEase }}
          >
            Tienda Luna
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        {NAV_ITEMS.map((group) => (
          <div key={group.section} className="mb-4">
            <div
              className={cn(
                "mb-2 overflow-hidden transition-[max-height,opacity] duration-300",
                collapsed ? "max-h-0 opacity-0" : "max-h-8 opacity-100"
              )}
              style={{ transitionTimingFunction: sidebarEase }}
            >
              <h3 className="px-4 text-[11px] font-semibold uppercase tracking-wider text-tl-muted">
                {group.section}
              </h3>
            </div>
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
                        "group tl-nav-item tl-interactive ring-1 ring-transparent transition-[box-shadow,transform,background-color,color] duration-200",
                        "hover:shadow-sm hover:ring-tl-accent/12",
                        isActive && "active shadow-sm",
                        collapsed && "!px-2 justify-center"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon
                        className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out group-hover:scale-105"
                        aria-hidden
                      />
                      <span
                        className={cn(
                          "min-w-0 truncate transition-[opacity,max-width,transform] duration-300",
                          collapsed ? "max-w-0 translate-x-1 opacity-0" : "max-w-[200px] translate-x-0 opacity-100"
                        )}
                        style={{ transitionTimingFunction: sidebarEase }}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Devices section - Collapsible (height animada, sin “saltos”) */}
      <div
        className={cn(
          "shrink-0 overflow-hidden border-t border-tl-line transition-[max-height,opacity,padding,border-color] duration-300",
          collapsed ? "pointer-events-none max-h-0 border-t-transparent opacity-0" : "max-h-[320px] opacity-100"
        )}
        style={{ transitionTimingFunction: sidebarEase }}
        aria-hidden={collapsed}
      >
        <div className="px-3 py-3">
          <button type="button" onClick={() => setDevicesOpen(!devicesOpen)} className="tl-collapse-trigger w-full">
            <span>Dispositivos</span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform duration-300", devicesOpen && "rotate-180")}
              style={{ transitionTimingFunction: sidebarEase }}
              aria-hidden
            />
          </button>

          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300",
              devicesOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            )}
            style={{ transitionTimingFunction: sidebarEase }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="mt-2 space-y-2">
                {DEVICES.map((device) => (
                  <div
                    key={device.name}
                    className="tl-interactive flex items-center gap-3 rounded-xl bg-tl-canvas-subtle px-4 py-3 transition-colors duration-200 hover:bg-tl-line-subtle"
                  >
                    <Monitor className="h-5 w-5 shrink-0 text-tl-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-tl-ink">{device.name}</p>
                      <p className="text-xs text-tl-muted">{device.version}</p>
                    </div>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-tl-success" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-tl-line p-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "tl-nav-item tl-interactive w-full ring-1 ring-transparent transition-[box-shadow,transform] duration-200 hover:shadow-sm hover:ring-tl-accent/12",
            collapsed && "justify-center !px-2"
          )}
          title="Colapsar (Cmd+B)"
        >
          <ChevronLeft
            className="h-5 w-5 transition-transform duration-300"
            style={{
              transitionTimingFunction: sidebarEase,
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
            }}
            aria-hidden
          />
          <span
            className={cn(
              "min-w-0 truncate transition-[opacity,max-width,transform] duration-300",
              collapsed ? "max-w-0 translate-x-1 opacity-0" : "max-w-[200px] translate-x-0 opacity-100"
            )}
            style={{ transitionTimingFunction: sidebarEase }}
          >
            Colapsar
          </span>
        </button>
      </div>
    </aside>
  );
}
