"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PencilLineIcon as PencilLine,
  PlusIcon as Plus,
  RefreshCwIcon as RefreshCw,
  SearchLucideIcon as Search,
  Trash2Icon as Trash2,
  WifiOffIcon as WifiOff,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";
import { formatCup } from "@/lib/money";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type RecentSale = {
  id: string;
  deviceId: string;
  totalCents: number;
  status: string;
  completedAt: string;
  paymentMethod: string | null;
  paidCents: number | null;
  changeCents: number | null;
  paidTotalCents: number | null;
  balanceCents: number | null;
  paymentStatus: string | null;
  editedAt: string | null;
  revisionCount: number;
  payments: {
    id: string;
    amountCupCents: number;
    currency: string;
    originalAmount: number | null;
    usdRateCup: number | null;
    method: string;
    paidAt: string;
  }[];
  returns: {
    id: string;
    amountCupCents: number;
    reason: string | null;
    returnedAt: string;
    lines: {
      id: string;
      productId: string | null;
      productName: string;
      sku: string;
      quantity: number;
      unitPriceCents: number;
      subtotalCents: number;
    }[];
  }[];
  /** Campo auxiliar para búsqueda local */
  searchText?: string;
  lines: {
    id: string;
    productId?: string | null;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    productName: string;
    sku: string;
  }[];
};

function derivedPaymentMethod(row: RecentSale): string {
  const payCount = row.payments?.length ?? 0;
  if (payCount > 1) return "MIXTO";
  if (payCount === 1) return row.payments[0]?.method?.trim() || "—";
  const bal = row.balanceCents ?? null;
  if (bal != null && bal > 0) return "FIADO";
  return row.paymentMethod?.trim() || "—";
}

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type SearchProductHit = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
  deletedAt: string | null;
  priceCents: number;
  stockQty: number;
};

type SaleLineDraft = {
  key: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCupCents: number;
};

function newDraftKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCupMajorToCents(raw: string): number | null {
  const s = raw.trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToCupMajorInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function buildEditPayloadLines(
  draft: SaleLineDraft[],
): { ok: true; lines: { productId: string; quantity: number; unitPriceCupCentsOverride: number }[] } | { ok: false; error: string } {
  const valid = draft.filter((l) => l.productId && l.quantity > 0);
  if (valid.length === 0) return { ok: false, error: "Añade al menos una línea con producto y cantidad mayor que cero." };

  const byPid = new Map<string, { qty: number; unit: number }>();
  for (const l of valid) {
    const cur = byPid.get(l.productId);
    if (!cur) byPid.set(l.productId, { qty: l.quantity, unit: l.unitPriceCupCents });
    else {
      if (cur.unit !== l.unitPriceCupCents) {
        return {
          ok: false,
          error:
            "El mismo producto aparece con distintos precios unitarios. Deja una sola línea por producto o iguala el precio.",
        };
      }
      cur.qty += l.quantity;
    }
  }

  return {
    ok: true,
    lines: [...byPid.entries()].map(([productId, { qty, unit }]) => ({
      productId,
      quantity: qty,
      unitPriceCupCentsOverride: unit,
    })),
  };
}

function previewPaymentStatusLabel(paidCents: number, totalCents: number) {
  if (paidCents === 0) return "CREDIT_OPEN";
  const bal = totalCents - paidCents;
  if (bal === 0) return "PAID";
  if (bal > 0) return "PARTIAL";
  return "OVERPAID";
}

export default function SalesPage() {
  const toast = useToast();
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  const selectedSale = useMemo(
    () => (selectedSaleId ? sales.find((s) => s.id === selectedSaleId) ?? null : null),
    [selectedSaleId, sales],
  );

  // Abonos (antes: prompt → ahora: modal con validación)
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);

  // Devolución parcial (antes: prompt → ahora: modal con selección de línea)
  const [retOpen, setRetOpen] = useState(false);
  const [retProductId, setRetProductId] = useState("");
  const [retQty, setRetQty] = useState("1");
  const [retReason, setRetReason] = useState("");
  const [retBusy, setRetBusy] = useState(false);
  const [retErr, setRetErr] = useState<string | null>(null);

  const [saleLinesEditOpen, setSaleLinesEditOpen] = useState(false);
  const [saleEditLines, setSaleEditLines] = useState<SaleLineDraft[]>([]);
  const [saleEditNote, setSaleEditNote] = useState("");
  const [saleEditBusy, setSaleEditBusy] = useState(false);
  const [saleEditErr, setSaleEditErr] = useState<string | null>(null);
  const [productSearchQ, setProductSearchQ] = useState("");
  const [productSearchHits, setProductSearchHits] = useState<SearchProductHit[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  /** null = no hay sustitución activa; "ADD" = el siguiente resultado se añade como línea */
  const [productPickTarget, setProductPickTarget] = useState<string | "ADD" | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    setSaleLinesEditOpen(false);
    setSaleEditLines([]);
    setSaleEditNote("");
    setSaleEditErr(null);
    setProductSearchQ("");
    setProductSearchHits([]);
    setProductPickTarget(null);

    setPayOpen(false);
    setPayAmount("");
    setPayMethod("cash");
    setPayBusy(false);
    setPayErr(null);

    setRetOpen(false);
    setRetProductId("");
    setRetQty("1");
    setRetReason("");
    setRetBusy(false);
    setRetErr(null);
  }, [selectedSaleId]);

  async function submitPayment() {
    if (!selectedSale) return;
    const cents = parseCupMajorToCents(payAmount);
    if (cents == null || cents <= 0) {
      setPayErr("El abono debe ser un número mayor que 0.");
      return;
    }
    const method = payMethod.trim() || "cash";
    setPayErr(null);
    setPayBusy(true);
    try {
      const res = await fetch("/api/admin/sales/apply-payment", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          saleId: selectedSale.id,
          method,
          currency: "CUP",
          amountCupCents: cents,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (j && typeof j.error === "string" ? j.error : null) ?? `Error HTTP ${res.status}`;
        setPayErr(msg);
        toast.push({ kind: "error", title: "No se pudo registrar el abono", description: msg });
        return;
      }
      await loadSales({ manual: true });
      setPayOpen(false);
      toast.push({ kind: "success", title: "Abono registrado" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error de red.";
      setPayErr(msg);
      toast.push({ kind: "error", title: "Error de red", description: msg });
    } finally {
      setPayBusy(false);
    }
  }

  async function submitReturn() {
    if (!selectedSale) return;
    const pid = retProductId.trim();
    if (!pid) {
      setRetErr("Selecciona un producto.");
      return;
    }
    const qty = Number(retQty);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      setRetErr("La cantidad debe ser un entero mayor que 0.");
      return;
    }
    setRetErr(null);
    setRetBusy(true);
    try {
      const res = await fetch("/api/admin/sales/return", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          saleId: selectedSale.id,
          reason: retReason.trim() || null,
          lines: [{ productId: pid, quantity: qty }],
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (j && typeof j.error === "string" ? j.error : null) ?? `Error HTTP ${res.status}`;
        setRetErr(msg);
        toast.push({ kind: "error", title: "No se pudo registrar la devolución", description: msg });
        return;
      }
      await loadSales({ manual: true });
      setRetOpen(false);
      toast.push({ kind: "success", title: "Devolución registrada" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error de red.";
      setRetErr(msg);
      toast.push({ kind: "error", title: "Error de red", description: msg });
    } finally {
      setRetBusy(false);
    }
  }

  const beginSaleLinesEdit = useCallback(() => {
    if (!selectedSale) return;
    if (selectedSale.status !== "COMPLETED") {
      toast.push({
        kind: "warning",
        title: "No se puede editar esta venta",
        description: "Solo se pueden editar líneas de ventas en estado COMPLETED.",
      });
      return;
    }
    setSaleEditErr(null);
    setSaleEditNote("");
    setProductSearchQ("");
    setProductSearchHits([]);
    setProductPickTarget(null);
    const withPid = selectedSale.lines.filter((l) => l.productId);
    const skipped = selectedSale.lines.length - withPid.length;
    if (skipped > 0) {
      toast.push({
        kind: "info",
        title: "Líneas sin producto enlazado",
        description: `Esta venta tiene ${skipped} línea(s) sin producto enlazado; no se pueden editar aquí y no se incluirán al guardar.`,
        durationMs: 5200,
      });
    }
    setSaleEditLines(
      withPid.map((l) => ({
        key: newDraftKey(),
        productId: l.productId as string,
        productName: l.productName,
        sku: l.sku,
        quantity: l.quantity,
        unitPriceCupCents: l.unitPriceCents,
      })),
    );
    setSaleLinesEditOpen(true);
  }, [selectedSale, toast]);

  const cancelSaleLinesEdit = useCallback(() => {
    setSaleLinesEditOpen(false);
    setSaleEditErr(null);
    setProductSearchQ("");
    setProductSearchHits([]);
    setProductPickTarget(null);
  }, []);

  useEffect(() => {
    if (!saleLinesEditOpen) return;
    const q = productSearchQ.trim();
    if (q.length < 2) {
      setProductSearchHits([]);
      setProductSearchLoading(false);
      return;
    }
    if (searchDebounceRef.current != null) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      void (async () => {
        setProductSearchLoading(true);
        try {
          const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}&limit=15`, { credentials: "include" });
          const json = (await res.json()) as { products?: SearchProductHit[]; meta?: { dbAvailable?: boolean } };
          if (!res.ok || json.meta?.dbAvailable === false) {
            setProductSearchHits([]);
            return;
          }
          setProductSearchHits(json.products ?? []);
        } catch {
          setProductSearchHits([]);
        } finally {
          setProductSearchLoading(false);
        }
      })();
    }, 280);
    return () => {
      if (searchDebounceRef.current != null) window.clearTimeout(searchDebounceRef.current);
    };
  }, [productSearchQ, saleLinesEditOpen]);

  const applyProductPick = useCallback((p: SearchProductHit) => {
    if (productPickTarget === "ADD") {
      setSaleEditLines((prev) => [
        ...prev,
        {
          key: newDraftKey(),
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          quantity: 1,
          unitPriceCupCents: p.priceCents,
        },
      ]);
    } else if (productPickTarget) {
      setSaleEditLines((prev) =>
        prev.map((row) =>
          row.key === productPickTarget
            ? {
                ...row,
                productId: p.id,
                productName: p.name,
                sku: p.sku,
                unitPriceCupCents: row.unitPriceCupCents,
              }
            : row,
        ),
      );
    }
    setProductPickTarget(null);
    setProductSearchQ("");
    setProductSearchHits([]);
  }, [productPickTarget]);

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
          s.paymentStatus ?? "",
          String(s.balanceCents ?? ""),
          ...(s.payments ?? []).map((p) => p.method),
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

  const saleEditPreviewTotal = useMemo(
    () => saleEditLines.reduce((acc, l) => acc + l.quantity * l.unitPriceCupCents, 0),
    [saleEditLines],
  );

  const submitSaleLinesEdit = useCallback(async () => {
    if (!selectedSale) return;
    const built = buildEditPayloadLines(saleEditLines);
    if (!built.ok) {
      setSaleEditErr(built.error);
      return;
    }
    setSaleEditBusy(true);
    setSaleEditErr(null);
    try {
      const res = await fetch("/api/admin/sales/edit", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          saleId: selectedSale.id,
          lines: built.lines,
          note: saleEditNote.trim() ? saleEditNote.trim() : null,
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setSaleEditErr(j?.error ?? `Error HTTP ${res.status}`);
        return;
      }
      setSaleLinesEditOpen(false);
      await loadSales({ manual: true });
    } catch (e) {
      setSaleEditErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setSaleEditBusy(false);
    }
  }, [selectedSale, saleEditLines, saleEditNote, loadSales]);

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

  useEffect(() => {
    setPage(1);
  }, [fromDay, toDay, searchQuery]);

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
          {derivedPaymentMethod(row)}
        </span>
      ),
    },
    {
      key: "paymentStatus",
      label: "Pago",
      width: "140px",
      render: (row) => {
        const status = row.paymentStatus ?? "—";
        const isMixed = (row.payments?.length ?? 0) > 1;
        const hasReturn = (row.returns?.length ?? 0) > 0;
        const edited = (row.revisionCount ?? 0) > 0 || Boolean(row.editedAt);
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-tl-muted">
              {status}
            </span>
            {isMixed ? (
              <span className="rounded-full bg-tl-accent-subtle px-2 py-0.5 text-[11px] font-semibold text-tl-accent">
                MIXTO
              </span>
            ) : null}
            {hasReturn ? (
              <span className="rounded-full bg-tl-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-tl-warning">
                DEV
              </span>
            ) : null}
            {edited ? (
              <span className="rounded-full bg-tl-canvas-inset px-2 py-0.5 text-[11px] font-semibold text-tl-muted">
                EDIT
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "balanceCents",
      label: "Saldo",
      align: "right",
      width: "120px",
      render: (row) => (
        <span className="text-xs tabular-nums text-tl-ink">
          {row.balanceCents != null ? <TablePriceCupCell cupCents={row.balanceCents} compact /> : "—"}
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
    setConfirmDeleteOpen(true);
    return;
  }

  async function deleteSelectedNow() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      const res = await fetch("/api/admin/sales/delete", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ ids }),
      });
      const json: unknown = await res.json().catch(() => null);
      const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      if (!res.ok) {
        const err = obj && "error" in obj ? String(obj.error ?? "") : "";
        setDeleteMsg(err || `No se pudo eliminar (HTTP ${res.status}).`);
        return;
      }
      setSelectedIds(new Set());
      await loadSales({ manual: true });
      const deleted =
        obj && "deleted" in obj ? Number(obj.deleted ?? NaN) : NaN;
      setDeleteMsg(`Eliminadas: ${Number.isFinite(deleted) ? deleted : ids.length}.`);
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
          title="Ventas"
          description="Busca por dispositivo, producto o método. Click en una fila para ver el detalle."
          actions={
            <button
              type="button"
              className="tl-btn tl-btn-secondary !h-10 !px-3 !py-0 text-xs"
              onClick={() => void loadSales({ manual: true })}
              disabled={loading}
              title="Actualizar"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Actualizar
            </button>
          }
          columns={columns}
          data={sales}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => setSelectedSaleId(row.id)}
          searchable
          searchPlaceholder="Buscar por dispositivo, producto o método..."
          searchKeys={["deviceId", "searchText", "paymentMethod"]}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onVisibleRowsChange={setVisibleSales}
          emptyMessage="No hay ventas que coincidan con tu búsqueda/filtros."
          maxHeight="calc(100vh - 300px)"
          loading={loading}
          skeletonRows={10}
          pagination={{
            kind: "client",
            page,
            totalPages: 1,
            onPageChange: setPage,
            pageSize,
            pageSizeOptions: [10, 25, 50, 100, 200],
            onPageSizeChange: (n) => {
              setPage(1);
              setPageSize(n);
            },
            summary: `${visibleSales.length.toLocaleString("es-ES")} ventas (filtradas) · página ${page}`,
          }}
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

        {selectedSale ? (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (saleEditBusy) return;
              setSelectedSaleId(null);
            }}
          >
            <div
              className="tl-glass max-h-[min(92vh,900px)] w-full max-w-4xl overflow-y-auto rounded-2xl p-4 md:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-tl-ink">Detalle de venta</h2>
                  <p className="mt-1 text-xs text-tl-muted">
                    {new Date(selectedSale.completedAt).toLocaleString("es-ES")} · {selectedSale.deviceId}
                  </p>
                </div>
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                  onClick={() => setSelectedSaleId(null)}
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-tl-line bg-tl-canvas-inset/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Total</div>
                  <div className="mt-1 text-base font-bold text-tl-ink">
                    <CupUsdMoney cents={selectedSale.totalCents} />
                  </div>
                </div>
                <div className="rounded-xl border border-tl-line bg-tl-canvas-inset/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Pagado</div>
                  <div className="mt-1 text-base font-bold text-tl-ink">
                    {selectedSale.paidTotalCents != null ? <CupUsdMoney cents={selectedSale.paidTotalCents} /> : "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-tl-line bg-tl-canvas-inset/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Saldo</div>
                  <div className="mt-1 text-base font-bold text-tl-ink">
                    {selectedSale.balanceCents != null ? <CupUsdMoney cents={selectedSale.balanceCents} /> : "—"}
                  </div>
                </div>
              </div>

              {saleLinesEditOpen ? (
                <div className="mt-4 rounded-xl border border-tl-accent/25 bg-gradient-to-br from-tl-accent/8 to-tl-canvas-inset p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-accent">Vista previa (sin guardar)</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <span className="text-tl-muted">
                      Nuevo total:{" "}
                      <span className="font-semibold text-tl-ink">
                        <CupUsdMoney cents={saleEditPreviewTotal} compact />
                      </span>
                    </span>
                    <span className="text-tl-muted">
                      Nuevo saldo:{" "}
                      <span className="font-semibold text-tl-ink">
                        <CupUsdMoney cents={saleEditPreviewTotal - (selectedSale.paidTotalCents ?? 0)} compact />
                      </span>
                    </span>
                    <span className="text-tl-muted">
                      Pago (estim.):{" "}
                      <span className="font-mono text-xs font-semibold text-tl-ink">
                        {previewPaymentStatusLabel(selectedSale.paidTotalCents ?? 0, saleEditPreviewTotal)}
                      </span>
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-tl-muted">
                    Al confirmar, el servidor ajusta stock, totales de la venta, fiado/saldo y el snapshot del día de la venta (cuadre y métricas).
                  </p>
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Pagos</div>
                  <div className="mt-2 space-y-2">
                    {(selectedSale.payments ?? []).length === 0 ? (
                      <div className="text-sm text-tl-muted">Sin pagos registrados (fiado total).</div>
                    ) : (
                      selectedSale.payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-tl-line px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-tl-ink">{p.method}</div>
                            <div className="text-xs text-tl-muted">
                              {new Date(p.paidAt).toLocaleString("es-ES")} · {p.currency}
                              {p.currency === "USD" && p.originalAmount != null ? ` ${p.originalAmount / 100}` : ""}
                            </div>
                          </div>
                          <div className="text-sm font-bold text-tl-ink">
                            <CupUsdMoney cents={p.amountCupCents} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Devoluciones</div>
                  <div className="mt-2 space-y-2">
                    {(selectedSale.returns ?? []).length === 0 ? (
                      <div className="text-sm text-tl-muted">Sin devoluciones.</div>
                    ) : (
                      selectedSale.returns.map((r) => (
                        <div key={r.id} className="rounded-lg border border-tl-line px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-tl-ink">
                              {new Date(r.returnedAt).toLocaleString("es-ES")}
                            </div>
                            <div className="text-sm font-bold text-tl-warning">
                              <CupUsdMoney cents={r.amountCupCents} />
                            </div>
                          </div>
                          {r.reason ? <div className="mt-1 text-xs text-tl-muted">{r.reason}</div> : null}
                          <div className="mt-2 space-y-1">
                            {r.lines.map((l) => (
                              <div key={l.id} className="flex items-center justify-between text-xs text-tl-muted">
                                <span className="truncate">{l.quantity}x {l.productName}</span>
                                <span className="tabular-nums"><TablePriceCupCell cupCents={l.subtotalCents} compact /></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Acciones</div>
                  <div className="flex flex-wrap gap-2">
                    {!saleLinesEditOpen ? (
                      <button
                        type="button"
                        className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                        disabled={selectedSale.status !== "COMPLETED"}
                        title={selectedSale.status !== "COMPLETED" ? "Solo ventas COMPLETED" : "Cambiar productos y cantidades"}
                        onClick={() => beginSaleLinesEdit()}
                      >
                        <PencilLine className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                        Editar productos
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
                          disabled={saleEditBusy}
                          onClick={() => void submitSaleLinesEdit()}
                        >
                          {saleEditBusy ? "Guardando…" : "Guardar líneas"}
                        </button>
                        <button
                          type="button"
                          className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                          disabled={saleEditBusy}
                          onClick={() => cancelSaleLinesEdit()}
                        >
                          Cancelar edición
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                      onClick={() => {
                        setPayErr(null);
                        setPayAmount("");
                        setPayMethod("cash");
                        setPayOpen(true);
                      }}
                      disabled={!selectedSale}
                    >
                      Registrar abono
                    </button>
                    <button
                      type="button"
                      className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                      onClick={() => {
                        const first = selectedSale?.lines?.find((l) => l.productId)?.productId ?? "";
                        setRetErr(null);
                        setRetReason("");
                        setRetQty("1");
                        setRetProductId(first);
                        setRetOpen(true);
                      }}
                      disabled={!selectedSale}
                    >
                      Devolución parcial
                    </button>
                  </div>
                </div>

                <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Productos</div>
                {!saleLinesEditOpen ? (
                  <div className="mt-2 space-y-1">
                    {selectedSale.lines.map((l) => (
                      <div key={l.id} className="flex items-center justify-between rounded-lg border border-tl-line px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-tl-ink">
                            {l.quantity}x {l.productName}
                          </div>
                          <div className="text-xs text-tl-muted">{l.sku}</div>
                        </div>
                        <div className="text-sm font-bold text-tl-ink">
                          <TablePriceCupCell cupCents={l.subtotalCents} compact />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 space-y-4">
                    {saleEditErr ? (
                      <div className="rounded-lg border border-tl-warning/30 bg-tl-warning-subtle px-3 py-2 text-sm text-tl-warning">{saleEditErr}</div>
                    ) : null}
                    <label className="block text-xs font-semibold uppercase tracking-wider text-tl-muted">
                      Nota de auditoría (opcional)
                      <textarea
                        className="tl-input mt-1 min-h-[56px] w-full px-3 py-2 text-sm normal-case"
                        value={saleEditNote}
                        onChange={(e) => setSaleEditNote(e.target.value)}
                        maxLength={200}
                        placeholder="Ej. Cliente cambió color mismo precio"
                      />
                    </label>
                    <div className="rounded-xl border border-tl-line bg-tl-canvas-inset/50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                          <Search className="h-3.5 w-3.5" aria-hidden />
                          Buscar producto
                        </div>
                        {productPickTarget ? (
                          <span className="text-[11px] font-medium text-tl-accent">
                            {productPickTarget === "ADD" ? "Pulsa un resultado para añadir línea" : "Pulsa un resultado para sustituir la línea"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-tl-muted">Pulsa &quot;Sustituir&quot; en una línea o &quot;Añadir línea&quot;</span>
                        )}
                      </div>
                      <input
                        type="search"
                        className="tl-input mt-2 h-9 w-full px-3 text-sm"
                        value={productSearchQ}
                        onChange={(e) => setProductSearchQ(e.target.value)}
                        placeholder="Nombre o SKU (mín. 2 caracteres)"
                        autoComplete="off"
                      />
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-tl-line-subtle bg-tl-canvas">
                        {productSearchLoading ? (
                          <p className="px-3 py-2 text-xs text-tl-muted">Buscando…</p>
                        ) : productSearchHits.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-tl-muted">
                            {productSearchQ.trim().length < 2 ? "Escribe para buscar." : "Sin resultados."}
                          </p>
                        ) : (
                          <ul className="divide-y divide-tl-line-subtle">
                            {productSearchHits.map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  disabled={!productPickTarget}
                                  className={cn(
                                    "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                                    productPickTarget ? "hover:bg-tl-canvas-inset" : "cursor-not-allowed opacity-50",
                                  )}
                                  onClick={() => {
                                    if (!productPickTarget) return;
                                    applyProductPick(p);
                                  }}
                                >
                                  <span className="min-w-0">
                                    <span className="font-medium text-tl-ink">{p.name}</span>
                                    <span className="mt-0.5 block font-mono text-[11px] text-tl-muted">{p.sku}</span>
                                  </span>
                                  <span className="shrink-0 text-xs tabular-nums text-tl-muted">
                                    Stock {p.stockQty} · {formatCup(p.priceCents)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-tl-line">
                      <table className="w-full min-w-[520px] text-left text-sm">
                        <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                          <tr>
                            <th className="px-3 py-2">Producto</th>
                            <th className="px-3 py-2">Cant.</th>
                            <th className="px-3 py-2">P. unit. CUP</th>
                            <th className="px-3 py-2 text-right">Subtotal</th>
                            <th className="px-3 py-2 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-tl-line-subtle">
                          {saleEditLines.map((row) => (
                            <tr key={row.key} className={productPickTarget === row.key ? "bg-tl-accent/10" : undefined}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-tl-ink">{row.productName || "—"}</div>
                                <div className="font-mono text-[11px] text-tl-muted">{row.sku || row.productId || "—"}</div>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  className="tl-input h-9 w-20 px-2 text-sm tabular-nums"
                                  value={row.quantity}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "") return;
                                    const n = Number(v);
                                    if (!Number.isFinite(n)) return;
                                    const q = Math.max(1, Math.floor(n));
                                    setSaleEditLines((prev) => prev.map((r) => (r.key === row.key ? { ...r, quantity: q } : r)));
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="tl-input h-9 w-28 px-2 text-sm tabular-nums"
                                  defaultValue={centsToCupMajorInput(row.unitPriceCupCents)}
                                  key={`${row.key}-u${row.unitPriceCupCents}`}
                                  onBlur={(e) => {
                                    const c = parseCupMajorToCents(e.currentTarget.value);
                                    if (c == null) return;
                                    setSaleEditLines((prev) => prev.map((r) => (r.key === row.key ? { ...r, unitPriceCupCents: c } : r)));
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <TablePriceCupCell cupCents={row.quantity * row.unitPriceCupCents} compact />
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  className="tl-btn tl-btn-secondary !px-2 !py-1 text-[11px]"
                                  onClick={() => {
                                    setProductPickTarget(row.key);
                                    setProductSearchQ("");
                                    setProductSearchHits([]);
                                  }}
                                >
                                  Sustituir
                                </button>
                                <button
                                  type="button"
                                  className="ml-1 tl-btn tl-btn-secondary !px-2 !py-1 text-[11px] text-tl-warning"
                                  onClick={() => setSaleEditLines((prev) => prev.filter((r) => r.key !== row.key))}
                                >
                                  Quitar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                      onClick={() => {
                        setProductPickTarget("ADD");
                        setProductSearchQ("");
                        setProductSearchHits([]);
                      }}
                    >
                      <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      Añadir línea
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <Modal
        open={payOpen}
        title="Registrar abono"
        description="Añade un pago parcial (CUP) a una venta con balance pendiente."
        onClose={() => {
          if (payBusy) return;
          setPayOpen(false);
        }}
        maxWidthClassName="max-w-[520px]"
      >
        <div className="grid gap-3">
          <div className="grid gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Monto (CUP)</label>
            <input
              inputMode="decimal"
              className="tl-input h-10"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="Ej: 350.00"
              disabled={payBusy}
            />
            <p className="text-xs text-tl-muted">
              Consejo: usa punto o coma. Se registrará como CUP.
            </p>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Método</label>
            <input
              className="tl-input h-10"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              placeholder="cash / transfer / ..."
              disabled={payBusy}
            />
          </div>
          {payErr ? (
            <div role="alert" className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
              {payErr}
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
              onClick={() => setPayOpen(false)}
              disabled={payBusy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-primary !px-4 !py-2 text-sm"
              onClick={() => void submitPayment()}
              disabled={payBusy || !selectedSale}
            >
              {payBusy ? "Guardando…" : "Registrar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={retOpen}
        title="Devolución parcial"
        description="Registra una devolución por línea de producto."
        onClose={() => {
          if (retBusy) return;
          setRetOpen(false);
        }}
        maxWidthClassName="max-w-[560px]"
      >
        <div className="grid gap-3">
          <div className="grid gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Producto</label>
            <select
              className="tl-input h-10"
              value={retProductId}
              onChange={(e) => setRetProductId(e.target.value)}
              disabled={retBusy}
            >
              <option value="">Selecciona…</option>
              {(selectedSale?.lines ?? [])
                .filter((l) => l.productId)
                .map((l) => (
                  <option key={String(l.productId)} value={String(l.productId)}>
                    {l.productName} · {l.sku} (x{l.quantity})
                  </option>
                ))}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Cantidad</label>
              <input
                inputMode="numeric"
                className="tl-input h-10"
                value={retQty}
                onChange={(e) => setRetQty(e.target.value)}
                disabled={retBusy}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Motivo (opcional)</label>
              <input
                className="tl-input h-10"
                value={retReason}
                onChange={(e) => setRetReason(e.target.value)}
                placeholder="Ej: defecto / error de talla"
                disabled={retBusy}
              />
            </div>
          </div>
          {retErr ? (
            <div role="alert" className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
              {retErr}
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
              onClick={() => setRetOpen(false)}
              disabled={retBusy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-primary !px-4 !py-2 text-sm"
              onClick={() => void submitReturn()}
              disabled={retBusy || !selectedSale}
            >
              {retBusy ? "Guardando…" : "Registrar devolución"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Eliminar ventas (admin)"
        description={
          selectedIds.size > 0
            ? `Vas a eliminar ${selectedIds.size} venta(s) de la base de datos. Esto borra Sale/SaleLine y revierte stock. Solo quedará un registro en Historial como “venta eliminada por admin”.`
            : "Selecciona al menos una venta."
        }
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusy}
        onClose={() => {
          if (deleteBusy) return;
          setConfirmDeleteOpen(false);
        }}
        onConfirm={() => {
          void deleteSelectedNow().then(() => {
            setConfirmDeleteOpen(false);
          });
        }}
      />
    </AdminShell>
  );
}
