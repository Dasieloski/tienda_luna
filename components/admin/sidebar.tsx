"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Calculator,
  ChevronDown,
  ChevronLeft,
  Clock,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  Monitor,
  Radio,
  ReceiptText,
  Settings,
  Store,
  Truck,
  Users,
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
      { href: "/admin/entradas-salidas", label: "Entradas/Salidas", icon: ArrowUpDown },
      { href: "/admin/proveedores", label: "Proveedores", icon: Truck },
      { href: "/admin/productos", label: "Productos", icon: Boxes },
      { href: "/admin/analitica", label: "Analítica", icon: BarChart3 },
      { href: "/admin/economia", label: "Economía", icon: Landmark },
      { href: "/admin/contabilidad", label: "Contabilidad", icon: Calculator },
      { href: "/admin/gastos", label: "Gastos", icon: ReceiptText },
      { href: "/admin/cambios", label: "Cambios", icon: ArrowRightLeft },
      { href: "/admin/duenos", label: "Dueños", icon: Users },
      { href: "/admin/control-diario", label: "Control diario", icon: ClipboardList },
    ],
  },
  {
    section: "Sistema",
    items: [
      { href: "/admin/alertas", label: "Alertas", icon: AlertTriangle },
      { href: "/admin/dispositivos", label: "Dispositivos", icon: Monitor },
      { href: "/admin/config", label: "Configuración", icon: Settings },
    ],
  },
];

const DEVICES = [
  { name: "Caja Principal", version: "v2.1", status: "online" },
];

const sidebarEase = "cubic-bezier(0.22, 1, 0.36, 1)";

interface SidebarProps {
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  mobileOpen: boolean;
  onMobileOpenChange: (next: boolean) => void;
}

export function Sidebar({
  collapsed,
  onCollapsedChange,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const pathname = usePathname();
  const [devicesOpen, setDevicesOpen] = useState(false);
  /** En móvil/tablet el drawer debe mostrar siempre icono + texto; `collapsed` solo aplica desde breakpoint lg. */
  const [isLgUp, setIsLgUp] = useState(false);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsLgUp(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const effectiveCollapsed = collapsed && isLgUp;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        onCollapsedChange(!collapsed);
      }
      if (e.key === "Escape") {
        onMobileOpenChange(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, onCollapsedChange, onMobileOpenChange]);

  useEffect(() => {
    onMobileOpenChange(false);
  }, [pathname, onMobileOpenChange]);

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar menú"
        className={cn(
          "fixed inset-0 z-40 bg-black/35 transition-opacity lg:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => onMobileOpenChange(false)}
      />
      <aside
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "fixed left-0 top-0 z-50 flex h-dvh max-h-dvh flex-col overflow-hidden bg-tl-canvas-inset",
          "w-[280px] max-w-[86vw] transition-[transform,width,box-shadow] duration-300",
          "lg:z-40 lg:max-w-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          collapsed ? "lg:w-[72px]" : "lg:w-[260px]",
        )}
        style={{
          borderRadius: "0 24px 24px 0",
          boxShadow: "var(--tl-shadow)",
          transitionTimingFunction: sidebarEase,
        }}
      >
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-5 lg:h-20">
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
              effectiveCollapsed ? "max-w-0 translate-x-1 opacity-0" : "max-w-[200px] translate-x-0 opacity-100"
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
                effectiveCollapsed ? "max-h-0 opacity-0" : "max-h-8 opacity-100"
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
                        effectiveCollapsed && "!px-2 justify-center"
                      )}
                      title={effectiveCollapsed ? item.label : undefined}
                    >
                      <Icon
                        className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out group-hover:scale-105"
                        aria-hidden
                      />
                      <span
                        className={cn(
                          "min-w-0 truncate transition-[opacity,max-width,transform] duration-300",
                          effectiveCollapsed ? "max-w-0 translate-x-1 opacity-0" : "max-w-[200px] translate-x-0 opacity-100"
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
          effectiveCollapsed ? "pointer-events-none max-h-0 border-t-transparent opacity-0" : "max-h-[320px] opacity-100"
        )}
        style={{ transitionTimingFunction: sidebarEase }}
        aria-hidden={effectiveCollapsed}
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
      <div className="shrink-0 border-t border-tl-line p-3 max-lg:hidden">
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
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
    </>
  );
}
