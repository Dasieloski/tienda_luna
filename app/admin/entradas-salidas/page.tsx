"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column, type DataTableFilters, type DataTableSorting } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";

type MovementRow = {
  id: string;
  createdAt: string;
  productId: string;
  product: { id: string; name: string; sku: string } | null;
  delta: number;
  beforeQty: number;
  afterQty: number;
  reason: string;
  actorType: "USER" | "DEVICE";
  actorId: string;
  /** Correo (USER), etiqueta del terminal (DEVICE) o texto legible para admin legacy. */
  actorLabel?: string;
  /** Texto multilínea para tooltip (fecha, terminal si aplica, límites de lo guardado en BD). */
  actorHover?: string;
  eventId: string | null;
};

type ApiResponse = {
  meta: {
    dbAvailable: boolean;
    message?: string;
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
  rows: MovementRow[];
};

function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function InventoryMovementsPageClient() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [sorting, setSorting] = useState<DataTableSorting>({ key: "createdAt", dir: "desc" });
  const [filters, setFilters] = useState<DataTableFilters>({});

  type SavedView = {
    id: string;
    name: string;
    q: string;
    from: string;
    to: string;
    sorting: DataTableSorting;
    filters: DataTableFilters;
    createdAt: number;
  };
  const SAVED_VIEWS_KEY = "tl-saved-views:movements";
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");

  const loadSavedViews = useCallback(() => {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(arr)) {
        setSavedViews([]);
        return;
      }
      const parsed = arr
        .filter((x): x is SavedView => x && typeof x === "object")
        .map((x: any): SavedView => {
          const sorting: DataTableSorting =
            x.sorting && typeof x.sorting === "object"
              ? {
                  key: typeof x.sorting.key === "string" ? x.sorting.key : null,
                  dir: x.sorting.dir === "asc" ? "asc" : "desc",
                }
              : { key: "createdAt", dir: "desc" };

          const filters: DataTableFilters =
            x.filters && typeof x.filters === "object" ? (x.filters as DataTableFilters) : {};

          return {
            id: String(x.id ?? ""),
            name: String(x.name ?? ""),
            q: typeof x.q === "string" ? x.q : "",
            from: typeof x.from === "string" ? x.from : "",
            to: typeof x.to === "string" ? x.to : "",
            sorting,
            filters,
            createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
          };
        })
        .filter((x) => x.id && x.name);
      setSavedViews(parsed);
    } catch {
      setSavedViews([]);
    }
  }, []);

  const persistSavedViews = useCallback((next: SavedView[]) => {
    setSavedViews(next);
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSavedViews();
  }, [loadSavedViews]);

  // Drill-down: precargar desde query params (solo 1 vez).
  useEffect(() => {
    const preset = (searchParams.get("preset") ?? "").toLowerCase();
    const qParam = searchParams.get("q");
    const fromIso = searchParams.get("from");
    const toIso = searchParams.get("to");
    const actorType = (searchParams.get("actorType") ?? "").toUpperCase();
    const actorId = searchParams.get("actorId");
    const productId = searchParams.get("productId");

    const shouldApply = preset || qParam || fromIso || toIso || actorType || actorId || productId;
    if (!shouldApply) return;

    setPage(1);
    if (typeof qParam === "string") setQ(qParam);

    if (preset === "today" || preset === "hoy") {
      const d = new Date();
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      setFrom(toDatetimeLocalValue(start.toISOString()));
      setTo(toDatetimeLocalValue(d.toISOString()));
    } else if (preset === "week" || preset === "semana") {
      const d = new Date();
      const start = new Date(d);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      setFrom(toDatetimeLocalValue(start.toISOString()));
      setTo(toDatetimeLocalValue(d.toISOString()));
    } else {
      if (fromIso) setFrom(toDatetimeLocalValue(fromIso));
      if (toIso) setTo(toDatetimeLocalValue(toIso));
    }

    setFilters((prev) => {
      const next: DataTableFilters = { ...prev };
      if (actorType === "USER" || actorType === "DEVICE") {
        next.actorType = { kind: "select", value: actorType };
      }
      if (typeof actorId === "string" && actorId.trim()) {
        next.actorId = { kind: "text", value: actorId.trim() };
      }
      if (typeof productId === "string" && productId.trim()) {
        next.productId = { kind: "text", value: productId.trim() };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (q.trim()) params.set("q", q.trim());
      if (from) {
        const iso = fromDatetimeLocalValue(from);
        if (iso) params.set("from", iso);
      }
      if (to) {
        const iso = fromDatetimeLocalValue(to);
        if (iso) params.set("to", iso);
      }

      // DataTable controlled filters -> query params
      const actorType = filters.actorType?.kind === "select" ? filters.actorType.value : "";
      const actorId = filters.actorId?.kind === "text" ? filters.actorId.value : "";
      const productId = filters.productId?.kind === "text" ? filters.productId.value : "";

      if (actorType) params.set("actorType", actorType);
      if (actorId.trim()) params.set("actorId", actorId.trim());
      if (productId.trim()) params.set("productId", productId.trim());

      if (sorting.key) {
        // API limita a llaves conocidas
        const k = sorting.key;
        if (["createdAt", "product", "delta", "actorType", "reason"].includes(k)) {
          params.set("sortKey", k);
          params.set("sortDir", sorting.dir);
        }
      }

      const res = await fetch(`/api/admin/inventory/movements?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError("No se pudo cargar Entradas/Salidas.");
        return;
      }
      if (!json.meta?.dbAvailable) {
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        setError(json.meta?.message ?? "Base de datos no disponible.");
        return;
      }
      setRows(json.rows ?? []);
      setTotal(json.meta.total ?? 0);
      setTotalPages(json.meta.totalPages ?? 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setLoading(false);
    }
  }, [filters, from, limit, page, q, sorting.dir, sorting.key, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<MovementRow>[] = useMemo(
    () => [
      {
        key: "createdAt",
        label: "Fecha",
        sortable: true,
        width: "190px",
        sortValue: (r) => r.createdAt,
        render: (r) => (
          <span className="text-xs tabular-nums text-tl-muted">
            {new Date(r.createdAt).toLocaleString("es-ES")}
          </span>
        ),
      },
      {
        key: "product",
        label: "Producto",
        sortable: true,
        sortValue: (r) => r.product?.name ?? "",
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-medium text-tl-ink">{r.product?.name ?? "—"}</span>
            {r.product?.sku ? <span className="text-xs font-mono text-tl-muted">{r.product.sku}</span> : null}
          </div>
        ),
      },
      {
        key: "delta",
        label: "Δ",
        sortable: true,
        align: "right",
        width: "80px",
        render: (r) => (
          <span className={cn("tabular-nums font-semibold", r.delta >= 0 ? "text-tl-success" : "text-tl-warning")}>
            {r.delta >= 0 ? `+${r.delta}` : String(r.delta)}
          </span>
        ),
      },
      {
        key: "beforeQty",
        label: "Antes",
        align: "right",
        width: "90px",
        render: (r) => <span className="tabular-nums text-tl-muted">{r.beforeQty}</span>,
      },
      {
        key: "afterQty",
        label: "Después",
        align: "right",
        width: "90px",
        render: (r) => <span className="tabular-nums text-tl-ink">{r.afterQty}</span>,
      },
      {
        key: "reason",
        label: "Motivo",
        sortable: true,
        width: "160px",
        render: (r) => <span className="text-xs font-semibold uppercase tracking-wide text-tl-muted">{r.reason}</span>,
      },
      {
        key: "actorType",
        label: "Actor",
        sortable: true,
        width: "120px",
        filter: {
          kind: "select",
          options: [
            { label: "USER", value: "USER" },
            { label: "DEVICE", value: "DEVICE" },
          ],
          getValue: (r) => r.actorType,
        },
        render: (r) => <span className="text-xs font-medium text-tl-ink-secondary">{r.actorType}</span>,
      },
      {
        key: "actorId",
        label: "Quién",
        sortable: true,
        width: "220px",
        filter: { kind: "text", placeholder: "Filtrar actorId…" },
        render: (r) => {
          const label = r.actorLabel?.trim() || r.actorId;
          const title = r.actorHover?.trim() || (label !== r.actorId ? `${label}\n${r.actorId}` : r.actorId);
          return (
            <span className="max-w-[220px] cursor-help truncate text-xs text-tl-ink-secondary" title={title}>
              {label}
            </span>
          );
        },
      },
      {
        key: "productId",
        label: "productId",
        filter: { kind: "text", placeholder: "Filtrar productId…" },
        render: (r) => (
          <span className="truncate font-mono text-[11px] text-tl-muted" title={r.productId}>
            {r.productId}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <AdminShell title="Entradas/Salidas">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="tl-welcome-header">Entradas / Salidas</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Registro (kardex) de ajustes y salidas por ventas: fecha/hora y quién lo hizo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
              Actualizar
            </button>
          </div>
        </div>

        <div className="tl-glass rounded-xl p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                    onClick={() => {
                      const d = new Date();
                      const start = new Date(d);
                      start.setHours(0, 0, 0, 0);
                      setFrom(toDatetimeLocalValue(start.toISOString()));
                      setTo(toDatetimeLocalValue(d.toISOString()));
                      setPage(1);
                    }}
                    title="Preset: hoy"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                    onClick={() => {
                      const d = new Date();
                      const start = new Date(d);
                      start.setDate(start.getDate() - 6);
                      start.setHours(0, 0, 0, 0);
                      setFrom(toDatetimeLocalValue(start.toISOString()));
                      setTo(toDatetimeLocalValue(d.toISOString()));
                      setPage(1);
                    }}
                    title="Preset: última semana"
                  >
                    Esta semana
                  </button>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                    onClick={() => {
                      setFilters({
                        ...filters,
                        actorType: { kind: "select", value: "DEVICE" },
                      });
                      setPage(1);
                    }}
                    title="Preset: solo cambios de dispositivos"
                  >
                    Solo DEVICE
                  </button>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="sr-only" htmlFor="tl-movements-saved">
                    Vistas guardadas
                  </label>
                  <select
                    id="tl-movements-saved"
                    className="tl-input h-10 w-full sm:w-[260px]"
                    value={selectedViewId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedViewId(id);
                      const v = savedViews.find((x) => x.id === id);
                      if (!v) return;
                      setQ(v.q);
                      setFrom(v.from);
                      setTo(v.to);
                      setSorting(v.sorting);
                      setFilters(v.filters);
                      setPage(1);
                    }}
                  >
                    <option value="">Vistas guardadas…</option>
                    {savedViews
                      .slice()
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="tl-btn tl-btn-primary tl-interactive !px-3 !py-2 text-xs"
                    onClick={() => {
                      const name = window.prompt("Nombre para guardar esta vista:", "");
                      if (!name || !name.trim()) return;
                      const v: SavedView = {
                        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                        name: name.trim(),
                        q,
                        from,
                        to,
                        sorting,
                        filters,
                        createdAt: Date.now(),
                      };
                      persistSavedViews([v, ...savedViews].slice(0, 30));
                      setSelectedViewId(v.id);
                    }}
                    title="Guardar filtros actuales"
                  >
                    Guardar vista
                  </button>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs"
                    onClick={() => {
                      if (!selectedViewId) return;
                      const v = savedViews.find((x) => x.id === selectedViewId);
                      if (!v) return;
                      if (!window.confirm(`¿Eliminar la vista \"${v.name}\"?`)) return;
                      persistSavedViews(savedViews.filter((x) => x.id !== selectedViewId));
                      setSelectedViewId("");
                    }}
                    disabled={!selectedViewId}
                    title="Eliminar vista seleccionada"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1 sm:min-w-[240px]">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Buscar (producto, sku, actor, motivo)
              </label>
              <input
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                className="tl-input"
                placeholder="Ej: arroz, STOCK_DECREASED, device..."
                type="search"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Desde
              </label>
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => {
                  setPage(1);
                  setFrom(e.target.value);
                }}
                className="tl-input w-full sm:w-[220px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Hasta
              </label>
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => {
                  setPage(1);
                  setTo(e.target.value);
                }}
                className="tl-input w-full sm:w-[220px]"
              />
            </div>
            <button
              type="button"
              className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
              onClick={() => {
                setPage(1);
                void load();
              }}
              title="Aplicar filtros"
            >
              <Filter className="h-4 w-4" aria-hidden />
              Aplicar
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
              onClick={() => {
                setQ("");
                setFrom("");
                setTo("");
                setFilters({});
                setSorting({ key: "createdAt", dir: "desc" });
                setPage(1);
              }}
            >
              Limpiar
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-tl-danger/20 bg-tl-danger-subtle px-4 py-3 text-sm text-tl-danger">
            {error}
          </div>
        )}

        <DataTable
          columns={columns}
          data={rows}
          keyExtractor={(r) => r.id}
          searchable={false}
          emptyMessage="No hay movimientos para el filtro actual."
          maxHeight="calc(100vh - 460px)"
          loading={loading}
          skeletonRows={12}
          sorting={sorting}
          onSortingChange={(next) => {
            setPage(1);
            setSorting(next);
          }}
          filters={filters}
          onFiltersChange={(next) => {
            setPage(1);
            setFilters(next);
          }}
          pagination={{
            page,
            totalPages,
            onPageChange: setPage,
            summary: `${total.toLocaleString("es-ES")} movimientos · página ${page} de ${totalPages}`,
          }}
        />
      </div>
    </AdminShell>
  );
}

export default function InventoryMovementsPage() {
  return (
    <Suspense
      fallback={
        <AdminShell title="Entradas/Salidas">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="h-8 w-8 text-tl-accent tl-spin" aria-hidden />
              <p className="text-sm text-tl-muted">Cargando movimientos...</p>
            </div>
          </div>
        </AdminShell>
      }
    >
      <InventoryMovementsPageClient />
    </Suspense>
  );
}

