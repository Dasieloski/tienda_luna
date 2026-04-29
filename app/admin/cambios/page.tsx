"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Plus, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { cn } from "@/lib/utils";

type FxExchangeDto = {
  id: string;
  deviceId: string;
  direction: string;
  usdCentsReceived: number;
  cupCentsGiven: number;
  usdRateCup: number;
  usdValueCupCents: number;
  spreadCupCents: number;
  exchangedAt: string;
  note: string | null;
  updatedAt: string;
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

function fmtMoneyUsd(usdCents: number) {
  const v = (usdCents ?? 0) / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function defaultUsdRateCup() {
  const globalRate = (globalThis as unknown as { __TL_USD_RATE_CUP__?: number }).__TL_USD_RATE_CUP__;
  if (typeof globalRate === "number" && Number.isFinite(globalRate) && globalRate > 0) return Math.round(globalRate);
  const v = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 250;
}

function parseMoney(raw: string) {
  const s = (raw ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export default function CambiosPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FxExchangeDto[]>([]);

  const [fromYmd, setFromYmd] = useState(utcTodayYmd());
  const [toYmd, setToYmd] = useState(utcTodayYmd());

  const [modalOpen, setModalOpen] = useState(false);
  const [usd, setUsd] = useState("10");
  const [cup, setCup] = useState("0");
  const [rate, setRate] = useState(String(defaultUsdRateCup()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = localDayRangeIso(fromYmd).from;
      const to = localDayRangeIso(toYmd).to;
      const res = await fetch(`/api/admin/fx-exchanges?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=400`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { fxExchanges?: FxExchangeDto[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error de red.");
      setRows(Array.isArray(json.fxExchanges) ? json.fxExchanges : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando cambios.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromYmd, toYmd]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const t = rows.reduce(
      (acc, r) => {
        acc.usdCents += r.usdCentsReceived;
        acc.cupGivenCents += r.cupCentsGiven;
        acc.usdValueCupCents += r.usdValueCupCents;
        acc.spreadCupCents += r.spreadCupCents;
        return acc;
      },
      { usdCents: 0, cupGivenCents: 0, usdValueCupCents: 0, spreadCupCents: 0 },
    );
    return { ...t, netCashImpactCupCents: -t.cupGivenCents };
  }, [rows]);

  async function createFx() {
    const usdNum = parseMoney(usd);
    const cupNum = parseMoney(cup);
    const rateNum = Number(String(rate).trim());
    const usdCentsReceived = Math.round(usdNum * 100);
    const cupCentsGiven = Math.round(cupNum * 100);
    if (!Number.isFinite(usdCentsReceived) || usdCentsReceived <= 0) return setError("USD inválido.");
    if (!Number.isFinite(cupCentsGiven) || cupCentsGiven <= 0) return setError("CUP inválido.");
    if (!Number.isFinite(rateNum) || rateNum <= 0) return setError("Tasa inválida.");

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/fx-exchanges", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          usdCentsReceived,
          cupCentsGiven,
          usdRateCup: Math.round(rateNum),
          exchangedAt: new Date().toISOString(),
          note: note.trim() ? note.trim() : null,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar.");
      setModalOpen(false);
      setUsd("10");
      setCup("0");
      setRate(String(defaultUsdRateCup()));
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando cambio.");
    } finally {
      setSaving(false);
    }
  }

  const impliedCup = useMemo(() => {
    const usdNum = parseMoney(usd);
    const rateNum = Number(rate);
    if (!Number.isFinite(usdNum) || !Number.isFinite(rateNum)) return null;
    if (usdNum <= 0 || rateNum <= 0) return null;
    return usdNum * rateNum;
  }, [usd, rate]);

  return (
    <AdminShell title="Cambios (USD → CUP)">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tl-welcome-header">Cambios (USD → CUP)</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Registra y audita cambios de moneda que afectan caja. Entra USD y sale CUP (no es una venta).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2 text-xs sm:text-sm"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo cambio
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-tl-line-subtle bg-tl-canvas-inset p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Desde
                <input
                  type="date"
                  className="tl-input h-10 w-[150px] px-3 text-sm normal-case font-normal"
                  value={fromYmd}
                  onChange={(e) => setFromYmd(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-tl-muted">
                Hasta
                <input
                  type="date"
                  className="tl-input h-10 w-[150px] px-3 text-sm normal-case font-normal"
                  value={toYmd}
                  onChange={(e) => setToYmd(e.target.value)}
                />
              </label>
            </div>
            <div className="text-xs text-tl-muted">Últimos {rows.length} cambios</div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          <KpiCard label="USD recibidos" value={fmtMoneyUsd(totals.usdCents)} hint="Entradas USD" variant="info" />
          <KpiCard
            label="CUP entregados"
            value={<TablePriceCupCell cupCents={totals.cupGivenCents} compact />}
            hint="Salida de efectivo"
            variant="default"
          />
          <KpiCard
            label="Equivalente CUP"
            value={<TablePriceCupCell cupCents={totals.usdValueCupCents} compact />}
            hint="USD × tasa"
            variant="default"
          />
          <KpiCard
            label="Spread"
            value={<TablePriceCupCell cupCents={totals.spreadCupCents} compact />}
            hint={totals.spreadCupCents >= 0 ? "A favor" : "En contra"}
            variant={totals.spreadCupCents >= 0 ? "success" : "warning"}
          />
        </section>

        <section className="tl-glass overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Momento</th>
                  <th className="px-4 py-3 text-left font-semibold">Origen</th>
                  <th className="px-4 py-3 text-right font-semibold">USD</th>
                  <th className="px-4 py-3 text-right font-semibold">CUP entregado</th>
                  <th className="px-4 py-3 text-right font-semibold">Tasa</th>
                  <th className="px-4 py-3 text-right font-semibold">Spread</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-tl-muted">
                      {loading ? "Cargando..." : "No hay cambios para ese rango."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-tl-canvas-subtle/50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-tl-ink">{fmtWhen(r.exchangedAt)}</div>
                        {r.note ? <div className="mt-0.5 line-clamp-1 text-xs text-tl-muted">{r.note}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-tl-muted">
                        <span className="rounded-full border border-tl-line bg-tl-canvas-inset px-2 py-0.5 text-[11px] font-semibold text-tl-muted">
                          {r.deviceId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-tl-ink">{fmtMoneyUsd(r.usdCentsReceived)}</td>
                      <td className="px-4 py-3 text-right">
                        <TablePriceCupCell cupCents={r.cupCentsGiven} compact />
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-tl-muted">{r.usdRateCup}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn("text-sm font-semibold", r.spreadCupCents >= 0 ? "text-emerald-700" : "text-tl-warning")}>
                          <TablePriceCupCell cupCents={r.spreadCupCents} compact />
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <FxModal
        open={modalOpen}
        saving={saving}
        error={error}
        usd={usd}
        cup={cup}
        rate={rate}
        note={note}
        impliedCup={impliedCup}
        onUsdChange={setUsd}
        onCupChange={setCup}
        onRateChange={setRate}
        onNoteChange={setNote}
        onClose={() => (saving ? null : setModalOpen(false))}
        onSave={() => void createFx()}
      />
    </AdminShell>
  );
}

function FxModal({
  open,
  saving,
  error,
  usd,
  cup,
  rate,
  note,
  impliedCup,
  onUsdChange,
  onCupChange,
  onRateChange,
  onNoteChange,
  onClose,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  error: string | null;
  usd: string;
  cup: string;
  rate: string;
  note: string;
  impliedCup: number | null;
  onUsdChange: (v: string) => void;
  onCupChange: (v: string) => void;
  onRateChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="fixed inset-0 z-50 bg-black/35" onClick={onClose} aria-label="Cerrar" />
      <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center">
        <div className="w-full max-w-2xl rounded-3xl border border-tl-line bg-tl-canvas shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-tl-line px-5 py-4">
            <div>
              <p className="text-lg font-bold text-tl-ink">Nuevo cambio USD → CUP</p>
              <p className="mt-1 text-xs text-tl-muted">Entra USD y sale CUP. Se registra para auditoría y cuadre.</p>
            </div>
            <button type="button" className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs" onClick={onClose} disabled={saving}>
              Cerrar
            </button>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">USD recibidos</label>
              <input
                className="tl-input mt-1 h-10 w-full"
                value={usd}
                onChange={(e) => onUsdChange(e.target.value)}
                inputMode="decimal"
                placeholder="10"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Tasa (CUP por 1 USD)</label>
              <input
                className="tl-input mt-1 h-10 w-full"
                value={rate}
                onChange={(e) => onRateChange(e.target.value)}
                inputMode="numeric"
                placeholder="520"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">CUP entregados</label>
              <input
                className="tl-input mt-1 h-10 w-full"
                value={cup}
                onChange={(e) => onCupChange(e.target.value)}
                inputMode="decimal"
                placeholder={impliedCup != null ? String(Math.round(impliedCup)) : "0"}
              />
            </div>
          </div>

          <div className="px-5">
            <div className="rounded-xl border border-tl-line bg-tl-canvas-inset p-3 text-sm text-tl-muted">
              {impliedCup != null ? (
                <div>
                  Equivalente teórico: <span className="font-semibold text-tl-ink">{Math.round(impliedCup)} CUP</span> (USD × tasa). Si entregas menos CUP,
                  queda como <span className="font-semibold text-emerald-700">spread</span>.
                </div>
              ) : (
                <div>Introduce USD y tasa para ver el equivalente.</div>
              )}
            </div>
          </div>

          <div className="space-y-3 p-5">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">Nota (opcional)</label>
              <textarea
                className="tl-input mt-1 min-h-[88px] w-full px-3 py-2 text-sm"
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Ej. Cambio para cliente habitual…"
              />
            </div>
            {error ? (
              <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">{error}</div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-tl-line px-5 py-4">
            <button type="button" className="tl-btn tl-btn-secondary !px-4 !py-2 text-sm" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className={cn("tl-btn tl-btn-primary inline-flex items-center gap-2 !px-4 !py-2 text-sm", saving && "opacity-70")}
              onClick={onSave}
              disabled={saving}
            >
              <BadgeCheck className={cn("h-4 w-4", saving && "animate-pulse")} aria-hidden />
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

