"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, Boxes, ChevronRight, Package, Pencil, Trash2, X } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { formatCup, formatUsdCents, formatUsdFromCupCents } from "@/lib/money";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  priceUsdCents: number;
  unitsPerBox: number;
  wholesaleCupCents: number | null;
  costCents: number | null;
  supplierId: string | null;
  supplierName: string | null;
  stockQty: number;
  lowStockAt: number;
  active: boolean;
  deletedAt?: string | null;
};

type SupplierOption = {
  id: string;
  name: string;
  active: boolean;
  productCount: number;
};

type ApiProductJson = ProductRow & {
  supplier?: { id: string; name: string } | null;
};

function normalizeProductRow(p: ApiProductJson): ProductRow {
  const fromRel = p.supplier?.name ?? null;
  return {
    ...p,
    supplierId: p.supplierId ?? p.supplier?.id ?? null,
    supplierName: fromRel ?? p.supplierName ?? null,
  };
}

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

function pluralEs(n: number, singular: string, plural: string) {
  return n === 1 ? singular : plural;
}

function stockBoxesHint(stockQty: number, unitsPerBox: number) {
  const u = Math.max(1, Math.trunc(unitsPerBox) || 1);
  const s = Math.max(0, Math.trunc(stockQty) || 0);
  const boxes = Math.floor(s / u);
  const units = s % u;
  if (u <= 1) return null;
  return `${boxes} ${pluralEs(boxes, "caja", "cajas")} y ${units} ${pluralEs(units, "unidad", "unidades")} (${u} ud/caja)`;
}

function StockQtyWithHover({ row, tone }: { row: ProductRow; tone: "muted" | "ink" | "warning" }) {
  const hint = stockBoxesHint(row.stockQty, row.unitsPerBox ?? 1);
  const color =
    tone === "warning" ? "text-tl-warning" : tone === "ink" ? "text-tl-ink" : "text-tl-muted";
  return (
    <span
      className={cn(
        "relative inline-flex tabular-nums",
        hint ? "cursor-help underline decoration-dotted underline-offset-2" : "",
        color,
      )}
      title={hint ?? undefined}
    >
      {row.stockQty}
      {hint ? (
        <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 min-w-max translate-y-1 rounded-lg border border-tl-line bg-tl-canvas px-2 py-1 text-xs font-normal text-tl-ink shadow-sm opacity-0 invisible transition-[opacity,transform] duration-150 ease-out group-hover:visible group-hover:opacity-100 group-hover:translate-y-0">
          {hint}
        </span>
      ) : null}
    </span>
  );
}

