"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookMarked,
  Calendar,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
} from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { cn } from "@/lib/utils";

type SupplierRow = {
  supplier: string;
  products: number;
  units: number;
  revenueCents: number;
  profitCents: number;
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

export default function SuppliersPage() {
  const todayInput = useMemo(() => toInputDate(new Date()), []);
  const [pageTab, setPageTab] = useState<"ranking" | "maestro">("ranking");
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
    if (pageTab === "maestro") void loadMasters();
  }, [pageTab, loadMasters]);

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
        setError(json.meta?.message ?? "No se pudo cargar proveedores.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red al cargar proveedores.");
    } finally {
      setLoading(false);
    }
  }, [mode, days, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sin auto-refresh: solo carga inicial y botón Actualizar.

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

  const topProductsBySupplier = useMemo(() => {
    const m = new Map<string, SupplierTopProduct[]>();
    for (const p of data?.topProducts ?? []) {
      const arr = m.get(p.supplier) ?? [];
      arr.push(p);
      m.set(p.supplier, arr);
    }
    return m;
  }, [data]);

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
        headers: { "Content-Type": "application/json" },
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

  function openEditMaster(s: MasterSupplier) {
    setEditMaster(s);
    setEMName(s.name);
    setEMPhone(s.phone ?? "");
    setEMNotes(s.notes ?? "");
  }

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
        headers: { "Content-Type": "application/json" },
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

  async function toggleMasterActive(s: MasterSupplier) {
    setMastersErr(null);
    const res = await fetch(`/api/admin/suppliers/${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    if (!res.ok) {
      setMastersErr("No se pudo cambiar el estado.");
      return;
    }
    await loadMasters();
  }

  async function onDeleteMaster(s: MasterSupplier) {
    if (
      !window.confirm(
        `¿Eliminar el proveedor «${s.name}» del nomenclador?\n\nSolo se permite si no hay productos vinculados.`,
      )
    ) {
      return;
    }
    setDeleteBusyId(s.id);
    setMastersErr(null);
    try {
      const res = await fetch(`/api/admin/suppliers/${encodeURIComponent(s.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; productCount?: number };
      if (res.status === 409 && j.error === "SUPPLIER_IN_USE") {
        window.alert(
          `No se puede borrar: hay ${j.productCount ?? 0} producto(s) con este proveedor. Desvincúlalos desde Inventario o archívalos.`,
        );
        return;
      }
      if (!res.ok) {
        window.alert("No se pudo eliminar.");
        return;
      }
      await loadMasters();
    } finally {
      setDeleteBusyId(null);
    }
  }

  return (
    <AdminShell title="Proveedores">
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="tl-welcome-header">Proveedores</h1>
              <p className="mt-2 text-sm text-tl-muted">
                {pageTab === "ranking"
                  ? "Ranking por proveedor: productos, unidades vendidas, ingresos y ganancia estimada (según costo)."
                  : "Nomenclador de la tienda: nombres que verás al crear productos y en informes. Los inactivos no se ofrecen en altas nuevas."}
              </p>
            </div>

            <div className="tl-glass flex shrink-0 flex-wrap gap-1 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setPageTab("ranking")}
                className={cn(
                  "tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs",
                  pageTab === "ranking" && "ring-1 ring-tl-accent/30",
                )}
              >
                <Truck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                Ventas por proveedor
              </button>
              <button
                type="button"
                onClick={() => setPageTab("maestro")}
                className={cn(
                  "tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs",
                  pageTab === "maestro" && "ring-1 ring-tl-accent/30",
                )}
              >
                <BookMarked className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                Nomenclador
              </button>
            </div>
          </div>

          {pageTab === "ranking" ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="tl-glass flex items-center gap-2 rounded-xl px-3 py-2">
              <button
                type="button"
                className={cn(
                  "tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs",
                  mode === "days" && "ring-1 ring-tl-accent/30",
                )}
                onClick={() => setMode("days")}
              >
                Últimos días
              </button>
              <button
                type="button"
                className={cn(
                  "tl-btn tl-btn-secondary !px-3 !py-1.5 text-xs",
                  mode === "range" && "ring-1 ring-tl-accent/30",
                )}
                onClick={() => setMode("range")}
              >
                Rango
              </button>
            </div>

            {mode === "days" ? (
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                <Calendar className="h-4 w-4" aria-hidden />
                <select
                  className="tl-input h-9 px-3 py-1 text-xs sm:text-sm"
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
              <>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  <Calendar className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Desde</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  <span className="hidden sm:inline">Hasta</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
                  />
                </label>
              </>
            )}

            <button
              type="button"
              onClick={() => void load()}
              className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
              disabled={loading}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
              Actualizar
            </button>
          </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void loadMasters()}
                className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm"
                disabled={mastersLoading}
                title="Actualizar nomenclador"
              >
                <RefreshCw className={cn("h-4 w-4", mastersLoading && "animate-spin")} aria-hidden />
                Actualizar
              </button>
            </div>
          )}
        </div>

        {pageTab === "maestro" ? (
          <>
            {mastersErr && (
              <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                {mastersErr}
              </div>
            )}

            <section className="tl-glass rounded-xl p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-tl-ink">
                <Plus className="h-4 w-4 text-tl-accent" aria-hidden />
                Nuevo proveedor
              </h2>
              <form onSubmit={onCreateMaster} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="text-xs text-tl-muted" htmlFor="ms-name">
                    Nombre
                  </label>
                  <input
                    id="ms-name"
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    className="tl-input mt-1"
                    placeholder="Ej. Distribuidora X"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ms-phone">
                    Teléfono
                  </label>
                  <input
                    id="ms-phone"
                    value={mPhone}
                    onChange={(e) => setMPhone(e.target.value)}
                    className="tl-input mt-1"
                    placeholder="opcional"
                  />
                </div>
                <div>
                  <label className="text-xs text-tl-muted" htmlFor="ms-notes">
                    Notas
                  </label>
                  <input
                    id="ms-notes"
                    value={mNotes}
                    onChange={(e) => setMNotes(e.target.value)}
                    className="tl-input mt-1"
                    placeholder="opcional"
                  />
                </div>
                <div className="flex items-end sm:col-span-2 lg:col-span-4">
                  <button type="submit" disabled={mBusy} className="tl-btn-primary">
                    {mBusy ? "Guardando…" : "Añadir al nomenclador"}
                  </button>
                </div>
              </form>
            </section>

            <section className="tl-glass rounded-xl p-4">
              <h2 className="text-sm font-semibold text-tl-ink">Proveedores registrados</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                    <tr>
                      <th className="px-4 py-3">Nombre</th>
                      <th className="px-4 py-3">Teléfono</th>
                      <th className="px-4 py-3 text-right">Productos</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tl-line-subtle">
                    {mastersLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 5 }).map((__, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="tl-skeleton h-3 rounded-md" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : masters.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-tl-muted">
                          No hay proveedores en el nomenclador. Crea el primero con el formulario de arriba; luego
                          podrás elegirlos al dar de alta productos en Inventario.
                        </td>
                      </tr>
                    ) : (
                      masters.map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-3 font-medium text-tl-ink">{s.name}</td>
                          <td className="px-4 py-3 text-tl-muted">{s.phone ?? "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                            {s.productCount.toLocaleString("es-ES")}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => void toggleMasterActive(s)}
                              className={cn(
                                "rounded-lg px-2 py-1 text-xs font-medium",
                                s.active
                                  ? "bg-tl-success-subtle text-tl-success"
                                  : "bg-tl-canvas-subtle text-tl-muted",
                              )}
                            >
                              {s.active ? "Activo" : "Inactivo"}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => openEditMaster(s)}
                              className="tl-btn tl-btn-secondary !px-2 !py-1 text-xs"
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDeleteMaster(s)}
                              disabled={deleteBusyId === s.id || s.productCount > 0}
                              className="tl-btn tl-btn-secondary !ml-2 !px-2 !py-1 text-xs disabled:opacity-40"
                              title={s.productCount > 0 ? "Hay productos vinculados" : "Eliminar"}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-tl-muted">
                Inactivo: no aparece en el desplegable de nuevos productos; los ya vinculados siguen mostrando el
                nombre. Eliminar solo está permitido sin productos asociados.
              </p>
            </section>

            {editMaster && (
              <div
                className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-supplier-title"
                onClick={() => setEditMaster(null)}
              >
                <div
                  className="tl-glass w-full max-w-md rounded-2xl p-5 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="edit-supplier-title" className="text-lg font-semibold text-tl-ink">
                    Editar proveedor
                  </h2>
                  <form onSubmit={onSaveEditMaster} className="mt-4 space-y-3">
                    <div>
                      <label className="text-xs text-tl-muted" htmlFor="ems-name">
                        Nombre
                      </label>
                      <input
                        id="ems-name"
                        value={eMName}
                        onChange={(e) => setEMName(e.target.value)}
                        className="tl-input mt-1"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-tl-muted" htmlFor="ems-phone">
                        Teléfono
                      </label>
                      <input
                        id="ems-phone"
                        value={eMPhone}
                        onChange={(e) => setEMPhone(e.target.value)}
                        className="tl-input mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-tl-muted" htmlFor="ems-notes">
                        Notas
                      </label>
                      <textarea
                        id="ems-notes"
                        value={eMNotes}
                        onChange={(e) => setEMNotes(e.target.value)}
                        rows={3}
                        className="tl-input mt-1"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        className="tl-btn tl-btn-secondary"
                        onClick={() => setEditMaster(null)}
                      >
                        Cancelar
                      </button>
                      <button type="submit" disabled={eMBusy} className="tl-btn-primary">
                        {eMBusy ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Proveedores activos"
              value={String(data?.suppliers.length ?? 0)}
              icon={<Truck className="h-4 w-4" />}
            />
            <KpiCard
              label="Top ingresos"
              value={topByRevenue ? <CupUsdMoney cents={topByRevenue.revenueCents} /> : "—"}
              hint={topByRevenue?.supplier}
              variant="info"
            />
            <KpiCard
              label="Top ganancia"
              value={topByProfit ? <CupUsdMoney cents={topByProfit.profitCents} /> : "—"}
              hint={topByProfit?.supplier}
              variant="success"
            />
            <KpiCard
              label="Más productos"
              value={topByProducts ? String(topByProducts.products) : "—"}
              hint={topByProducts?.supplier}
            />
          </div>
        </section>

        <section className="tl-glass rounded-xl p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-tl-muted" aria-hidden />
              <p className="text-sm font-semibold text-tl-ink">Resumen por proveedor</p>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar proveedor…"
              className="tl-input h-9 w-full sm:w-[260px]"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-subtle text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3 text-right">Productos</th>
                  <th className="px-4 py-3 text-right">Unidades vendidas</th>
                  <th className="px-4 py-3 text-right">Ingresos</th>
                  <th className="px-4 py-3 text-right">Ganancia (estim.)</th>
                  <th className="px-4 py-3 text-right">Costos faltantes</th>
                  <th className="px-4 py-3">Top productos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="tl-skeleton h-3 rounded-md" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : suppliersFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-tl-muted">
                      No hay datos para el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  suppliersFiltered.map((s) => {
                    const tops = topProductsBySupplier.get(s.supplier) ?? [];
                    return (
                      <tr key={s.supplier}>
                        <td className="px-4 py-3 font-medium text-tl-ink">{s.supplier}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                          {s.products.toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-ink">
                          {s.units.toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3 text-right text-tl-ink align-top">
                          <TablePriceCupCell cupCents={s.revenueCents} compact />
                        </td>
                        <td className="px-4 py-3 text-right text-tl-ink align-top">
                          <TablePriceCupCell cupCents={s.profitCents} compact />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-tl-muted">
                          {s.linesMissingCost > 0 ? s.linesMissingCost.toLocaleString("es-ES") : "0"}
                        </td>
                        <td className="px-4 py-3">
                          {tops.length === 0 ? (
                            <span className="text-xs text-tl-muted">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {tops.map((p) => (
                                <li key={p.productId} className="flex items-center justify-between gap-3">
                                  <span className="truncate text-xs text-tl-ink">
                                    {p.name}
                                    {p.sku ? (
                                      <span className="ml-2 font-mono text-[10px] text-tl-muted">
                                        {p.sku}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-xs tabular-nums text-tl-muted">
                                    {p.units} u · <TablePriceCupCell cupCents={p.revenueCents} compact />
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-xs text-tl-muted">
            La ganancia mostrada es estimada (precio de venta menos costo del producto, por unidad). Si falta
            el costo en ficha de producto, esa venta cuenta en “Costos faltantes” y no suma a la ganancia.
          </div>
        </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}

