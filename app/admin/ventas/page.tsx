"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export default function SalesPage() {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightNew, setHighlightNew] = useState(false);
  const topSaleRef = useRef<string | null>(null);

  const loadSales = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sales/recent?limit=30", { credentials: "include" });
      if (!res.ok) return;
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
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  // Sin auto-refresh: solo carga inicial (y el usuario puede recargar manualmente si lo desea).

  const columns: Column<RecentSale>[] = [
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
  ];

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

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Transacciones
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
              {sales.length}
            </p>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Total facturado
            </p>
            <div className="mt-1 text-2xl font-bold text-tl-ink">
              <CupUsdMoney cents={sales.reduce((acc, s) => acc + s.totalCents, 0)} />
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Ticket medio
            </p>
            <div className="mt-1 text-2xl font-bold text-tl-ink">
              <CupUsdMoney
                cents={
                  sales.length > 0
                    ? Math.round(sales.reduce((acc, s) => acc + s.totalCents, 0) / sales.length)
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
          emptyMessage="No hay ventas recientes"
          maxHeight="calc(100vh - 400px)"
          loading={loading}
          skeletonRows={10}
        />
      </div>
    </AdminShell>
  );
}
