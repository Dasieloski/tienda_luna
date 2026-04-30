"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  BookMarked,
  Calendar,
  FileText,
  Layers,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Store,
  Trash2,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type SupplierRow = {
  supplier: string;
  products: number;
  units: number;
  revenueCents: number;
  profitCents: number;
  /** Coste proveedor × uds (estimación a pagar por mercancía vendida). */
  payableCents: number;
  linesMissingCost: number;
};

type SupplierTopProduct = {
  supplier: string;
  productId: string;
  name: string;
  sku: string;
  units: number;
  revenueCents: number;
};

type SuppliersResponse = {
  meta: { dbAvailable: boolean; message?: string };
  from: string | null;
  to: string | null;
  suppliers: SupplierRow[];
  topProducts: SupplierTopProduct[];
  totals?: {
    payableCents: number;
    revenueCents: number;
    units: number;
    linesMissingCost: number;
  };
};

type SupplierPayableDetailResponse = {
  meta: { dbAvailable: boolean; message?: string };
  range?: { from: string; to: string };
  supplierId?: string;
  totals: { units: number; revenueCents: number; payableCents: number; linesMissingCost: number } | null;
  rows: {
    productId: string;
    name: string;
    sku: string;
    units: number;
    unitPriceCents: number;
    costCents: number | null;
    revenueCents: number;
    payableCents: number;
    linesMissingCost: number;
  }[];
  note?: string;
};

type SupplierDebtResponse = {
  meta: { dbAvailable: boolean; message?: string };
  range: { from: string; to: string } | null;
  supplierId: string | null;
  suppliers: {
    supplierId: string | null;
    supplierName: string;
    window: {
      salesCostCents: number;
      salesRetailCents: number;
      paymentsCents: number;
      withdrawalsCostCents: number;
      withdrawalsRetailCents: number;
    };
    pendingCents: number;
  }[];
};

type SupplierPaymentsResponse = {
  meta: { dbAvailable: boolean; message?: string };
  range?: { from: string; to: string };
  supplierId?: string;
  payments: { id: string; amountCents: number; paidAt: string; method: string | null; note: string | null }[];
};

