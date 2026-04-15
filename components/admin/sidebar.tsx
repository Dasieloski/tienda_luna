"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronLeft,
  LayoutDashboard,
  Moon,
  Radio,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    section: "Principal",
    items: [
      { href: "/admin", label: "Vista general", icon: LayoutDashboard },
      { href: "/admin/ventas", label: "Ventas en vivo", icon: Radio },
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

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapse state
  useEffect(() => {
    const stored = localStorage.getItem("tl-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("tl-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  // Keyboard shortcut: Cmd/Ctrl + B
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
        "fixed left-0 top-0 z-40 flex h-full flex-col border-r border-tl-line bg-tl-canvas-subtle transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-tl-line px-4">
        <Link
          href="/admin"
          className="group flex items-center gap-3 rounded-xl p-1 transition-colors hover:bg-tl-accent-subtle"
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-900/30">
            <Moon className="h-5 w-5 text-white" aria-hidden />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-bold text-tl-ink">
                Tienda Luna
                <Sparkles
                  className="h-3 w-3 text-amber-400 opacity-80"
                  aria-hidden
                />
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-tl-muted">
                Command center
              </p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((group) => (
          <div key={group.section} className="mb-6">
            {!collapsed && (
              <h3 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-tl-muted">
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
                        "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                        isActive
                          ? "bg-tl-accent-subtle text-tl-accent"
                          : "text-tl-ink-secondary hover:bg-tl-canvas-inset hover:text-tl-ink"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon
                        className={cn(
                          "h-5 w-5 shrink-0 transition-colors",
                          isActive
                            ? "text-tl-accent"
                            : "text-tl-muted group-hover:text-tl-ink-secondary"
                        )}
                        aria-hidden
                      />
                      {!collapsed && <span>{item.label}</span>}
                      {isActive && !collapsed && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-tl-accent" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-tl-line p-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-tl-muted transition-all hover:bg-tl-canvas-inset hover:text-tl-ink",
            collapsed && "justify-center"
          )}
          title="Colapsar barra lateral (Cmd+B)"
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
