"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LandmarkLucideIcon as Landmark,
  PieChartIcon as PieChart,
  RefreshCwIcon as RefreshCw,
  UsersLucideIcon as Users,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { formatCup } from "@/lib/money";
import { cn } from "@/lib/utils";

type OwnerSaleLineDto = {
  id: string;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  quantity: number;
  unitCostCents: number;
  subtotalCents: number;
};

type OwnerSalesSummaryPayload = {
  meta: { dbAvailable: boolean; note?: string; message?: string };
  window: { mode: "day" | "month"; key: string } | null;
  totals: { OSMAR: number; ALEX: number; totalCents: number; count: number };
  ledger?: {
    window: { pendingCents: number; pendingCount: number; paidCents: number; paidCount: number };
    all: { pendingCents: number; pendingCount: number; paidCents: number; paidCount: number };
  };
  sales: {
    id: string;
    owner: "OSMAR" | "ALEX";
    status: "PENDING_PAYMENT" | "PAID";
    totalCents: number;
    createdAt: string;
    paidAt: string | null;
    paidSaleId: string | null;
    lineCount: number;
    lines: OwnerSaleLineDto[];
  }[];
};

type AdminSearchPayload = {
  meta: { dbAvailable: boolean };
  q: string;
  products: {
    id: string;
    sku: string;
    name: string;
    priceCents: number;
    costCents: number | null;
    stockQty: number;
    active: boolean;
    deletedAt: string | null;
  }[];
};

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function ownerLabel(o: "OSMAR" | "ALEX") {
  return o === "OSMAR" ? "Osmar" : "Álex";
}

