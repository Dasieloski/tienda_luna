"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Trash2, WifiOff } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";

type RecentSale = {
  id: string;
  deviceId: string;
  totalCents: number;
  status: string;
  completedAt: string;
  paymentMethod: string | null;
  paidCents: number | null;
  changeCents: number | null;
  /** Campo auxiliar para búsqueda local */
  searchText?: string;
  lines: {
    id: string;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    productName: string;
    sku: string;
  }[];
};

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function SalesPage() {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [visibleSales, setVisibleSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightNew, setHighlightNew] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const topSaleRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const stopRef = useRef(false);

  const now = useMemo(() => new Date(), []);
  const [fromDay, setFromDay] = useState(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return ymdLocal(d);
  });
  const [toDay, setToDay] = useState(() => ymdLocal(now));

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const loadSales = useCallback(async (opts?: { initial?: boolean; manual?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const isInitial = opts?.initial === true;
    if (!isInitial) setRefreshing(true);
    try {
      const qs = new URLSearchParams({
        limit: "500",
        fromDay,
        toDay,
      });
      const res = await fetch(`/api/admin/sales/recent?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) {
        setPollError("No se pudo actualizar ventas.");
        return;
      }
      const json = (await res.json()) as { sales: RecentSale[] };
      const next = (json.sales ?? []).map((s) => ({
        ...s,
        searchText: [
          s.deviceId,
          s.paymentMethod ?? "",
          ...s.lines.map((l) => `${l.productName} ${l.sku}`),
        ]
          .join(" ")
          .toLowerCase(),
      }));
      
      // Check if there's a new sale
      if (next[0] && topSaleRef.current && next[0].id !== topSaleRef.current) {
        setHighlightNew(true);
        setTimeout(() => setHighlightNew(false), 1500);
      }
      topSaleRef.current = next[0]?.id ?? null;
      setSales(next);
      setPollError(null);
      setLastUpdatedAt(new Date());
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlightRef.current = false;
    }
  }, [fromDay, toDay]);

  // Initial load
  useEffect(() => {
    void loadSales({ initial: true });
  }, [loadSales]);

  // Auto-refresh (5s) solo si la pestaña está visible.
  useEffect(() => {
    stopRef.current = false;
    let interval: number | null = null;

    const tick = () => {
      if (stopRef.current) return;
      if (document.visibilityState !== "visible") return;
      void loadSales();
    };

    interval = window.setInterval(tick, 5000);

    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopRef.current = true;
      if (interval != null) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadSales]);

  const totals = useMemo(() => {
    const out = { totalCents: 0, units: 0, tickets: 0 };
    out.tickets = visibleSales.length;
    for (const s of visibleSales) {
      out.totalCents += s.totalCents;
      for (const l of s.lines) out.units += l.quantity;
    }
    return out;
  }, [visibleSales]);

  const columns: Column<RecentSale>[] = [
    {
      key: "__sel",
      label: "✓",
      width: "46px",
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const checked = e.target.checked;
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (checked) next.add(row.id);
              else next.delete(row.id);
              return next;
            });
          }}
          aria-label="Seleccionar venta"
        />
      ),
    },
    {
      key: "completedAt",
      label: "Fecha",
      sortable: true,
      width: "130px",
      render: (row) => (
        <span className="text-xs tabular-nums text-tl-muted">
          {new Date(row.completedAt).toLocaleDateString("es-ES")}
        </span>
      ),
    },
    {
      key: "time",
      label: "Hora",
      width: "90px",
      render: (row) => (
        <span className="text-xs tabular-nums text-tl-muted">
          {new Date(row.completedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
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
      key: "paymentMethod",
      label: "Método",
      width: "120px",
      render: (row) => (
        <span className="text-xs font-semibold uppercase tracking-wide text-tl-muted">
          {row.paymentMethod ?? "—"}
        </span>
      ),
    },
    {
      key: "paidCents",
      label: "Pagó con",
      align: "right",
      width: "120px",
      render: (row) => (
        <span className="text-xs tabular-nums text-tl-ink">
          {row.paidCents != null ? <TablePriceCupCell cupCents={row.paidCents} compact /> : "—"}
        </span>
      ),
    },
    {
      key: "changeCents",
      label: "Vuelto",
      align: "right",
      width: "120px",
      render: (row) => (
        <span className="text-xs tabular-nums text-tl-ink">
          {row.changeCents != null ? <TablePriceCupCell cupCents={row.changeCents} compact /> : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      width: "120px",
      render: (row) => (
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            row.status === "completed" && "bg-tl-success-subtle text-tl-success",
            row.status === "pending" && "bg-tl-warning-subtle text-tl-warning",
            row.status === "cancelled" && "bg-tl-danger-subtle text-tl-danger"
          )}
        >
          {row.status === "completed" ? "Completado" : row.status === "pending" ? "Pendiente" : row.status}
        </span>
      ),
    },
    {
      key: "deviceId",
      label: "Dispositivo",
      width: "140px",
      render: (row) => (
        <span className="truncate font-mono text-xs text-tl-muted" title={row.deviceId}>
          {row.deviceId.length > 12 ? `${row.deviceId.slice(0, 10)}...` : row.deviceId}
        </span>
      ),
    },
    {
      key: "lines",
      label: "Productos",
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
    {
      key: "__actions",
      label: "",
      width: "70px",
      align: "right",
      render: (row) => (
        <button
          type="button"
          className="tl-btn tl-btn-secondary !px-2 !py-2 text-xs"
          title="Eliminar venta (admin)"
          onClick={(e) => {
            e.stopPropagation();
            if (deleteBusy) return;
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.add(row.id);
              return next;
            });
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ),
    },
  ];

  async function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Vas a eliminar ${ids.length} venta(s) de la base de datos.\n\nEsto borra Sale/SaleLine y revierte stock.\nSolo quedará un registro en Historial como “venta eliminada por admin”.\n\n¿Continuar?`,
    );
    if (!ok) return;
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      const res = await fetch("/api/admin/sales/delete", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ ids }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setDeleteMsg(json?.error ?? `No se pudo eliminar (HTTP ${res.status}).`);
        return;
      }
      setSelectedIds(new Set());
      await loadSales({ manual: true });
      setDeleteMsg(`Eliminadas: ${json?.deleted ?? ids.length}.`);
    } catch (e) {
      setDeleteMsg(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AdminShell title="Ventas">
      <div className="space-y-6">
        {/* Header - Crextio style */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="tl-welcome-header">
              Ventas en vivo
            </h1>
            <p className="mt-2 text-sm text-tl-muted">
              Actualización automática cada 5 segundos
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
                onClick={() => void loadSales({ manual: true })}
                disabled={loading || refreshing}
              >
                <RefreshCw className={cn("h-4 w-4", (loading || refreshing) && "animate-spin")} aria-hidden />
                {refreshing ? "Actualizando..." : "Actualizar"}
              </button>
              {lastUpdatedAt && (
                <span className="text-xs text-tl-muted">
                  Última actualización: {lastUpdatedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              {pollError && (
                <span className="inline-flex items-center gap-2 text-xs text-tl-warning">
                  <WifiOff className="h-4 w-4" aria-hidden />
                  {pollError}
                </span>
              )}
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
                onClick={() => void deleteSelected()}
                disabled={deleteBusy || selectedIds.size === 0}
                title="Eliminar ventas seleccionadas"
              >
                <Trash2 className={cn("h-4 w-4", deleteBusy && "animate-spin")} aria-hidden />
                {deleteBusy ? "Eliminando..." : `Eliminar (${selectedIds.size})`}
              </button>
            </div>
            {deleteMsg ? <p className="mt-2 text-xs text-tl-muted">{deleteMsg}</p> : null}
          </div>
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border border-tl-success/20 px-4 py-2 transition-all",
              highlightNew
                ? "bg-tl-success-subtle ring-2 ring-tl-success/30"
                : "bg-tl-success-subtle"
            )}
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tl-success opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-tl-success" />
            </span>
            <span className="text-sm font-medium text-tl-success">Stream activo</span>
          </div>
        </div>

        {/* Filtros */}
        <div className="tl-glass rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="fromDay">
                Desde
              </label>
              <input
                id="fromDay"
                type="date"
                value={fromDay}
                onChange={(e) => setFromDay(e.target.value)}
                className="tl-input mt-1 h-9 text-sm"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="toDay">
                Hasta
              </label>
              <input
                id="toDay"
                type="date"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
                className="tl-input mt-1 h-9 text-sm"
              />
            </div>
            <div className="ml-auto text-xs text-tl-muted">
              El total y las unidades se calculan sobre lo visible (búsqueda y rango).
            </div>
          </div>
        </div>

        {/* Summary cards (sobre lo filtrado) */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Transacciones (filtrado)
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
              {totals.tickets}
            </p>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Total facturado (filtrado)
            </p>
            <div className="mt-1 text-2xl font-bold text-tl-ink">
              <CupUsdMoney cents={totals.totalCents} />
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Ticket medio (filtrado)
            </p>
            <div className="mt-1 text-2xl font-bold text-tl-ink">
              <CupUsdMoney
                cents={
                  totals.tickets > 0
                    ? Math.round(totals.totalCents / totals.tickets)
                    : 0
                }
              />
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={sales}
          keyExtractor={(row) => row.id}
          searchable
          searchPlaceholder="Buscar por dispositivo, producto o método..."
          searchKeys={["deviceId", "searchText", "paymentMethod"]}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onVisibleRowsChange={setVisibleSales}
          emptyMessage="No hay ventas recientes"
          maxHeight="calc(100vh - 400px)"
          loading={loading}
          skeletonRows={10}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Total visible
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-tl-muted">
                  Unidades: <span className="tabular-nums text-tl-ink">{totals.units}</span>
                </span>
                <span className="text-tl-muted">
                  Importe: <span className="font-semibold text-tl-ink"><CupUsdMoney cents={totals.totalCents} /></span>
                </span>
              </div>
            </div>
          }
        />
      </div>
    </AdminShell>
  );
}
