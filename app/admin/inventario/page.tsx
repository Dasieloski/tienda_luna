"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, ChevronRight, Package } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  costCents: number | null;
  supplierName: string | null;
  stockQty: number;
  lowStockAt: number;
  active: boolean;
};

function money(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default function InventoryPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formSku, setFormSku] = useState("");
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formStock, setFormStock] = useState("0");
  const [formLow, setFormLow] = useState("5");
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as { products: ProductRow[] };
      setProducts(json.products ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // Listen for refresh events
  useEffect(() => {
    function handleRefresh() {
      void loadProducts();
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [loadProducts]);

  async function onCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormMsg(null);

    const priceCents = Math.round(parseFloat(formPrice.replace(",", ".")) * 100);
    const costCents =
      formCost.trim() === "" ? undefined : Math.round(parseFloat(formCost.replace(",", ".")) * 100);

    if (Number.isNaN(priceCents) || priceCents < 0) {
      setFormMsg("Precio público no válido.");
      setFormBusy(false);
      return;
    }

    const res = await fetch("/api/products", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: formSku.trim(),
        name: formName.trim(),
        priceCents,
        costCents,
        supplierName: formSupplier.trim() || null,
        stockQty: parseInt(formStock, 10) || 0,
        lowStockAt: parseInt(formLow, 10) || 5,
      }),
    });

    setFormBusy(false);
    if (!res.ok) {
      setFormMsg("No se pudo crear (SKU duplicado o error de servidor).");
      return;
    }

    setFormMsg("Producto creado correctamente.");
    setFormSku("");
    setFormName("");
    setFormPrice("");
    setFormCost("");
    setFormSupplier("");
    setFormStock("0");
    setFormLow("5");
    void loadProducts();
  }

  // Stats
  const totalProducts = products.length;
  const lowStockCount = products.filter((p) => p.stockQty <= p.lowStockAt).length;
  const totalValue = products.reduce((acc, p) => acc + p.priceCents * p.stockQty, 0);

  const columns: Column<ProductRow>[] = [
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      width: "120px",
      render: (row) => (
        <span className="font-mono text-xs text-tl-accent">{row.sku}</span>
      ),
    },
    {
      key: "name",
      label: "Nombre",
      sortable: true,
      render: (row) => (
        <span className="font-medium text-tl-ink">{row.name}</span>
      ),
    },
    {
      key: "priceCents",
      label: "PVP",
      sortable: true,
      align: "right",
      width: "100px",
      render: (row) => (
        <span className="tabular-nums text-tl-ink">{money(row.priceCents)}</span>
      ),
    },
    {
      key: "supplierName",
      label: "Proveedor",
      width: "150px",
      render: (row) => (
        <span className="text-tl-muted">{row.supplierName ?? "—"}</span>
      ),
    },
    {
      key: "costCents",
      label: "Coste",
      align: "right",
      width: "100px",
      render: (row) => (
        <span className="tabular-nums text-tl-muted">
          {row.costCents != null ? money(row.costCents) : "—"}
        </span>
      ),
    },
    {
      key: "stockQty",
      label: "Stock",
      sortable: true,
      align: "right",
      width: "80px",
      render: (row) => (
        <span
          className={cn(
            "tabular-nums font-medium",
            row.stockQty <= row.lowStockAt ? "text-tl-warning" : "text-tl-ink"
          )}
        >
          {row.stockQty}
        </span>
      ),
    },
    {
      key: "lowStockAt",
      label: "Umbral",
      align: "right",
      width: "80px",
      render: (row) => (
        <span className="tabular-nums text-tl-muted">{row.lowStockAt}</span>
      ),
    },
  ];

  return (
    <AdminShell title="Inventario">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="tl-welcome-header">Inventario</h1>
          <p className="mt-1 text-sm text-tl-muted">
            Gestión de productos y control de stock
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-accent-subtle">
                <Boxes className="h-5 w-5 text-tl-accent" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Productos
                </p>
                <p className="text-xl font-bold tabular-nums text-tl-ink">{totalProducts}</p>
              </div>
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-warning-subtle">
                <Package className="h-5 w-5 text-tl-warning" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Stock bajo
                </p>
                <p className="text-xl font-bold tabular-nums text-tl-ink">{lowStockCount}</p>
              </div>
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Valor inventario
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-tl-ink">{money(totalValue)}</p>
          </div>
        </div>

        {/* Main content: Table + Form */}
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Products table */}
          {loading ? (
            <div className="tl-glass flex min-h-[400px] items-center justify-center rounded-xl">
              <div className="flex flex-col items-center gap-3">
                <Boxes className="h-8 w-8 text-tl-accent tl-pulse" aria-hidden />
                <p className="text-sm text-tl-muted">Cargando productos...</p>
              </div>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={products}
              keyExtractor={(row) => row.id}
              searchable
              searchPlaceholder="Buscar por SKU o nombre..."
              searchKeys={["sku", "name"]}
              emptyMessage="No hay productos en el catálogo"
              maxHeight="calc(100vh - 340px)"
            />
          )}

          {/* New product form */}
          <div className="h-fit tl-glass tl-gradient-border rounded-xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-tl-ink">
              <Package className="h-4 w-4 text-tl-accent" aria-hidden />
              Nuevo producto
            </h2>
            <form onSubmit={onCreateProduct} className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-tl-muted" htmlFor="np-sku">
                  SKU
                </label>
                <input
                  id="np-sku"
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value)}
                  className="tl-input mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-tl-muted" htmlFor="np-name">
                  Nombre
                </label>
                <input
                  id="np-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="tl-input mt-1"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-price">
                    PVP (EUR)
                  </label>
                  <input
                    id="np-price"
                    inputMode="decimal"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder="12,50"
                    className="tl-input mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-cost">
                    Coste prov.
                  </label>
                  <input
                    id="np-cost"
                    inputMode="decimal"
                    value={formCost}
                    onChange={(e) => setFormCost(e.target.value)}
                    placeholder="8,00"
                    className="tl-input mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-tl-muted" htmlFor="np-sup">
                  Proveedor
                </label>
                <input
                  id="np-sup"
                  value={formSupplier}
                  onChange={(e) => setFormSupplier(e.target.value)}
                  className="tl-input mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-st">
                    Stock inicial
                  </label>
                  <input
                    id="np-st"
                    type="number"
                    min={0}
                    value={formStock}
                    onChange={(e) => setFormStock(e.target.value)}
                    className="tl-input mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-low">
                    Alerta stock
                  </label>
                  <input
                    id="np-low"
                    type="number"
                    min={0}
                    value={formLow}
                    onChange={(e) => setFormLow(e.target.value)}
                    className="tl-input mt-1"
                  />
                </div>
              </div>
              {formMsg && (
                <p
                  className={cn(
                    "text-xs",
                    formMsg.includes("correctamente") ? "text-tl-success" : "text-tl-warning"
                  )}
                >
                  {formMsg}
                </p>
              )}
              <button
                type="submit"
                disabled={formBusy}
                className="tl-btn-primary w-full"
              >
                {formBusy ? "Guardando..." : "Crear producto"}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