export default function OwnersPage() {
  const today = useMemo(() => utcTodayYmd(), []);
  const [tab, setTab] = useState<"resumen" | "consumos">("consumos");
  const [mode, setMode] = useState<"day" | "month">("day");
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<OwnerSalesSummaryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalWho, setModalWho] = useState<"OSMAR" | "ALEX">("OSMAR");
  const [modalQ, setModalQ] = useState("");
  const [modalHits, setModalHits] = useState<AdminSearchPayload["products"]>([]);
  const [modalLines, setModalLines] = useState<
    { productId: string; sku: string; name: string; unitCostCents: number; stockQty: number; quantity: number }[]
  >([]);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalMsg, setModalMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("mode", mode);
      if (mode === "day") params.set("date", day);
      else params.set("month", month);
      const res = await fetch(`/api/admin/owner-sales/summary?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as OwnerSalesSummaryPayload;
      setData(json);
      if (!res.ok) setErr(json.meta?.message ?? "No se pudo cargar.");
      else if (json.meta?.dbAvailable === false && json.meta?.message) setErr(json.meta.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [day, mode, month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell title="Dueños">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tl-welcome-header">Ingresos / gastos entre dueños</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Vista resumida del consumo/deuda de dueños (a costo proveedor) y su estado (pendiente/pagada).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
            Actualizar
          </button>
        </div>

        {err ? (
          <div className="rounded-xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              "tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
              tab === "consumos" && "bg-tl-canvas-subtle",
            )}
            onClick={() => setTab("consumos")}
          >
            Consumos / deudas
          </button>
          <button
            type="button"
            className={cn(
              "tl-btn tl-btn-secondary tl-interactive tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
              tab === "resumen" && "bg-tl-canvas-subtle",
            )}
            onClick={() => setTab("resumen")}
          >
            Resumen
          </button>
        </div>

        <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
              Ventana
              <select className="tl-input h-10 px-3 text-sm" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                <option value="day">Diario</option>
                <option value="month">Mensual</option>
              </select>
            </label>
            {mode === "day" ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Día
                <input type="date" className="tl-input h-10 px-3 text-sm" value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs font-medium text-tl-muted">
                Mes
                <input type="month" className="tl-input h-10 px-3 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
              </label>
            )}
            <button type="button" onClick={() => void load()} className="tl-btn tl-btn-primary inline-flex h-10 items-center gap-2 self-end" disabled={loading}>
              <Landmark className="h-4 w-4" aria-hidden />
              Calcular
            </button>
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setModalMsg(null);
                setModalQ("");
                setModalHits([]);
                setModalLines([]);
              }}
              className="tl-btn tl-btn-secondary inline-flex h-10 items-center gap-2 self-end"
              disabled={loading}
              title="Descuenta stock y queda pendiente por pagar"
            >
              <Users className="h-4 w-4" aria-hidden />
              Registrar consumo
            </button>
          </div>
          {data?.meta?.note ? <p className="mt-3 text-xs text-tl-muted">{data.meta.note}</p> : null}
        </section>

        {tab === "resumen" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              variant="default"
              label="Pendiente (total)"
              value={<CupUsdMoney cents={data?.ledger?.all?.pendingCents ?? 0} />}
              hint={`${data?.ledger?.all?.pendingCount ?? 0} registro(s)`}
              icon={<Users className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="warning"
              label="Pendiente (ventana)"
              value={<CupUsdMoney cents={data?.ledger?.window?.pendingCents ?? 0} />}
              hint={`${data?.ledger?.window?.pendingCount ?? 0} registro(s)`}
              icon={<Users className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="success"
              label="Pagado (ventana)"
              value={<CupUsdMoney cents={data?.ledger?.window?.paidCents ?? 0} />}
              hint={`${data?.ledger?.window?.paidCount ?? 0} registro(s)`}
              icon={<Users className="h-5 w-5" aria-hidden />}
            />
            <KpiCard
              variant="info"
              label="Total pendiente (por dueño)"
              value={<CupUsdMoney cents={data?.totals?.totalCents ?? 0} />}
              hint={`${data?.totals?.count ?? 0} deuda(s) pendiente(s)`}
              icon={<PieChart className="h-5 w-5" aria-hidden />}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {data?.ledger ? (
              <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-4 py-3 text-xs text-tl-muted">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <span className="tabular-nums">
                    Pendiente (ventana):{" "}
                    <span className="font-semibold text-tl-ink">{formatCup(data.ledger.window.pendingCents)}</span> ·{" "}
                    {data.ledger.window.pendingCount} registro(s)
                  </span>
                  <span className="tabular-nums">
                    Pagado (ventana): <span className="font-semibold text-tl-ink">{formatCup(data.ledger.window.paidCents)}</span>{" "}
                    · {data.ledger.window.paidCount} registro(s)
                  </span>
                  <span className="tabular-nums">
                    Pendiente (total): <span className="font-semibold text-tl-ink">{formatCup(data.ledger.all.pendingCents)}</span>{" "}
                    · {data.ledger.all.pendingCount} registro(s)
                  </span>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                variant="default"
                label="Osmar"
                value={<CupUsdMoney cents={data?.totals?.OSMAR ?? 0} />}
                hint={`${(data?.sales ?? []).filter((s) => s.owner === "OSMAR" && s.status === "PENDING_PAYMENT").length} pendiente(s)`}
                icon={<Users className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="default"
                label="Álex"
                value={<CupUsdMoney cents={data?.totals?.ALEX ?? 0} />}
                hint={`${(data?.sales ?? []).filter((s) => s.owner === "ALEX" && s.status === "PENDING_PAYMENT").length} pendiente(s)`}
                icon={<Users className="h-5 w-5" aria-hidden />}
              />
              <KpiCard
                variant="info"
                label="Total"
                value={<CupUsdMoney cents={data?.totals?.totalCents ?? 0} />}
                hint={`${data?.totals?.count ?? 0} deuda(s) pendiente(s)`}
                icon={<PieChart className="h-5 w-5" aria-hidden />}
              />
            </div>

            <div className="mt-3 overflow-x-auto tl-glass rounded-xl">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Dueño</th>
                    <th className="px-4 py-3 text-right">Líneas</th>
                    <th className="px-4 py-3 min-w-[280px]">Productos</th>
                    <th className="px-4 py-3 text-right">Total (CUP)</th>
                    <th className="px-4 py-3 text-right">Pago</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tl-line-subtle">
                  {(data?.sales ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-tl-muted">
                        No hay consumos registrados en esta ventana.
                      </td>
                    </tr>
                  ) : (
                    (data?.sales ?? []).map((s) => {
                      const detailLines = s.lines ?? [];
                      const isPending = s.status === "PENDING_PAYMENT";
                      return (
                        <tr key={s.id}>
                          <td className="px-4 py-3 tabular-nums text-tl-ink align-top">
                            {new Date(s.createdAt).toLocaleString("es-ES")}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                                isPending
                                  ? "bg-tl-warning-subtle text-tl-warning border border-tl-warning/20"
                                  : "bg-tl-success-subtle text-tl-success border border-tl-success/20",
                              )}
                            >
                              {isPending ? "Pendiente" : "Pagada"}
                            </span>
                            {!isPending && s.paidAt ? (
                              <div className="mt-1 text-[11px] tabular-nums text-tl-muted">
                                {new Date(s.paidAt).toLocaleString("es-ES")}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-tl-ink align-top">{ownerLabel(s.owner)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-tl-muted align-top">{s.lineCount}</td>
                          <td className="px-4 py-3 align-top text-tl-ink-secondary">
                            {detailLines.length === 0 ? (
                              <span className="text-xs text-tl-muted">Sin detalle de líneas en BD.</span>
                            ) : (
                              <details className="group max-w-md">
                                <summary className="cursor-pointer list-none text-xs font-semibold text-tl-accent hover:underline [&::-webkit-details-marker]:hidden">
                                  Ver {detailLines.length} producto{detailLines.length === 1 ? "" : "s"}
                                </summary>
                                <ul className="mt-2 space-y-2 rounded-lg border border-tl-line-subtle bg-tl-canvas-inset p-3 text-xs">
                                  {detailLines.map((l) => {
                                    const name = l.productName?.trim() || "Sin nombre en registro";
                                    const sku = l.productSku?.trim() || "—";
                                    return (
                                      <li key={l.id} className="border-b border-tl-line-subtle/60 pb-2 last:border-0 last:pb-0">
                                        <div className="font-medium text-tl-ink">{name}</div>
                                        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                          <span className="font-mono text-tl-muted">SKU {sku}</span>
                                          <span className="tabular-nums text-tl-muted">
                                            {l.quantity} ud × {formatCup(l.unitCostCents)}
                                          </span>
                                        </div>
                                        <div className="mt-1 text-right tabular-nums text-tl-ink">
                                          Subtotal: <TablePriceCupCell cupCents={l.subtotalCents} compact />
                                        </div>
                                        {!l.productName?.trim() && !l.productSku?.trim() && l.productId ? (
                                          <div className="mt-1 font-mono text-[10px] text-tl-muted">id: {l.productId}</div>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </details>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            <TablePriceCupCell cupCents={s.totalCents} compact />
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            {isPending ? (
                              <button
                                type="button"
                                className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
                                onClick={async () => {
                                  setErr(null);
                                  try {
                                    const res = await fetch("/api/admin/owner-sales/pay", {
                                      method: "POST",
                                      credentials: "include",
                                      headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                                      body: JSON.stringify({ ownerSaleId: s.id }),
                                    });
                                    const json = (await res.json()) as any;
                                    if (!res.ok) {
                                      setErr(json?.error ?? "No se pudo marcar como pagada.");
                                      return;
                                    }
                                    await load();
                                  } catch (e) {
                                    setErr(e instanceof Error ? e.message : "Error de red al pagar.");
                                  }
                                }}
                              >
                                Pagar
                              </button>
                            ) : (
                              <span className="text-xs text-tl-muted">{s.paidSaleId ? "Registrada" : "—"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {modalOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-50 bg-black/35"
              onClick={() => setModalOpen(false)}
              aria-label="Cerrar modal"
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-[720px] rounded-2xl border border-tl-line bg-tl-canvas shadow-xl">
                <div className="flex items-start justify-between gap-3 border-b border-tl-line px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-tl-ink">Registrar consumo</p>
                    <p className="mt-0.5 text-xs text-tl-muted">Se descuenta stock y queda pendiente por pagar.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
                  >
                    Cerrar
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                      Dueño
                      <select
                        className="tl-input h-10 normal-case font-normal"
                        value={modalWho}
                        onChange={(e) => setModalWho(e.target.value as "OSMAR" | "ALEX")}
                        disabled={modalBusy}
                      >
                        <option value="OSMAR">Osmar</option>
                        <option value="ALEX">Álex</option>
                      </select>
                    </label>
                    <label className="sm:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                      Buscar producto
                      <div className="flex gap-2">
                        <input
                          className="tl-input h-10 flex-1 normal-case font-normal"
                          placeholder="SKU o nombre…"
                          value={modalQ}
                          onChange={(e) => setModalQ(e.target.value)}
                          disabled={modalBusy}
                        />
                        <button
                          type="button"
                          className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                          disabled={modalBusy || !modalQ.trim()}
                          onClick={async () => {
                            setModalMsg(null);
                            const q = modalQ.trim();
                            if (!q) return;
                            try {
                              const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}&limit=10`, { credentials: "include" });
                              const json = (await res.json()) as AdminSearchPayload;
                              setModalHits((json.products ?? []).filter((p) => p.active && !p.deletedAt));
                            } catch (e) {
                              setModalHits([]);
                              setModalMsg(e instanceof Error ? e.message : "Error de red al buscar productos.");
                            }
                          }}
                        >
                          Buscar
                        </button>
                      </div>
                    </label>
                  </div>

                  {modalMsg ? (
                    <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
                      {modalMsg}
                    </div>
                  ) : null}

                  {modalHits.length ? (
                    <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Resultados</p>
                      <div className="mt-2 space-y-2">
                        {modalHits.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full rounded-xl border border-tl-line-subtle bg-tl-canvas px-3 py-2 text-left hover:bg-tl-canvas-subtle"
                            onClick={() => {
                              const unitCostCents = p.costCents ?? 0;
                              setModalLines((prev) => {
                                if (prev.some((x) => x.productId === p.id)) return prev;
                                return [
                                  ...prev,
                                  {
                                    productId: p.id,
                                    sku: p.sku,
                                    name: p.name,
                                    unitCostCents,
                                    stockQty: p.stockQty,
                                    quantity: 1,
                                  },
                                ];
                              });
                            }}
                            disabled={modalBusy}
                            title={p.costCents == null ? "Este producto no tiene costo; al guardar fallará (MISSING_COST)." : "Agregar"}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-tl-ink">{p.name}</p>
                                <p className="mt-0.5 text-[11px] font-mono text-tl-muted">SKU {p.sku}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-xs tabular-nums text-tl-muted">Stock: {p.stockQty}</p>
                                <p className="text-xs tabular-nums text-tl-muted">Costo: {p.costCents != null ? formatCup(p.costCents) : "—"}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Líneas</p>
                      <p className="text-xs tabular-nums text-tl-muted">
                        Total: {formatCup(modalLines.reduce((a, l) => a + l.quantity * l.unitCostCents, 0))}
                      </p>
                    </div>
                    {modalLines.length === 0 ? (
                      <p className="mt-2 text-sm text-tl-muted">Agrega productos desde la búsqueda.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {modalLines.map((l) => (
                          <div key={l.productId} className="rounded-xl border border-tl-line-subtle bg-tl-canvas px-3 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-tl-ink">{l.name}</p>
                                <p className="mt-0.5 text-[11px] font-mono text-tl-muted">SKU {l.sku}</p>
                                <p className="mt-0.5 text-[11px] tabular-nums text-tl-muted">
                                  {formatCup(l.unitCostCents)} · stock {l.stockQty}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                                  disabled={modalBusy || l.quantity <= 1}
                                  onClick={() =>
                                    setModalLines((prev) =>
                                      prev.map((x) => (x.productId === l.productId ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)),
                                    )
                                  }
                                >
                                  -
                                </button>
                                <input
                                  className="tl-input h-9 w-[76px] px-2 text-sm tabular-nums"
                                  value={String(l.quantity)}
                                  disabled={modalBusy}
                                  inputMode="numeric"
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    setModalLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, quantity: Number.isFinite(n) && n > 0 ? n : 1 } : x)));
                                  }}
                                />
                                <button
                                  type="button"
                                  className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                                  disabled={modalBusy}
                                  onClick={() =>
                                    setModalLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, quantity: x.quantity + 1 } : x)))
                                  }
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                                  disabled={modalBusy}
                                  onClick={() => setModalLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                                  title="Quitar línea"
                                >
                                  Quitar
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm"
                      onClick={() => setModalOpen(false)}
                      disabled={modalBusy}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="tl-btn tl-btn-primary !px-4 !py-2 text-sm"
                      disabled={modalBusy || modalLines.length === 0}
                      onClick={async () => {
                        setModalBusy(true);
                        setModalMsg(null);
                        try {
                          const res = await fetch("/api/admin/owner-sales/create", {
                            method: "POST",
                            credentials: "include",
                            headers: { "content-type": "application/json", "x-tl-csrf": "1" },
                            body: JSON.stringify({
                              owner: modalWho,
                              lines: modalLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                            }),
                          });
                          const json = (await res.json()) as any;
                          if (!res.ok) {
                            setModalMsg(json?.error ?? "No se pudo registrar el consumo.");
                            setModalBusy(false);
                            return;
                          }
                          setModalOpen(false);
                          setModalLines([]);
                          setModalHits([]);
                          setModalQ("");
                          await load();
                        } catch (e) {
                          setModalMsg(e instanceof Error ? e.message : "Error de red al registrar consumo.");
                        } finally {
                          setModalBusy(false);
                        }
                      }}
                    >
                      {modalBusy ? "Guardando…" : "Registrar"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}

