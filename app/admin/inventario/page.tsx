"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, ChevronRight, Package, Pencil, X } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { formatCup, formatCupAndUsdLabel, formatUsdCents, formatUsdFromCupCents } from "@/lib/money";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  priceUsdCents: number;
  unitsPerBox: number;
  wholesaleCupCents: number | null;
  costCents: number | null;
  supplierName: string | null;
  stockQty: number;
  lowStockAt: number;
  active: boolean;
};

function parseMoneyToCents(s: string): number | null {
  const t = s.replace(",", ".").trim();
  if (t === "") return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export default function InventoryPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Alta
  const [formSku, setFormSku] = useState("");
  const [formName, setFormName] = useState("");
  const [formPriceCup, setFormPriceCup] = useState("");
  const [formPriceUsd, setFormPriceUsd] = useState("");
  const [formUnitsBox, setFormUnitsBox] = useState("1");
  const [formWholesaleCup, setFormWholesaleCup] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formStock, setFormStock] = useState("0");
  const [formLow, setFormLow] = useState("5");
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  // Edición (modal)
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [eSku, setESku] = useState("");
  const [eName, setEName] = useState("");
  const [ePriceCup, setEPriceCup] = useState("");
  const [ePriceUsd, setEPriceUsd] = useState("");
  const [eUnitsBox, setEUnitsBox] = useState("1");
  const [eWholesaleCup, setEWholesaleCup] = useState("");
  const [eSupplier, setESupplier] = useState("");
  const [eStock, setEStock] = useState("0");
  const [eLow, setELow] = useState("5");
  const [eActive, setEActive] = useState(true);

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

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    function handleRefresh() {
      void loadProducts();
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [loadProducts]);

  useEffect(() => {
    if (!editOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEditOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editOpen]);

  function openEdit(p: ProductRow) {
    setEditId(p.id);
    setESku(p.sku);
    setEName(p.name);
    setEPriceCup(centsToInput(p.priceCents));
    setEPriceUsd(
      p.priceUsdCents > 0
        ? (p.priceUsdCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
    setEUnitsBox(String(p.unitsPerBox ?? 1));
    setEWholesaleCup(
      p.wholesaleCupCents != null ? centsToInput(p.wholesaleCupCents) : "",
    );
    setESupplier(p.supplierName ?? "");
    setEStock(String(p.stockQty));
    setELow(String(p.lowStockAt));
    setEActive(p.active);
    setEditMsg(null);
    setEditOpen(true);
  }

  async function onCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormMsg(null);

    const priceCents = parseMoneyToCents(formPriceCup);
    const priceUsdCentsParsed =
      formPriceUsd.trim() === "" ? 0 : parseMoneyToCents(formPriceUsd);
    const priceUsdCents = priceUsdCentsParsed ?? -1;
    const wholesaleCupCents =
      formWholesaleCup.trim() === "" ? null : parseMoneyToCents(formWholesaleCup);
    const unitsPerBox = Math.max(1, parseInt(formUnitsBox, 10) || 1);

    if (priceCents == null || priceCents < 0) {
      setFormMsg("Precio en CUP no válido.");
      setFormBusy(false);
      return;
    }
    if (priceUsdCents < 0) {
      setFormMsg("Precio en USD no válido.");
      setFormBusy(false);
      return;
    }
    if (formWholesaleCup.trim() !== "" && wholesaleCupCents == null) {
      setFormMsg("Precio mayorista no válido.");
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
        priceUsdCents,
        unitsPerBox,
        wholesaleCupCents,
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
    setFormPriceCup("");
    setFormPriceUsd("");
    setFormUnitsBox("1");
    setFormWholesaleCup("");
    setFormSupplier("");
    setFormStock("0");
    setFormLow("5");
    void loadProducts();
    window.dispatchEvent(new Event("tl-refresh"));
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditBusy(true);
    setEditMsg(null);

    const priceCents = parseMoneyToCents(ePriceCup);
    const priceUsdCentsParsed =
      ePriceUsd.trim() === "" ? 0 : parseMoneyToCents(ePriceUsd);
    const priceUsdCents = priceUsdCentsParsed ?? -1;
    const wholesaleCupCents =
      eWholesaleCup.trim() === "" ? null : parseMoneyToCents(eWholesaleCup);
    const unitsPerBox = Math.max(1, parseInt(eUnitsBox, 10) || 1);

    if (priceCents == null || priceCents < 0) {
      setEditMsg("Precio en CUP no válido.");
      setEditBusy(false);
      return;
    }
    if (priceUsdCents < 0) {
      setEditMsg("Precio en USD no válido.");
      setEditBusy(false);
      return;
    }
    if (eWholesaleCup.trim() !== "" && wholesaleCupCents == null) {
      setEditMsg("Precio mayorista no válido.");
      setEditBusy(false);
      return;
    }

    const res = await fetch(`/api/products/${editId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: eSku.trim(),
        name: eName.trim(),
        priceCents,
        priceUsdCents,
        unitsPerBox,
        wholesaleCupCents,
        supplierName: eSupplier.trim() || null,
        stockQty: parseInt(eStock, 10) || 0,
        lowStockAt: parseInt(eLow, 10) || 5,
        active: eActive,
      }),
    });

    setEditBusy(false);
    if (!res.ok) {
      setEditMsg(
        res.status === 409
          ? "SKU duplicado u otro conflicto."
          : "No se pudo guardar el producto.",
      );
      return;
    }

    setEditOpen(false);
    void loadProducts();
    window.dispatchEvent(new Event("tl-refresh"));
  }

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
      key: "priceUsdCents",
      label: "PVP USD",
      sortable: true,
      align: "right",
      width: "100px",
      render: (row) => (
        <span className="tabular-nums text-tl-ink">
          {row.priceUsdCents > 0
            ? formatUsdCents(row.priceUsdCents)
            : formatUsdFromCupCents(row.priceCents)}
        </span>
      ),
    },
    {
      key: "priceCents",
      label: "PVP CUP",
      sortable: true,
      align: "right",
      width: "100px",
      render: (row) => (
        <span className="tabular-nums text-tl-ink">{formatCup(row.priceCents)}</span>
      ),
    },
    {
      key: "unitsPerBox",
      label: "Ud/caja",
      align: "right",
      width: "72px",
      render: (row) => (
        <span className="tabular-nums text-tl-muted">{row.unitsPerBox ?? 1}</span>
      ),
    },
    {
      key: "wholesaleCupCents",
      label: "Mayorista",
      align: "right",
      width: "100px",
      render: (row) => (
        <span className="tabular-nums text-tl-muted">
          {row.wholesaleCupCents != null ? formatCup(row.wholesaleCupCents) : "—"}
        </span>
      ),
    },
    {
      key: "supplierName",
      label: "Proveedor",
      width: "140px",
      render: (row) => (
        <span className="text-tl-muted">{row.supplierName ?? "—"}</span>
      ),
    },
    {
      key: "stockQty",
      label: "Stock",
      sortable: true,
      align: "right",
      width: "72px",
      render: (row) => (
        <span
          className={cn(
            "tabular-nums font-medium",
            row.stockQty <= row.lowStockAt ? "text-tl-warning" : "text-tl-ink",
          )}
        >
          {row.stockQty}
        </span>
      ),
    },
    {
      key: "id",
      label: "",
      width: "52px",
      align: "center",
      render: (row) => (
        <button
          type="button"
          className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1"
          title="Editar producto"
          aria-label={`Editar ${row.name}`}
          onClick={(ev) => {
            ev.stopPropagation();
            openEdit(row);
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      ),
    },
  ];

  return (
    <AdminShell title="Inventario">
      <div className="space-y-6">
        <div>
          <h1 className="tl-welcome-header">Inventario</h1>
          <p className="mt-1 text-sm text-tl-muted">
            Gestión de productos y control de stock
          </p>
        </div>

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
            <p className="mt-1 text-xl font-bold tabular-nums text-tl-ink">
              {formatCupAndUsdLabel(totalValue)}
            </p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <DataTable
            columns={columns}
            data={products}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar por SKU o nombre..."
            searchKeys={["sku", "name"]}
            emptyMessage="No hay productos en el catálogo"
            maxHeight="calc(100vh - 340px)"
            loading={loading}
            skeletonRows={12}
          />

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
                  Nombre del producto
                </label>
                <input
                  id="np-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="tl-input mt-1"
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-cup">
                    Precio PVP (CUP)
                  </label>
                  <input
                    id="np-cup"
                    inputMode="decimal"
                    value={formPriceCup}
                    onChange={(e) => setFormPriceCup(e.target.value)}
                    placeholder="250,00"
                    className="tl-input mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-usd">
                    Precio PVP (USD)
                  </label>
                  <input
                    id="np-usd"
                    inputMode="decimal"
                    value={formPriceUsd}
                    onChange={(e) => setFormPriceUsd(e.target.value)}
                    placeholder="1,00 (opcional)"
                    className="tl-input mt-1"
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-box">
                    Unidades por caja
                  </label>
                  <input
                    id="np-box"
                    type="number"
                    min={1}
                    value={formUnitsBox}
                    onChange={(e) => setFormUnitsBox(e.target.value)}
                    className="tl-input mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-wh">
                    Precio mayorista (CUP)
                  </label>
                  <input
                    id="np-wh"
                    inputMode="decimal"
                    value={formWholesaleCup}
                    onChange={(e) => setFormWholesaleCup(e.target.value)}
                    placeholder="opcional"
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
              <div className="grid gap-2 sm:grid-cols-2">
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
                    formMsg.includes("correctamente") ? "text-tl-success" : "text-tl-warning",
                  )}
                >
                  {formMsg}
                </p>
              )}
              <button type="submit" disabled={formBusy} className="tl-btn-primary w-full">
                {formBusy ? "Guardando..." : "Crear producto"}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </div>

      {editOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-product-title"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="tl-glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="edit-product-title" className="text-lg font-semibold text-tl-ink">
                Editar producto
              </h2>
              <button
                type="button"
                className="tl-btn tl-btn-secondary !p-2"
                aria-label="Cerrar"
                onClick={() => setEditOpen(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <form onSubmit={onSaveEdit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-tl-muted" htmlFor="ed-sku">
                  SKU
                </label>
                <input
                  id="ed-sku"
                  value={eSku}
                  onChange={(e) => setESku(e.target.value)}
                  className="tl-input mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-tl-muted" htmlFor="ed-name">
                  Nombre
                </label>
                <input
                  id="ed-name"
                  value={eName}
                  onChange={(e) => setEName(e.target.value)}
                  className="tl-input mt-1"
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-cup">
                    PVP (CUP)
                  </label>
                  <input
                    id="ed-cup"
                    inputMode="decimal"
                    value={ePriceCup}
                    onChange={(e) => setEPriceCup(e.target.value)}
                    className="tl-input mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-usd">
                    PVP (USD)
                  </label>
                  <input
                    id="ed-usd"
                    inputMode="decimal"
                    value={ePriceUsd}
                    onChange={(e) => setEPriceUsd(e.target.value)}
                    placeholder="opcional"
                    className="tl-input mt-1"
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-box">
                    Unidades por caja
                  </label>
                  <input
                    id="ed-box"
                    type="number"
                    min={1}
                    value={eUnitsBox}
                    onChange={(e) => setEUnitsBox(e.target.value)}
                    className="tl-input mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-wh">
                    Mayorista (CUP)
                  </label>
                  <input
                    id="ed-wh"
                    inputMode="decimal"
                    value={eWholesaleCup}
                    onChange={(e) => setEWholesaleCup(e.target.value)}
                    placeholder="opcional"
                    className="tl-input mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-tl-muted" htmlFor="ed-sup">
                  Proveedor
                </label>
                <input
                  id="ed-sup"
                  value={eSupplier}
                  onChange={(e) => setESupplier(e.target.value)}
                  className="tl-input mt-1"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-st">
                    Stock
                  </label>
                  <input
                    id="ed-st"
                    type="number"
                    min={0}
                    value={eStock}
                    onChange={(e) => setEStock(e.target.value)}
                    className="tl-input mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-low">
                    Alerta stock
                  </label>
                  <input
                    id="ed-low"
                    type="number"
                    min={0}
                    value={eLow}
                    onChange={(e) => setELow(e.target.value)}
                    className="tl-input mt-1"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-tl-ink">
                <input
                  type="checkbox"
                  checked={eActive}
                  onChange={(e) => setEActive(e.target.checked)}
                  className="h-4 w-4 rounded border-tl-line"
                />
                Producto activo (visible en catálogo)
              </label>
              {editMsg && <p className="text-xs text-tl-warning">{editMsg}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" disabled={editBusy} className="tl-btn-primary flex-1">
                  {editBusy ? "Guardando..." : "Guardar cambios"}
                </button>
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary flex-1"
                  onClick={() => setEditOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
