"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilterIcon as Filter, RefreshCwIcon as RefreshCw } from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column, type DataTableFilters, type DataTableSorting } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  auditMeta?: unknown;
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

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), Math.max(0, delayMs));
    return () => window.clearTimeout(id);
  }, [delayMs, value]);
  return debounced;
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

  const qDebounced = useDebouncedValue(q, 350);

  const [sorting, setSorting] = useState<DataTableSorting>({ key: "createdAt", dir: "desc" });
  const [filters, setFilters] = useState<DataTableFilters>({});
  const [revertBusyId, setRevertBusyId] = useState<string | null>(null);
  const [confirmRevertOpen, setConfirmRevertOpen] = useState(false);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [confirmDeleteViewOpen, setConfirmDeleteViewOpen] = useState(false);

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

  const selectedView = useMemo(
    () => (selectedViewId ? savedViews.find((v) => v.id === selectedViewId) ?? null : null),
    [savedViews, selectedViewId],
  );

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
        .map((x: unknown): SavedView => {
          const obj = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
          const sorting: DataTableSorting =
            obj.sorting && typeof obj.sorting === "object"
              ? {
                  key:
                    typeof (obj.sorting as Record<string, unknown>).key === "string"
                      ? ((obj.sorting as Record<string, unknown>).key as string)
                      : null,
                  dir: (obj.sorting as Record<string, unknown>).dir === "asc" ? "asc" : "desc",
                }
              : { key: "createdAt", dir: "desc" };

          const filters: DataTableFilters =
            obj.filters && typeof obj.filters === "object" ? (obj.filters as DataTableFilters) : {};

          return {
            id: String(obj.id ?? ""),
            name: String(obj.name ?? ""),
            q: typeof obj.q === "string" ? obj.q : "",
            from: typeof obj.from === "string" ? obj.from : "",
            to: typeof obj.to === "string" ? obj.to : "",
            sorting,
            filters,
            createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
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

  const inFlightRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      const needle = qDebounced.trim();
      if (needle.length >= 2) params.set("q", needle);
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

      const res = await fetch(`/api/admin/inventory/movements?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      });
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
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setLoading(false);
    }
  }, [filters, from, limit, page, qDebounced, sorting.dir, sorting.key, to]);

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
      {
        key: "revert",
        label: "",
        width: "120px",
        render: (r) => {
          const can = r.reason === "MANUAL_ADJUST" && r.actorType === "USER";
          if (!can) return null;
          const busy = revertBusyId === r.id;
          return (
            <button
              type="button"
              className={cn(
                "tl-btn tl-btn-secondary tl-interactive !px-3 !py-2 text-xs",
                busy && "opacity-60 pointer-events-none",
              )}
              title="Revertir este ajuste manual"
              onClick={async () => {
                setConfirmRevertId(r.id);
                setConfirmRevertOpen(true);
              }}
            >
              {busy ? "Revirtiendo…" : "Revertir"}
            </button>
          );
        },
      },
    ],
    [revertBusyId],
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
                      setSaveViewName("");
                      setSaveViewOpen(true);
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
                      setConfirmDeleteViewOpen(true);
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

      <ConfirmDialog
        open={confirmRevertOpen}
        title="Revertir ajuste manual"
        description="Esto creará un nuevo movimiento que revierte el ajuste y dejará auditoría."
        confirmLabel="Revertir"
        destructive
        busy={revertBusyId != null}
        onClose={() => {
          if (revertBusyId != null) return;
          setConfirmRevertOpen(false);
          setConfirmRevertId(null);
        }}
        onConfirm={() => {
          if (!confirmRevertId) return;
          void (async () => {
            setRevertBusyId(confirmRevertId);
            setError(null);
            try {
              const res = await fetch("/api/admin/inventory/revert-manual-adjust", {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                body: JSON.stringify({ movementId: confirmRevertId }),
              });
              const raw: unknown = await res.json().catch(() => ({}));
              const obj = raw && typeof raw === "object" ? (raw as { error?: unknown }) : null;
              if (!res.ok) {
                setError(typeof obj?.error === "string" ? obj.error : "No se pudo revertir.");
                return;
              }
              await load();
              setConfirmRevertOpen(false);
              setConfirmRevertId(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Error de red al revertir.");
            } finally {
              setRevertBusyId(null);
            }
          })();
        }}
      />

      <Modal
        open={saveViewOpen}
        title="Guardar vista"
        description="Guarda filtros/orden para reutilizarlos rápidamente."
        onClose={() => setSaveViewOpen(false)}
        maxWidthClassName="max-w-[520px]"
      >
        <div className="grid gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
            Nombre
            <input
              className="tl-input mt-1 h-10"
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              placeholder="Ej: Ajustes manuales · esta semana"
              autoFocus
            />
          </label>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm" onClick={() => setSaveViewOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-primary !px-4 !py-2 text-sm"
              onClick={() => {
                const name = saveViewName.trim();
                if (!name) return;
                const v: SavedView = {
                  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                  name,
                  q,
                  from,
                  to,
                  sorting,
                  filters,
                  createdAt: Date.now(),
                };
                persistSavedViews([v, ...savedViews].slice(0, 30));
                setSelectedViewId(v.id);
                setSaveViewOpen(false);
              }}
            >
              Guardar
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteViewOpen}
        title="Eliminar vista guardada"
        description={
          selectedView
            ? `Se eliminará la vista «${selectedView.name}». Esta acción no se puede deshacer.`
            : "Se eliminará la vista seleccionada. Esta acción no se puede deshacer."
        }
        confirmLabel="Eliminar"
        destructive
        onClose={() => setConfirmDeleteViewOpen(false)}
        onConfirm={() => {
          if (!selectedViewId) return;
          persistSavedViews(savedViews.filter((x) => x.id !== selectedViewId));
          setSelectedViewId("");
          setConfirmDeleteViewOpen(false);
        }}
      />
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

