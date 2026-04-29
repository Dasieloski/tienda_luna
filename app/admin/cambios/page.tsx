"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
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

function fmtMoneyCup(cents: number) {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("es-ES", { style: "currency", currency: "CUP", maximumFractionDigits: 2 });
}

function fmtMoneyUsd(usdCents: number) {
  const v = (usdCents ?? 0) / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function defaultUsdRateCup() {
  const v = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 250;
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
    const usdNum = Number(usd);
    const cupNum = Number(cup);
    const rateNum = Number(rate);
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
    const usdNum = Number(usd);
    const rateNum = Number(rate);
    if (!Number.isFinite(usdNum) || !Number.isFinite(rateNum)) return null;
    if (usdNum <= 0 || rateNum <= 0) return null;
    return usdNum * rateNum;
  }, [usd, rate]);

  return (
    <AdminShell title="Cambios (USD → CUP)">
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0 p-4">
          <div className="text-sm text-white/70">
            Registra y audita los cambios de moneda que afectan caja (no son ventas). Entra USD y sale CUP.
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-xs text-white/60">Desde</span>
              <input
                type="date"
                value={fromYmd}
                onChange={(e) => setFromYmd(e.target.value)}
                className="bg-transparent text-sm text-white outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-xs text-white/60">Hasta</span>
              <input
                type="date"
                value={toYmd}
                onChange={(e) => setToYmd(e.target.value)}
                className="bg-transparent text-sm text-white outline-none"
              />
            </div>
            <button
              onClick={() => void load()}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white shadow-sm transition hover:bg-white/10",
                loading && "opacity-60",
              )}
              disabled={loading}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Actualizar
            </button>
          </div>

          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-4 py-2 text-sm font-medium text-black shadow-sm transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Nuevo cambio
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">USD recibidos</div>
            <div className="mt-1 text-lg font-semibold text-white">{fmtMoneyUsd(totals.usdCents)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">CUP entregados</div>
            <div className="mt-1 text-lg font-semibold text-white">{fmtMoneyCup(totals.cupGivenCents)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Equivalente CUP (USD × tasa)</div>
            <div className="mt-1 text-lg font-semibold text-white">{fmtMoneyCup(totals.usdValueCupCents)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Spread (equiv − entregado)</div>
            <div className={cn("mt-1 text-lg font-semibold", totals.spreadCupCents >= 0 ? "text-emerald-200" : "text-red-200")}>
              {fmtMoneyCup(totals.spreadCupCents)}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs text-white/60">
            <div className="col-span-4">Momento</div>
            <div className="col-span-2">USD</div>
            <div className="col-span-2">CUP entregado</div>
            <div className="col-span-2">Tasa</div>
            <div className="col-span-2">Origen</div>
          </div>
          <div className="divide-y divide-white/10">
            {rows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-white/60">
                {loading ? "Cargando..." : "No hay cambios en este rango."}
              </div>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm text-white">
                  <div className="col-span-4">
                    <div className="font-medium">{fmtWhen(r.exchangedAt)}</div>
                    {r.note ? <div className="mt-0.5 text-xs text-white/60">{r.note}</div> : null}
                  </div>
                  <div className="col-span-2 font-medium text-emerald-200">{fmtMoneyUsd(r.usdCentsReceived)}</div>
                  <div className="col-span-2">{fmtMoneyCup(r.cupCentsGiven)}</div>
                  <div className="col-span-2">{r.usdRateCup}</div>
                  <div className="col-span-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">{r.deviceId}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-950 to-zinc-900 shadow-2xl">
            <div className="border-b border-white/10 p-5">
              <div className="text-lg font-semibold text-white">Nuevo cambio USD → CUP</div>
              <div className="mt-1 text-sm text-white/60">
                Entra USD y sale CUP. Se usa para el cuadre de caja (no cuenta como venta).
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1">
                  <div className="text-xs text-white/60">USD recibidos</div>
                  <input
                    value={usd}
                    onChange={(e) => setUsd(e.target.value)}
                    inputMode="decimal"
                    placeholder="10"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-white/60">Tasa (CUP por 1 USD)</div>
                  <input
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    inputMode="numeric"
                    placeholder="520"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-white/60">CUP entregados</div>
                  <input
                    value={cup}
                    onChange={(e) => setCup(e.target.value)}
                    inputMode="decimal"
                    placeholder={impliedCup != null ? impliedCup.toFixed(0) : "0"}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                {impliedCup != null ? (
                  <div>
                    Equivalente teórico: <span className="font-semibold text-white">{impliedCup.toFixed(0)} CUP</span>{" "}
                    (USD × tasa). Si entregas menos CUP, queda como <span className="font-semibold text-emerald-200">spread</span>.
                  </div>
                ) : (
                  <div>Introduce USD y tasa para ver el equivalente.</div>
                )}
              </div>

              <label className="space-y-1">
                <div className="text-xs text-white/60">Nota (opcional)</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50"
                  placeholder="Ej. Cambio para cliente habitual…"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 p-5">
              <button
                onClick={() => (saving ? null : setModalOpen(false))}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={() => void createFx()}
                className={cn(
                  "rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-4 py-2 text-sm font-medium text-black shadow-sm transition hover:brightness-110",
                  saving && "opacity-60",
                )}
                disabled={saving}
              >
                {saving ? "Guardando..." : "Guardar cambio"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

