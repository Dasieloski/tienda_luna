"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BoxesIcon as Boxes, SearchLucideIcon as Search, TruckIcon as Truck } from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { formatCup } from "@/lib/money";

type SupplierHit = { id: string; name: string; active: boolean; phone: string | null };
type ProductHit = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
  deletedAt: string | null;
  supplierName: string | null;
  priceCents: number;
  priceUsdCents: number;
  stockQty: number;
  lowStockAt: number;
};

function SearchPageClient() {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();
  const [loading, setLoading] = useState(false);
  const [dbAvailable, setDbAvailable] = useState(true);
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierHit[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!q) {
        setProducts([]);
        setSuppliers([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}&limit=30`, {
          credentials: "include",
        });
        const json = (await res.json().catch(() => null)) as any;
        if (cancelled) return;
        setDbAvailable(Boolean(json?.meta?.dbAvailable ?? true));
        setProducts((json?.products ?? []) as ProductHit[]);
        setSuppliers((json?.suppliers ?? []) as SupplierHit[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [q]);

  const productColumns = useMemo<Column<ProductHit>[]>(
    () => [
      {
        key: "name",
        label: "Producto",
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-tl-ink">{row.name}</p>
            <p className="truncate text-xs text-tl-muted">
              SKU: <span className="font-mono">{row.sku}</span>
              {row.supplierName ? ` · ${row.supplierName}` : ""}
            </p>
          </div>
        ),
        sortValue: (row) => row.name.toLowerCase(),
      },
      {
        key: "priceCents",
        label: "PVP (CUP)",
        sortable: true,
        align: "right",
        width: "120px",
        render: (row) => <span className="tabular-nums text-tl-ink">{formatCup(row.priceCents)}</span>,
      },
      {
        key: "stockQty",
        label: "Stock",
        sortable: true,
        align: "right",
        width: "90px",
        render: (row) => (
          <span className="tabular-nums text-tl-ink">
            {row.stockQty}
            <span className="text-tl-muted"> / {row.lowStockAt}</span>
          </span>
        ),
      },
      {
        key: "active",
        label: "Estado",
        sortable: true,
        width: "120px",
        render: (row) => (
          <span className="text-xs font-semibold text-tl-muted">
            {row.deletedAt ? "Archivado" : row.active ? "Activo" : "Inactivo"}
          </span>
        ),
        sortValue: (row) => (row.deletedAt ? 2 : row.active ? 0 : 1),
      },
    ],
    [],
  );

  const supplierColumns = useMemo<Column<SupplierHit>[]>(
    () => [
      {
        key: "name",
        label: "Proveedor",
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-tl-ink">{row.name}</p>
            <p className="truncate text-xs text-tl-muted">{row.phone ?? "—"}</p>
          </div>
        ),
        sortValue: (row) => row.name.toLowerCase(),
      },
      {
        key: "active",
        label: "Estado",
        sortable: true,
        width: "120px",
        render: (row) => (
          <span className="text-xs font-semibold text-tl-muted">{row.active ? "Activo" : "Inactivo"}</span>
        ),
        sortValue: (row) => (row.active ? 0 : 1),
      },
    ],
    [],
  );

  const title = q ? `Búsqueda: ${q}` : "Búsqueda";
  const empty = !q ? "Escribe algo arriba para buscar." : loading ? "Buscando…" : "Sin resultados.";

  return (
    <AdminShell title="Búsqueda">
      <div className="space-y-6">
        <div>
          <h1 className="tl-welcome-header">Búsqueda global</h1>
          <p className="mt-1 text-sm text-tl-muted">
            Escribe en el buscador del navbar (arriba). Aquí verás resultados por productos y proveedores.
          </p>
          {!dbAvailable ? (
            <p className="mt-2 text-xs text-tl-warning">
              La base de datos no está disponible en este entorno.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-tl-muted">
            <span className="inline-flex items-center gap-1 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-1">
              <Search className="h-3.5 w-3.5" aria-hidden /> {q ? "Consulta activa" : "Sin consulta"}
            </span>
            <Link
              href="/admin/inventario"
              className="inline-flex items-center gap-1 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-1 hover:bg-tl-canvas-subtle"
            >
              <Boxes className="h-3.5 w-3.5" aria-hidden /> Inventario
            </Link>
            <Link
              href="/admin/proveedores"
              className="inline-flex items-center gap-1 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-1 hover:bg-tl-canvas-subtle"
            >
              <Truck className="h-3.5 w-3.5" aria-hidden /> Proveedores
            </Link>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <DataTable
            title="Productos"
            description={q ? `Resultados para “${q}”.` : "Escribe una consulta en el buscador superior."}
            columns={productColumns}
            data={products}
            keyExtractor={(r) => r.id}
            searchable={false}
            emptyMessage={empty}
            fillHeight
            maxHeight="min(70vh, 720px)"
            loading={loading}
            skeletonRows={10}
            onRowClick={() => {
              // Navegación directa al módulo (edición específica se hace desde allí)
              window.location.href = "/admin/inventario";
            }}
            className="h-full"
          />

          <DataTable
            title="Proveedores"
            description={q ? `Resultados para “${q}”.` : "Escribe una consulta en el buscador superior."}
            columns={supplierColumns}
            data={suppliers}
            keyExtractor={(r) => r.id}
            searchable={false}
            emptyMessage={empty}
            fillHeight
            maxHeight="min(70vh, 720px)"
            loading={loading}
            skeletonRows={8}
            onRowClick={() => {
              window.location.href = "/admin/proveedores";
            }}
            className="h-full"
          />
        </div>
      </div>
    </AdminShell>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}

