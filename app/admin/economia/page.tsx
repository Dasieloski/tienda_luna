"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Calendar, CreditCard, DollarSign, ReceiptText, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { formatCup, formatCupAndUsdLabel, formatUsdFromCupCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type EconomySummary = {
  meta: {
    dbAvailable: boolean;
    message?: string;
  };
  date?: string;
  totals: {
    ventas: number;
    totalCents: number;
    efectivoCents: number;
    transferenciaCents: number;
    usdCents: number;
  };
  buckets: {
    method: string;
    ventas: number;
    totalCents: number;
  }[];
};

export default function EconomyPage() {
  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const [date, setDate] = useState(today);
  const [data, setData] = useState<EconomySummary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRefreshAtRef = useRef<number>(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;

    const now = Date.now();
    // Evita encadenar refreshes (AdminShell emite cada 5s).
    if (silent && now - lastRefreshAtRef.current < 4500) return;
    lastRefreshAtRef.current = now;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setInitialLoading(true);
    setRefreshing(silent);
    if (!silent) setError(null);
    try {
      const params = new URLSearchParams();
      params.set("date", date);
      const res = await fetch(`/api/admin/economy/summary?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const json = (await res.json()) as EconomySummary;
      if (!res.ok) {
        setError(json.meta?.message ?? "No se pudo cargar la economía.");
      }
      setData(json);
      if (json.meta?.dbAvailable === false && json.meta?.message) {
        setError(json.meta.message);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Error de red al cargar economía.");
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handleRefresh() {
      void load({ silent: true });
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (initialLoading && !data) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 rounded-full border-2 border-tl-accent border-t-transparent tl-spin" />
          <p className="text-sm text-tl-muted">Calculando economía de la tienda...</p>
        </div>
      </AdminShell>
    );
  }

  const totals = data?.totals ?? {
    ventas: 0,
    totalCents: 0,
    efectivoCents: 0,
    transferenciaCents: 0,
    usdCents: 0,
  };

  const cajaCup =
    totals.efectivoCents +
    totals.transferenciaCents +
    totals.usdCents;

  return (
    <AdminShell title="Economía">
      <div className="space-y-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Economía de la tienda</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Resumen de ventas y cuánto debería haber en caja en efectivo, transferencias y USD.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              <Calendar className="h-4 w-4" aria-hidden />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="tl-input h-9 w-[140px] px-3 py-1 text-xs sm:text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void load({ silent: true })}
              className={cn(
                "tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-3 !py-2 text-xs sm:text-sm",
              )}
              disabled={refreshing}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
              {refreshing ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {error}
          </div>
        )}

        {/* KPIs principales */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Ventas registradas
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
                {totals.ventas.toLocaleString("es-ES")}
              </p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Dinero total generado
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
                {formatCupAndUsdLabel(totals.totalCents)}
              </p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Total en CUP (todas las formas)
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
                {formatCup(cajaCup)}
              </p>
            </div>
            <div className="tl-glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Equivalente total en USD
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-tl-ink">
                {formatUsdFromCupCents(cajaCup)}
              </p>
            </div>
          </div>
        </section>

        {/* Caja por método de pago */}
        <section>
          <h2 className="text-lg font-semibold text-tl-ink">Caja por método de pago</h2>
          <p className="mt-1 text-sm text-tl-muted">
            Los importes se calculan a partir de las ventas completadas (`SALE_COMPLETED`) agrupadas por
            método de pago que envía la app de caja.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="tl-glass rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tl-success-subtle">
                  <Banknote className="h-5 w-5 text-tl-success" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Efectivo CUP
                  </p>
                  <p className="text-lg font-bold tabular-nums text-tl-ink">
                    {formatCupAndUsdLabel(totals.efectivoCents)}
                  </p>
                </div>
              </div>
            </div>

            <div className="tl-glass rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tl-accent-subtle">
                  <CreditCard className="h-5 w-5 text-tl-accent" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Transferencias CUP
                  </p>
                  <p className="text-lg font-bold tabular-nums text-tl-ink">
                    {formatCupAndUsdLabel(totals.transferenciaCents)}
                  </p>
                </div>
              </div>
            </div>

            <div className="tl-glass rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tl-warning-subtle">
                  <DollarSign className="h-5 w-5 text-tl-warning" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                    Ventas en USD
                  </p>
                  <p className="text-lg font-bold tabular-nums text-tl-ink">
                    {formatCupAndUsdLabel(totals.usdCents)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Detalle por método */}
        <section>
          <h2 className="text-lg font-semibold text-tl-ink">Detalle por método exacto</h2>
          <p className="mt-1 text-sm text-tl-muted">
            Aquí ves el nombre exacto del método de pago que envía cada caja (por ejemplo:
            `cash_cup`, `transfer_cup`, `cash_usd`).
          </p>

          <div className="mt-3 overflow-x-auto tl-glass rounded-xl">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3">Ventas</th>
                  <th className="px-4 py-3">Total CUP / USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {(data?.buckets ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-tl-muted">
                      No hay ventas económicas registradas todavía.
                    </td>
                  </tr>
                ) : (
                  data?.buckets.map((b) => (
                    <tr key={b.method}>
                      <td className="px-4 py-3 text-sm text-tl-ink">
                        {b.method || "Sin especificar"}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-tl-ink">
                        {b.ventas.toLocaleString("es-ES")}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-tl-ink">
                        {formatCupAndUsdLabel(b.totalCents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="tl-glass flex items-start gap-3 rounded-xl border-tl-line-subtle bg-tl-canvas-inset p-4">
            <ReceiptText className="mt-0.5 h-5 w-5 text-tl-muted" aria-hidden />
            <div className="text-xs text-tl-muted">
              <p>
                Nota: los importes se calculan sobre el total de la venta (`totalCents`). Si quieres
                separar montos mixtos (parte en CUP y parte en USD en la misma venta) habría que
                ampliar el evento que envía la app offline para incluir ese desglose.
              </p>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

