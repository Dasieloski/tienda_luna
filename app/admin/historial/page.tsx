"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { formatCupAndUsdLabel } from "@/lib/money";

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

export default function SalesHistoryPage() {
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistorySale | null>(null);

  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

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
        render: (row) => (
          <span className="font-semibold tabular-nums text-tl-ink">
            {formatCupAndUsdLabel(row.totalCents)}
          </span>
        ),
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
              maxHeight="calc(100vh - 430px)"
              loading={loading}
              skeletonRows={12}
              selectedKey={selected?.id ?? null}
              onRowClick={(row) => setSelected(row)}
              pagination={{
                page,
                totalPages,
                onPageChange: setPage,
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
                <p className="mt-1 text-lg font-bold tabular-nums text-tl-ink">
                  {formatCupAndUsdLabel(selected.totalCents)}
                </p>
                  <p className="mt-1 text-xs text-tl-muted">{selectedTotalItems} artículos</p>
                </div>
                <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Productos</p>
                  <ul className="mt-2 space-y-2">
                    {selected.lines.map((l) => (
                      <li key={l.id} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-tl-ink">{l.productName}</p>
                          <p className="text-xs font-mono text-tl-muted">{l.sku}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-tl-muted">
                            {l.quantity} × {formatCupAndUsdLabel(l.unitPriceCents)}
                          </p>
                          <p className="text-sm font-semibold tabular-nums text-tl-ink">
                            {formatCupAndUsdLabel(l.subtotalCents)}
                          </p>
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
    </AdminShell>
  );
}