export default function InventoryPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Alta (SKU lo asigna el servidor)
  const [formName, setFormName] = useState("");
  const [formPriceCup, setFormPriceCup] = useState("");
  const [formPriceUsd, setFormPriceUsd] = useState("");
  const [formUnitsBox, setFormUnitsBox] = useState("1");
  const [formWholesaleCup, setFormWholesaleCup] = useState("");
  const [formSupplierId, setFormSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [formStock, setFormStock] = useState("0");
  const [formLow, setFormLow] = useState("5");
  const [formCostCup, setFormCostCup] = useState("");
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
  const [eSupplierId, setESupplierId] = useState("");
  const [eStock, setEStock] = useState("0");
  const [eLow, setELow] = useState("5");
  const [eCostCup, setECostCup] = useState("");
  const [eActive, setEActive] = useState(true);
  const [editWasDeleted, setEditWasDeleted] = useState(false);
  const [reactivateId, setReactivateId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [restoreDeletedId, setRestoreDeletedId] = useState<string | null>(null);

  const editPrevFocusRef = useRef<HTMLElement | null>(null);
  const editDialogRef = useRef<HTMLDivElement | null>(null);

  const closeEdit = useCallback(() => {
    setEditOpen(false);
  }, []);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/suppliers?includeInactive=1", { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as { suppliers?: SupplierOption[] };
      setSuppliers(json.suppliers ?? []);
    } catch {
      setSuppliers([]);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products?includeInactive=1&includeDeleted=1", { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as { products: ApiProductJson[] };
      setProducts((json.products ?? []).map(normalizeProductRow));
    } finally {
      setLoading(false);
    }
  }, []);

  const activeProducts = useMemo(
    () => products.filter((p) => p.active && !p.deletedAt),
    [products],
  );
  const inactiveProducts = useMemo(
    () => products.filter((p) => !p.active && !p.deletedAt),
    [products],
  );
  const deletedProducts = useMemo(() => products.filter((p) => !!p.deletedAt), [products]);

  const previewUnitGainCents = useMemo(() => {
    const p = parseMoneyToCents(formPriceCup);
    const c = parseMoneyToCents(formCostCup);
    if (p == null || c == null) return null;
    return p - c;
  }, [formPriceCup, formCostCup]);

  async function deleteProduct(p: ProductRow) {
    if (
      !window.confirm(
        `¿Archivar "${p.name}"?\n\nLas ventas e historial se conservan. Dejará de mostrarse en caja y el SKU se archivará para poder reutilizarlo.`,
      )
    ) {
      return;
    }
    setDeleteBusyId(p.id);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(p.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
        window.alert(
          j.error === "DATABASE_SCHEMA_MISMATCH"
            ? "Falta la columna de archivado en la base de datos. Ejecuta la migración (deletedAt en Product)."
            : "No se pudo archivar el producto.",
        );
        return;
      }
      await loadProducts();
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function restoreDeletedProduct(id: string) {
    setRestoreDeletedId(id);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (!res.ok) {
        window.alert("No se pudo restaurar el producto.");
        return;
      }
      await loadProducts();
    } finally {
      setRestoreDeletedId(null);
    }
  }

  async function reactivateProduct(id: string) {
    setReactivateId(id);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error === "NOT_FOUND" ? "Producto no encontrado." : "No se pudo reactivar.");
        return;
      }
      await loadProducts();
    } finally {
      setReactivateId(null);
    }
  }

  useEffect(() => {
    void loadProducts();
    void loadSuppliers();
  }, [loadProducts, loadSuppliers]);

  // Sin auto-refresh: evita refrescar mientras editas formularios.

  useEffect(() => {
    if (!editOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeEdit();
        return;
      }
      if (e.key === "Tab") {
        const root = editDialogRef.current;
        if (!root) return;
        const nodes = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null);
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
    }
    window.addEventListener("keydown", onKey);
    // Focus inicial al abrir
    window.setTimeout(() => {
      const root = editDialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }, 0);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeEdit, editOpen]);

  // Retorno de foco al cerrar el diálogo
  useEffect(() => {
    if (editOpen) return;
    editPrevFocusRef.current?.focus?.();
  }, [editOpen]);

  function openEdit(p: ProductRow) {
    editPrevFocusRef.current = document.activeElement as HTMLElement | null;
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
    setESupplierId(p.supplierId ?? "");
    setEStock(String(p.stockQty));
    setELow(String(p.lowStockAt));
    setECostCup(p.costCents != null ? centsToInput(p.costCents) : "");
    setEActive(p.active);
    setEditWasDeleted(!!p.deletedAt);
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
    const costCentsParsed =
      formCostCup.trim() === "" ? null : parseMoneyToCents(formCostCup);

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
    if (formCostCup.trim() === "" || costCentsParsed == null) {
      setFormMsg("Indica el precio de compra al proveedor (obligatorio).");
      setFormBusy(false);
      return;
    }
    if (!formSupplierId.trim()) {
      setFormMsg("Selecciona un proveedor del nomenclador (Administración → Proveedores → Nomenclador).");
      setFormBusy(false);
      return;
    }

    const res = await fetch("/api/products", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formName.trim(),
        priceCents,
        priceUsdCents,
        unitsPerBox,
        wholesaleCupCents,
        costCents: costCentsParsed,
        supplierId: formSupplierId.trim(),
        stockQty: parseInt(formStock, 10) || 0,
        lowStockAt: parseInt(formLow, 10) || 5,
      }),
    });

    setFormBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setFormMsg(
        j.error === "INVALID_BODY"
          ? "Revisa los datos (precio de proveedor obligatorio, importes válidos)."
          : j.error === "INVALID_SUPPLIER"
            ? "Proveedor no válido o inactivo. Actualiza el nomenclador en Proveedores."
            : "No se pudo crear el producto.",
      );
      return;
    }

    const created = (await res.json()) as { product?: { sku?: string } };
    const newSku = created.product?.sku;
    setFormMsg(
      newSku
        ? `Producto creado. SKU interno asignado: ${newSku}`
        : "Producto creado correctamente.",
    );
    setFormName("");
    setFormPriceCup("");
    setFormPriceUsd("");
    setFormUnitsBox("1");
    setFormWholesaleCup("");
    setFormCostCup("");
    setFormSupplierId("");
    setFormStock("0");
    setFormLow("5");
    void loadProducts();
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
    const costCentsParsed = eCostCup.trim() === "" ? null : parseMoneyToCents(eCostCup);

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
    if (eCostCup.trim() !== "" && costCentsParsed == null) {
      setEditMsg("Precio de compra al proveedor no válido.");
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
        costCents: costCentsParsed,
        supplierId: eSupplierId.trim() === "" ? null : eSupplierId.trim(),
        stockQty: parseInt(eStock, 10) || 0,
        lowStockAt: parseInt(eLow, 10) || 5,
        active: eActive,
      }),
    });

    setEditBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setEditMsg(
        res.status === 409
          ? "SKU duplicado u otro conflicto."
          : j.error === "INVALID_SUPPLIER"
            ? "Proveedor no válido o inactivo."
            : "No se pudo guardar el producto.",
      );
      return;
    }

    setEditOpen(false);
    void loadProducts();
  }

  const totalActive = activeProducts.length;
  const totalInactive = inactiveProducts.length;
  const totalDeleted = deletedProducts.length;
  const lowStockCount = activeProducts.filter((p) => p.stockQty <= p.lowStockAt).length;
  const totalValue = activeProducts.reduce((acc, p) => acc + p.priceCents * p.stockQty, 0);

  const supplierFilterOptions = useMemo(() => {
    const base = suppliers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        label: `${s.active ? "" : "(inactivo) "}${s.name}`,
        value: s.id,
      }));
    return [{ label: "(Sin proveedor)", value: "__none__" }, ...base];
  }, [suppliers]);

  const columns: Column<ProductRow>[] = [
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
      width: "120px",
      filter: {
        kind: "numberRange",
        placeholderMin: "CUP min",
        placeholderMax: "CUP max",
        getValue: (row) => row.priceCents / 100,
      },
      render: (row) => (
        <TablePriceCupCell cupCents={row.priceCents} explicitUsdCents={row.priceUsdCents} compact />
      ),
    },
    {
      key: "costCents",
      label: "Compra",
      sortable: true,
      align: "right",
      width: "96px",
      filter: {
        kind: "numberRange",
        placeholderMin: "CUP min",
        placeholderMax: "CUP max",
        getValue: (row) => (row.costCents == null ? null : row.costCents / 100),
      },
      render: (row) => (
        <span className="tabular-nums text-tl-muted">
          {row.costCents != null ? formatCup(row.costCents) : "—"}
        </span>
      ),
    },
    {
      key: "unitsPerBox",
      label: "Ud/caja",
      sortable: true,
      align: "right",
      width: "72px",
      render: (row) => (
        <span className="tabular-nums text-tl-muted">{row.unitsPerBox ?? 1}</span>
      ),
    },
    {
      key: "supplierName",
      label: "Proveedor",
      sortable: true,
      width: "140px",
      filter: {
        kind: "select",
        placeholder: "Todos",
        options: supplierFilterOptions,
        getValue: (row) => row.supplierId ?? "__none__",
      },
      sortValue: (row) => (row.supplierName ?? "").toLowerCase(),
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
      filter: {
        kind: "select",
        placeholder: "Todos",
        options: [
          { label: "Stock bajo", value: "low" },
          { label: "Suficiente", value: "ok" },
        ],
        getValue: (row) => (row.stockQty <= row.lowStockAt ? "low" : "ok"),
      },
      render: (row) => (
        <span className="group">
          <StockQtyWithHover
            row={row}
            tone={row.stockQty <= row.lowStockAt ? "warning" : "ink"}
          />
        </span>
      ),
    },
    {
      key: "id",
      label: "",
      width: "88px",
      align: "center",
      render: (row) => (
        <div className="flex justify-center gap-1">
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
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1 text-tl-warning"
            title="Archivar producto"
            aria-label={`Archivar ${row.name}`}
            disabled={deleteBusyId === row.id}
            onClick={(ev) => {
              ev.stopPropagation();
              void deleteProduct(row);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ),
    },
  ];

  const inactiveColumns: Column<ProductRow>[] = [
    {
      key: "name",
      label: "Nombre",
      sortable: true,
      render: (row) => <span className="font-medium text-tl-ink">{row.name}</span>,
    },
    {
      key: "priceCents",
      label: "PVP",
      sortable: true,
      align: "right",
      width: "120px",
      render: (row) => (
        <TablePriceCupCell cupCents={row.priceCents} explicitUsdCents={row.priceUsdCents} compact />
      ),
    },
    {
      key: "supplierName",
      label: "Proveedor",
      sortable: true,
      width: "140px",
      sortValue: (row) => (row.supplierName ?? "").toLowerCase(),
      render: (row) => <span className="text-tl-muted">{row.supplierName ?? "—"}</span>,
    },
    {
      key: "stockQty",
      label: "Stock",
      sortable: true,
      align: "right",
      width: "72px",
      render: (row) => (
        <span className="group">
          <StockQtyWithHover row={row} tone="muted" />
        </span>
      ),
    },
    {
      key: "id",
      label: "",
      width: "168px",
      align: "center",
      render: (row) => (
        <div className="flex flex-wrap justify-center gap-1">
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1"
            title="Editar"
            aria-label={`Editar ${row.name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              openEdit(row);
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1 text-tl-warning"
            title="Archivar"
            aria-label={`Archivar ${row.name}`}
            disabled={deleteBusyId === row.id}
            onClick={(ev) => {
              ev.stopPropagation();
              void deleteProduct(row);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-2 !py-1 text-xs"
            title="Volver a catálogo activo"
            disabled={reactivateId === row.id}
            onClick={(ev) => {
              ev.stopPropagation();
              void reactivateProduct(row.id);
            }}
          >
            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            {reactivateId === row.id ? "…" : "Reactivar"}
          </button>
        </div>
      ),
    },
  ];

  const deletedColumns: Column<ProductRow>[] = [
    {
      key: "name",
      label: "Nombre",
      sortable: true,
      render: (row) => <span className="font-medium text-tl-ink">{row.name}</span>,
    },
    {
      key: "sku",
      label: "SKU (archivado)",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs text-tl-muted" title={row.sku}>
          {row.sku}
        </span>
      ),
    },
    {
      key: "supplierName",
      label: "Proveedor",
      sortable: true,
      width: "140px",
      sortValue: (row) => (row.supplierName ?? "").toLowerCase(),
      render: (row) => <span className="text-tl-muted">{row.supplierName ?? "—"}</span>,
    },
    {
      key: "stockQty",
      label: "Stock",
      sortable: true,
      align: "right",
      width: "72px",
      render: (row) => (
        <span className="group">
          <StockQtyWithHover row={row} tone="muted" />
        </span>
      ),
    },
    {
      key: "id",
      label: "",
      width: "120px",
      align: "center",
      render: (row) => (
        <div className="flex flex-wrap justify-center gap-1">
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1"
            title="Ver o editar"
            onClick={(ev) => {
              ev.stopPropagation();
              openEdit(row);
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-2 !py-1 text-xs"
            title="Restaurar al catálogo (quita archivado)"
            disabled={restoreDeletedId === row.id}
            onClick={(ev) => {
              ev.stopPropagation();
              void restoreDeletedProduct(row.id);
            }}
          >
            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            {restoreDeletedId === row.id ? "…" : "Restaurar"}
          </button>
        </div>
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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-accent-subtle">
                <Boxes className="h-5 w-5 text-tl-accent" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Activos (catálogo)
                </p>
                <p className="text-xl font-bold tabular-nums text-tl-ink">{totalActive}</p>
              </div>
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-canvas-subtle ring-1 ring-tl-line">
                <ArchiveRestore className="h-5 w-5 text-tl-muted" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Inactivos
                </p>
                <p className="text-xl font-bold tabular-nums text-tl-ink">{totalInactive}</p>
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
                  Stock bajo (activos)
                </p>
                <p className="text-xl font-bold tabular-nums text-tl-ink">{lowStockCount}</p>
              </div>
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Valor inventario (activos)
            </p>
            <div className="mt-1 text-xl font-bold text-tl-ink">
              <CupUsdMoney cents={totalValue} />
            </div>
          </div>
          <div className="tl-glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-tl-warning/15 ring-1 ring-tl-warning/30">
                <Trash2 className="h-5 w-5 text-tl-warning" aria-hidden />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Archivados
                </p>
                <p className="text-xl font-bold tabular-nums text-tl-ink">{totalDeleted}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <DataTable
            columns={columns}
            data={activeProducts}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar por SKU o nombre..."
            searchKeys={["sku", "name"]}
            emptyMessage="No hay productos en el catálogo"
            fillHeight
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
              <div>
                <label className="text-xs text-tl-muted" htmlFor="np-cost">
                  Precio compra al proveedor (CUP / unidad)
                </label>
                <input
                  id="np-cost"
                  inputMode="decimal"
                  value={formCostCup}
                  onChange={(e) => setFormCostCup(e.target.value)}
                  placeholder="obligatorio"
                  className="tl-input mt-1"
                  required
                />
                <p className="mt-1 text-[11px] leading-snug text-tl-muted">
                  Coste real por unidad al proveedor. La ganancia de la tienda por unidad es PVP − este importe (se
                  refleja en Economía y en el dashboard).
                </p>
                {previewUnitGainCents != null ? (
                  <p className="mt-2 text-sm font-semibold text-tl-success">
                    Ganancia por unidad (estimada): {formatCup(previewUnitGainCents)}
                  </p>
                ) : null}
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
                  Proveedor (nomenclador)
                </label>
                <select
                  id="np-sup"
                  value={formSupplierId}
                  onChange={(e) => setFormSupplierId(e.target.value)}
                  className="tl-input mt-1"
                  required
                >
                  <option value="">— Seleccionar —</option>
                  {suppliers
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.productCount > 0 ? ` (${s.productCount} prod.)` : ""}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-[11px] text-tl-muted">
                  Alta y edición del listado en{" "}
                  <a href="/admin/proveedores" className="text-tl-accent underline-offset-2 hover:underline">
                    Proveedores → Nomenclador
                  </a>
                  .
                </p>
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
                    step={1}
                    value={formStock}
                    onChange={(e) => setFormStock(e.target.value)}
                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
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
                    step={1}
                    value={formLow}
                    onChange={(e) => setFormLow(e.target.value)}
                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
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

        <section className="space-y-3 border-t border-tl-line-subtle pt-8">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-tl-ink">Productos inactivos</h2>
              <p className="mt-1 max-w-2xl text-sm text-tl-muted">
                No aparecen en el catálogo de la APK ni en la tabla principal. Desde aquí puedes revisarlos,
                editarlos o reactivarlos para que vuelvan a sincronizar y mostrarse en caja.
              </p>
            </div>
          </div>
          <DataTable
            columns={inactiveColumns}
            data={inactiveProducts}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar inactivos por SKU o nombre…"
            searchKeys={["sku", "name"]}
            emptyMessage="No hay productos inactivos"
            maxHeight="min(420px, 50vh)"
            loading={loading}
            skeletonRows={6}
          />
        </section>

        <section className="space-y-3 border-t border-tl-line-subtle pt-8">
          <div>
            <h2 className="text-lg font-semibold text-tl-ink">Productos archivados</h2>
            <p className="mt-1 max-w-2xl text-sm text-tl-muted">
              No se borran las ventas ni el historial: siguen enlazadas a esta fila. El SKU se renombra para liberar el
              código. Desde aquí puedes restaurar el producto o seguir editándolo antes de reactivarlo.
            </p>
          </div>
          <DataTable
            columns={deletedColumns}
            data={deletedProducts}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar archivados por nombre o SKU…"
            searchKeys={["sku", "name"]}
            emptyMessage="No hay productos archivados"
            maxHeight="min(360px, 45vh)"
            loading={loading}
            skeletonRows={5}
          />
        </section>
      </div>

      {editOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-product-title"
          onClick={closeEdit}
        >
          <div
            className="tl-glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 shadow-xl"
            ref={editDialogRef}
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
                onClick={closeEdit}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <form onSubmit={onSaveEdit} className="mt-4 space-y-3">
              {editWasDeleted ? (
                <p className="rounded-lg border border-tl-warning/25 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
                  Este producto está archivado: no aparece en caja. Las ventas pasadas se conservan. Puedes restaurarlo
                  desde la tabla de archivados o con el botón de abajo.
                </p>
              ) : null}
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
              <div>
                <label className="text-xs text-tl-muted" htmlFor="ed-cost">
                  Precio compra al proveedor (CUP / unidad)
                </label>
                <input
                  id="ed-cost"
                  inputMode="decimal"
                  value={eCostCup}
                  onChange={(e) => setECostCup(e.target.value)}
                  placeholder="vacío = sin coste en márgenes"
                  className="tl-input mt-1"
                />
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
                  Proveedor (nomenclador)
                </label>
                <select
                  id="ed-sup"
                  value={eSupplierId}
                  onChange={(e) => setESupplierId(e.target.value)}
                  className="tl-input mt-1"
                >
                  <option value="">— Sin proveedor —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.active && eSupplierId !== s.id}>
                      {s.active ? "" : "(inactivo) "}
                      {s.name}
                    </option>
                  ))}
                </select>
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
                  step={1}
                    value={eStock}
                    onChange={(e) => setEStock(e.target.value)}
                  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
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
                  step={1}
                    value={eLow}
                    onChange={(e) => setELow(e.target.value)}
                  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
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
                {editWasDeleted && editId ? (
                  <button
                    type="button"
                    disabled={editBusy}
                    className="tl-btn tl-btn-secondary flex-1"
                    onClick={async () => {
                      setEditBusy(true);
                      setEditMsg(null);
                      const res = await fetch(`/api/products/${encodeURIComponent(editId)}`, {
                        method: "PATCH",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ restore: true }),
                      });
                      setEditBusy(false);
                      if (!res.ok) {
                        setEditMsg("No se pudo restaurar.");
                        return;
                      }
                      setEditOpen(false);
                      void loadProducts();
                    }}
                  >
                    Restaurar (quitar archivo)
                  </button>
                ) : null}
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
