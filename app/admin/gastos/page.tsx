"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DataTable, type Column } from "@/components/admin/data-table";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { cn } from "@/lib/utils";

type ExpenseCategoryDto = { id: string; name: string; active: boolean };

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

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function splitLabel(e: ExpenseDto) {
  if (e.splitStrategy === "UN_SOLO_DUENO") return e.singleOwner ?? "—";
  if (e.splitStrategy === "PORCENTAJE_CUSTOM") return `Osmar ${e.osmarPct ?? 50}%`;
  return "50/50";
}

export default function GastosPage() {
  const today = useMemo(() => utcTodayYmd(), []);
  const [from, setFrom] = useState(() => `${today}T00:00:00.000Z`);
  const [to, setTo] = useState(() => `${today}T23:59:59.999Z`);
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  const [categories, setCategories] = useState<ExpenseCategoryDto[]>([]);
  const [rows, setRows] = useState<ExpenseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const totals = useMemo(() => rows.reduce((acc, r) => acc + (r.amountCents ?? 0), 0), [rows]);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/admin/expense-categories", { credentials: "include" });
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      setCategories([]);
      return;
    }
    const j = raw && typeof raw === "object" ? (raw as { categories?: unknown }).categories : undefined;
    const arr = Array.isArray(j) ? j : [];
    setCategories(
      arr
        .filter((c): c is { id: unknown; name: unknown; active: unknown } => c != null && typeof c === "object")
        .map((c) => ({
          id: String(c.id ?? ""),
          name: String(c.name ?? ""),
          active: Boolean(c.active),
        }))
        .filter((c) => c.id && c.name),
    );
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q.trim()) params.set("q", q.trim());
      if (categoryId) params.set("categoryId", categoryId);
      params.set("limit", "400");
      const res = await fetch(`/api/admin/expenses?${params.toString()}`, { credentials: "include" });
      const raw: unknown = await res.json().catch(() => null);
      const json = raw && typeof raw === "object" ? (raw as { expenses?: unknown; error?: unknown }) : null;
      if (!res.ok) {
        setErr(typeof json?.error === "string" ? json.error : "No se pudo cargar gastos.");
        setRows([]);
        return;
      }
      setRows(Array.isArray(json?.expenses) ? (json?.expenses as ExpenseDto[]) : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryId, from, q, to]);

  useEffect(() => {
    void loadCategories();
    void load();
  }, [load, loadCategories]);

  const columns: Column<ExpenseDto>[] = [
    {
      key: "occurredAt",
      label: "Fecha",
      sortable: true,
      width: "160px",
      render: (r) => (
        <span className="text-xs tabular-nums text-tl-muted">
          {new Date(r.occurredAt).toLocaleString("es-ES", { year: "numeric", month: "2-digit", day: "2-digit" })}
        </span>
      ),
    },
    {
      key: "concept",
      label: "Concepto",
      sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-tl-ink">{r.concept}</div>
          <div className="truncate text-xs text-tl-muted">{r.categoryName ?? "Sin categoría"}</div>
        </div>
      ),
    },
    {
      key: "amountCents",
      label: "Monto",
      align: "right",
      sortable: true,
      width: "140px",
      render: (r) => <TablePriceCupCell cupCents={r.amountCents} compact />,
    },
    {
      key: "paidBy",
      label: "Responsable",
      width: "140px",
      render: (r) => <span className="text-xs text-tl-muted">{r.paidBy ?? "—"}</span>,
    },
    {
      key: "splitStrategy",
      label: "Reparto",
      width: "140px",
      render: (r) => <span className="text-xs font-semibold text-tl-muted">{splitLabel(r)}</span>,
    },
    {
      key: "__actions",
      label: "",
      width: "70px",
      align: "right",
      render: (r) => (
        <button
          type="button"
          className="tl-btn tl-btn-secondary !px-2 !py-2 text-xs"
          title="Eliminar gasto"
          onClick={async (e) => {
            e.stopPropagation();
            const pin = window.prompt("PIN para eliminar gasto:", "");
            if (!pin) return;
            const ok = window.confirm("¿Eliminar este gasto? Esto quedará auditado.");
            if (!ok) return;
            const res = await fetch(`/api/admin/expenses?id=${encodeURIComponent(r.id)}`, {
              method: "DELETE",
              credentials: "include",
              headers: { "x-tl-csrf": "1", "x-tl-pin": pin },
            });
            const j = await res.json().catch(() => null);
            if (!res.ok) {
              window.alert(j?.error ?? `Error HTTP ${res.status}`);
              return;
            }
            await load();
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ),
    },
  ];

  async function createExpenseQuick() {
    const concept = window.prompt("Concepto:", "")?.trim() ?? "";
    if (!concept) return;
    const amount = window.prompt("Monto CUP (ej. 125.00):", "0") ?? "0";
    const n = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    const amountCupCents = Math.round(n * 100);
    const occurredAt = new Date().toISOString();
    const split = (window.prompt("Reparto: PARTES_IGUALES / PORCENTAJE_CUSTOM / UN_SOLO_DUENO", "PARTES_IGUALES") ?? "PARTES_IGUALES").toUpperCase();
    const payload: Record<string, unknown> = {
      concept,
      occurredAt,
      currency: "CUP",
      amountCupCents,
      splitStrategy: split,
      categoryId: categoryId || null,
    };
    if (split === "PORCENTAJE_CUSTOM") {
      const pct = Number(window.prompt("% Osmar (0-100)", "50") ?? "50");
      payload.osmarPct = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 50;
    }
    if (split === "UN_SOLO_DUENO") {
      payload.singleOwner = (window.prompt("Dueño: OSMAR / ALEX", "OSMAR") ?? "OSMAR").toUpperCase();
    }
    const res = await fetch("/api/admin/expenses", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-tl-csrf": "1" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      window.alert(j?.error ?? `Error HTTP ${res.status}`);
      return;
    }
    await load();
  }

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
              onClick={() => void createExpenseQuick()}
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

        <div className="tl-glass rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Desde (ISO)
              <input className="tl-input h-10 px-3 text-xs normal-case" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Hasta (ISO)
              <input className="tl-input h-10 px-3 text-xs normal-case" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Categoría
              <select className="tl-input h-10 px-3 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Todas</option>
                {categories.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              Buscar
              <input className="tl-input h-10 px-3 text-sm normal-case font-normal" value={q} onChange={(e) => setQ(e.target.value)} placeholder="electricidad, alquiler..." />
            </label>
            <div className="ml-auto rounded-xl border border-tl-line bg-tl-canvas-inset px-4 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Total (filtrado)</div>
              <div className="mt-1 text-lg font-bold text-tl-ink">
                <CupUsdMoney cents={totals} />
              </div>
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          keyExtractor={(r) => r.id}
          searchable={false}
          emptyMessage="No hay gastos en el rango/filtro."
          maxHeight="calc(100vh - 360px)"
          loading={loading}
          skeletonRows={10}
        />
      </div>
    </AdminShell>
  );
}

