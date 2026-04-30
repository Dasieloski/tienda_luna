"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type HistorySale = {
  id: string;
  deviceId: string;
  deviceLabel: string | null;
  soldBy: string | null;
  totalCents: number;
  status: string;
  completedAt: string;
  lines: {
    id: string;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    productName: string;
    sku: string;
  }[];
};

type HistoryResponse = {
  sales: HistorySale[];
  meta: {
    dbAvailable: boolean;
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    message?: string;
  };
};

function toDatetimeLocalValue(iso: string) {
  // iso -> YYYY-MM-DDTHH:mm (sin segundos) en hora local
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(v: string) {
  // string local -> ISO
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function SalesHistoryPageClient() {
  const searchParams = useSearchParams();
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistorySale | null>(null);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  type SavedView = { id: string; name: string; q: string; from: string; to: string; createdAt: number };
  const SAVED_VIEWS_KEY = "tl-saved-views:historial";
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [confirmDeleteViewOpen, setConfirmDeleteViewOpen] = useState(false);

  const selectedView = useMemo(
    () => (selectedViewId ? savedViews.find((v) => v.id === selectedViewId) ?? null : null),
    [savedViews, selectedViewId],
  );

  function isRecord(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === "object";
  }

  const loadSavedViews = useCallback(() => {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(arr)) {
        setSavedViews([]);
        return;
      }
      const parsed = arr
        .filter((x): x is Record<string, unknown> => isRecord(x))
        .map((x) => ({
          id: String(x.id ?? ""),
          name: String(x.name ?? ""),
          q: typeof x.q === "string" ? x.q : "",
          from: typeof x.from === "string" ? x.from : "",
          to: typeof x.to === "string" ? x.to : "",
          createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
        }))
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

  // Drill-down: precargar filtros desde query params (solo 1 vez).
  useEffect(() => {
    const preset = (searchParams.get("preset") ?? "").toLowerCase();
    const qParam = searchParams.get("q");
    const fromIso = searchParams.get("from");
    const toIso = searchParams.get("to");

    const shouldApply = preset || qParam || fromIso || toIso;
    if (!shouldApply) return;

    // Aplica una sola vez: si el usuario ya interactuó, no sobreescribimos.
    setPage(1);
    if (typeof qParam === "string") setQ(qParam);

    if (preset === "today" || preset === "hoy") {
      const d = new Date();
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      setFrom(toDatetimeLocalValue(start.toISOString()));
      setTo(toDatetimeLocalValue(d.toISOString()));
      return;
    }
    if (preset === "week" || preset === "semana") {
      const d = new Date();
      const start = new Date(d);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      setFrom(toDatetimeLocalValue(start.toISOString()));
      setTo(toDatetimeLocalValue(d.toISOString()));
      return;
    }

    if (fromIso) setFrom(toDatetimeLocalValue(fromIso));
    if (toIso) setTo(toDatetimeLocalValue(toIso));
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

      const res = await fetch(`/api/admin/sales/history?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as HistoryResponse;
      if (!res.ok) {
        setError("No se pudo cargar el historial.");
        return;
      }
      if (!json.meta?.dbAvailable) {
        setSales([]);
        setTotalPages(1);
        setTotal(0);
        setError(json.meta?.message ?? "Base de datos no disponible.");
        return;
      }
      const nextSales = json.sales ?? [];
      setSales(nextSales);
      setTotalPages(json.meta.totalPages ?? 1);
      setTotal(json.meta.total ?? 0);
      setSelected((prev) => {
        if (!prev) return null;
        return nextSales.some((s) => s.id === prev.id) ? prev : null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando historial");
    } finally {
      setLoading(false);
    }
  }, [from, limit, page, q, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sin auto-refresh: evita recargar mientras filtras o revisas detalle.

  const columns: Column<HistorySale>[] = useMemo(
    () => [
      {
        key: "completedAt",
        label: "Fecha",
        sortable: true,
        width: "190px",
        render: (row) => (
          <span className="text-xs tabular-nums text-tl-muted">{new Date(row.completedAt).toLocaleString("es-ES")}</span>
        ),
      },
      {
        key: "soldBy",
        label: "Vendido por",
        width: "180px",
        render: (row) => (
          <span className="text-sm text-tl-ink-secondary">{row.soldBy ?? "—"}</span>
        ),
      },
      {
        key: "deviceLabel",
        label: "Caja",
        width: "140px",
        render: (row) => (
          <span className="text-xs font-medium text-tl-ink-secondary">
            {row.deviceLabel ?? "Caja"}
          </span>
        ),
      },
      {
        key: "totalCents",
        label: "Total",
        sortable: true,
        align: "right",
        width: "120px",
        render: (row) => <TablePriceCupCell cupCents={row.totalCents} compact />,
      },
      {
        key: "lines",
        label: "Items",
        render: (row) => (
          <span className="text-sm text-tl-ink-secondary">
            {row.lines
              .map((l) => `${l.quantity}x ${l.productName}`)
              .slice(0, 3)
              .join(", ")}
            {row.lines.length > 3 && "..."}
          </span>
        ),
      },
    ],
    [],
  );

  const selectedTotalItems = selected?.lines.reduce((acc, l) => acc + l.quantity, 0) ?? 0;

  return (
    <AdminShell title="Historial">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="tl-welcome-header">Historial de ventas</h1>
            <p className="mt-2 text-sm text-tl-muted">
              {total.toLocaleString("es-ES")} ventas registradas
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

        {/* Filters */}
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
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="sr-only" htmlFor="tl-historial-saved">
                    Vistas guardadas
                  </label>
                  <select
                    id="tl-historial-saved"
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
              Buscar (cajero, dispositivo)
              </label>
              <input
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                className="tl-input"
              placeholder="Ej: cajero@..., Caja 1..."
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <DataTable
              columns={columns}
              data={sales}
              keyExtractor={(row) => row.id}
              searchable={false}
              emptyMessage="No hay ventas en el rango seleccionado"
              maxHeight="calc(100vh - 300px)"
              loading={loading}
              skeletonRows={12}
              selectedKey={selected?.id ?? null}
              onRowClick={(row) => setSelected(row)}
              pagination={{
                kind: "server",
                page,
                totalPages,
                onPageChange: setPage,
                pageSize: limit,
                pageSizeOptions: [10, 25, 50, 100, 200],
                onPageSizeChange: (n) => {
                  setPage(1);
                  setLimit(n);
                },
                summary: `${total.toLocaleString("es-ES")} ventas · página ${page} de ${totalPages}`,
              }}
            />
          </div>

          {/* Detail panel */}
          <aside className="tl-glass rounded-xl p-4">
            <h2 className="text-sm font-semibold text-tl-ink">Detalle</h2>
            {!selected ? (
              <p className="mt-2 text-sm text-tl-muted">Selecciona una venta para ver el detalle.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {selected.status === "deleted" ? (
                  <div className="rounded-xl border border-tl-danger/20 bg-tl-danger-subtle p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-tl-danger">
                      Venta eliminada por admin
                    </p>
                    <p className="mt-1 text-xs text-tl-muted">
                      Esta venta fue borrada de la BD y se conserva aquí solo como registro de auditoría.
                    </p>
                  </div>
                ) : null}
                <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Fecha</p>
                  <p className="mt-1 text-sm font-medium text-tl-ink">
                    {new Date(selected.completedAt).toLocaleString("es-ES")}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Vendido por</p>
                    <p className="mt-1 text-sm font-medium text-tl-ink">{selected.soldBy ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Caja</p>
                    <p className="mt-1 text-sm font-medium text-tl-ink">
                      {selected.deviceLabel ?? "—"}
                    </p>
                    <p className="mt-1 text-xs font-mono text-tl-muted">{selected.deviceId}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Total</p>
                <div className="mt-1 text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={selected.totalCents} />
                </div>
                  <p className="mt-1 text-xs text-tl-muted">{selectedTotalItems} artículos</p>
                </div>
                <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Productos</p>
                  <ul className="mt-2 space-y-2">
                    {selected.lines.map((l) => (
                      <li key={l.id} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-tl-ink">{l.productName}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-tl-muted">
                            {l.quantity} × <CupUsdMoney cents={l.unitPriceCents} compact />
                          </p>
                          <div className="text-sm font-semibold text-tl-ink">
                            <CupUsdMoney cents={l.subtotalCents} compact />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      <Modal
        open={saveViewOpen}
        title="Guardar vista"
        description="Guarda los filtros actuales para reutilizarlos rápidamente."
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
              placeholder="Ej: Semana actual · Caja principal"
              autoFocus
            />
          </label>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
              onClick={() => setSaveViewOpen(false)}
            >
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

export default function SalesHistoryPage() {
  return (
    <Suspense
      fallback={
        <AdminShell title="Historial">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="h-8 w-8 text-tl-accent tl-spin" aria-hidden />
              <p className="text-sm text-tl-muted">Cargando historial...</p>
            </div>
          </div>
        </AdminShell>
      }
    >
      <SalesHistoryPageClient />
    </Suspense>
  );
}

