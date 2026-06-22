"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PlusIcon as Plus,
  SearchLucideIcon as Search,
  Trash2Icon as Trash2,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";
import { formatCup } from "@/lib/money";
import { TablePriceCupCell } from "@/components/admin/table-price-cup-cell";
import { useToast } from "@/components/ui/toast";
import { CupUsdMoney } from "@/components/admin/cup-usd-money";

type SearchProductHit = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
  deletedAt: string | null;
  priceCents: number;
  transferPriceCents?: number;
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
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCupMajorToCents(raw: string): number | null {
  const s = raw
    .trim()
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function centsToCupMajorInput(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function WebSalesPage() {
  const toast = useToast();

  const [lines, setLines] = useState<SaleLineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productSearchQ, setProductSearchQ] = useState("");
  const [productSearchHits, setProductSearchHits] = useState<
    SearchProductHit[]
  >([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productPickTarget, setProductPickTarget] = useState<
    string | "ADD" | null
  >(null);
  const searchDebounceRef = useRef<number | null>(null);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paidAmount, setPaidAmount] = useState("");

  useEffect(() => {
    if (productSearchQ.trim().length < 2) {
      setProductSearchHits([]);
      setProductSearchLoading(false);
      return;
    }
    if (searchDebounceRef.current != null)
      window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      void (async () => {
        setProductSearchLoading(true);
        try {
          const q = productSearchQ.trim();
          const res = await fetch(
            `/api/admin/search?q=${encodeURIComponent(q)}&limit=15`,
            {
              credentials: "include",
            },
          );
          const json = (await res.json()) as {
            products?: SearchProductHit[];
            meta?: { dbAvailable?: boolean };
          };
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
      if (searchDebounceRef.current != null)
        window.clearTimeout(searchDebounceRef.current);
    };
  }, [productSearchQ]);

  const applyProductPick = useCallback(
    (p: SearchProductHit) => {
      if (productPickTarget === "ADD") {
        setLines((prev) => [
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
        setLines((prev) =>
          prev.map((row) =>
            row.key === productPickTarget
              ? {
                  ...row,
                  productId: p.id,
                  productName: p.name,
                  sku: p.sku,
                  quantity: row.quantity,
                  unitPriceCupCents: row.unitPriceCupCents,
                }
              : row,
          ),
        );
      }
      setProductPickTarget(null);
      setProductSearchQ("");
      setProductSearchHits([]);
    },
    [productPickTarget],
  );

  const totalCents = useMemo(
    () => lines.reduce((acc, l) => acc + l.quantity * l.unitPriceCupCents, 0),
    [lines],
  );

  const buildPayload = useCallback(() => {
    const valid = lines.filter((l) => l.productId && l.quantity > 0);
    if (valid.length === 0) {
      return {
        ok: false as const,
        error: "Añade al menos un producto con cantidad mayor que cero.",
      };
    }
    const byPid = new Map<string, { qty: number; unit: number }>();
    for (const l of valid) {
      if (l.unitPriceCupCents <= 0) {
        return {
          ok: false as const,
          error:
            "El precio unitario debe ser mayor que cero en todas las líneas.",
        };
      }
      const cur = byPid.get(l.productId);
      if (!cur)
        byPid.set(l.productId, { qty: l.quantity, unit: l.unitPriceCupCents });
      else {
        if (cur.unit !== l.unitPriceCupCents) {
          return {
            ok: false as const,
            error:
              "El mismo producto aparece con distintos precios unitarios. Deja una sola línea por producto o iguala el precio.",
          };
        }
        cur.qty += l.quantity;
      }
    }
    return {
      ok: true as const,
      lines: [...byPid.entries()].map(([productId, { qty, unit }]) => ({
        productId,
        quantity: qty,
        unitPriceCupCentsOverride: unit,
      })),
    };
  }, [lines]);

  const doCreateSale = useCallback(async () => {
    setError(null);
    const built = buildPayload();
    if (!built.ok) {
      setError(built.error);
      return;
    }

    const paidCentsInput = paidAmount.trim()
      ? parseCupMajorToCents(paidAmount)
      : null;
    const paidAmountCents =
      paidCentsInput != null ? paidCentsInput : totalCents;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/sales/web-create", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({
          lines: built.lines,
          paymentMethod: paymentMethod.trim() || "cash",
          paidAmountCents,
        }),
      });
      const j = (await res.json().catch(() => null)) as {
        error?: string;
        saleId?: string;
      } | null;
      if (!res.ok) {
        const msg =
          (j && typeof j.error === "string" ? j.error : null) ??
          `Error HTTP ${res.status}`;
        setError(msg);
        toast.push({
          kind: "error",
          title: "No se pudo crear la venta",
          description: msg,
        });
        return;
      }
      setLines([]);
      setPaidAmount("");
      toast.push({
        kind: "success",
        title: "Venta web creada",
        description: `Venta #${j?.saleId?.slice(0, 8) ?? ""}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error de red.";
      setError(msg);
      toast.push({ kind: "error", title: "Error de red", description: msg });
    } finally {
      setBusy(false);
    }
  }, [buildPayload, paidAmount, paymentMethod, totalCents, toast]);

  const totalUnits = useMemo(
    () => lines.reduce((acc, l) => acc + l.quantity, 0),
    [lines],
  );

  return (
    <AdminShell title="Ventas Web">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="tl-welcome-header">Ventas Web</h1>
            <p className="mt-2 text-sm text-tl-muted">
              Registra ventas directamente desde el panel, sin necesidad de la
              APK de tablets.
            </p>
          </div>
        </div>

        {/* Product search */}
        <div className="tl-glass rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tl-muted">
              <Search className="h-3.5 w-3.5" aria-hidden />
              Buscar producto
            </div>
            {productPickTarget ? (
              <span className="text-[11px] font-medium text-tl-accent">
                {productPickTarget === "ADD"
                  ? "Pulsa un resultado para añadir"
                  : "Pulsa un resultado para sustituir"}
              </span>
            ) : (
              <span className="text-[11px] text-tl-muted">
                Pulsa &quot;Sustituir&quot; en una línea o &quot;Añadir
                producto&quot;
              </span>
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
                {productSearchQ.trim().length < 2
                  ? "Escribe para buscar."
                  : "Sin resultados."}
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
                        productPickTarget
                          ? "hover:bg-tl-canvas-inset"
                          : "cursor-not-allowed opacity-50",
                      )}
                      onClick={() => {
                        if (!productPickTarget) return;
                        applyProductPick(p);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-tl-ink">
                          {p.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[11px] text-tl-muted">
                          {p.sku}
                        </span>
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

        {/* Lines table */}
        <div className="tl-glass rounded-xl p-4">
          {error ? (
            <div className="mb-4 rounded-lg border border-tl-warning/30 bg-tl-warning-subtle px-3 py-2 text-sm text-tl-warning">
              {error}
            </div>
          ) : null}

          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-tl-muted">
                No hay productos en la venta. Busca y añade productos arriba.
              </p>
            </div>
          ) : (
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
                  {lines.map((row) => (
                    <tr
                      key={row.key}
                      className={
                        productPickTarget === row.key
                          ? "bg-tl-accent/10"
                          : undefined
                      }
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-tl-ink">
                          {row.productName || "—"}
                        </div>
                        <div className="font-mono text-[11px] text-tl-muted">
                          {row.sku || row.productId || "—"}
                        </div>
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
                            setLines((prev) =>
                              prev.map((r) =>
                                r.key === row.key ? { ...r, quantity: q } : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="tl-input h-9 w-28 px-2 text-sm tabular-nums"
                          defaultValue={centsToCupMajorInput(
                            row.unitPriceCupCents,
                          )}
                          key={`${row.key}-u${row.unitPriceCupCents}`}
                          onBlur={(e) => {
                            const c = parseCupMajorToCents(
                              e.currentTarget.value,
                            );
                            if (c == null) {
                              e.currentTarget.value = centsToCupMajorInput(
                                row.unitPriceCupCents,
                              );
                              return;
                            }
                            setLines((prev) =>
                              prev.map((r) =>
                                r.key === row.key
                                  ? { ...r, unitPriceCupCents: c }
                                  : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <TablePriceCupCell
                          cupCents={row.quantity * row.unitPriceCupCents}
                          compact
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
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
                          onClick={() =>
                            setLines((prev) =>
                              prev.filter((r) => r.key !== row.key),
                            )
                          }
                        >
                          <Trash2 className="inline h-3 w-3" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
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
              Añadir producto
            </button>
          </div>
        </div>

        {/* Payment & summary */}
        <div className="tl-glass rounded-xl p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Método de pago
                </label>
                <input
                  className="tl-input mt-1 h-10 w-full"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="cash / transfer / usd_cash / ..."
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Monto recibido (opcional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="tl-input mt-1 h-10 w-full"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="Ej: 350.00 (vacío = total)"
                />
                <p className="mt-1 text-xs text-tl-muted">
                  Si se deja vacío, se registra como pagado completo.
                </p>
              </div>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <div className="rounded-xl border border-tl-line bg-tl-canvas-inset/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  Resumen
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-tl-muted">Unidades</span>
                    <span className="tabular-nums font-semibold text-tl-ink">
                      {totalUnits}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-tl-muted">Productos distintos</span>
                    <span className="tabular-nums font-semibold text-tl-ink">
                      {lines.length}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-tl-line pt-1">
                    <span className="font-semibold text-tl-ink">Total</span>
                    <span className="font-bold text-tl-ink">
                      <CupUsdMoney cents={totalCents} />
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={cn(
                  "tl-btn tl-btn-primary tl-interactive tl-hover-lift tl-press tl-focus !px-6 !py-3 text-base font-bold",
                  (busy || lines.length === 0) &&
                    "pointer-events-none opacity-60",
                )}
                disabled={busy || lines.length === 0}
                onClick={() => void doCreateSale()}
              >
                {busy ? (
                  "Creando venta…"
                ) : (
                  <>
                    <span className="mr-2">💳</span>
                    Cobrar <CupUsdMoney cents={totalCents} compact />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
