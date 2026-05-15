"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BoltIcon as Bolt,
  CalendarIcon as Calendar,
  CreditCardIcon as CreditCard,
  HomeIcon as Home,
  PackageIcon as Package,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  RefreshCwIcon as RefreshCw,
  TagIcon as Tag,
  Trash2Icon as Trash2,
  TruckIcon as Truck,
  UtensilsCrossedIcon as UtensilsCrossed,
  WrenchIcon as Wrench,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ExpenseDto = {
  id: string;
  concept: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  currency: string;
  originalAmount: number | null;
  usdRateCup: number | null;
  occurredAt: string;
  paidBy: string | null;
  notes: string | null;
  splitStrategy: string;
  osmarPct: number | null;
  singleOwner: string | null;
  updatedAt: string;
};

type ApiResponse = {
  expenses: ExpenseDto[];
  totals: { totalCents: number; osmarCents: number; alexCents: number };
};

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function localDayRangeIso(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function splitLabelNice(e: { splitStrategy: string; osmarPct: number | null; singleOwner: string | null }) {
  if (e.splitStrategy === "UN_SOLO_DUENO") return e.singleOwner === "ALEX" ? "Álex (100%)" : "Osmar (100%)";
  if (e.splitStrategy === "PORCENTAJE_CUSTOM") return `Osmar ${e.osmarPct ?? 50}% · Álex ${100 - (e.osmarPct ?? 50)}%`;
  return "Osmar 50% · Álex 50%";
}

const EXPENSE_CATEGORIES = [
  { id: "proveedor", label: "Proveedor" },
  { id: "servicios", label: "Servicios" },
  { id: "alquiler", label: "Alquiler" },
  { id: "transporte", label: "Transporte" },
  { id: "personal", label: "Personal" },
  { id: "mantenimiento", label: "Mantenimiento" },
  { id: "impuestos", label: "Impuestos" },
  { id: "otros", label: "Otros" },
] as const;

function categoryLabel(name: string | null | undefined) {
  if (!name) return "Otros";
  const n = name.trim().toLowerCase();
  const hit = EXPENSE_CATEGORIES.find((c) => c.label.toLowerCase() === n || c.id === n);
  return hit?.label ?? name;
}

function categoryIcon(cat: string) {
  const c = cat.trim().toLowerCase();
  if (c.includes("servicio") || c.includes("luz") || c.includes("electric") || c.includes("agua")) return Bolt;
  if (c.includes("alquiler") || c.includes("renta") || c.includes("local")) return Home;
  if (c.includes("transporte") || c.includes("gas") || c.includes("combust")) return Truck;
  if (c.includes("mantenimiento") || c.includes("repar")) return Wrench;
  if (c.includes("proveedor") || c.includes("invent") || c.includes("compra") || c.includes("producto")) return Package;
  if (c.includes("impuesto") || c.includes("banco") || c.includes("comisión") || c.includes("tarjeta")) return CreditCard;
  if (c.includes("comida") || c.includes("almuerzo") || c.includes("merienda")) return UtensilsCrossed;
  return Tag;
}

type SplitStrategy = "PARTES_IGUALES" | "PORCENTAJE_CUSTOM" | "UN_SOLO_DUENO";
type OwnerName = "OSMAR" | "ALEX";

function splitOwnerShare(exp: { splitStrategy: string; osmarPct: number | null; singleOwner: string | null }) {
  if (exp.splitStrategy === "UN_SOLO_DUENO") return exp.singleOwner === "ALEX" ? { osmarPct: 0, alexPct: 100 } : { osmarPct: 100, alexPct: 0 };
  if (exp.splitStrategy === "PORCENTAJE_CUSTOM") {
    const o = Math.max(0, Math.min(100, exp.osmarPct ?? 50));
    return { osmarPct: o, alexPct: 100 - o };
  }
  return { osmarPct: 50, alexPct: 50 };
}

export default function GastosPage() {
  const toast = useToast();
  const today = useMemo(() => utcTodayYmd(), []);
  const firstOfMonth = useMemo(() => {
    const [y, m] = today.split("-");
    return `${y}-${m}-01`;
  }, [today]);
  const [fromDay, setFromDay] = useState(() => firstOfMonth);
  const [toDay, setToDay] = useState(() => today);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");

  const [rows, setRows] = useState<ExpenseDto[]>([]);
  const [totals, setTotals] = useState<ApiResponse["totals"]>({ totalCents: 0, osmarCents: 0, alexCents: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const from = localDayRangeIso(fromDay).from;
      const to = localDayRangeIso(toDay).to;
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "400");
      // Filtrado por categoría: se hace por `q` en el server (categoryName contiene texto).
      if (category) params.set("q", `${q ? q.trim() + " " : ""}${categoryLabel(category)}`.trim());
      const res = await fetch(`/api/admin/expenses?${params.toString()}`, { credentials: "include" });
      const raw: unknown = await res.json().catch(() => null);
      const json = raw && typeof raw === "object" ? (raw as { expenses?: unknown; totals?: unknown; error?: unknown }) : null;
      if (!res.ok) {
        setErr(typeof json?.error === "string" ? json.error : "No se pudo cargar gastos.");
        setRows([]);
        setTotals({ totalCents: 0, osmarCents: 0, alexCents: 0 });
        return;
      }
      setRows(Array.isArray(json?.expenses) ? (json?.expenses as ExpenseDto[]) : []);
      const t = json?.totals;
      if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        setTotals({
          totalCents: Number(o.totalCents ?? 0) || 0,
          osmarCents: Number(o.osmarCents ?? 0) || 0,
          alexCents: Number(o.alexCents ?? 0) || 0,
        });
      } else {
        setTotals({ totalCents: 0, osmarCents: 0, alexCents: 0 });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setRows([]);
      setTotals({ totalCents: 0, osmarCents: 0, alexCents: 0 });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category, fromDay, q, toDay]);

  useEffect(() => {
    void load();
  }, [load]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(exp: ExpenseDto) {
    setEditing(exp);
    setModalOpen(true);
  }

  const visibleRows = useMemo(() => {
    if (!category) return rows;
    const wanted = categoryLabel(category).toLowerCase();
    return rows.filter((r) => (r.categoryName ?? "").toLowerCase() === wanted);
  }, [category, rows]);

  return (
    <AdminShell title="Gastos">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tl-welcome-header">Gastos</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Registra egresos (CUP/USD), categoría, responsable y reparto entre dueños.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
              {refreshing ? "Actualizando…" : "Actualizar"}
            </button>
            <button
              type="button"
              className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
              onClick={openCreate}
              disabled={refreshing}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo gasto
            </button>
          </div>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <section className="tl-glass rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Desde
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" aria-hidden />
                  <input
                    type="date"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={fromDay}
                    onChange={(e) => setFromDay(e.target.value)}
                  />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Hasta
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" aria-hidden />
                  <input
                    type="date"
                    className="tl-input h-10 px-3 text-sm normal-case font-normal"
                    value={toDay}
                    onChange={(e) => setToDay(e.target.value)}
                  />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Categoría
                <select
                  className="tl-input h-10 px-3 text-sm normal-case font-normal"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Todas</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Buscar
                <input
                  className="tl-input h-10 px-3 text-sm normal-case font-normal"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="electricidad, proveedor, alquiler…"
                />
              </label>
              <button
                type="button"
                className="tl-btn tl-btn-primary tl-interactive tl-press tl-focus !px-4 !py-2 text-sm"
                onClick={() => void load()}
                disabled={refreshing}
              >
                Aplicar
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-tl-line bg-tl-canvas px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">Total</div>
                <div className="mt-1 text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.totalCents} />
                </div>
              </div>
              <div className="rounded-2xl border border-tl-line bg-tl-canvas px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">Osmar</div>
                <div className="mt-1 text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.osmarCents} />
                </div>
              </div>
              <div className="rounded-2xl border border-tl-line bg-tl-canvas px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">Álex</div>
                <div className="mt-1 text-lg font-bold text-tl-ink">
                  <CupUsdMoney cents={totals.alexCents} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="tl-glass overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-tl-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-tl-ink">Listado</p>
              <p className="mt-0.5 text-xs text-tl-muted">
                {visibleRows.length.toLocaleString("es-ES")} gasto(s) en el rango seleccionado.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3 w-[140px]">Fecha</th>
                  <th className="px-4 py-3">Concepto</th>
                  <th className="px-4 py-3 w-[170px]">Categoría</th>
                  <th className="px-4 py-3 w-[140px] text-right">Monto</th>
                  <th className="px-4 py-3 w-[160px]">Responsable</th>
                  <th className="px-4 py-3 w-[220px]">Reparto</th>
                  <th className="px-4 py-3 w-[120px] text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-tl-canvas-inset" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-64 rounded bg-tl-canvas-inset" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 rounded bg-tl-canvas-inset" /></td>
                      <td className="px-4 py-3 text-right"><div className="ml-auto h-4 w-24 rounded bg-tl-canvas-inset" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-tl-canvas-inset" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-40 rounded bg-tl-canvas-inset" /></td>
                      <td className="px-4 py-3 text-right"><div className="ml-auto h-8 w-20 rounded bg-tl-canvas-inset" /></td>
                    </tr>
                  ))
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-tl-muted">
                      No hay gastos para ese filtro.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => {
                    const cat = categoryLabel(r.categoryName);
                    const Icon = categoryIcon(cat);
                    return (
                      <tr key={r.id} className="hover:bg-tl-canvas-subtle/50">
                        <td className="px-4 py-3 text-xs tabular-nums text-tl-muted">
                          {new Date(r.occurredAt).toLocaleDateString("es-ES")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-tl-ink">{r.concept}</div>
                          {r.notes ? <div className="mt-0.5 line-clamp-1 text-xs text-tl-muted">{r.notes}</div> : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-1 text-xs font-semibold text-tl-ink">
                            <Icon className="h-4 w-4 text-tl-muted" aria-hidden />
                            {cat}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <TablePriceCupCell cupCents={r.amountCents} compact />
                        </td>
                        <td className="px-4 py-3 text-xs text-tl-muted">{r.paidBy ?? "—"}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-tl-muted">
                          {splitLabelNice(r)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="tl-btn tl-btn-secondary !px-2.5 !py-2 text-xs"
                              title="Editar"
                              onClick={() => openEdit(r)}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="tl-btn tl-btn-secondary !px-2.5 !py-2 text-xs"
                              title="Eliminar"
                              onClick={() => {
                                setConfirmDeleteId(r.id);
                                setConfirmDeleteOpen(true);
                              }}
                              disabled={deleteBusy}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <ExpenseModal
          open={modalOpen}
          editing={editing}
          defaultCategory={category || ""}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false);
            await load();
          }}
        />

        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Eliminar gasto"
          description="Esta acción no se puede deshacer. Se eliminará el registro del gasto."
          confirmLabel="Eliminar"
          destructive
          busy={deleteBusy}
          onClose={() => {
            if (deleteBusy) return;
            setConfirmDeleteOpen(false);
            setConfirmDeleteId(null);
          }}
          onConfirm={() => {
            if (!confirmDeleteId) return;
            void (async () => {
              setDeleteBusy(true);
              try {
                const res = await fetch(`/api/admin/expenses?id=${encodeURIComponent(confirmDeleteId)}`, {
                  method: "DELETE",
                  credentials: "include",
                  headers: { "x-tl-csrf": "1" },
                });
                const raw: unknown = await res.json().catch(() => null);
                if (!res.ok) {
                  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
                  toast.push({
                    kind: "error",
                    title: "No se pudo eliminar el gasto",
                    description:
                      (obj && typeof obj.error === "string" ? obj.error : "") ||
                      `Error HTTP ${res.status}`,
                  });
                  return;
                }
                await load();
                toast.push({ kind: "success", title: "Gasto eliminado" });
                setConfirmDeleteOpen(false);
                setConfirmDeleteId(null);
              } finally {
                setDeleteBusy(false);
              }
            })();
          }}
        />
      </div>
    </AdminShell>
  );
}

function ExpenseModal({
  open,
  editing,
  defaultCategory,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ExpenseDto | null;
  defaultCategory: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [concept, setConcept] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [notes, setNotes] = useState("");
  const [day, setDay] = useState(() => utcTodayYmd());

  const [currency, setCurrency] = useState<"CUP" | "USD">("CUP");
  const [amount, setAmount] = useState<string>("0");
  const [usdRateCup, setUsdRateCup] = useState<string>("");

  const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>("PARTES_IGUALES");
  const [osmarPct, setOsmarPct] = useState<number>(50);
  const [singleOwner, setSingleOwner] = useState<OwnerName>("OSMAR");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (!editing) {
      setConcept("");
      setCategoryName(defaultCategory || "Otros");
      setPaidBy("");
      setNotes("");
      setDay(utcTodayYmd());
      setCurrency("CUP");
      setAmount("0");
      setUsdRateCup("");
      setSplitStrategy("PARTES_IGUALES");
      setOsmarPct(50);
      setSingleOwner("OSMAR");
      return;
    }
    setConcept(editing.concept ?? "");
    setCategoryName(categoryLabel(editing.categoryName));
    setPaidBy(editing.paidBy ?? "");
    setNotes(editing.notes ?? "");
    setDay(editing.occurredAt.slice(0, 10));
    if (editing.currency === "USD") {
      setCurrency("USD");
      setAmount(String(((editing.originalAmount ?? 0) / 100).toFixed(2)));
      setUsdRateCup(editing.usdRateCup != null ? String(editing.usdRateCup) : "");
    } else {
      setCurrency("CUP");
      setAmount(String((editing.amountCents / 100).toFixed(2)));
      setUsdRateCup("");
    }
    setSplitStrategy(
      editing.splitStrategy === "PORCENTAJE_CUSTOM"
        ? "PORCENTAJE_CUSTOM"
        : editing.splitStrategy === "UN_SOLO_DUENO"
          ? "UN_SOLO_DUENO"
          : "PARTES_IGUALES",
    );
    setOsmarPct(editing.osmarPct ?? 50);
    setSingleOwner(editing.singleOwner === "ALEX" ? "ALEX" : "OSMAR");
  }, [defaultCategory, editing, open]);

  const split = useMemo(() => splitOwnerShare({ splitStrategy, osmarPct, singleOwner }), [osmarPct, singleOwner, splitStrategy]);

  if (!open) return null;

  async function save() {
    const c = concept.trim();
    if (!c) {
      setErr("El concepto es obligatorio.");
      return;
    }
    const amountNum = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setErr("El monto no es válido.");
      return;
    }
    const occurredAt = new Date(`${day}T12:00:00`).toISOString();
    const payload: Record<string, unknown> = {
      concept: c,
      categoryId: null,
      categoryName: categoryLabel(categoryName),
      currency,
      occurredAt,
      paidBy: paidBy.trim() || null,
      notes: notes.trim() || null,
      splitStrategy,
      osmarPct: splitStrategy === "PORCENTAJE_CUSTOM" ? osmarPct : undefined,
      singleOwner: splitStrategy === "UN_SOLO_DUENO" ? singleOwner : undefined,
    };
    if (currency === "USD") {
      payload.amountUsdCents = Math.round(amountNum * 100);
      const rate = Number(String(usdRateCup).trim());
      if (Number.isFinite(rate) && rate > 0) payload.usdRateCup = Math.round(rate);
    } else {
      payload.amountCupCents = Math.round(amountNum * 100);
    }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/expenses", {
        method: editing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
        setErr((obj && typeof obj.error === "string" ? obj.error : "") || `Error HTTP ${res.status}`);
        return;
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? "Editar gasto" : "Nuevo gasto"}
      description="Reparto: PARTES_IGUALES, PORCENTAJE_CUSTOM o UN_SOLO_DUENO."
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
    >
      <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Concepto</label>
                <input className="tl-input mt-1 h-10" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej: Electricidad, proveedor, alquiler…" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Categoría</label>
                  <select className="tl-input mt-1 h-10" value={categoryName} onChange={(e) => setCategoryName(e.target.value)}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.label}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Fecha</label>
                  <input type="date" className="tl-input mt-1 h-10" value={day} onChange={(e) => setDay(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Responsable</label>
                  <input className="tl-input mt-1 h-10" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} placeholder="Ej: Osmar / Álex / empleado" />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Moneda</label>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className={cn("tl-btn tl-btn-secondary flex-1 !py-2 text-sm", currency === "CUP" && "bg-tl-canvas-subtle")}
                      onClick={() => setCurrency("CUP")}
                      disabled={busy}
                    >
                      CUP
                    </button>
                    <button
                      type="button"
                      className={cn("tl-btn tl-btn-secondary flex-1 !py-2 text-sm", currency === "USD" && "bg-tl-canvas-subtle")}
                      onClick={() => setCurrency("USD")}
                      disabled={busy}
                    >
                      USD
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Monto ({currency})
                  </label>
                  <input
                    inputMode="decimal"
                    className="tl-input mt-1 h-10"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={currency === "USD" ? "Ej: 5.00" : "Ej: 125.00"}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Cambio USD→CUP (opcional)
                  </label>
                  <input
                    inputMode="numeric"
                    className={cn("tl-input mt-1 h-10", currency !== "USD" && "opacity-60")}
                    value={usdRateCup}
                    onChange={(e) => setUsdRateCup(e.target.value)}
                    placeholder="Ej: 520"
                    disabled={currency !== "USD"}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Notas</label>
                <textarea className="tl-input mt-1 min-h-[88px] resize-y p-3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional: detalles del gasto…" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-tl-line bg-tl-canvas-inset p-4">
                <p className="text-sm font-semibold text-tl-ink">Reparto entre dueños</p>
                <p className="mt-1 text-xs text-tl-muted">
                  Elige cómo se reparte este gasto entre <span className="font-semibold">Osmar</span> y <span className="font-semibold">Álex</span>.
                </p>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setSplitStrategy("PARTES_IGUALES")}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    splitStrategy === "PARTES_IGUALES" ? "border-tl-accent/40 bg-tl-canvas" : "border-tl-line bg-tl-canvas-inset hover:bg-tl-canvas",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-tl-ink">PARTES_IGUALES</p>
                    <span className="text-xs font-semibold text-tl-muted">Osmar 50% · Álex 50%</span>
                  </div>
                  <p className="mt-1 text-xs text-tl-muted">Reparto estándar, rápido y sin pensar.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setSplitStrategy("PORCENTAJE_CUSTOM")}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    splitStrategy === "PORCENTAJE_CUSTOM" ? "border-tl-accent/40 bg-tl-canvas" : "border-tl-line bg-tl-canvas-inset hover:bg-tl-canvas",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-tl-ink">PORCENTAJE_CUSTOM</p>
                    <span className="text-xs font-semibold text-tl-muted">
                      Osmar {osmarPct}% · Álex {100 - osmarPct}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-tl-muted">Define exactamente qué porcentaje paga cada uno.</p>
                  {splitStrategy === "PORCENTAJE_CUSTOM" ? (
                    <div className="mt-3">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">% Osmar</label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={osmarPct}
                        onChange={(e) => setOsmarPct(Math.max(0, Math.min(100, Number(e.target.value))))}
                        className="mt-2 w-full"
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-tl-line bg-tl-canvas-inset px-3 py-2">
                          <div className="font-semibold text-tl-ink">Osmar</div>
                          <div className="tabular-nums text-tl-muted">{osmarPct}%</div>
                        </div>
                        <div className="rounded-xl border border-tl-line bg-tl-canvas-inset px-3 py-2">
                          <div className="font-semibold text-tl-ink">Álex</div>
                          <div className="tabular-nums text-tl-muted">{100 - osmarPct}%</div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() => setSplitStrategy("UN_SOLO_DUENO")}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    splitStrategy === "UN_SOLO_DUENO" ? "border-tl-accent/40 bg-tl-canvas" : "border-tl-line bg-tl-canvas-inset hover:bg-tl-canvas",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-tl-ink">UN_SOLO_DUENO</p>
                    <span className="text-xs font-semibold text-tl-muted">
                      {singleOwner === "ALEX" ? "Álex 100%" : "Osmar 100%"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-tl-muted">Todo el gasto se asigna a un solo dueño.</p>
                  {splitStrategy === "UN_SOLO_DUENO" ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={cn(
                          "tl-btn tl-btn-secondary !py-2 text-sm",
                          singleOwner === "OSMAR" && "bg-tl-canvas-subtle",
                        )}
                        onClick={() => setSingleOwner("OSMAR")}
                      >
                        Osmar
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "tl-btn tl-btn-secondary !py-2 text-sm",
                          singleOwner === "ALEX" && "bg-tl-canvas-subtle",
                        )}
                        onClick={() => setSingleOwner("ALEX")}
                      >
                        Álex
                      </button>
                    </div>
                  ) : null}
                </button>
              </div>

              <div className="rounded-2xl border border-tl-line bg-tl-canvas-inset p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Vista rápida</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-tl-line bg-tl-canvas px-3 py-2">
                    <div className="text-xs font-semibold text-tl-ink">Osmar</div>
                    <div className="text-xs tabular-nums text-tl-muted">{split.osmarPct}%</div>
                  </div>
                  <div className="rounded-xl border border-tl-line bg-tl-canvas px-3 py-2">
                    <div className="text-xs font-semibold text-tl-ink">Álex</div>
                    <div className="text-xs tabular-nums text-tl-muted">{split.alexPct}%</div>
                  </div>
                </div>
              </div>

              {err ? (
                <div className="rounded-2xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                  {err}
                </div>
              ) : null}
            </div>
          </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-tl-line pt-4">
            <button type="button" className="tl-btn tl-btn-secondary !px-4 !py-2" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="tl-btn tl-btn-primary !px-4 !py-2" onClick={() => void save()} disabled={busy}>
              {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear gasto"}
            </button>
          </div>
    </Modal>
  );
}

