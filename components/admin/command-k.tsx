"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Clock,
  CreditCard,
  LayoutDashboard,
  Landmark,
  Search,
  Settings,
  ShieldAlert,
  Truck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type CommandAction = {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  keywords?: string[];
  run: () => void;
};

const RECENTS_KEY = "tl-commandk-recents";
const RECENTS_LIMIT = 8;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

function writeRecents(next: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, RECENTS_LIMIT)));
  } catch {
    // ignore quota/private
  }
}

export function CommandK() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const actions = useMemo<CommandAction[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
    };

    return [
      {
        id: "nav:dashboard",
        title: "Dashboard",
        subtitle: "Resumen general",
        icon: <LayoutDashboard className="h-4 w-4" aria-hidden />,
        keywords: ["inicio", "overview", "resumen"],
        run: go("/admin"),
      },
      {
        id: "nav:ventas",
        title: "Ventas",
        subtitle: "Ventas en vivo",
        icon: <CreditCard className="h-4 w-4" aria-hidden />,
        keywords: ["stream", "recientes", "caja"],
        run: go("/admin/ventas"),
      },
      {
        id: "nav:historial",
        title: "Historial",
        subtitle: "Búsqueda y filtros",
        icon: <Clock className="h-4 w-4" aria-hidden />,
        keywords: ["ventas", "filtros", "fechas"],
        run: go("/admin/historial"),
      },
      {
        id: "nav:inventario",
        title: "Inventario",
        subtitle: "Productos, costos y stock",
        icon: <Boxes className="h-4 w-4" aria-hidden />,
        keywords: ["productos", "stock", "sku", "costo", "precio"],
        run: go("/admin/inventario"),
      },
      {
        id: "nav:kardex",
        title: "Entradas/Salidas",
        subtitle: "Kardex de inventario",
        icon: <BarChart3 className="h-4 w-4" aria-hidden />,
        keywords: ["movimientos", "kardex", "ajustes"],
        run: go("/admin/entradas-salidas"),
      },
      {
        id: "nav:proveedores",
        title: "Proveedores",
        subtitle: "Ranking y cuentas",
        icon: <Truck className="h-4 w-4" aria-hidden />,
        keywords: ["cuentas", "a pagar", "nomenclador"],
        run: go("/admin/proveedores"),
      },
      {
        id: "nav:economia",
        title: "Economía",
        subtitle: "Métricas, margen y mix de pago",
        icon: <Landmark className="h-4 w-4" aria-hidden />,
        keywords: ["margen", "revenue", "pagos", "usd"],
        run: go("/admin/economia"),
      },
      {
        id: "nav:alertas",
        title: "Alertas",
        subtitle: "Anomalías y fraude",
        icon: <ShieldAlert className="h-4 w-4" aria-hidden />,
        keywords: ["fraude", "anomalias", "eventos"],
        run: go("/admin/alertas"),
      },
      {
        id: "nav:config",
        title: "Configuración",
        subtitle: "Estado del sistema",
        icon: <Settings className="h-4 w-4" aria-hidden />,
        keywords: ["sesion", "storeId", "estado"],
        run: go("/admin/config"),
      },
    ];
  }, [router]);

  const actionsById = useMemo(() => new Map(actions.map((a) => [a.id, a])), [actions]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      const recentActions = recents
        .map((id) => actionsById.get(id))
        .filter(Boolean) as CommandAction[];
      const recentIds = new Set(recentActions.map((a) => a.id));
      return [...recentActions, ...actions.filter((a) => !recentIds.has(a.id))].slice(0, 18);
    }
    return actions
      .filter((a) => {
        const hay = [a.title, a.subtitle ?? "", ...(a.keywords ?? [])].join(" ").toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 18);
  }, [actions, actionsById, q, recents]);

  function close() {
    setOpen(false);
  }

  function openDialog() {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    setRecents(readRecents());
    setOpen(true);
    setQ("");
  }

  function runAction(a: CommandAction) {
    const next = [a.id, ...readRecents().filter((x) => x !== a.id)];
    writeRecents(next);
    setRecents(next);
    close();
    a.run();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        if (!open) openDialog();
        else close();
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // focus inicial y retorno
  useEffect(() => {
    if (!open) {
      prevFocusRef.current?.focus?.();
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // cerrar al navegar
  useEffect(() => {
    if (!open) return;
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // focus trap básico
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.tabIndex !== -1 && el.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!active || active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/45 p-4 pt-16 sm:pt-20"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tl-commandk-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="tl-glass w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-tl-line px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="tl-commandk-title" className="text-sm font-semibold text-tl-ink">
                Búsqueda global
              </h2>
              <p className="mt-0.5 text-xs text-tl-muted">Atajo: Ctrl/Cmd + K</p>
            </div>
            <button
              type="button"
              className="tl-btn tl-btn-secondary !p-2"
              aria-label="Cerrar búsqueda"
              onClick={close}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="mt-3">
            <label htmlFor="tl-commandk-input" className="sr-only">
              Buscar acción o sección
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tl-muted" aria-hidden />
              <input
                ref={inputRef}
                id="tl-commandk-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="tl-input w-full pl-10"
                placeholder="Escribe para buscar (ventas, inventario, proveedores...)"
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-tl-muted">Sin resultados.</div>
          ) : (
            <ul className="divide-y divide-tl-line-subtle">
              {filtered.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-tl-canvas-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-tl-accent/30",
                    )}
                    onClick={() => runAction(a)}
                  >
                    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tl-canvas-subtle text-tl-accent">
                      {a.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-tl-ink">{a.title}</span>
                      {a.subtitle ? (
                        <span className="mt-0.5 block truncate text-xs text-tl-muted">{a.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="text-[11px] font-semibold text-tl-muted">↵</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