type MasterSupplier = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  productCount: number;
};

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export default function SuppliersPage() {
  const toast = useToast();
  const todayInput = useMemo(() => toInputDate(new Date()), []);
  const defaultAccountsRange = useMemo(() => {
    const t = new Date();
    const f = new Date(t);
    f.setDate(f.getDate() - 29);
    return { from: toInputDate(f), to: toInputDate(t) };
  }, []);

  const [pageTab, setPageTab] = useState<"ranking" | "maestro" | "cuentas">("ranking");
  const [mode, setMode] = useState<"days" | "range">("days");
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState(() => todayInput);
  const [to, setTo] = useState(() => todayInput);

  const [data, setData] = useState<SuppliersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [masters, setMasters] = useState<MasterSupplier[]>([]);
  const [mastersLoading, setMastersLoading] = useState(false);
  const [mastersErr, setMastersErr] = useState<string | null>(null);
  const [mName, setMName] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mNotes, setMNotes] = useState("");
  const [mBusy, setMBusy] = useState(false);
  const [editMaster, setEditMaster] = useState<MasterSupplier | null>(null);
  const [eMName, setEMName] = useState("");
  const [eMPhone, setEMPhone] = useState("");
  const [eMNotes, setEMNotes] = useState("");
  const [eMBusy, setEMBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteSupplier, setConfirmDeleteSupplier] = useState<MasterSupplier | null>(null);

  const [accountsFrom, setAccountsFrom] = useState(defaultAccountsRange.from);
  const [accountsTo, setAccountsTo] = useState(defaultAccountsRange.to);
  const [accountsData, setAccountsData] = useState<SuppliersResponse | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [debtData, setDebtData] = useState<SupplierDebtResponse | null>(null);
  const [debtLoading, setDebtLoading] = useState(false);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("Efectivo");
  const [payNote, setPayNote] = useState<string>("");
  const [payBusy, setPayBusy] = useState(false);
  const [paymentsData, setPaymentsData] = useState<SupplierPaymentsResponse | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [accountsQuery, setAccountsQuery] = useState("");

  const [detailSupplierId, setDetailSupplierId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<SupplierPayableDetailResponse | null>(null);

  const loadMasters = useCallback(async () => {
    setMastersLoading(true);
    setMastersErr(null);
    try {
      const res = await fetch("/api/admin/suppliers?includeInactive=1", { credentials: "include" });
      const json = (await res.json()) as {
        meta?: { dbAvailable?: boolean; message?: string };
        suppliers?: MasterSupplier[];
      };
      if (!res.ok || json.meta?.dbAvailable === false) {
        setMastersErr(json.meta?.message ?? "No se pudo cargar el nomenclador.");
        setMasters([]);
        return;
      }
      setMasters(json.suppliers ?? []);
    } catch (e) {
      setMastersErr(e instanceof Error ? e.message : "Error de red.");
      setMasters([]);
    } finally {
      setMastersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMasters();
  }, [loadMasters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (mode === "range") {
        params.set("from", from);
        params.set("to", to);
      } else {
        params.set("days", String(days));
      }
      const res = await fetch(`/api/admin/suppliers/summary?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as SuppliersResponse;
      setData(json);
      if (!res.ok || json.meta?.dbAvailable === false) {
        setError(json.meta?.message ?? "No se pudo cargar el resumen.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setLoading(false);
    }
  }, [mode, days, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const start = new Date(accountsFrom + "T12:00:00");
      const end = new Date(accountsTo + "T12:00:00");
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setAccountsError("Fechas no válidas.");
        setAccountsData(null);
        return;
      }
      if (start > end) {
        setAccountsError("La fecha inicial no puede ser posterior a la final.");
        setAccountsData(null);
        return;
      }
      const params = new URLSearchParams();
      params.set("from", accountsFrom);
      params.set("to", accountsTo);
      const res = await fetch(`/api/admin/suppliers/summary?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as SuppliersResponse;
      setAccountsData(json);
      if (!res.ok || json.meta?.dbAvailable === false) {
        setAccountsError(json.meta?.message ?? "No se pudo cargar las cuentas.");
      }
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : "Error de red.");
      setAccountsData(null);
    } finally {
      setAccountsLoading(false);
    }
  }, [accountsFrom, accountsTo]);

  const loadDebt = useCallback(async () => {
    setDebtLoading(true);
    setDebtError(null);
    try {
      const params = new URLSearchParams({ from: accountsFrom, to: accountsTo });
      if (detailSupplierId?.trim()) params.set("supplierId", detailSupplierId.trim());
      const res = await fetch(`/api/admin/suppliers/debt?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as SupplierDebtResponse;
      setDebtData(json);
      if (!res.ok) {
        const err = json && typeof (json as unknown as { error?: unknown }).error === "string" ? (json as unknown as { error: string }).error : null;
        setDebtError(err ?? "No se pudo cargar la deuda.");
      }
      else if (json.meta?.dbAvailable === false && json.meta?.message) setDebtError(json.meta.message);
    } catch (e) {
      setDebtError(e instanceof Error ? e.message : "Error de red al cargar la deuda.");
      setDebtData(null);
    } finally {
      setDebtLoading(false);
    }
  }, [accountsFrom, accountsTo, detailSupplierId]);

  const loadPayments = useCallback(async () => {
    if (!detailSupplierId?.trim()) return;
    setPaymentsLoading(true);
    setPaymentsError(null);
    try {
      const params = new URLSearchParams({ supplierId: detailSupplierId.trim(), from: accountsFrom, to: accountsTo });
      const res = await fetch(`/api/admin/suppliers/payments?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as SupplierPaymentsResponse;
      setPaymentsData(json);
      if (!res.ok) {
        const err = json && typeof (json as unknown as { error?: unknown }).error === "string" ? (json as unknown as { error: string }).error : null;
        setPaymentsError(err ?? "No se pudo cargar el historial.");
      }
    } catch (e) {
      setPaymentsError(e instanceof Error ? e.message : "Error de red al cargar pagos.");
      setPaymentsData(null);
    } finally {
      setPaymentsLoading(false);
    }
  }, [accountsFrom, accountsTo, detailSupplierId]);

  useEffect(() => {
    if (pageTab !== "cuentas") return;
    void loadAccounts();
  }, [pageTab, loadAccounts]);

  const periodDescription = useMemo(() => {
    if (mode === "days") {
      return `Últimos ${days} días · hasta ${fmtShortDate(new Date().toISOString())}`;
    }
    return `${fmtShortDate(from + "T12:00:00.000Z")} — ${fmtShortDate(to + "T12:00:00.000Z")}`;
  }, [mode, days, from, to]);

  const nomencladorActive = useMemo(() => masters.filter((m) => m.active).length, [masters]);
  const nomencladorTotal = masters.length;

  const suppliersFiltered = useMemo(() => {
    const list = data?.suppliers ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.supplier.toLowerCase().includes(q));
  }, [data, query]);

  const topByRevenue = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.revenueCents - a.revenueCents);
    return s[0] ?? null;
  }, [data]);

  const topByProfit = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.profitCents - a.profitCents);
    return s[0] ?? null;
  }, [data]);

  const topByProducts = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.products - a.products);
    return s[0] ?? null;
  }, [data]);

  const topByUnits = useMemo(() => {
    const s = (data?.suppliers ?? []).slice().sort((a, b) => b.units - a.units);
    return s[0] ?? null;
  }, [data]);

  const topProductsBySupplier = useMemo(() => {
    const m = new Map<string, SupplierTopProduct[]>();
    for (const p of data?.topProducts ?? []) {
      const arr = m.get(p.supplier) ?? [];
      arr.push(p);
      m.set(p.supplier, arr);
    }
    return m;
  }, [data]);

  const withSalesCount = data?.suppliers.length ?? 0;

  const accountsPeriodLabel = useMemo(
    () => `${fmtShortDate(accountsFrom + "T12:00:00.000Z")} — ${fmtShortDate(accountsTo + "T12:00:00.000Z")}`,
    [accountsFrom, accountsTo],
  );

  const accountsFiltered = useMemo(() => {
    const list = accountsData?.suppliers ?? [];
    const q = accountsQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.supplier.toLowerCase().includes(q));
  }, [accountsData, accountsQuery]);

  const accountsSorted = useMemo(() => {
    return [...accountsFiltered].sort((a, b) => b.payableCents - a.payableCents);
  }, [accountsFiltered]);

  const detailSupplier = useMemo(() => {
    const id = detailSupplierId.trim();
    if (!id) return null;
    return masters.find((m) => m.id === id) ?? null;
  }, [detailSupplierId, masters]);

  const accTopRevenue = useMemo(() => {
    const s = (accountsData?.suppliers ?? []).slice().sort((a, b) => b.revenueCents - a.revenueCents);
    return s[0] ?? null;
  }, [accountsData]);

  const accTopUnits = useMemo(() => {
    const s = (accountsData?.suppliers ?? []).slice().sort((a, b) => b.units - a.units);
    return s[0] ?? null;
  }, [accountsData]);

  const accTopProducts = useMemo(() => {
    const s = (accountsData?.suppliers ?? []).slice().sort((a, b) => b.products - a.products);
    return s[0] ?? null;
  }, [accountsData]);

  const accTopPayable = useMemo(() => {
    const s = (accountsData?.suppliers ?? []).slice().sort((a, b) => b.payableCents - a.payableCents);
    return s[0] ?? null;
  }, [accountsData]);

  async function onCreateMaster(e: React.FormEvent) {
    e.preventDefault();
    const name = mName.trim();
    if (!name) return;
    setMBusy(true);
    setMastersErr(null);
    try {
      const res = await fetch("/api/admin/suppliers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          name,
          phone: mPhone.trim() || null,
          notes: mNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        setMastersErr(res.status === 409 ? "Ya existe un proveedor con ese nombre." : "No se pudo crear.");
        return;
      }
      setMName("");
      setMPhone("");
      setMNotes("");
      await loadMasters();
    } finally {
      setMBusy(false);
    }
  }

  const openEditMaster = useCallback((s: MasterSupplier) => {
    setEditMaster(s);
    setEMName(s.name);
    setEMPhone(s.phone ?? "");
    setEMNotes(s.notes ?? "");
  }, []);

  async function onSaveEditMaster(e: React.FormEvent) {
    e.preventDefault();
    if (!editMaster) return;
    const name = eMName.trim();
    if (!name) return;
    setEMBusy(true);
    try {
      const res = await fetch(`/api/admin/suppliers/${encodeURIComponent(editMaster.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          name,
          phone: eMPhone.trim() || null,
          notes: eMNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        setMastersErr(res.status === 409 ? "Nombre duplicado." : "No se pudo guardar.");
        return;
      }
      setEditMaster(null);
      await loadMasters();
    } finally {
      setEMBusy(false);
    }
  }

  const toggleMasterActive = useCallback(async (s: MasterSupplier) => {
    setMastersErr(null);
    const res = await fetch(`/api/admin/suppliers/${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-tl-csrf": "1" },
      body: JSON.stringify({ active: !s.active }),
    });
    if (!res.ok) {
      setMastersErr("No se pudo cambiar el estado.");
      return;
    }
    await loadMasters();
  }, [loadMasters]);

  const onDeleteMaster = useCallback(async (s: MasterSupplier) => {
    setConfirmDeleteSupplier(s);
    setConfirmDeleteOpen(true);
    return;
  }, []);

  const confirmDeleteMasterNow = useCallback(async () => {
    const s = confirmDeleteSupplier;
    if (!s) return;
    setDeleteBusyId(s.id);
    setMastersErr(null);
    try {
      const res = await fetch(`/api/admin/suppliers/${encodeURIComponent(s.id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-tl-csrf": "1" },
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; productCount?: number };
      if (res.status === 409 && j.error === "SUPPLIER_IN_USE") {
        toast.push({
          kind: "warning",
          title: "Proveedor en uso",
          description: `Hay ${j.productCount ?? 0} producto(s) con este proveedor. Cambia el proveedor en Inventario antes.`,
          durationMs: 5200,
        });
        return;
      }
      if (!res.ok) {
        toast.push({ kind: "error", title: "No se pudo eliminar", description: "Inténtalo de nuevo." });
        return;
      }
      await loadMasters();
      toast.push({ kind: "success", title: "Proveedor eliminado" });
    } finally {
      setDeleteBusyId(null);
    }
  }, [confirmDeleteSupplier, loadMasters, toast]);

  const loadDetail = useCallback(async () => {
    const supplierId = detailSupplierId.trim();
    if (!supplierId) {
      setDetailErr("Selecciona un proveedor.");
      setDetailData(null);
      return;
    }

    setDetailLoading(true);
    setDetailErr(null);
    try {
      const params = new URLSearchParams();
      params.set("supplierId", supplierId);
      params.set("from", accountsFrom);
      params.set("to", accountsTo);
      const res = await fetch(`/api/admin/suppliers/payable-detail?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as SupplierPayableDetailResponse;
      setDetailData(json);
      if (!res.ok || json.meta?.dbAvailable === false) {
        setDetailErr(json.meta?.message ?? "No se pudo calcular el detalle del proveedor.");
      }
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : "Error de red.");
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  }, [accountsFrom, accountsTo, detailSupplierId]);

  const masterColumns: Column<MasterSupplier>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Nombre",
        sortable: true,
        filter: { kind: "text", placeholder: "Filtrar por nombre…" },
        render: (row) => <span className="font-medium text-tl-ink">{row.name}</span>,
      },
      {
        key: "phone",
        label: "Teléfono",
        render: (row) => <span className="text-tl-muted">{row.phone ?? "—"}</span>,
      },
      {
        key: "productCount",
        label: "Productos",
        sortable: true,
        align: "right",
        width: "110px",
        filter: { kind: "numberRange" },
        render: (row) => (
          <span className="tabular-nums text-tl-ink">{row.productCount.toLocaleString("es-ES")}</span>
        ),
      },
      {
        key: "active",
        label: "Estado",
        width: "130px",
        filter: {
          kind: "select",
          options: [
            { label: "Activo", value: "true" },
            { label: "Inactivo", value: "false" },
          ],
          getValue: (row) => String(Boolean(row.active)),
        },
        render: (row) => (
          <button
            type="button"
            onClick={() => void toggleMasterActive(row)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              row.active
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-zinc-500/10 text-tl-muted",
            )}
          >
            {row.active ? "Activo" : "Inactivo"}
          </button>
        ),
      },
      {
        key: "id",
        label: "Acciones",
        align: "right",
        width: "140px",
        render: (row) => (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => openEditMaster(row)}
              className="tl-btn tl-btn-secondary inline-flex !px-2.5 !py-1.5"
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void onDeleteMaster(row)}
              disabled={deleteBusyId === row.id || row.productCount > 0}
              className="tl-btn tl-btn-secondary inline-flex !px-2.5 !py-1.5 disabled:opacity-40"
              title={row.productCount > 0 ? "Hay productos usando este proveedor" : "Eliminar"}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ),
      },
    ],
    [deleteBusyId, onDeleteMaster, openEditMaster, toggleMasterActive],
  );

  const accountsColumns: Column<SupplierRow>[] = useMemo(
    () => [
      {
        key: "supplier",
        label: "Proveedor",
        sortable: true,
        filter: { kind: "text", placeholder: "Filtrar proveedor…" },
        render: (row) => <span className="font-medium text-tl-ink">{row.supplier}</span>,
      },
      {
        key: "units",
        label: "Unidades",
        sortable: true,
        align: "right",
        width: "110px",
        filter: { kind: "numberRange" },
        render: (row) => <span className="tabular-nums text-tl-ink">{row.units.toLocaleString("es-ES")}</span>,
      },
      {
        key: "revenueCents",
        label: "Ingresos venta",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.revenueCents} compact />,
      },
      {
        key: "payableCents",
        label: "A pagar prov.",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => (
          <span className="font-medium text-amber-900 dark:text-amber-100/95">
            <TablePriceCupCell cupCents={row.payableCents ?? 0} compact />
          </span>
        ),
      },
      {
        key: "profitCents",
        label: "Ganancia est.",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.profitCents} compact />,
      },
      {
        key: "products",
        label: "Refs.",
        sortable: true,
        align: "right",
        width: "90px",
        filter: { kind: "numberRange" },
        render: (row) => <span className="tabular-nums text-tl-muted">{row.products.toLocaleString("es-ES")}</span>,
      },
      {
        key: "linesMissingCost",
        label: "Sin coste",
        sortable: true,
        align: "right",
        width: "110px",
        filter: { kind: "numberRange" },
        render: (row) => (
          <span className="tabular-nums text-tl-muted">
            {row.linesMissingCost > 0 ? row.linesMissingCost.toLocaleString("es-ES") : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const detailColumns: Column<SupplierPayableDetailResponse["rows"][number]>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Producto",
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-tl-ink">{row.name}</p>
            <p className="truncate text-xs text-tl-muted">{row.sku || "—"}</p>
          </div>
        ),
      },
      {
        key: "units",
        label: "Cant.",
        sortable: true,
        align: "right",
        width: "110px",
        render: (row) => <span className="tabular-nums text-tl-ink">{row.units.toLocaleString("es-ES")}</span>,
      },
      {
        key: "unitPriceCents",
        label: "Precio venta",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.unitPriceCents} compact />,
      },
      {
        key: "costCents",
        label: "Precio prov.",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) =>
          row.costCents == null ? (
            <span className="text-xs font-semibold text-tl-warning">Sin coste</span>
          ) : (
            <span className="text-amber-900 dark:text-amber-100/95">
              <TablePriceCupCell cupCents={row.costCents} compact />
            </span>
          ),
      },
      {
        key: "payableCents",
        label: "A pagar",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => (
          <span className="font-medium text-amber-900 dark:text-amber-100/95">
            <TablePriceCupCell cupCents={row.payableCents ?? 0} compact />
          </span>
        ),
      },
      {
        key: "revenueCents",
        label: "Ingreso",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.revenueCents} compact />,
      },
      {
        key: "linesMissingCost",
        label: "Sin coste",
        sortable: true,
        align: "right",
        width: "110px",
        render: (row) => (
          <span className="tabular-nums text-tl-muted">
            {row.linesMissingCost > 0 ? row.linesMissingCost.toLocaleString("es-ES") : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const rankingColumns: Column<SupplierRow>[] = useMemo(
    () => [
      {
        key: "supplier",
        label: "Proveedor",
        sortable: true,
        filter: { kind: "text", placeholder: "Filtrar proveedor…" },
        render: (row) => <span className="font-medium text-tl-ink">{row.supplier}</span>,
      },
      {
        key: "products",
        label: "Refs.",
        sortable: true,
        align: "right",
        width: "90px",
        filter: { kind: "numberRange" },
        render: (row) => <span className="tabular-nums text-tl-ink">{row.products.toLocaleString("es-ES")}</span>,
      },
      {
        key: "units",
        label: "Unidades",
        sortable: true,
        align: "right",
        width: "110px",
        filter: { kind: "numberRange" },
        render: (row) => <span className="tabular-nums text-tl-ink">{row.units.toLocaleString("es-ES")}</span>,
      },
      {
        key: "revenueCents",
        label: "Ingresos",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.revenueCents} compact />,
      },
      {
        key: "payableCents",
        label: "A pagar prov.",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.payableCents ?? 0} compact />,
      },
      {
        key: "profitCents",
        label: "Ganancia est.",
        sortable: true,
        align: "right",
        width: "140px",
        render: (row) => <TablePriceCupCell cupCents={row.profitCents} compact />,
      },
      {
        key: "linesMissingCost",
        label: "Sin coste",
        sortable: true,
        align: "right",
        width: "110px",
        filter: { kind: "numberRange" },
        render: (row) => (
          <span className="tabular-nums text-tl-muted">
            {row.linesMissingCost > 0 ? row.linesMissingCost.toLocaleString("es-ES") : "—"}
          </span>
        ),
      },
      {
        key: "tops",
        label: "Destacados",
        render: (row) => {
          const tops = topProductsBySupplier.get(row.supplier) ?? [];
          if (tops.length === 0) return <span className="text-xs text-tl-muted">—</span>;
          return (
            <ul className="space-y-1.5">
              {tops.map((p) => (
                <li
                  key={p.productId}
                  className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span className="min-w-0 truncate text-tl-ink">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-tl-muted">
                    {p.units} u. · <TablePriceCupCell cupCents={p.revenueCents} compact />
                  </span>
                </li>
              ))}
            </ul>
          );
        },
      },
    ],
    [topProductsBySupplier],
  );

  return (
    <AdminShell title="Proveedores">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Cabecera */}
        <section className="overflow-hidden rounded-2xl border border-tl-line-subtle bg-gradient-to-br from-tl-canvas-inset via-tl-canvas to-tl-canvas-inset/80 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="tl-welcome-header">Proveedores</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-tl-muted">
                {pageTab === "ranking"
                  ? "Compara ventas por origen de compra y revisa qué proveedor aporta más en el periodo que elijas."
                  : pageTab === "cuentas"
                    ? "Calcula cuánto pagar a cada proveedor según lo vendido y el precio de compra en el producto."
                    : "Administra la lista de proveedores: son los que podrás elegir al crear productos."}
              </p>
              {pageTab === "ranking" ? (
                <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-tl-accent/8 px-3 py-1.5 text-xs font-medium text-tl-ink-secondary">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-tl-accent" aria-hidden />
                  {periodDescription}
                </p>
              ) : pageTab === "cuentas" ? (
                <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-100/90">
                  <Wallet className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                  {accountsPeriodLabel}
                </p>
              ) : null}
            </div>

            <div
              className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center"
              role="tablist"
              aria-label="Sección"
            >
              <div className="flex flex-wrap gap-1 rounded-xl border border-tl-line-subtle bg-tl-canvas p-1 shadow-inner">
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageTab === "ranking"}
                  onClick={() => setPageTab("ranking")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:gap-2 sm:px-4 sm:text-sm",
                    pageTab === "ranking"
                      ? "bg-tl-accent text-tl-accent-fg shadow-sm"
                      : "text-tl-muted hover:text-tl-ink",
                  )}
                >
                  <Truck className="h-4 w-4 shrink-0" aria-hidden />
                  Ventas
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageTab === "cuentas"}
                  onClick={() => setPageTab("cuentas")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:gap-2 sm:px-4 sm:text-sm",
                    pageTab === "cuentas"
                      ? "bg-amber-500 text-white shadow-sm dark:bg-amber-600"
                      : "text-tl-muted hover:text-tl-ink",
                  )}
                >
                  <Wallet className="h-4 w-4 shrink-0" aria-hidden />
                  Cuentas
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageTab === "maestro"}
                  onClick={() => setPageTab("maestro")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:gap-2 sm:px-4 sm:text-sm",
                    pageTab === "maestro"
                      ? "bg-tl-accent text-tl-accent-fg shadow-sm"
                      : "text-tl-muted hover:text-tl-ink",
                  )}
                >
                  <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
                  Nomenclador
                </button>
              </div>
            </div>
          </div>
        </section>

        {pageTab === "maestro" ? (
          <>
            {mastersErr ? (
              <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {mastersErr}
              </div>
            ) : null}

            <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] to-tl-canvas-inset p-5 sm:p-6">
              <div className="flex items-center gap-3 border-b border-emerald-500/15 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
                  <Plus className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-tl-ink">Añadir proveedor</h2>
                  <p className="text-xs text-tl-muted">Nombre obligatorio · teléfono y notas opcionales</p>
                </div>
              </div>
              <form onSubmit={onCreateMaster} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
                <div className="sm:col-span-2 lg:col-span-5">
                  <label className="text-xs font-medium text-tl-muted" htmlFor="ms-name">
                    Nombre comercial
                  </label>
                  <input
                    id="ms-name"
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    className="tl-input mt-1.5 w-full"
                    placeholder="Ej. Distribuidora regional"
                    required
                  />
                </div>
                <div className="lg:col-span-3">
                  <label className="text-xs font-medium text-tl-muted" htmlFor="ms-phone">
                    Teléfono
                  </label>
                  <input
                    id="ms-phone"
                    value={mPhone}
                    onChange={(e) => setMPhone(e.target.value)}
                    className="tl-input mt-1.5 w-full"
                    placeholder="Opcional"
                    inputMode="tel"
                  />
                </div>
                <div className="lg:col-span-4">
                  <label className="text-xs font-medium text-tl-muted" htmlFor="ms-notes">
                    Notas internas
                  </label>
                  <input
                    id="ms-notes"
                    value={mNotes}
                    onChange={(e) => setMNotes(e.target.value)}
                    className="tl-input mt-1.5 w-full"
                    placeholder="Opcional"
                  />
                </div>
                <div className="flex items-end sm:col-span-2 lg:col-span-12">
                  <button type="submit" disabled={mBusy} className="tl-btn-primary w-full sm:w-auto">
                    {mBusy ? "Guardando…" : "Guardar en el nomenclador"}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-0 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-tl-line-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600">
                    <Layers className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-tl-ink">Listado</h2>
                    <p className="text-xs text-tl-muted">
                      {mastersLoading ? "Cargando…" : `${nomencladorTotal} registro(s) · ${nomencladorActive} activo(s)`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadMasters()}
                  className="tl-btn tl-btn-secondary inline-flex items-center justify-center gap-2 self-start sm:self-auto"
                  disabled={mastersLoading}
                >
                  <RefreshCw className={cn("h-4 w-4", mastersLoading && "animate-spin")} aria-hidden />
                  Actualizar
                </button>
              </div>

              <div className="px-2 pb-2 sm:px-0">
                <DataTable
                  columns={masterColumns}
                  data={masters}
                  keyExtractor={(r) => r.id}
                  searchable
                  searchPlaceholder="Buscar proveedor por nombre o teléfono…"
                  searchKeys={["name", "phone"]}
                  emptyMessage="Aún no hay proveedores. Usa el formulario de arriba para crear el primero."
                  loading={mastersLoading}
                  skeletonRows={6}
                  maxHeight="min(520px, 60vh)"
                />
              </div>
              <p className="border-t border-tl-line-subtle px-5 py-3 text-xs leading-relaxed text-tl-muted">
                Los inactivos no aparecen al crear productos nuevos. No se puede borrar si hay productos vinculados.
              </p>
            </section>

            {editMaster ? (
              <div
                className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-supplier-title"
                onClick={() => setEditMaster(null)}
              >
                <div
                  className="tl-glass w-full max-w-md rounded-2xl p-6 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="edit-supplier-title" className="text-lg font-semibold text-tl-ink">
                    Editar proveedor
                  </h2>
                  <form onSubmit={onSaveEditMaster} className="mt-5 space-y-4">
                    <div>
                      <label className="text-xs font-medium text-tl-muted" htmlFor="ems-name">
                        Nombre
                      </label>
                      <input
                        id="ems-name"
                        value={eMName}
                        onChange={(e) => setEMName(e.target.value)}
                        className="tl-input mt-1.5 w-full"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-tl-muted" htmlFor="ems-phone">
                        Teléfono
                      </label>
                      <input
                        id="ems-phone"
                        value={eMPhone}
                        onChange={(e) => setEMPhone(e.target.value)}
                        className="tl-input mt-1.5 w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-tl-muted" htmlFor="ems-notes">
                        Notas
                      </label>
                      <textarea
                        id="ems-notes"
                        value={eMNotes}
                        onChange={(e) => setEMNotes(e.target.value)}
                        rows={3}
                        className="tl-input mt-1.5 w-full"
                      />
                    </div>
                    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        className="tl-btn tl-btn-secondary w-full sm:w-auto"
                        onClick={() => setEditMaster(null)}
                      >
                        Cancelar
                      </button>
                      <button type="submit" disabled={eMBusy} className="tl-btn-primary w-full sm:w-auto">
                        {eMBusy ? "Guardando…" : "Guardar cambios"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}
          </>
        ) : pageTab === "cuentas" ? (
          <>
            {accountsError ? (
              <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {accountsError}
              </div>
            ) : null}
            {detailErr ? (
              <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {detailErr}
              </div>
            ) : null}
            {debtError ? (
              <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {debtError}
              </div>
            ) : null}
            {paymentsError ? (
              <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {paymentsError}
              </div>
            ) : null}

            <section className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-tl-canvas-inset p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-tl-ink">Rango de fechas</h2>
                  <p className="mt-1 text-xs text-tl-muted">
                    Se consideran ventas cerradas. El importe a pagar es precio de compra × unidades vendidas (por
                    línea).
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                    Desde
                    <input
                      type="date"
                      value={accountsFrom}
                      onChange={(e) => setAccountsFrom(e.target.value)}
                      className="tl-input h-10 px-3 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                    Hasta
                    <input
                      type="date"
                      value={accountsTo}
                      onChange={(e) => setAccountsTo(e.target.value)}
                      className="tl-input h-10 px-3 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadAccounts()}
                    className="tl-btn tl-btn-secondary inline-flex h-10 items-center gap-2 self-end"
                    disabled={accountsLoading}
                  >
                    <RefreshCw className={cn("h-4 w-4", accountsLoading && "animate-spin")} aria-hidden />
                    Calcular
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-tl-ink">Deuda a un proveedor (detalle)</h2>
                  <p className="mt-1 text-xs text-tl-muted">
                    Selecciona un proveedor y el rango. Verás los productos exactos vendidos y el total a pagar usando el
                    precio proveedor.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                    Proveedor
                    <select
                      value={detailSupplierId}
                      onChange={(e) => setDetailSupplierId(e.target.value)}
                      className="tl-input h-10 min-w-[240px] px-3 text-sm"
                    >
                      <option value="">— Selecciona —</option>
                      {masters
                        .filter((m) => m.active)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadDetail()}
                    className="tl-btn tl-btn-secondary inline-flex h-10 items-center gap-2 self-end"
                    disabled={detailLoading}
                  >
                    <RefreshCw className={cn("h-4 w-4", detailLoading && "animate-spin")} aria-hidden />
                    Calcular detalle
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await loadDebt();
                      await loadPayments();
                    }}
                    className="tl-btn tl-btn-primary inline-flex h-10 items-center gap-2 self-end"
                    disabled={debtLoading || paymentsLoading}
                    title="Cargar saldo pendiente y pagos"
                  >
                    <Wallet className={cn("h-4 w-4", (debtLoading || paymentsLoading) && "animate-pulse")} aria-hidden />
                    Saldo y pagos
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Proveedor"
                  value={detailSupplier ? detailSupplier.name : "—"}
                  hint={detailSupplier ? `${detailSupplier.productCount} producto(s) vinculados` : "Selecciona uno"}
                  variant="default"
                  icon={<Truck className="h-4 w-4" />}
                />
                <KpiCard
                  label="Unidades (rango)"
                  value={detailLoading ? "…" : String(detailData?.totals?.units ?? 0)}
                  hint="Suma de cantidades vendidas"
                  variant="warning"
                  icon={<Package className="h-4 w-4" />}
                />
                <KpiCard
                  label="Ingresos venta (rango)"
                  value={detailLoading ? "…" : <CupUsdMoney cents={detailData?.totals?.revenueCents ?? 0} compact />}
                  hint="Solo para referencia"
                  variant="info"
                  icon={<TrendingUp className="h-4 w-4" />}
                />
                <KpiCard
                  label="Total a pagar proveedor"
                  value={detailLoading ? "…" : <CupUsdMoney cents={detailData?.totals?.payableCents ?? 0} compact />}
                  hint={
                    (detailData?.totals?.linesMissingCost ?? 0) > 0
                      ? `${detailData?.totals?.linesMissingCost ?? 0} línea(s) sin coste no suman`
                      : "coste × unidades"
                  }
                  variant="accent"
                  icon={<Wallet className="h-4 w-4" />}
                />
                <KpiCard
                  label="Saldo pendiente (acumulado)"
                  value={
                    debtLoading ? "…" : (
                      <CupUsdMoney
                        cents={(debtData?.suppliers ?? []).find((x) => x.supplierId === detailSupplierId)?.pendingCents ?? 0}
                        compact
                      />
                    )
                  }
                  hint="Ventas a costo − pagos − retiros"
                  variant="warning"
                  icon={<Banknote className="h-4 w-4" />}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-tl-ink">Pagar deuda (parcial o total)</h2>
                  <p className="mt-1 text-xs text-tl-muted">
                    Registra un pago que descuenta el saldo pendiente del proveedor. Se guarda historial.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                    Monto (CUP)
                    <input
                      className="tl-input h-10 w-[160px] px-3 text-sm"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="1000"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                    Método
                    <input
                      className="tl-input h-10 w-[160px] px-3 text-sm"
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      placeholder="Efectivo"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                    Nota
                    <input
                      className="tl-input h-10 w-[220px] px-3 text-sm"
                      value={payNote}
                      onChange={(e) => setPayNote(e.target.value)}
                      placeholder="Opcional…"
                    />
                  </label>
                  <button
                    type="button"
                    className="tl-btn tl-btn-primary inline-flex h-10 items-center gap-2 self-end"
                    disabled={payBusy || !detailSupplierId || !payAmount.trim()}
                    onClick={async () => {
                      const supplierId = detailSupplierId?.trim();
                      if (!supplierId) {
                        setDebtError("Selecciona un proveedor.");
                        return;
                      }
                      const n = Number(String(payAmount).replace(",", "."));
                      if (!Number.isFinite(n) || n <= 0) {
                        setDebtError("Monto inválido.");
                        return;
                      }
                      const cents = Math.round(n * 100);
                      setPayBusy(true);
                      setDebtError(null);
                      try {
                        const res = await fetch("/api/admin/suppliers/pay", {
                          method: "POST",
                          credentials: "include",
                          headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                          body: JSON.stringify({
                            supplierId,
                            amountCents: cents,
                            method: payMethod.trim() || null,
                            note: payNote.trim() || null,
                          }),
                        });
                        const raw: unknown = await res.json().catch(() => ({}));
                        const j =
                          raw && typeof raw === "object"
                            ? (raw as { error?: unknown })
                            : ({} as { error?: unknown });
                        if (!res.ok) {
                          setDebtError(typeof j.error === "string" ? j.error : "No se pudo registrar el pago.");
                          return;
                        }
                        setPayAmount("");
                        setPayNote("");
                        await loadDebt();
                        await loadPayments();
                      } catch (e) {
                        setDebtError(e instanceof Error ? e.message : "Error de red al pagar.");
                      } finally {
                        setPayBusy(false);
                      }
                    }}
                  >
                    {payBusy ? "Guardando…" : "Pagar"}
                  </button>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-tl-line-subtle px-4 py-4 sm:px-6">
                <div className="flex items-center gap-2">
                  <BookMarked className="h-5 w-5 text-amber-600" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-tl-ink">Historial de pagos</h2>
                    <p className="text-xs text-tl-muted">Pagos registrados en el rango seleccionado.</p>
                  </div>
                </div>
              </div>
              <div className="px-4 pb-4 sm:px-6">
                {(paymentsData?.payments ?? []).length === 0 ? (
                  <div className="py-6 text-sm text-tl-muted">
                    {detailSupplierId ? (paymentsLoading ? "Cargando…" : "No hay pagos en este rango.") : "Selecciona un proveedor."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                        <tr>
                          <th className="px-4 py-3">Fecha</th>
                          <th className="px-4 py-3 text-right">Monto</th>
                          <th className="px-4 py-3">Método</th>
                          <th className="px-4 py-3">Nota</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-tl-line-subtle">
                        {(paymentsData?.payments ?? []).map((p) => (
                          <tr key={p.id}>
                            <td className="px-4 py-3 tabular-nums text-tl-muted">{new Date(p.paidAt).toLocaleString("es-ES")}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                              <TablePriceCupCell cupCents={p.amountCents} compact />
                            </td>
                            <td className="px-4 py-3 text-tl-ink-secondary">{p.method ?? "—"}</td>
                            <td className="px-4 py-3 text-tl-ink-secondary">{p.note ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-tl-line-subtle px-4 py-4 sm:px-6">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-amber-600" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-tl-ink">Resumen del proveedor (rango)</h2>
                    <p className="text-xs text-tl-muted">
                      Aquí queda bien claro cuánto se debe a este proveedor en el periodo seleccionado. El detalle por producto queda debajo.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-4 pb-4 sm:px-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard
                    label="Rango"
                    value={accountsPeriodLabel}
                    hint="Fechas seleccionadas"
                    variant="default"
                    icon={<Calendar className="h-4 w-4" />}
                  />
                  <KpiCard
                    label="Ventas (PVP)"
                    value={detailLoading ? "…" : <CupUsdMoney cents={detailData?.totals?.revenueCents ?? 0} compact />}
                    hint="Ingresos por venta en el rango"
                    variant="info"
                    icon={<TrendingUp className="h-4 w-4" />}
                  />
                  <KpiCard
                    label="A pagar en el rango"
                    value={detailLoading ? "…" : <CupUsdMoney cents={detailData?.totals?.payableCents ?? 0} compact />}
                    hint="Costo proveedor × unidades (rango)"
                    variant="accent"
                    icon={<Wallet className="h-4 w-4" />}
                  />
                  <KpiCard
                    label="Saldo pendiente (acumulado)"
                    value={
                      debtLoading ? "…" : (
                        <CupUsdMoney
                          cents={(debtData?.suppliers ?? []).find((x) => x.supplierId === detailSupplierId)?.pendingCents ?? 0}
                          compact
                        />
                      )
                    }
                    hint="Ventas a costo − pagos − retiros"
                    variant="warning"
                    icon={<Banknote className="h-4 w-4" />}
                  />
                </div>

                <details className="mt-4 tl-glass rounded-xl">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-tl-accent hover:underline [&::-webkit-details-marker]:hidden">
                    Ver detalle por producto (precio proveedor, cantidades y a pagar)
                  </summary>
                  <div className="px-4 pb-4">
                    <DataTable
                      columns={detailColumns}
                      data={detailData?.rows ?? []}
                      keyExtractor={(r) => `${r.productId}:${r.unitPriceCents}:${r.costCents ?? "null"}`}
                      searchable={false}
                      emptyMessage={
                        detailSupplierId ? "No hay ventas de ese proveedor en el rango (o faltan datos)." : "Selecciona un proveedor y calcula."
                      }
                      loading={detailLoading}
                      skeletonRows={8}
                      maxHeight="min(560px, 65vh)"
                    />
                  </div>
                </details>
              </div>
              {detailData?.note ? (
                <p className="border-t border-tl-line-subtle px-5 py-3 text-xs leading-relaxed text-tl-muted">
                  {detailData.note}
                </p>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-2xl border-2 border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-tl-canvas-inset to-tl-canvas p-6 shadow-md sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200/90">
                    Total estimado a pagar proveedores
                  </p>
                  <p className="mt-1 text-xs text-tl-muted">Suma de costes de compra sobre unidades vendidas en el rango</p>
                </div>
                <Banknote className="h-10 w-10 shrink-0 text-amber-600 opacity-90" aria-hidden />
              </div>
              <div className="mt-4 text-3xl font-bold tracking-tight text-tl-ink sm:text-4xl">
                {accountsLoading ? (
                  "…"
                ) : (
                  <CupUsdMoney cents={accountsData?.totals?.payableCents ?? 0} className="!text-3xl sm:!text-4xl" />
                )}
              </div>
            </section>

            <section aria-labelledby="kpi-acc">
              <h2 id="kpi-acc" className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-tl-muted">
                <TrendingUp className="h-4 w-4 text-amber-600" aria-hidden />
                Quién destaca en este periodo
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Más ingresos por ventas"
                  value={
                    accountsLoading ? "…" : accTopRevenue ? <CupUsdMoney cents={accTopRevenue.revenueCents} /> : "—"
                  }
                  hint={accTopRevenue?.supplier ?? "Sin datos"}
                  variant="info"
                  icon={<TrendingUp className="h-4 w-4" />}
                />
                <KpiCard
                  label="Más unidades vendidas"
                  value={accountsLoading ? "…" : accTopUnits ? accTopUnits.units.toLocaleString("es-ES") : "—"}
                  hint={accTopUnits?.supplier ?? "—"}
                  variant="warning"
                  icon={<Truck className="h-4 w-4" />}
                />
                <KpiCard
                  label="Más referencias distintas"
                  value={accountsLoading ? "…" : accTopProducts ? String(accTopProducts.products) : "—"}
                  hint={accTopProducts?.supplier ?? "—"}
                  variant="default"
                  icon={<Package className="h-4 w-4" />}
                />
                <KpiCard
                  label="Mayor monto a pagar"
                  value={
                    accountsLoading ? "…" : accTopPayable ? <CupUsdMoney cents={accTopPayable.payableCents} /> : "—"
                  }
                  hint={accTopPayable?.supplier ?? "—"}
                  variant="accent"
                  icon={<Wallet className="h-4 w-4" />}
                />
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset shadow-sm">
              <div className="flex flex-col gap-3 border-b border-tl-line-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-base font-semibold text-tl-ink">Detalle por proveedor</h2>
                  <p className="text-xs text-tl-muted">Ordenado por importe a pagar (mayor primero)</p>
                </div>
                <input
                  value={accountsQuery}
                  onChange={(e) => setAccountsQuery(e.target.value)}
                  placeholder="Buscar proveedor…"
                  className="tl-input h-10 w-full sm:max-w-xs"
                  type="search"
                  aria-label="Buscar proveedor (detalle)"
                />
              </div>
              <div className="px-4 pb-4 sm:px-6">
                <DataTable
                  columns={accountsColumns}
                  data={accountsSorted}
                  keyExtractor={(r) => r.supplier}
                  searchable={false}
                  emptyMessage="No hay ventas en este rango o no coincide la búsqueda."
                  loading={accountsLoading}
                  skeletonRows={8}
                  maxHeight="min(560px, 65vh)"
                />
              </div>
              <p className="border-t border-tl-line-subtle px-5 py-3 text-xs leading-relaxed text-tl-muted">
                «A pagar» usa el precio de compra del producto. Si falta, esa línea no suma al pago y se cuenta en
                líneas sin coste.
              </p>
            </section>
          </>
        ) : (
          <>
            {error ? (
              <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {error}
              </div>
            ) : null}

            {/* Filtros */}
            <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Periodo</span>
                  <div className="inline-flex rounded-lg border border-tl-line-subtle bg-tl-canvas p-0.5">
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                        mode === "days" ? "bg-tl-accent text-tl-accent-fg shadow-sm" : "text-tl-muted hover:text-tl-ink",
                      )}
                      onClick={() => setMode("days")}
                    >
                      Últimos días
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                        mode === "range" ? "bg-tl-accent text-tl-accent-fg shadow-sm" : "text-tl-muted hover:text-tl-ink",
                      )}
                      onClick={() => setMode("range")}
                    >
                      Entre fechas
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {mode === "days" ? (
                    <label className="flex items-center gap-2 text-sm text-tl-ink">
                      <span className="text-xs text-tl-muted">Rango</span>
                      <select
                        className="tl-input h-10 min-w-[8rem] px-3 text-sm"
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                      >
                        <option value={7}>7 días</option>
                        <option value={30}>30 días</option>
                        <option value={90}>90 días</option>
                        <option value={180}>180 días</option>
                      </select>
                    </label>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="tl-input h-10 w-full min-w-[140px] px-3 text-sm sm:w-auto"
                        aria-label="Desde"
                      />
                      <span className="text-tl-muted">—</span>
                      <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="tl-input h-10 w-full min-w-[140px] px-3 text-sm sm:w-auto"
                        aria-label="Hasta"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="tl-btn tl-btn-secondary inline-flex items-center gap-2"
                    disabled={loading}
                  >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
                    Actualizar datos
                  </button>
                </div>
              </div>
            </section>

            {/* Bloque: nomenclador (datos reales de la lista) */}
            <section aria-labelledby="kpi-nom">
              <h2 id="kpi-nom" className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-tl-muted">
                <Store className="h-4 w-4 text-violet-500" aria-hidden />
                Tu nomenclador
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <KpiCard
                  label="Activos en la lista"
                  value={mastersLoading ? "…" : String(nomencladorActive)}
                  hint="Se ofrecen al crear productos"
                  variant="accent"
                  icon={<BookMarked className="h-4 w-4" />}
                />
                <KpiCard
                  label="Registros en total"
                  value={mastersLoading ? "…" : String(nomencladorTotal)}
                  hint="Incluye inactivos"
                  variant="default"
                  icon={<Layers className="h-4 w-4" />}
                />
              </div>
            </section>

            {/* Bloque: ventas del periodo */}
            <section aria-labelledby="kpi-sales">
              <h2 id="kpi-sales" className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-tl-muted">
                <TrendingUp className="h-4 w-4 text-cyan-600" aria-hidden />
                Resultados en el periodo
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <KpiCard
                  label="Con ventas"
                  value={loading ? "…" : String(withSalesCount)}
                  hint="Proveedores con movimiento"
                  variant="info"
                  icon={<Truck className="h-4 w-4" />}
                />
                <KpiCard
                  label="Total a pagar prov."
                  value={
                    loading ? "…" : <CupUsdMoney cents={data?.totals?.payableCents ?? 0} compact />
                  }
                  hint="Coste × uds vendidas"
                  variant="accent"
                  icon={<Wallet className="h-4 w-4" />}
                />
                <KpiCard
                  label="Mayor ingreso"
                  value={loading ? "…" : topByRevenue ? <CupUsdMoney cents={topByRevenue.revenueCents} /> : "—"}
                  hint={topByRevenue?.supplier ?? "Sin datos"}
                  variant="info"
                />
                <KpiCard
                  label="Más unidades"
                  value={loading ? "…" : topByUnits ? topByUnits.units.toLocaleString("es-ES") : "—"}
                  hint={topByUnits?.supplier ?? "—"}
                  variant="warning"
                />
                <KpiCard
                  label="Mayor ganancia est."
                  value={loading ? "…" : topByProfit ? <CupUsdMoney cents={topByProfit.profitCents} /> : "—"}
                  hint={topByProfit?.supplier ?? "Sin datos"}
                  variant="success"
                />
                <KpiCard
                  label="Más referencias vendidas"
                  value={loading ? "…" : topByProducts ? String(topByProducts.products) : "—"}
                  hint={topByProducts?.supplier ?? "Productos distintos"}
                  variant="default"
                  icon={<Package className="h-4 w-4" />}
                />
              </div>
            </section>

            {/* Tabla */}
            <section className="overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset shadow-sm">
              <div className="flex flex-col gap-3 border-b border-tl-line-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-tl-accent" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-tl-ink">Detalle por proveedor</h2>
                    <p className="text-xs text-tl-muted">Ingresos y ganancia según coste en ficha de producto</p>
                  </div>
                </div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar en la tabla…"
                  className="tl-input h-10 w-full sm:max-w-xs"
                  type="search"
                  aria-label="Buscar en la tabla de proveedores"
                />
              </div>

              <div className="px-4 pb-4 sm:px-6">
                <DataTable
                  columns={rankingColumns}
                  data={suppliersFiltered}
                  keyExtractor={(r) => r.supplier}
                  searchable={false}
                  emptyMessage="No hay ventas en este periodo o no coincide la búsqueda."
                  loading={loading}
                  skeletonRows={10}
                  maxHeight="min(620px, 70vh)"
                />
              </div>
              <p className="border-t border-tl-line-subtle px-5 py-3 text-xs leading-relaxed text-tl-muted">
                «A pagar» es coste de compra × unidades. La ganancia usa PVP − ese coste. Si falta precio de compra, se
                indica en «Sin coste».
              </p>
            </section>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Eliminar proveedor del nomenclador"
        description={
          confirmDeleteSupplier
            ? `Se eliminará «${confirmDeleteSupplier.name}» del nomenclador. Solo es posible si no tiene productos vinculados.`
            : "Se eliminará el proveedor del nomenclador."
        }
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusyId != null}
        onClose={() => {
          if (deleteBusyId != null) return;
          setConfirmDeleteOpen(false);
          setConfirmDeleteSupplier(null);
        }}
        onConfirm={() => {
          void confirmDeleteMasterNow().then(() => {
            setConfirmDeleteOpen(false);
            setConfirmDeleteSupplier(null);
          });
        }}
      />
    </AdminShell>
  );
}
