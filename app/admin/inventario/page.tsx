"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestoreIcon as ArchiveRestore,
  BoxesIcon as Boxes,
  ChevronRightIcon as ChevronRight,
  FileDownIcon as FileDown,
  FileSpreadsheetIcon as FileSpreadsheet,
  FileTextIcon as FileText,
  MinusIcon as Minus,
  PackageIcon as Package,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  Trash2Icon as Trash2,
  XLucideIcon as X,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { formatCup } from "@/lib/money";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import {
  buildInventoryCsv,
  buildBulkPayload,
  diffInventory,
  parseInventoryCsv,
  type InventoryDiff,
  type ProductExportRow,
} from "@/lib/inventory-csv";
import { buildInventoryPdf } from "@/lib/inventory-pdf";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  transferPriceCents: number;
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
  const pX = p as unknown as { transferPriceCents?: number };
  return {
    ...p,
    transferPriceCents:
      typeof pX.transferPriceCents === "number" ? pX.transferPriceCents : p.priceCents,
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
  const toast = useToast();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<ProductRow | null>(null);

  // Importación CSV
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importDiffs, setImportDiffs] = useState<InventoryDiff[]>([]);
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());
  const [importMissing, setImportMissing] = useState<{ sku: string; rowIndex: number; name: string }[]>([]);
  const [importParseErrors, setImportParseErrors] = useState<{ rowIndex: number; message: string }[]>([]);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set([0]));

  // Alta (SKU lo asigna el servidor)
  const [formName, setFormName] = useState("");
  const [formPriceCup, setFormPriceCup] = useState("");
  const [formTransferPriceCup, setFormTransferPriceCup] = useState("");
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
  const [eTransferPriceCup, setETransferPriceCup] = useState("");
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

  // Entrada de stock (modal)
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryProduct, setEntryProduct] = useState<ProductRow | null>(null);
  const [entryMode, setEntryMode] = useState<"units" | "boxes">("units");
  const [entryQty, setEntryQty] = useState("");
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryMsg, setEntryMsg] = useState<string | null>(null);

  const entryPrevFocusRef = useRef<HTMLElement | null>(null);
  const entryDialogRef = useRef<HTMLDivElement | null>(null);

  // Merma / rebaja de stock (modal)
  const [mermaOpen, setMermaOpen] = useState(false);
  const [mermaProduct, setMermaProduct] = useState<ProductRow | null>(null);
  const [mermaMode, setMermaMode] = useState<"units" | "boxes">("units");
  const [mermaQty, setMermaQty] = useState("");
  const [mermaBusy, setMermaBusy] = useState(false);
  const [mermaMsg, setMermaMsg] = useState<string | null>(null);
  const [mermaReason, setMermaReason] = useState<"MERMA" | "ROTURA">("MERMA");

  const mermaPrevFocusRef = useRef<HTMLElement | null>(null);
  const mermaDialogRef = useRef<HTMLDivElement | null>(null);

  const closeEdit = useCallback(() => {
    setEditOpen(false);
  }, []);

  const closeEntry = useCallback(() => {
    setEntryOpen(false);
  }, []);

  function openEntry(p: ProductRow) {
    entryPrevFocusRef.current = document.activeElement as HTMLElement | null;
    setEntryProduct(p);
    setEntryMode("units");
    setEntryQty("");
    setEntryMsg(null);
    setEntryOpen(true);
  }

  function openMerma(p: ProductRow) {
    mermaPrevFocusRef.current = document.activeElement as HTMLElement | null;
    setMermaProduct(p);
    setMermaMode("units");
    setMermaQty("");
    setMermaReason("MERMA");
    setMermaMsg(null);
    setMermaOpen(true);
  }

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
    setConfirmDeleteProduct(p);
    setConfirmDeleteOpen(true);
    return;
  }

  async function confirmDeleteProductNow() {
    const p = confirmDeleteProduct;
    if (!p) return;
    setDeleteBusyId(p.id);
    try {
      const res = await fetch(`/api/admin/products/hard-delete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ productId: p.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
        toast.push({
          kind: "error",
          title: "No se pudo eliminar el producto",
          description:
            j.error === "DATABASE_SCHEMA_MISMATCH"
              ? "La BD no tiene las columnas necesarias para conservar historial por snapshot. Ejecuta migraciones o `npx prisma db push`."
              : j.hint ?? j.error ?? "Inténtalo de nuevo.",
        });
        return;
      }
      await loadProducts();
      toast.push({
        kind: "success",
        title: "Producto eliminado",
        description: "Se eliminó del catálogo (el historial se conserva por snapshot).",
      });
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
        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ restore: true }),
      });
      if (!res.ok) {
        toast.push({
          kind: "error",
          title: "No se pudo restaurar el producto",
          description: "Inténtalo de nuevo.",
        });
        return;
      }
      await loadProducts();
      toast.push({ kind: "success", title: "Producto restaurado" });
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
        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ active: true }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.push({
          kind: "error",
          title: j.error === "NOT_FOUND" ? "Producto no encontrado" : "No se pudo reactivar",
          description: j.error === "NOT_FOUND" ? "Es posible que haya sido eliminado." : "Inténtalo de nuevo.",
        });
        return;
      }
      await loadProducts();
      toast.push({ kind: "success", title: "Producto reactivado" });
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

  useEffect(() => {
    if (!entryOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeEntry();
        return;
      }
      if (e.key === "Tab") {
        const root = entryDialogRef.current;
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
    window.setTimeout(() => {
      const root = entryDialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }, 0);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeEntry, entryOpen]);

  useEffect(() => {
    if (entryOpen) return;
    entryPrevFocusRef.current?.focus?.();
  }, [entryOpen]);

  function openEdit(p: ProductRow) {
    editPrevFocusRef.current = document.activeElement as HTMLElement | null;
    setEditId(p.id);
    setESku(p.sku);
    setEName(p.name);
    setEPriceCup(centsToInput(p.priceCents));
    setETransferPriceCup(centsToInput(p.transferPriceCents ?? p.priceCents));
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
    const transferPriceCentsParsed =
      formTransferPriceCup.trim() === "" ? null : parseMoneyToCents(formTransferPriceCup);
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
    if (formTransferPriceCup.trim() !== "" && (transferPriceCentsParsed == null || transferPriceCentsParsed < 0)) {
      setFormMsg("Precio por transferencia no válido.");
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
        transferPriceCents: transferPriceCentsParsed ?? priceCents,
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
    setFormTransferPriceCup("");
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
    const transferPriceCentsParsed =
      eTransferPriceCup.trim() === "" ? null : parseMoneyToCents(eTransferPriceCup);
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
    if (eTransferPriceCup.trim() !== "" && (transferPriceCentsParsed == null || transferPriceCentsParsed < 0)) {
      setEditMsg("Precio por transferencia no válido.");
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
      headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
      body: JSON.stringify({
        sku: eSku.trim(),
        name: eName.trim(),
        priceCents,
        transferPriceCents: transferPriceCentsParsed ?? priceCents,
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

  async function onSaveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!entryProduct) return;
    setEntryBusy(true);
    setEntryMsg(null);

    const qty = parseInt(entryQty, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setEntryMsg("Por favor, introduce una cantidad válida mayor que cero.");
      setEntryBusy(false);
      return;
    }

    const factor = entryMode === "boxes" ? Math.max(1, entryProduct.unitsPerBox ?? 1) : 1;
    const addedUnits = qty * factor;
    const nextStock = entryProduct.stockQty + addedUnits;

    const res = await fetch(`/api/products/${encodeURIComponent(entryProduct.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
      body: JSON.stringify({
        stockQty: nextStock,
      }),
    });

    setEntryBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
      setEntryMsg(
        j.error === "RATE_LIMITED"
          ? "Demasiados ajustes de inventario. Inténtalo más tarde."
          : j.error === "MFA_REQUIRED"
            ? "Se requiere verificación de dos factores (2FA)."
            : j.hint ?? j.error ?? "No se pudo actualizar el stock del producto.",
      );
      return;
    }

    setEntryOpen(false);
    toast.push({
      kind: "success",
      title: "Entrada registrada",
      description: `Se añadieron ${addedUnits} unidades a "${entryProduct.name}".`,
    });
    void loadProducts();
  }

  async function onSaveMerma(e: React.FormEvent) {
    e.preventDefault();
    if (!mermaProduct) return;
    setMermaBusy(true);
    setMermaMsg(null);

    const qty = parseInt(mermaQty, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setMermaMsg("Por favor, introduce una cantidad válida mayor que cero.");
      setMermaBusy(false);
      return;
    }

    const factor = mermaMode === "boxes" ? Math.max(1, mermaProduct.unitsPerBox ?? 1) : 1;
    const removedUnits = qty * factor;

    if (removedUnits > mermaProduct.stockQty) {
      setMermaMsg("No puedes rebajar más unidades de las que hay en stock.");
      setMermaBusy(false);
      return;
    }

    const nextStock = mermaProduct.stockQty - removedUnits;

    const res = await fetch(`/api/products/${encodeURIComponent(mermaProduct.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
      body: JSON.stringify({
        stockQty: nextStock,
        reason: mermaReason,
      }),
    });

    setMermaBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
      setMermaMsg(
        j.error === "RATE_LIMITED"
          ? "Demasiados ajustes de inventario. Inténtalo más tarde."
          : j.error === "MFA_REQUIRED"
            ? "Se requiere verificación de dos factores (2FA)."
            : j.hint ?? j.error ?? "No se pudo actualizar el stock del producto.",
      );
      return;
    }

    setMermaOpen(false);
    toast.push({
      kind: "success",
      title: "Rebaja registrada",
      description: `Se rebajaron ${removedUnits} unidades de "${mermaProduct.name}" por ${mermaReason === "MERMA" ? "merma" : "rotura"}.`,
    });
    void loadProducts();
  }

  const totalActive = activeProducts.length;
  const totalInactive = inactiveProducts.length;
  const totalDeleted = deletedProducts.length;
  const lowStockCount = activeProducts.filter((p) => p.stockQty <= p.lowStockAt).length;
  const totalValue = activeProducts.reduce((acc, p) => acc + p.priceCents * p.stockQty, 0);

  function toExportRow(p: ProductRow): ProductExportRow {
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      priceCents: p.priceCents,
      transferPriceCents: p.transferPriceCents ?? p.priceCents,
      priceUsdCents: p.priceUsdCents ?? 0,
      costCents: p.costCents,
      unitsPerBox: p.unitsPerBox ?? 1,
      wholesaleCupCents: p.wholesaleCupCents,
      stockQty: p.stockQty,
      lowStockAt: p.lowStockAt,
      supplierId: p.supplierId,
      supplierName: p.supplierName,
      active: p.active,
    };
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function timestampSlug() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function handleExportCsv() {
    const exportRows = activeProducts.map(toExportRow);
    if (exportRows.length === 0) {
      toast.push({ kind: "warning", title: "Sin productos para exportar" });
      return;
    }
    const csv = buildInventoryCsv(exportRows);
    // BOM para que Excel detecte UTF-8.
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `inventario-${timestampSlug()}.csv`);
    toast.push({
      kind: "success",
      title: "CSV generado",
      description: `${exportRows.length} productos exportados.`,
    });
  }

  function handleExportPdf() {
    const exportRows = activeProducts.map(toExportRow);
    if (exportRows.length === 0) {
      toast.push({ kind: "warning", title: "Sin productos para exportar" });
      return;
    }
    try {
      const blob = buildInventoryPdf(exportRows);
      downloadBlob(blob, `inventario-${timestampSlug()}.pdf`);
      toast.push({
        kind: "success",
        title: "PDF generado",
        description: `${exportRows.length} productos exportados.`,
      });
    } catch (e) {
      console.error("[inventario] export PDF", e);
      toast.push({
        kind: "error",
        title: "No se pudo generar el PDF",
        description: "Inténtalo de nuevo.",
      });
    }
  }

  function handleOpenImport() {
    csvFileInputRef.current?.click();
  }

  function handleCsvFileChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes("csv") && !file.type.includes("text")) {
      toast.push({
        kind: "warning",
        title: "Formato no reconocido",
        description: "El archivo debe ser CSV. Se intentará procesar igualmente.",
      });
    }
    const reader = new FileReader();
    reader.onerror = () => {
      toast.push({ kind: "error", title: "No se pudo leer el archivo" });
    };
    reader.onload = () => {
      const text = String(reader.result ?? "");
      try {
        const parsed = parseInventoryCsv(text);
        const currentRows = activeProducts.map(toExportRow);
        const supplierNames = new Set(suppliers.map((s) => s.name));
        const { diffs, missing, parseErrors } = diffInventory(
          currentRows,
          parsed,
          supplierNames,
        );
        setImportDiffs(diffs);
        setImportMissing(missing);
        setImportParseErrors(parseErrors);
        setImportFileName(file.name);
        const allIndexes = new Set(diffs.map((_, i) => i));
        setImportSelected(allIndexes);
        setExpandedDiffs(new Set(diffs.length > 0 ? [0] : []));
        setImportOpen(true);
        if (diffs.length === 0 && missing.length === 0 && parseErrors.length === 0) {
          toast.push({
            kind: "info",
            title: "Sin cambios detectados",
            description: "El CSV no tiene diferencias frente al catálogo actual.",
          });
        } else if (parseErrors.length > 0) {
          toast.push({
            kind: "warning",
            title: `CSV con ${parseErrors.length} aviso(s)`,
            description: "Revisa los errores antes de aplicar.",
          });
        }
      } catch (e) {
        console.error("[inventario] parse CSV", e);
        toast.push({
          kind: "error",
          title: "No se pudo procesar el CSV",
          description: "Verifica el formato del archivo.",
        });
      }
    };
    reader.readAsText(file);
  }

  function toggleDiffSelected(index: number) {
    setImportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAllSelected() {
    setImportSelected((prev) => {
      const selectable = importDiffs
        .map((d, i) => (d.selectable ? i : -1))
        .filter((i) => i >= 0);
      const allSelected = selectable.length > 0 && selectable.every((i) => prev.has(i));
      if (allSelected) return new Set();
      return new Set(selectable);
    });
  }

  function toggleDiffExpanded(index: number) {
    setExpandedDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function closeImport() {
    if (importBusy) return;
    setImportOpen(false);
    setImportDiffs([]);
    setImportSelected(new Set());
    setImportMissing([]);
    setImportParseErrors([]);
    setImportFileName(null);
    setExpandedDiffs(new Set());
  }

  async function handleApplyImport() {
    if (importSelected.size === 0) {
      toast.push({ kind: "warning", title: "No hay cambios seleccionados" });
      return;
    }
    const updates = buildBulkPayload(importDiffs, importSelected);
    if (updates.length === 0) {
      toast.push({
        kind: "warning",
        title: "Los cambios seleccionados no son válidos",
        description: "Revisa los valores marcados con aviso.",
      });
      return;
    }
    setImportBusy(true);
    try {
      const res = await fetch("/api/admin/products/bulk-update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          hint?: string;
          message?: string;
        };
        toast.push({
          kind: "error",
          title: "No se pudieron aplicar los cambios",
          description:
            j.hint ??
            j.message ??
            (j.error === "PRODUCTS_NOT_FOUND"
              ? "Algunos productos ya no existen. Recarga la página."
              : j.error === "DATABASE_SCHEMA_MISMATCH"
                ? "La BD no soporta algunas columnas del CSV. Ejecuta migraciones."
                : "Inténtalo de nuevo."),
        });
        return;
      }
      const json = (await res.json()) as {
        productsUpdated: number;
        appliedCount: number;
      };
      toast.push({
        kind: "success",
        title: "Cambios aplicados",
        description: `${json.productsUpdated} productos actualizados (${json.appliedCount} campos).`,
      });
      closeImport();
      void loadProducts();
    } catch (e) {
      console.error("[inventario] bulk-update", e);
      toast.push({ kind: "error", title: "Error de red al aplicar cambios" });
    } finally {
      setImportBusy(false);
    }
  }


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
      label: "PVP (efectivo)",
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
      key: "transferPriceCents",
      label: "PVP (transfer)",
      sortable: true,
      align: "right",
      width: "132px",
      filter: {
        kind: "numberRange",
        placeholderMin: "CUP min",
        placeholderMax: "CUP max",
        getValue: (row) => (row.transferPriceCents ?? row.priceCents) / 100,
      },
      render: (row) => (
        <span className="tabular-nums text-tl-muted">
          {formatCup(row.transferPriceCents ?? row.priceCents)}
        </span>
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
      width: "120px",
      align: "center",
      render: (row) => (
        <div className="flex justify-center gap-1">
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1 text-tl-success"
            title="Dar entrada a stock"
            aria-label={`Dar entrada a ${row.name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              openEntry(row);
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-2 !py-1 text-tl-info"
            title="Rebajar por merma / rotura"
            aria-label={`Rebajar ${row.name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              openMerma(row);
            }}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
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
      label: "PVP (efectivo)",
      sortable: true,
      align: "right",
      width: "120px",
      render: (row) => (
        <TablePriceCupCell cupCents={row.priceCents} explicitUsdCents={row.priceUsdCents} compact />
      ),
    },
    {
      key: "transferPriceCents",
      label: "PVP (transfer)",
      sortable: true,
      align: "right",
      width: "132px",
      render: (row) => (
        <span className="tabular-nums text-tl-muted">{formatCup(row.transferPriceCents ?? row.priceCents)}</span>
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
            title="Catálogo"
            description="Busca por SKU o nombre. Click en una fila para editar."
            columns={columns}
            data={activeProducts}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar por SKU o nombre..."
            searchKeys={["sku", "name"]}
            emptyMessage="No hay productos que coincidan con tu búsqueda."
            fillHeight
            maxHeight="calc(100vh - 340px)"
            loading={loading}
            skeletonRows={12}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv,text/csv,application/vnd.ms-excel"
                  className="sr-only"
                  onChange={handleCsvFileChange}
                  aria-hidden
                  tabIndex={-1}
                />
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !h-9 !px-3 !py-0 text-xs"
                  onClick={handleExportPdf}
                  disabled={loading || activeProducts.length === 0}
                  title="Descargar PDF con nombre, precio de venta, precio de proveedor, proveedor y stock"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  PDF
                </button>
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !h-9 !px-3 !py-0 text-xs"
                  onClick={handleExportCsv}
                  disabled={loading || activeProducts.length === 0}
                  title="Descargar CSV con toda la información de la tabla"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                  CSV
                </button>
                <button
                  type="button"
                  className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !h-9 !px-3 !py-0 text-xs"
                  onClick={handleOpenImport}
                  disabled={loading}
                  title="Subir un CSV editado para aplicar cambios al catálogo"
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden />
                  Importar CSV
                </button>
              </div>
            }
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
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="np-cup">
                    Precio PVP (efectivo)
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
                  <label className="text-xs text-tl-muted" htmlFor="np-transfer">
                    Precio PVP (transferencia)
                  </label>
                  <input
                    id="np-transfer"
                    inputMode="decimal"
                    value={formTransferPriceCup}
                    onChange={(e) => setFormTransferPriceCup(e.target.value)}
                    placeholder="(por defecto = efectivo)"
                    className="tl-input mt-1"
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
            title="Productos inactivos"
            description="No aparecen en caja. Útil para reactivar o revisar."
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
            title="Archivados"
            description="Conservan historial. Puedes restaurar o editar antes de reactivar."
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
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ed-cup">
                    PVP (efectivo)
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
                  <label className="text-xs text-tl-muted" htmlFor="ed-transfer">
                    PVP (transferencia)
                  </label>
                  <input
                    id="ed-transfer"
                    inputMode="decimal"
                    value={eTransferPriceCup}
                    onChange={(e) => setETransferPriceCup(e.target.value)}
                    placeholder="(por defecto = efectivo)"
                    className="tl-input mt-1"
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
                        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
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

      {entryOpen && entryProduct && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="entry-product-title"
          onClick={closeEntry}
        >
          <div
            className="tl-glass max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150"
            ref={entryDialogRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="entry-product-title" className="text-lg font-semibold text-tl-ink">
                  Dar entrada a producto
                </h2>
                <p className="mt-1 text-xs text-tl-muted">
                  {entryProduct.name} &bull; <span className="font-mono">{entryProduct.sku}</span>
                </p>
              </div>
              <button
                type="button"
                className="tl-btn tl-btn-secondary !p-2"
                aria-label="Cerrar"
                onClick={closeEntry}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <form onSubmit={onSaveEntry} className="mt-6 space-y-5">
              {/* Selector de modo: Unidades o Cajas */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Modo de entrada
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={cn(
                      "tl-btn justify-center text-sm py-2.5 transition-all",
                      entryMode === "units"
                        ? "tl-btn-primary bg-tl-accent text-white shadow-sm"
                        : "tl-btn-secondary border-tl-line text-tl-ink hover:bg-tl-canvas-subtle"
                    )}
                    onClick={() => {
                      setEntryMode("units");
                      setEntryMsg(null);
                    }}
                  >
                    Unidades
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "tl-btn justify-center text-sm py-2.5 transition-all",
                      entryMode === "boxes"
                        ? "tl-btn-primary bg-tl-accent text-white shadow-sm"
                        : "tl-btn-secondary border-tl-line text-tl-ink hover:bg-tl-canvas-subtle"
                    )}
                    onClick={() => {
                      setEntryMode("boxes");
                      setEntryMsg(null);
                    }}
                  >
                    Cajas
                  </button>
                </div>
              </div>

              {/* Input de cantidad */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="en-qty">
                  {entryMode === "boxes" ? "Cantidad de cajas a agregar" : "Cantidad de unidades a agregar"}
                </label>
                <div className="relative mt-2">
                  <input
                    id="en-qty"
                    type="number"
                    min={1}
                    step={1}
                    value={entryQty}
                    onChange={(e) => {
                      setEntryQty(e.target.value);
                      setEntryMsg(null);
                    }}
                    placeholder="Ej. 5"
                    className="tl-input w-full pr-12 text-lg font-medium tabular-nums"
                    required
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-sm text-tl-muted font-medium">
                    {entryMode === "boxes" ? "cajas" : "uds"}
                  </div>
                </div>
              </div>

              {/* Información de la caja si aplica */}
              {entryMode === "boxes" && (
                <div className="rounded-xl border border-tl-accent/20 bg-tl-accent-subtle/30 p-3.5 text-xs text-tl-ink flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-tl-accent/10">
                    <Boxes className="h-3.5 w-3.5 text-tl-accent" aria-hidden />
                  </div>
                  <div>
                    <span className="font-semibold text-tl-accent">Información del producto:</span>
                    <p className="mt-0.5 text-tl-muted">
                      Este producto tiene definido <span className="font-semibold text-tl-ink">{Math.max(1, entryProduct.unitsPerBox ?? 1)} unidades</span> por caja.
                    </p>
                    {parseInt(entryQty, 10) > 0 && (
                      <p className="mt-1.5 font-medium text-tl-ink">
                        Equivale a: <span className="underline decoration-tl-accent decoration-2">{parseInt(entryQty, 10) * Math.max(1, entryProduct.unitsPerBox ?? 1)} unidades</span> agregadas.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Comparador visual de Stock */}
              <div className="rounded-xl border border-tl-line bg-tl-canvas-subtle p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-tl-muted">
                  Previsualización del Stock
                </span>
                <div className="mt-3 flex items-center justify-between text-center">
                  <div className="flex-1">
                    <div className="text-xs text-tl-muted">Actual</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
                      {entryProduct.stockQty}
                    </div>
                  </div>
                  
                  <div className="px-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-tl-success-subtle text-tl-success">
                      <Plus className="h-4 w-4" />
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="text-xs text-tl-muted">Añadiendo</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-tl-success">
                      {parseInt(entryQty, 10) > 0
                        ? (entryMode === "boxes"
                            ? parseInt(entryQty, 10) * Math.max(1, entryProduct.unitsPerBox ?? 1)
                            : parseInt(entryQty, 10))
                        : 0}
                    </div>
                  </div>

                  <div className="px-2">
                    <div className="text-tl-muted font-bold text-lg">&rarr;</div>
                  </div>

                  <div className="flex-1">
                    <div className="text-xs font-semibold text-tl-accent">Resultante</div>
                    <div className="mt-1 text-2xl font-black tabular-nums text-tl-accent">
                      {entryProduct.stockQty +
                        (parseInt(entryQty, 10) > 0
                          ? (entryMode === "boxes"
                              ? parseInt(entryQty, 10) * Math.max(1, entryProduct.unitsPerBox ?? 1)
                              : parseInt(entryQty, 10))
                          : 0)}
                    </div>
                  </div>
                </div>
              </div>

              {entryMsg && (
                <p className="text-xs font-medium text-tl-warning bg-tl-warning-subtle/50 px-3 py-2 rounded-lg border border-tl-warning/20">
                  {entryMsg}
                </p>
              )}

              {/* Botones de acción */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary flex-1 py-3 text-sm justify-center font-medium"
                  onClick={closeEntry}
                  disabled={entryBusy}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={entryBusy || !entryQty || parseInt(entryQty, 10) <= 0}
                  className="tl-btn-primary flex-1 py-3 text-sm justify-center font-medium shadow-sm shadow-tl-accent/25 hover:shadow-md transition-all"
                >
                  {entryBusy ? "Guardando..." : "Confirmar entrada"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mermaOpen && mermaProduct && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="merma-product-title"
          onClick={() => setMermaOpen(false)}
        >
          <div
            className="tl-glass max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150"
            ref={mermaDialogRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="merma-product-title" className="text-lg font-semibold text-tl-ink">
                  Rebajar por merma / rotura
                </h2>
                <p className="mt-1 text-xs text-tl-muted">
                  {mermaProduct.name} &bull; <span className="font-mono">{mermaProduct.sku}</span>
                </p>
              </div>
              <button
                type="button"
                className="tl-btn tl-btn-secondary !p-2"
                aria-label="Cerrar"
                onClick={() => setMermaOpen(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <form onSubmit={onSaveMerma} className="mt-6 space-y-5">
              {/* Selector de modo: Unidades o Cajas */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Modo de rebaja
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={cn(
                      "tl-btn justify-center text-sm py-2.5 transition-all",
                      mermaMode === "units"
                        ? "tl-btn-primary bg-tl-accent text-white shadow-sm"
                        : "tl-btn-secondary border-tl-line text-tl-ink hover:bg-tl-canvas-subtle",
                    )}
                    onClick={() => {
                      setMermaMode("units");
                      setMermaMsg(null);
                    }}
                  >
                    Unidades
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "tl-btn justify-center text-sm py-2.5 transition-all",
                      mermaMode === "boxes"
                        ? "tl-btn-primary bg-tl-accent text-white shadow-sm"
                        : "tl-btn-secondary border-tl-line text-tl-ink hover:bg-tl-canvas-subtle",
                    )}
                    onClick={() => {
                      setMermaMode("boxes");
                      setMermaMsg(null);
                    }}
                  >
                    Cajas
                  </button>
                </div>
              </div>

              {/* Selector de motivo */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Motivo de la rebaja
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={cn(
                      "tl-btn justify-center text-sm py-2.5 transition-all",
                      mermaReason === "MERMA"
                        ? "tl-btn-primary bg-tl-accent text-white shadow-sm"
                        : "tl-btn-secondary border-tl-line text-tl-ink hover:bg-tl-canvas-subtle",
                    )}
                    onClick={() => {
                      setMermaReason("MERMA");
                      setMermaMsg(null);
                    }}
                  >
                    Merma
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "tl-btn justify-center text-sm py-2.5 transition-all",
                      mermaReason === "ROTURA"
                        ? "tl-btn-primary bg-tl-accent text-white shadow-sm"
                        : "tl-btn-secondary border-tl-line text-tl-ink hover:bg-tl-canvas-subtle",
                    )}
                    onClick={() => {
                      setMermaReason("ROTURA");
                      setMermaMsg(null);
                    }}
                  >
                    Rotura
                  </button>
                </div>
              </div>

              {/* Input de cantidad */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted" htmlFor="mr-qty">
                  {mermaMode === "boxes" ? "Cantidad de cajas a rebajar" : "Cantidad de unidades a rebajar"}
                </label>
                <div className="relative mt-2">
                  <input
                    id="mr-qty"
                    type="number"
                    min={1}
                    step={1}
                    value={mermaQty}
                    onChange={(e) => {
                      setMermaQty(e.target.value);
                      setMermaMsg(null);
                    }}
                    placeholder="Ej. 3"
                    className="tl-input w-full pr-12 text-lg font-medium tabular-nums"
                    required
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-sm text-tl-muted font-medium">
                    {mermaMode === "boxes" ? "cajas" : "uds"}
                  </div>
                </div>
              </div>

              {/* Información de la caja si aplica */}
              {mermaMode === "boxes" && (
                <div className="rounded-xl border border-tl-info/20 bg-tl-info-subtle/30 p-3.5 text-xs text-tl-ink flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-tl-info/10">
                    <Boxes className="h-3.5 w-3.5 text-tl-info" aria-hidden />
                  </div>
                  <div>
                    <span className="font-semibold text-tl-info">Información del producto:</span>
                    <p className="mt-0.5 text-tl-muted">
                      Este producto tiene definido <span className="font-semibold text-tl-ink">{Math.max(1, mermaProduct.unitsPerBox ?? 1)} unidades</span> por caja.
                    </p>
                    {parseInt(mermaQty, 10) > 0 && (
                      <p className="mt-1.5 font-medium text-tl-ink">
                        Equivale a: <span className="underline decoration-tl-info decoration-2">{parseInt(mermaQty, 10) * Math.max(1, mermaProduct.unitsPerBox ?? 1)} unidades</span> rebajadas.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Comparador visual de Stock */}
              <div className="rounded-xl border border-tl-line bg-tl-canvas-subtle p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-tl-muted">
                  Previsualización del Stock
                </span>
                <div className="mt-3 flex items-center justify-between text-center">
                  <div className="flex-1">
                    <div className="text-xs text-tl-muted">Actual</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
                      {mermaProduct.stockQty}
                    </div>
                  </div>

                  <div className="px-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-tl-warning-subtle text-tl-warning">
                      <Minus className="h-4 w-4" />
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="text-xs text-tl-muted">Rebajando</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-tl-warning">
                      {parseInt(mermaQty, 10) > 0
                        ? (mermaMode === "boxes"
                            ? parseInt(mermaQty, 10) * Math.max(1, mermaProduct.unitsPerBox ?? 1)
                            : parseInt(mermaQty, 10))
                        : 0}
                    </div>
                  </div>

                  <div className="px-2">
                    <div className="text-tl-muted font-bold text-lg">&rarr;</div>
                  </div>

                  <div className="flex-1">
                    <div className="text-xs font-semibold text-tl-accent">Resultante</div>
                    <div className="mt-1 text-2xl font-black tabular-nums text-tl-accent">
                      {Math.max(
                        0,
                        mermaProduct.stockQty -
                          (parseInt(mermaQty, 10) > 0
                            ? (mermaMode === "boxes"
                                ? parseInt(mermaQty, 10) * Math.max(1, mermaProduct.unitsPerBox ?? 1)
                                : parseInt(mermaQty, 10))
                            : 0),
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {mermaMsg && (
                <p className="text-xs font-medium text-tl-warning bg-tl-warning-subtle/50 px-3 py-2 rounded-lg border border-tl-warning/20">
                  {mermaMsg}
                </p>
              )}

              {/* Botones de acción */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary flex-1 py-3 text-sm justify-center font-medium"
                  onClick={() => setMermaOpen(false)}
                  disabled={mermaBusy}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={mermaBusy || !mermaQty || parseInt(mermaQty, 10) <= 0}
                  className="tl-btn-primary flex-1 py-3 text-sm justify-center font-medium shadow-sm shadow-tl-info/25 hover:shadow-md transition-all"
                >
                  {mermaBusy ? "Guardando..." : "Confirmar rebaja"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Eliminar producto definitivamente"
        description={
          confirmDeleteProduct
            ? `Se borrará "${confirmDeleteProduct.name}" de la base de datos. El historial se conservará por snapshot (ventas/movimientos), pero el producto ya no existirá en catálogo.`
            : "Se borrará el producto de la base de datos."
        }
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusyId != null}
        onClose={() => {
          if (deleteBusyId != null) return;
          setConfirmDeleteOpen(false);
          setConfirmDeleteProduct(null);
        }}
        onConfirm={() => {
          void confirmDeleteProductNow().then(() => {
            setConfirmDeleteOpen(false);
            setConfirmDeleteProduct(null);
          });
        }}
      />

      {importOpen ? (
        <ImportCsvDialog
          fileName={importFileName}
          diffs={importDiffs}
          selected={importSelected}
          missing={importMissing}
          parseErrors={importParseErrors}
          expanded={expandedDiffs}
          busy={importBusy}
          onClose={closeImport}
          onToggleAll={toggleAllSelected}
          onToggleProduct={toggleDiffSelected}
          onToggleExpanded={toggleDiffExpanded}
          onApply={handleApplyImport}
        />
      ) : null}
    </AdminShell>
  );
}

type ImportCsvDialogProps = {
  fileName: string | null;
  diffs: InventoryDiff[];
  selected: Set<number>;
  missing: { sku: string; rowIndex: number; name: string }[];
  parseErrors: { rowIndex: number; message: string }[];
  expanded: Set<number>;
  busy: boolean;
  onClose: () => void;
  onToggleAll: () => void;
  onToggleProduct: (index: number) => void;
  onToggleExpanded: (index: number) => void;
  onApply: () => void;
};

function ImportCsvDialog({
  fileName,
  diffs,
  selected,
  missing,
  parseErrors,
  expanded,
  busy,
  onClose,
  onToggleAll,
  onToggleProduct,
  onToggleExpanded,
  onApply,
}: ImportCsvDialogProps) {
  const selectableCount = diffs.filter((d) => d.selectable).length;
  const allSelected = selectableCount > 0 && Array.from({ length: diffs.length }, (_, i) => i)
    .filter((i) => diffs[i]!.selectable)
    .every((i) => selected.has(i));
  const selectedChangesCount = diffs.reduce(
    (acc, d, i) => (selected.has(i) ? acc + d.changes.filter((c) => !c.warning).length : acc),
    0,
  );

  return (
    <Modal
      open
      title="Importar cambios desde CSV"
      description={
        fileName
          ? `Archivo: ${fileName}. Revisa los cambios y marca los que quieres aplicar.`
          : "Revisa los cambios y marca los que quieres aplicar."
      }
      onClose={onClose}
      closeOnOverlayClick={!busy}
      maxWidthClassName="max-w-3xl"
    >
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {parseErrors.length > 0 ? (
            <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-3 py-2.5 text-xs text-tl-warning">
              <p className="font-semibold">
                {parseErrors.length === 1
                  ? "1 aviso al leer el CSV"
                  : `${parseErrors.length} avisos al leer el CSV`}
              </p>
              <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                {parseErrors.slice(0, 5).map((e, i) => (
                  <li key={`${e.rowIndex}-${i}`}>
                    Fila {e.rowIndex}: {e.message}
                  </li>
                ))}
                {parseErrors.length > 5 ? (
                  <li>…y {parseErrors.length - 5} más.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {missing.length > 0 ? (
            <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-3 py-2.5 text-xs text-tl-warning">
              <p className="font-semibold">
                {missing.length === 1
                  ? "1 fila con SKU no encontrado en el catálogo (se ignora)"
                  : `${missing.length} filas con SKU no encontrado en el catálogo (se ignoran)`}
              </p>
              <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                {missing.slice(0, 5).map((m, i) => (
                  <li key={`${m.sku}-${i}`}>
                    Fila {m.rowIndex}: SKU <span className="font-mono">{m.sku}</span>
                    {m.name ? ` (${m.name})` : ""} no existe en el catálogo.
                  </li>
                ))}
                {missing.length > 5 ? <li>…y {missing.length - 5} más.</li> : null}
              </ul>
            </div>
          ) : null}

          {diffs.length === 0 ? (
            <div className="rounded-xl border border-tl-line bg-tl-canvas-inset px-3 py-6 text-center text-sm text-tl-muted">
              No se detectaron cambios entre el CSV y el catálogo actual.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-tl-muted">
                <div>
                  {diffs.length === 1
                    ? "1 producto con cambios"
                    : `${diffs.length} productos con cambios`}
                  {selectedChangesCount > 0 ? (
                    <span className="ml-2 font-semibold text-tl-ink">
                      · {selectedChangesCount} campos seleccionados
                    </span>
                  ) : null}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-tl-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-tl-line"
                    checked={allSelected}
                    onChange={onToggleAll}
                    disabled={selectableCount === 0}
                  />
                  Seleccionar todos los aplicables
                </label>
              </div>

              <ul className="space-y-2">
                {diffs.map((d, i) => {
                  const isSelected = selected.has(i);
                  const isExpanded = expanded.has(i);
                  const productSelectedChanges = isSelected
                    ? d.changes.filter((c) => !c.warning).length
                    : 0;
                  return (
                    <li
                      key={`${d.productId}-${i}`}
                      className={cn(
                        "rounded-xl border transition-colors",
                        isSelected
                          ? "border-tl-accent/30 bg-tl-accent-subtle/30"
                          : "border-tl-line bg-tl-canvas-inset",
                      )}
                    >
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-tl-line"
                          checked={isSelected}
                          onChange={() => onToggleProduct(i)}
                          disabled={!d.selectable}
                          aria-label={`Aplicar cambios a ${d.productName}`}
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 text-left"
                            onClick={() => onToggleExpanded(i)}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-tl-ink">
                                {d.productName}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] font-mono text-tl-muted">
                                {d.sku}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-tl-line bg-tl-canvas px-2 py-0.5 text-[11px] font-semibold text-tl-ink">
                                {d.changes.length === 1
                                  ? "1 cambio"
                                  : `${d.changes.length} cambios`}
                              </span>
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 text-tl-muted transition-transform",
                                  isExpanded && "rotate-90",
                                )}
                                aria-hidden
                              />
                            </div>
                          </button>
                          {!isExpanded && productSelectedChanges > 0 ? (
                            <p className="mt-1 text-[11px] text-tl-muted">
                              {productSelectedChanges} campo(s) listo(s) para aplicar.
                            </p>
                          ) : null}
                          {isExpanded ? (
                            <ul className="mt-2 space-y-1.5">
                              {d.changes.map((c, ci) => (
                                <li
                                  key={`${c.field}-${ci}`}
                                  className={cn(
                                    "rounded-lg border px-2.5 py-1.5 text-[12px]",
                                    c.warning
                                      ? "border-tl-warning/30 bg-tl-warning-subtle/50"
                                      : "border-tl-line bg-tl-canvas",
                                  )}
                                >
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-semibold text-tl-ink">{c.label}:</span>
                                    <span className="text-tl-muted line-through decoration-tl-danger/60 decoration-1">
                                      {c.before || "(vacío)"}
                                    </span>
                                    <span className="text-tl-muted">→</span>
                                    <span className="font-semibold text-tl-accent">
                                      {c.after || "(vacío)"}
                                    </span>
                                  </div>
                                  {c.warning ? (
                                    <p className="mt-1 text-[11px] text-tl-warning">{c.warning}</p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {!d.selectable ? (
                            <p className="mt-1 text-[11px] text-tl-warning">
                              Este producto tiene campos con valores no válidos. No se puede aplicar.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-tl-line pt-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="tl-btn-primary !px-4 !py-2 text-sm"
            onClick={onApply}
            disabled={busy || selectedChangesCount === 0}
          >
            {busy
              ? "Aplicando…"
              : selectedChangesCount === 0
                ? "Sin cambios para aplicar"
                : `Aplicar ${selectedChangesCount} cambio(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
