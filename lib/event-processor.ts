import { randomUUID } from "crypto";
import type { EventStatus, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  buildDuplicateKey,
  checkDuplicateInBatch,
  checkDuplicateInDb,
  checkSalesSpike,
  checkTimestampFraud,
} from "@/lib/fraud";
import { payloadHash } from "@/lib/hash";
import { fulfillableQuantity } from "@/lib/stock-engine";
import { loadCatalogProducts } from "@/lib/catalog-products";
import { allocateProductSku } from "@/lib/product-sku";
import { unitPriceCupCentsForSale } from "@/lib/pricing";
import type { ClientSyncEvent } from "@/types/events";

type DraftSale = {
  customerId?: string;
  lines: { productId: string; quantity: number; unitPriceOverrideCents?: number }[];
};

export type ProcessedEventResult = {
  clientEventId: string;
  type: string;
  status: EventStatus;
  serverEventId: string;
  isFraud: boolean;
  fraudReason?: string;
  correctionNote?: string;
  skipped?: boolean;
};

type Tx = Prisma.TransactionClient;

function getPayloadString(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === "string" ? v : undefined;
}

function getPayloadNumber(p: Record<string, unknown>, key: string): number | undefined {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function getPayloadArray(p: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = p[key];
  return Array.isArray(v) ? v : undefined;
}

/** Entero ≥ 0 en payload (rechaza decimales). */
function getPayloadIntNonneg(p: Record<string, unknown>, key: string): number | undefined {
  const v = getPayloadNumber(p, key);
  if (v === undefined || !Number.isInteger(v) || v < 0) return undefined;
  return v;
}

/** Entero > 0 en payload (rechaza decimales). */
function getPayloadIntPos(p: Record<string, unknown>, key: string): number | undefined {
  const v = getPayloadNumber(p, key);
  if (v === undefined || !Number.isInteger(v) || v <= 0) return undefined;
  return v;
}

function prismaUniqueViolation(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}

export async function processBatch(
  prisma: PrismaClient,
  params: {
    storeId: string;
    deviceId: string;
    events: ClientSyncEvent[];
  },
): Promise<ProcessedEventResult[]> {
  const serverNow = Date.now();
  const serverDate = new Date(serverNow);
  const sorted = [...params.events].sort((a, b) => a.timestamp - b.timestamp);
  const batchSeen = new Set<string>();
  const results: ProcessedEventResult[] = [];

  await prisma.$transaction(async (tx: Tx) => {
    const store = await tx.store.findUnique({
      where: { id: params.storeId },
      select: { usdRateCup: true },
    });
    const storeUsdRateCup =
      typeof store?.usdRateCup === "number" && Number.isFinite(store.usdRateCup) && store.usdRateCup > 0
        ? store.usdRateCup
        : Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250") || 250;

    const products = await loadCatalogProducts(tx, params.storeId);
    const stock = new Map(products.map((p) => [p.id, p.stockQty]));
    const productById = new Map(products.map((p) => [p.id, p]));
    const productIdBySku = new Map(
      products.map((p) => [p.sku, p.id] as const),
    );

    const pendingSales = new Map<string, DraftSale>();

    for (const ev of sorted) {
      const ph = payloadHash(ev.payload);
      const dupKey = buildDuplicateKey(params.deviceId, ev.timestamp, ev.payload);
      const dupBatch = checkDuplicateInBatch(dupKey, batchSeen);
      const dupDb = await checkDuplicateInDb(
        tx,
        params.storeId,
        params.deviceId,
        BigInt(ev.timestamp),
        ph,
      );
      const tsFraud = checkTimestampFraud(ev.timestamp, serverNow);

      const existing = await tx.event.findUnique({
        where: {
          storeId_clientEventId: {
            storeId: params.storeId,
            clientEventId: ev.id,
          },
        },
      });
      if (existing) {
        results.push({
          clientEventId: ev.id,
          type: ev.type,
          status: existing.status,
          serverEventId: existing.id,
          isFraud: existing.isFraud,
          fraudReason: existing.fraudReason ?? undefined,
          skipped: true,
        });
        continue;
      }

      const relatedSaleId = getPayloadString(ev.payload, "saleId");

      const hardFraud =
        dupBatch.isFraud ? dupBatch : dupDb.isFraud ? dupDb : tsFraud.isFraud ? tsFraud : null;
      if (hardFraud?.isFraud) {
        const row = await tx.event.create({
          data: {
            clientEventId: ev.id,
            type: ev.type,
            payload: ev.payload as Prisma.InputJsonValue,
            payloadHash: ph,
            storeId: params.storeId,
            deviceId: params.deviceId,
            clientTimestamp: BigInt(ev.timestamp),
            status: "REJECTED",
            isFraud: true,
            fraudReason: hardFraud.fraudReason,
            correctionNote: "HARD_FRAUD_OR_DUPLICATE",
            relatedClientSaleId: relatedSaleId ?? null,
          },
        });
        if (ev.type === "SALE_COMPLETED" && relatedSaleId) {
          pendingSales.delete(relatedSaleId);
        }
        results.push({
          clientEventId: ev.id,
          type: ev.type,
          status: "REJECTED",
          serverEventId: row.id,
          isFraud: true,
          fraudReason: hardFraud.fraudReason,
          correctionNote: "HARD_FRAUD_OR_DUPLICATE",
        });
        continue;
      }

      let fraudMerged = { isFraud: false as boolean, fraudReason: undefined as string | undefined };

      const record = async (input: {
        status: EventStatus;
        correctionNote?: string;
        extraFraud?: string;
      }): Promise<ProcessedEventResult> => {
        const extra = input.extraFraud;
        const isFraud = fraudMerged.isFraud || Boolean(extra);
        const fraudReason =
          [fraudMerged.fraudReason, extra].filter(Boolean).join(";") || undefined;

        const row = await tx.event.create({
          data: {
            clientEventId: ev.id,
            type: ev.type,
            payload: ev.payload as Prisma.InputJsonValue,
            payloadHash: ph,
            storeId: params.storeId,
            deviceId: params.deviceId,
            clientTimestamp: BigInt(ev.timestamp),
            status: input.status,
            isFraud,
            fraudReason,
            correctionNote: input.correctionNote,
            relatedClientSaleId: relatedSaleId ?? null,
          },
        });
        return {
          clientEventId: ev.id,
          type: ev.type,
          status: input.status,
          serverEventId: row.id,
          isFraud,
          fraudReason,
          correctionNote: input.correctionNote,
        };
      };

      switch (ev.type) {
        case "SALE_CREATED": {
          const saleId = getPayloadString(ev.payload, "saleId");
          if (!saleId) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "MISSING_SALE_ID",
              }),
            );
            break;
          }
          pendingSales.set(saleId, {
            customerId: getPayloadString(ev.payload, "customerId"),
            lines: [],
          });
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        case "PRODUCT_ADDED_TO_CART": {
          const saleId = getPayloadString(ev.payload, "saleId");
          const productIdRaw = getPayloadString(ev.payload, "productId");
          const skuRaw = getPayloadString(ev.payload, "sku");
          const quantity = getPayloadNumber(ev.payload, "quantity");
          const unitPriceOverride =
            getPayloadIntNonneg(ev.payload, "unitPriceCupCentsOverride") ??
            // compat: si envían `unitPriceCents` asumimos que es CUP céntimos
            getPayloadIntNonneg(ev.payload, "unitPriceCents");
          const draft = saleId ? pendingSales.get(saleId) : undefined;
          if (!saleId || !productIdRaw || quantity === undefined || quantity <= 0 || !draft) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_CART_LINE",
              }),
            );
            break;
          }

          // Compat: la APK puede enviar `productId` como UUID local. Permitimos resolver por SKU.
          // Prioridad: productId real -> sku explícito -> interpretar productId como sku.
          let resolvedProductId: string | null = null;
          if (productById.has(productIdRaw)) {
            resolvedProductId = productIdRaw;
          } else if (skuRaw && productIdBySku.has(skuRaw)) {
            resolvedProductId = productIdBySku.get(skuRaw)!;
          } else if (productIdBySku.has(productIdRaw)) {
            resolvedProductId = productIdBySku.get(productIdRaw)!;
          }

          if (!resolvedProductId) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "UNKNOWN_PRODUCT",
              }),
            );
            break;
          }
          draft.lines.push({
            productId: resolvedProductId,
            quantity,
            unitPriceOverrideCents: unitPriceOverride,
          });
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        case "STOCK_DECREASED": {
          const productId = getPayloadString(ev.payload, "productId");
          const quantity = getPayloadNumber(ev.payload, "quantity");
          const saleId = getPayloadString(ev.payload, "saleId");
          if (!productId || quantity === undefined || quantity <= 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_STOCK_DECREASE",
              }),
            );
            break;
          }
          if (saleId) {
            results.push(
              await record({
                status: "ACCEPTED",
                correctionNote: "AUDIT_ONLY_SALE_LINKED_NO_STOCK_MOVE",
              }),
            );
            break;
          }
          const current = stock.get(productId);
          if (current === undefined) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "UNKNOWN_PRODUCT",
              }),
            );
            break;
          }
          const next = current - quantity;
          if (next < 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "NEGATIVE_STOCK",
                extraFraud: "NEGATIVE_STOCK_ATTEMPT",
              }),
            );
            break;
          }
          stock.set(productId, next);
          await tx.product.update({
            where: { id: productId },
            data: { stockQty: next },
          });
          const rec = await record({ status: "ACCEPTED" });
          await tx.inventoryMovement.create({
            data: {
              storeId: params.storeId,
              productId,
              delta: -Math.trunc(quantity),
              beforeQty: current,
              afterQty: next,
              reason: "STOCK_DECREASED",
              actorType: "DEVICE",
              actorId: params.deviceId,
              eventId: rec.serverEventId,
            },
          });
          results.push(rec);
          break;
        }

        case "SALE_CANCELLED": {
          const saleId = getPayloadString(ev.payload, "saleId");
          if (saleId) pendingSales.delete(saleId);
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        case "SALE_COMPLETED":
        case "SALE_COMPLETED_V2": {
          const spike = await checkSalesSpike(tx, params.storeId, params.deviceId, serverDate);
          if (spike.isFraud) {
            fraudMerged = {
              isFraud: true,
              fraudReason: [fraudMerged.fraudReason, spike.fraudReason].filter(Boolean).join(";"),
            };
          }
          if (fraudMerged.isFraud) {
            const saleIdEarly = getPayloadString(ev.payload, "saleId");
            if (saleIdEarly) pendingSales.delete(saleIdEarly);
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "FRAUD_OR_POLICY_REJECT",
              }),
            );
            break;
          }

          const saleId = getPayloadString(ev.payload, "saleId");
          const paymentMethod = getPayloadString(ev.payload, "paymentMethod");
          if (!saleId) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "MISSING_SALE_ID",
              }),
            );
            break;
          }
          const draft = pendingSales.get(saleId);
          if (!draft || draft.lines.length === 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "EMPTY_OR_UNKNOWN_SALE",
              }),
            );
            break;
          }

          const evPayload = ev.payload as Record<string, unknown>;
          const priceListRaw = getPayloadString(evPayload, "priceList");
          const paymentsRaw = getPayloadArray(evPayload, "payments");
          const isV2 = ev.type === "SALE_COMPLETED_V2";

          const resolvedLines: {
            productId: string;
            requested: number;
            fulfilled: number;
            unitPriceCents: number;
          }[] = [];

          for (const line of draft.lines) {
            const p = productById.get(line.productId);
            if (!p) continue;
            const available = stock.get(line.productId) ?? 0;
            const fulfilled = fulfillableQuantity(line.quantity, available);
            const inferredPricingMethod =
              priceListRaw?.toUpperCase() === "USD"
                ? "usd"
                : priceListRaw?.toUpperCase() === "CUP"
                  ? "cup"
                  : isV2
                    ? // si la venta incluye pagos USD, asumimos lista USD; si no, CUP
                      (Array.isArray(paymentsRaw) &&
                      paymentsRaw.some(
                        (x) =>
                          typeof x === "object" &&
                          x !== null &&
                          String((x as any).currency ?? "").toUpperCase() === "USD",
                      )
                        ? "usd"
                        : "cup")
                    : paymentMethod;
            resolvedLines.push({
              productId: line.productId,
              requested: line.quantity,
              fulfilled,
              unitPriceCents:
                typeof line.unitPriceOverrideCents === "number"
                  ? line.unitPriceOverrideCents
                  : unitPriceCupCentsForSale(
                      {
                        priceCents: p.priceCents,
                        priceUsdCents: p.priceUsdCents,
                      },
                      inferredPricingMethod,
                    ),
            });
          }

          const anyFulfilled = resolvedLines.some((l) => l.fulfilled > 0);
          if (!anyFulfilled) {
            const rejected = await record({
              status: "REJECTED",
              correctionNote: "NO_STOCK_FOR_SALE",
              extraFraud: "NEGATIVE_STOCK_ATTEMPT",
            });
            results.push(rejected);
            await tx.event.create({
              data: {
                clientEventId: randomUUID(),
                type: "SALE_REJECTED",
                payload: {
                  saleId,
                  lines: resolvedLines,
                } as Prisma.InputJsonValue,
                payloadHash: payloadHash({
                  saleId,
                  lines: resolvedLines,
                } as Record<string, unknown>),
                storeId: params.storeId,
                deviceId: params.deviceId,
                clientTimestamp: BigInt(ev.timestamp),
                status: "ACCEPTED",
                relatedClientSaleId: saleId,
                isFraud: rejected.isFraud,
                fraudReason: rejected.fraudReason,
              },
            });
            pendingSales.delete(saleId);
            break;
          }

          const shortfall = resolvedLines.some((l) => l.fulfilled < l.requested);
          const status: EventStatus = shortfall ? "CORRECTED" : "ACCEPTED";

          let totalCents = 0;
          const movementDrafts: {
            productId: string;
            beforeQty: number;
            afterQty: number;
            delta: number;
          }[] = [];
          for (const l of resolvedLines) {
            if (l.fulfilled <= 0) continue;
            const cur = stock.get(l.productId) ?? 0;
            const next = cur - l.fulfilled;
            stock.set(l.productId, next);
            await tx.product.update({
              where: { id: l.productId },
              data: { stockQty: next },
            });
            movementDrafts.push({
              productId: l.productId,
              beforeQty: cur,
              afterQty: next,
              delta: -Math.trunc(l.fulfilled),
            });
            totalCents += l.fulfilled * l.unitPriceCents;
          }

          const correctionNote = shortfall ? "SALE_PARTIALLY_FULFILLED_SERVER" : undefined;

          const main = await record({
            status,
            correctionNote,
          });
          results.push(main);

          if (movementDrafts.length > 0) {
            await tx.inventoryMovement.createMany({
              data: movementDrafts.map((m) => {
                const p = productById.get(m.productId);
                return {
                storeId: params.storeId,
                productId: m.productId,
                productName: p?.name ?? m.productId,
                productSku: p?.sku ?? "—",
                delta: m.delta,
                beforeQty: m.beforeQty,
                afterQty: m.afterQty,
                reason: "SALE_COMPLETED",
                actorType: "DEVICE",
                actorId: params.deviceId,
                eventId: main.serverEventId,
                };
              }),
            });
          }

          // La app no gestiona datos de cliente; cada venta cuenta como 1 cliente.

          const sale = await tx.sale.create({
            data: {
              storeId: params.storeId,
              deviceId: params.deviceId,
              clientSaleId: saleId,
              customerId: null,
              totalCents,
              paidTotalCents: 0,
              balanceCents: totalCents,
              paymentStatus: "CREDIT_OPEN",
              status: shortfall ? "PARTIAL" : "COMPLETED",
              lines: {
                create: resolvedLines
                  .filter((l) => l.fulfilled > 0)
                  .map((l) => {
                    const p = productById.get(l.productId);
                    const unitCostCents = p?.costCents ?? null;
                    return {
                    productId: l.productId,
                    productName: p?.name ?? l.productId,
                    productSku: p?.sku ?? "—",
                    quantity: l.fulfilled,
                    unitPriceCents: l.unitPriceCents,
                    subtotalCents: l.fulfilled * l.unitPriceCents,
                    unitCostCents,
                    subtotalCostCents: unitCostCents == null ? null : l.fulfilled * unitCostCents,
                    };
                  }),
              },
            },
          });

          // Registrar pagos: v2 usa `payments[]`; legacy crea 1 pago por el total.
          const paymentRows: Array<{
            amountCupCents: number;
            currency: "CUP" | "USD";
            originalAmount: number | null;
            usdRateCup: number | null;
            method: string;
            paidAt: Date;
          }> = [];

          if (isV2) {
            if (!Array.isArray(paymentsRaw) || paymentsRaw.length === 0) {
              // Permite fiado total si payments vacío, pero lo registramos como crédito abierto.
            } else {
              for (const x of paymentsRaw) {
                if (typeof x !== "object" || x === null) continue;
                const obj = x as Record<string, unknown>;
                const method = typeof obj.method === "string" ? obj.method.trim() : "";
                const currency = String(obj.currency ?? "").toUpperCase() === "USD" ? "USD" : "CUP";
                if (!method) continue;

                const paidAtMs = typeof obj.paidAt === "number" && Number.isFinite(obj.paidAt) ? obj.paidAt : ev.timestamp;
                const paidAt = new Date(paidAtMs);

                if (currency === "USD") {
                  const usdCents = getPayloadIntNonneg(obj, "amountUsdCents");
                  const rate =
                    (typeof obj.usdRateCup === "number" && Number.isFinite(obj.usdRateCup) && obj.usdRateCup > 0
                      ? Math.round(obj.usdRateCup)
                      : storeUsdRateCup) ?? storeUsdRateCup;
                  if (usdCents === undefined) continue;
                  const amountCupCents = Math.round((usdCents / 100) * rate * 100);
                  paymentRows.push({
                    amountCupCents,
                    currency,
                    originalAmount: usdCents,
                    usdRateCup: rate,
                    method,
                    paidAt,
                  });
                } else {
                  const cupCents = getPayloadIntNonneg(obj, "amountCupCents");
                  if (cupCents === undefined) continue;
                  paymentRows.push({
                    amountCupCents: cupCents,
                    currency,
                    originalAmount: null,
                    usdRateCup: null,
                    method,
                    paidAt,
                  });
                }
              }
            }
          } else {
            // Legacy: 1 pago por el total. Interpretamos canal por texto.
            const m = (paymentMethod ?? "").toLowerCase();
            const isUsd = m.includes("usd") || m.includes("dolar") || m.includes("dólar") || m.includes("cash_usd");
            const isTransfer = m.includes("trans") || m.includes("bank") || m.includes("banco");
            const method = isUsd ? "usd_channel" : isTransfer ? "transfer" : "cash";
            paymentRows.push({
              amountCupCents: totalCents,
              currency: isUsd ? "USD" : "CUP",
              originalAmount: isUsd ? Math.round((totalCents / 100 / storeUsdRateCup) * 100) : null,
              usdRateCup: isUsd ? storeUsdRateCup : null,
              method,
              paidAt: new Date(ev.timestamp),
            });
          }

          if (paymentRows.length > 0) {
            const paidTotalCents = paymentRows.reduce((acc, p) => acc + p.amountCupCents, 0);
            await tx.salePayment.createMany({
              data: paymentRows.map((p) => ({
                storeId: params.storeId,
                saleId: sale.id,
                amountCupCents: p.amountCupCents,
                currency: p.currency as any,
                originalAmount: p.originalAmount,
                usdRateCup: p.usdRateCup,
                method: p.method,
                paidAt: p.paidAt,
                eventId: main.serverEventId,
              })),
            });
            const balanceCents = sale.totalCents - paidTotalCents;
            const paymentStatus =
              paidTotalCents === 0
                ? "CREDIT_OPEN"
                : balanceCents === 0
                  ? "PAID"
                  : balanceCents > 0
                    ? "PARTIAL"
                    : "OVERPAID";
            await tx.sale.update({
              where: { id: sale.id },
              data: { paidTotalCents, balanceCents, paymentStatus },
            });
          }

          if (shortfall) {
            await tx.event.create({
              data: {
                clientEventId: randomUUID(),
                type: "SALE_PARTIALLY_FULFILLED",
                payload: {
                  saleId,
                  saleRecordId: sale.id,
                  lines: resolvedLines,
                } as Prisma.InputJsonValue,
                payloadHash: payloadHash({
                  saleId,
                  saleRecordId: sale.id,
                  lines: resolvedLines,
                } as Record<string, unknown>),
                storeId: params.storeId,
                deviceId: params.deviceId,
                clientTimestamp: BigInt(ev.timestamp),
                status: "ACCEPTED",
                relatedClientSaleId: saleId,
              },
            });
          }

          pendingSales.delete(saleId);
          break;
        }

        case "SALE_PAYMENT_APPLIED": {
          const saleId = getPayloadString(ev.payload, "saleId");
          const paymentsRaw = getPayloadArray(ev.payload as Record<string, unknown>, "payments");
          if (!saleId || !Array.isArray(paymentsRaw) || paymentsRaw.length === 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_PAYMENT_APPLIED",
              }),
            );
            break;
          }

          const existingSale = await tx.sale.findFirst({
            where: { storeId: params.storeId, clientSaleId: saleId },
            select: { id: true, totalCents: true, paidTotalCents: true },
          });
          if (!existingSale) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "UNKNOWN_SALE",
              }),
            );
            break;
          }

          const rec = await record({ status: "ACCEPTED" });

          let added = 0;
          const toCreate: Prisma.SalePaymentCreateManyInput[] = [];
          for (const x of paymentsRaw) {
            if (typeof x !== "object" || x === null) continue;
            const obj = x as Record<string, unknown>;
            const method = typeof obj.method === "string" ? obj.method.trim() : "";
            const currency = String(obj.currency ?? "").toUpperCase() === "USD" ? "USD" : "CUP";
            if (!method) continue;
            const paidAtMs = typeof obj.paidAt === "number" && Number.isFinite(obj.paidAt) ? obj.paidAt : ev.timestamp;
            const paidAt = new Date(paidAtMs);

            if (currency === "USD") {
              const usdCents = getPayloadIntNonneg(obj, "amountUsdCents");
              const rate =
                (typeof obj.usdRateCup === "number" && Number.isFinite(obj.usdRateCup) && obj.usdRateCup > 0
                  ? Math.round(obj.usdRateCup)
                  : storeUsdRateCup) ?? storeUsdRateCup;
              if (usdCents === undefined) continue;
              const amountCupCents = Math.round((usdCents / 100) * rate * 100);
              added += amountCupCents;
              toCreate.push({
                storeId: params.storeId,
                saleId: existingSale.id,
                amountCupCents,
                currency: "USD" as any,
                originalAmount: usdCents,
                usdRateCup: rate,
                method,
                paidAt,
                eventId: rec.serverEventId,
              });
            } else {
              const cupCents = getPayloadIntNonneg(obj, "amountCupCents");
              if (cupCents === undefined) continue;
              added += cupCents;
              toCreate.push({
                storeId: params.storeId,
                saleId: existingSale.id,
                amountCupCents: cupCents,
                currency: "CUP" as any,
                originalAmount: null,
                usdRateCup: null,
                method,
                paidAt,
                eventId: rec.serverEventId,
              });
            }
          }

          if (toCreate.length === 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_PAYMENT_APPLIED",
              }),
            );
            break;
          }

          await tx.salePayment.createMany({ data: toCreate });
          const nextPaid = existingSale.paidTotalCents + added;
          const balanceCents = existingSale.totalCents - nextPaid;
          const paymentStatus =
            nextPaid === 0 ? "CREDIT_OPEN" : balanceCents === 0 ? "PAID" : balanceCents > 0 ? "PARTIAL" : "OVERPAID";
          await tx.sale.update({
            where: { id: existingSale.id },
            data: { paidTotalCents: nextPaid, balanceCents, paymentStatus, editedAt: new Date(serverNow) },
          });

          results.push(rec);
          break;
        }

        case "SALE_RETURNED": {
          const saleId = getPayloadString(ev.payload, "saleId");
          const linesRaw = getPayloadArray(ev.payload as Record<string, unknown>, "lines");
          const reason = getPayloadString(ev.payload, "reason");
          const returnedAtMs = getPayloadNumber(ev.payload as Record<string, unknown>, "returnedAt") ?? ev.timestamp;
          const returnedAt = new Date(returnedAtMs);
          if (!saleId || !Array.isArray(linesRaw) || linesRaw.length === 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_RETURN",
              }),
            );
            break;
          }

          const sale = await tx.sale.findFirst({
            where: { storeId: params.storeId, clientSaleId: saleId },
            include: { lines: true },
          });
          if (!sale) {
            results.push(await record({ status: "REJECTED", correctionNote: "UNKNOWN_SALE" }));
            break;
          }

          // map actual quantities by productId (sum if duplicates)
          const soldByProduct = new Map<string, { quantity: number; unitPriceCents: number }>();
          for (const l of sale.lines) {
            if (!l.productId) continue;
            const prev = soldByProduct.get(l.productId) ?? { quantity: 0, unitPriceCents: l.unitPriceCents };
            soldByProduct.set(l.productId, {
              quantity: prev.quantity + l.quantity,
              unitPriceCents: prev.unitPriceCents,
            });
          }

          const toReturn = new Map<string, number>();
          for (const x of linesRaw) {
            if (typeof x !== "object" || x === null) continue;
            const obj = x as Record<string, unknown>;
            const pid = typeof obj.productId === "string" ? obj.productId.trim() : "";
            const qty = getPayloadIntPos(obj, "quantity");
            if (!pid || qty === undefined) continue;
            toReturn.set(pid, (toReturn.get(pid) ?? 0) + qty);
          }
          if (toReturn.size === 0) {
            results.push(await record({ status: "REJECTED", correctionNote: "INVALID_RETURN_LINES" }));
            break;
          }

          // validar que no devuelvan más de lo vendido
          let invalidReturn = false;
          for (const [pid, qty] of toReturn.entries()) {
            const sold = soldByProduct.get(pid)?.quantity ?? 0;
            if (qty > sold) {
              results.push(await record({ status: "REJECTED", correctionNote: "RETURN_EXCEEDS_SOLD" }));
              invalidReturn = true;
              break;
            }
          }
          if (invalidReturn) break;

          const rec = await record({ status: "ACCEPTED" });

          // aplicar: stock + movimientos + actualizar líneas/total
          let returnTotalCents = 0;
          const movementDrafts: { productId: string; beforeQty: number; afterQty: number; delta: number }[] = [];

          for (const [pid, qty] of toReturn.entries()) {
            const cur = stock.get(pid);
            if (cur === undefined) {
              // producto ya no activo: igual permitimos ajustar por DB
              const p = await tx.product.findFirst({ where: { id: pid, storeId: params.storeId }, select: { stockQty: true } });
              if (!p) continue;
              const beforeQty = p.stockQty;
              const afterQty = beforeQty + qty;
              await tx.product.update({ where: { id: pid }, data: { stockQty: afterQty } });
              movementDrafts.push({ productId: pid, beforeQty, afterQty, delta: qty });
            } else {
              const beforeQty = cur;
              const afterQty = beforeQty + qty;
              stock.set(pid, afterQty);
              await tx.product.update({ where: { id: pid }, data: { stockQty: afterQty } });
              movementDrafts.push({ productId: pid, beforeQty, afterQty, delta: qty });
            }

            const unitPriceCents = soldByProduct.get(pid)?.unitPriceCents ?? 0;
            returnTotalCents += qty * unitPriceCents;
          }

          if (movementDrafts.length > 0) {
            await tx.inventoryMovement.createMany({
              data: movementDrafts.map((m) => {
                const p = productById.get(m.productId);
                return {
                  storeId: params.storeId,
                  productId: m.productId,
                  productName: p?.name ?? m.productId,
                  productSku: p?.sku ?? "—",
                  delta: m.delta,
                  beforeQty: m.beforeQty,
                  afterQty: m.afterQty,
                  reason: "SALE_RETURNED",
                  actorType: "DEVICE",
                  actorId: params.deviceId,
                  eventId: rec.serverEventId,
                };
              }),
            });
          }

          // actualizar SaleLine: restar cantidades (simple: iterar líneas existentes en orden)
          const remainingToReturn = new Map(toReturn);
          for (const l of sale.lines) {
            const pid = l.productId;
            if (!pid) continue;
            const remaining = remainingToReturn.get(pid) ?? 0;
            if (remaining <= 0) continue;
            const dec = Math.min(remaining, l.quantity);
            const nextQty = l.quantity - dec;
            remainingToReturn.set(pid, remaining - dec);
            if (nextQty <= 0) {
              await tx.saleLine.delete({ where: { id: l.id } });
            } else {
              await tx.saleLine.update({
                where: { id: l.id },
                data: { quantity: nextQty, subtotalCents: nextQty * l.unitPriceCents },
              });
            }
          }

          const nextTotal = Math.max(0, sale.totalCents - returnTotalCents);
          const nextBalance = nextTotal - sale.paidTotalCents;
          const nextPaymentStatus =
            sale.paidTotalCents === 0
              ? "CREDIT_OPEN"
              : nextBalance === 0
                ? "PAID"
                : nextBalance > 0
                  ? "PARTIAL"
                  : "OVERPAID";

          await tx.sale.update({
            where: { id: sale.id },
            data: {
              totalCents: nextTotal,
              balanceCents: nextBalance,
              paymentStatus: nextPaymentStatus,
              editedAt: new Date(serverNow),
              revisionCount: { increment: 1 },
            },
          });

          // registrar devolución como entidad propia
          const createdReturn = await tx.saleReturn.create({
            data: {
              storeId: params.storeId,
              saleId: sale.id,
              amountCupCents: -returnTotalCents,
              reason: reason ?? null,
              returnedAt,
              eventId: rec.serverEventId,
            },
          });
          const returnLines = Array.from(toReturn.entries()).map(([pid, qty]) => {
            const p = productById.get(pid);
            const unitPriceCents = soldByProduct.get(pid)?.unitPriceCents ?? 0;
            return {
              saleReturnId: createdReturn.id,
              productId: pid,
              productName: p?.name ?? pid,
              productSku: p?.sku ?? "—",
              quantity: qty,
              unitPriceCents,
              subtotalCents: qty * unitPriceCents,
            };
          });
          if (returnLines.length > 0) {
            await tx.saleReturnLine.createMany({ data: returnLines as any });
          }

          await tx.auditLog.create({
            data: {
              storeId: params.storeId,
              actorType: "DEVICE",
              actorId: params.deviceId,
              action: "SALE_RETURNED_DEVICE",
              entityType: "Sale",
              entityId: sale.id,
              meta: { clientSaleId: saleId, returnTotalCents, reason } as any,
            },
          });

          results.push(rec);
          break;
        }

        case "SALE_EDITED": {
          const saleId = getPayloadString(ev.payload, "saleId");
          const linesRaw = getPayloadArray(ev.payload as Record<string, unknown>, "lines");
          const note = getPayloadString(ev.payload, "note");
          if (!saleId || !Array.isArray(linesRaw) || linesRaw.length === 0) {
            results.push(await record({ status: "REJECTED", correctionNote: "INVALID_SALE_EDIT" }));
            break;
          }

          const sale = await tx.sale.findFirst({
            where: { storeId: params.storeId, clientSaleId: saleId },
            include: { lines: true, payments: true },
          });
          if (!sale) {
            results.push(await record({ status: "REJECTED", correctionNote: "UNKNOWN_SALE" }));
            break;
          }

          // Construir nuevo set de líneas (sumando duplicados por productId)
          const desired = new Map<string, { quantity: number; unitPriceOverrideCents?: number }>();
          for (const x of linesRaw) {
            if (typeof x !== "object" || x === null) continue;
            const obj = x as Record<string, unknown>;
            const pid = typeof obj.productId === "string" ? obj.productId.trim() : "";
            const qty = getPayloadIntNonneg(obj, "quantity");
            if (!pid || qty === undefined) continue;
            const override = getPayloadIntNonneg(obj, "unitPriceCupCentsOverride");
            const prev = desired.get(pid) ?? { quantity: 0 };
            desired.set(pid, {
              quantity: prev.quantity + qty,
              unitPriceOverrideCents: override ?? prev.unitPriceOverrideCents,
            });
          }
          if (desired.size === 0) {
            results.push(await record({ status: "REJECTED", correctionNote: "INVALID_SALE_EDIT_LINES" }));
            break;
          }

          // Actual actual quantities
          const actual = new Map<string, { quantity: number; unitPriceCents: number }>();
          for (const l of sale.lines) {
            if (!l.productId) continue;
            const prev = actual.get(l.productId) ?? { quantity: 0, unitPriceCents: l.unitPriceCents };
            actual.set(l.productId, { quantity: prev.quantity + l.quantity, unitPriceCents: prev.unitPriceCents });
          }

          // calcular delta de stock: si desired < actual => devolver stock; si desired > actual => consumir stock
          const deltas = new Map<string, number>();
          const allPids = new Set<string>([...actual.keys(), ...desired.keys()]);
          for (const pid of allPids) {
            const a = actual.get(pid)?.quantity ?? 0;
            const d = desired.get(pid)?.quantity ?? 0;
            deltas.set(pid, d - a); // positivo = necesita más stock
          }

          // validar stock para incrementos
          let invalidEdit = false;
          for (const [pid, delta] of deltas.entries()) {
            if (delta <= 0) continue;
            const available = stock.get(pid);
            if (available === undefined) {
              results.push(await record({ status: "REJECTED", correctionNote: "UNKNOWN_PRODUCT" }));
              invalidEdit = true;
              break;
            }
            if (available < delta) {
              results.push(await record({ status: "REJECTED", correctionNote: "NEGATIVE_STOCK" }));
              invalidEdit = true;
              break;
            }
          }
          if (invalidEdit) break;

          const beforeSnapshot = {
            totalCents: sale.totalCents,
            paidTotalCents: sale.paidTotalCents,
            balanceCents: sale.balanceCents,
            paymentStatus: sale.paymentStatus,
            lines: sale.lines.map((l) => ({
              id: l.id,
              productId: l.productId,
              productSku: l.productSku,
              productName: l.productName,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              subtotalCents: l.subtotalCents,
            })),
          };

          const rec = await record({ status: "ACCEPTED" });

          // aplicar movimientos de stock
          const movementDrafts: { productId: string; beforeQty: number; afterQty: number; delta: number }[] = [];
          for (const [pid, delta] of deltas.entries()) {
            if (delta === 0) continue;
            const cur = stock.get(pid) ?? 0;
            const next = cur - delta; // delta positivo consume, negativo devuelve
            stock.set(pid, next);
            await tx.product.update({ where: { id: pid }, data: { stockQty: next } });
            movementDrafts.push({ productId: pid, beforeQty: cur, afterQty: next, delta: -delta });
          }
          if (movementDrafts.length > 0) {
            await tx.inventoryMovement.createMany({
              data: movementDrafts.map((m) => {
                const p = productById.get(m.productId);
                return {
                  storeId: params.storeId,
                  productId: m.productId,
                  productName: p?.name ?? m.productId,
                  productSku: p?.sku ?? "—",
                  delta: m.delta,
                  beforeQty: m.beforeQty,
                  afterQty: m.afterQty,
                  reason: "SALE_EDITED",
                  actorType: "DEVICE",
                  actorId: params.deviceId,
                  eventId: rec.serverEventId,
                };
              }),
            });
          }

          // reconstruir líneas: para cada desired productId, fijar unitPrice (override o original o catálogo CUP)
          let nextTotal = 0;
          const createLines: any[] = [];
          for (const [pid, d] of desired.entries()) {
            const p = productById.get(pid);
            if (!p) continue;
            const unitPriceCents =
              typeof d.unitPriceOverrideCents === "number"
                ? d.unitPriceOverrideCents
                : actual.get(pid)?.unitPriceCents ?? p.priceCents;
            const qty = d.quantity;
            if (qty <= 0) continue;
            const subtotalCents = qty * unitPriceCents;
            nextTotal += subtotalCents;
            const unitCostCents = p.costCents ?? null;
            createLines.push({
              productId: pid,
              productName: p.name,
              productSku: p.sku,
              quantity: qty,
              unitPriceCents,
              subtotalCents,
              unitCostCents,
              subtotalCostCents: unitCostCents == null ? null : qty * unitCostCents,
            });
          }

          await tx.saleLine.deleteMany({ where: { saleId: sale.id } });
          if (createLines.length > 0) {
            await tx.sale.update({
              where: { id: sale.id },
              data: {
                lines: { create: createLines },
              },
            });
          }

          const nextBalance = nextTotal - sale.paidTotalCents;
          const nextPaymentStatus =
            sale.paidTotalCents === 0
              ? "CREDIT_OPEN"
              : nextBalance === 0
                ? "PAID"
                : nextBalance > 0
                  ? "PARTIAL"
                  : "OVERPAID";

          await tx.sale.update({
            where: { id: sale.id },
            data: {
              totalCents: nextTotal,
              balanceCents: nextBalance,
              paymentStatus: nextPaymentStatus,
              editedAt: new Date(serverNow),
              revisionCount: { increment: 1 },
            },
          });

          await tx.auditLog.create({
            data: {
              storeId: params.storeId,
              actorType: "DEVICE",
              actorId: params.deviceId,
              action: "SALE_EDITED_DEVICE",
              entityType: "Sale",
              entityId: sale.id,
              before: beforeSnapshot as any,
              after: { totalCents: nextTotal, balanceCents: nextBalance, lines: createLines } as any,
              meta: { clientSaleId: saleId, note } as any,
            },
          });

          results.push(rec);
          break;
        }

        case "CUSTOMER_UPSERTED": {
          const pl = ev.payload as Record<string, unknown>;
          const phone = typeof pl.phone === "string" ? pl.phone.trim() : "";
          const name = typeof pl.name === "string" ? pl.name.trim() : null;
          const email = typeof pl.email === "string" ? pl.email.trim() : null;
          const externalId = typeof pl.externalId === "string" ? pl.externalId.trim() : null;
          if (!phone && !externalId) {
            results.push(await record({ status: "REJECTED", correctionNote: "INVALID_CUSTOMER" }));
            break;
          }
          // Estrategia simple: crear cliente si no existe por (storeId, phone) o (storeId, externalId).
          const existing =
            (externalId
              ? await tx.customer.findFirst({ where: { storeId: params.storeId, externalId } })
              : null) ??
            (phone ? await tx.customer.findFirst({ where: { storeId: params.storeId, phone } }) : null);

          if (existing) {
            await tx.customer.update({
              where: { id: existing.id },
              data: {
                name: name ?? existing.name,
                phone: phone || existing.phone,
                email: email ?? existing.email,
                externalId: externalId ?? existing.externalId,
              },
            });
          } else {
            await tx.customer.create({
              data: {
                storeId: params.storeId,
                name,
                phone: phone || null,
                email,
                externalId,
              },
            });
          }
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        case "PRODUCT_CREATED": {
          const name = getPayloadString(ev.payload, "name")?.trim();
          if (!name) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_PRODUCT_CREATE",
              }),
            );
            break;
          }
          let sku = getPayloadString(ev.payload, "sku")?.trim() ?? "";
          if (!sku) {
            sku = await allocateProductSku(tx, params.storeId);
          }
          const priceCents = getPayloadIntNonneg(ev.payload, "priceCents");
          if (priceCents === undefined) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_PRICE_CENTS",
              }),
            );
            break;
          }
          const priceUsdCents = getPayloadIntNonneg(ev.payload, "priceUsdCents") ?? 0;
          let unitsPerBox = getPayloadIntNonneg(ev.payload, "unitsPerBox") ?? 1;
          if (unitsPerBox < 1) unitsPerBox = 1;
          const stockQty = getPayloadIntNonneg(ev.payload, "stockQty") ?? 0;
          const lowStockAt = getPayloadIntNonneg(ev.payload, "lowStockAt") ?? 5;
          const supplierRaw = getPayloadString(ev.payload, "supplierName");
          let supplierName =
            supplierRaw === undefined
              ? null
              : supplierRaw.trim() === ""
                ? null
                : supplierRaw.trim().slice(0, 120);

          const supplierIdFromPayload = getPayloadString(ev.payload, "supplierId")?.trim();
          let supplierIdResolved: string | null = null;
          if (supplierIdFromPayload) {
            const sup = await tx.supplier.findFirst({
              where: {
                id: supplierIdFromPayload,
                storeId: params.storeId,
                active: true,
              },
              select: { id: true, name: true },
            });
            if (sup) {
              supplierIdResolved = sup.id;
              supplierName = sup.name;
            }
          }

          const costCentsPayload = getPayloadIntNonneg(ev.payload, "costCents");

          let wholesaleCupCents: number | null = null;
          if (Object.prototype.hasOwnProperty.call(ev.payload, "wholesaleCupCents")) {
            const raw = (ev.payload as Record<string, unknown>).wholesaleCupCents;
            if (raw === null) {
              wholesaleCupCents = null;
            } else {
              const w = getPayloadIntNonneg(ev.payload, "wholesaleCupCents");
              if (w === undefined) {
                results.push(
                  await record({
                    status: "REJECTED",
                    correctionNote: "INVALID_WHOLESALE_CENTS",
                  }),
                );
                break;
              }
              wholesaleCupCents = w;
            }
          }

          const hasUsdColRows = await tx.$queryRaw<{ ok: number }[]>`
            SELECT 1::int AS ok
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Product'
              AND column_name = 'priceUsdCents'
            LIMIT 1
          `;
          const hasUsdCol = hasUsdColRows.length > 0;

          const hasSupplierIdColRows = await tx.$queryRaw<{ ok: number }[]>`
            SELECT 1::int AS ok
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Product'
              AND column_name = 'supplierId'
            LIMIT 1
          `;
          const hasSupplierIdCol = hasSupplierIdColRows.length > 0;

          try {
            const created = hasUsdCol
              ? await tx.product.create({
                  data: {
                    storeId: params.storeId,
                    sku,
                    name,
                    priceCents,
                    priceUsdCents,
                    unitsPerBox,
                    wholesaleCupCents,
                    costCents: costCentsPayload ?? null,
                    ...(hasSupplierIdCol && supplierIdResolved
                      ? { supplierId: supplierIdResolved, supplierName }
                      : { supplierName }),
                    stockQty,
                    lowStockAt,
                    active: true,
                  },
                })
              : await (async () => {
                  const legacyRows = await tx.$queryRaw<
                    {
                      id: string;
                      storeId: string;
                      sku: string;
                      name: string;
                      priceCents: number;
                      costCents: number | null;
                      supplierName: string | null;
                      stockQty: number;
                      lowStockAt: number;
                      active: boolean;
                      createdAt: Date;
                      updatedAt: Date;
                    }[]
                  >`
                    INSERT INTO "Product" (
                      "storeId",
                      sku,
                      name,
                      "priceCents",
                      "supplierName",
                      "stockQty",
                      "lowStockAt",
                      active
                    )
                    VALUES (
                      ${params.storeId},
                      ${sku},
                      ${name},
                      ${priceCents},
                      ${supplierName},
                      ${stockQty},
                      ${lowStockAt},
                      true
                    )
                    RETURNING
                      id,
                      "storeId",
                      sku,
                      name,
                      "priceCents",
                      "costCents",
                      "supplierName",
                      "stockQty",
                      "lowStockAt",
                      active,
                      "createdAt",
                      "updatedAt"
                  `;
                  const r = legacyRows[0];
                  if (!r) throw new Error("DB_INSERT_FAILED");
                  return {
                    ...r,
                    priceUsdCents: 0,
                    unitsPerBox: 1,
                    wholesaleCupCents: null,
                    deletedAt: null,
                    supplierId: null,
                  };
                })();
            productById.set(created.id, created);
            stock.set(created.id, created.stockQty);
            results.push(await record({ status: "ACCEPTED" }));
          } catch (e: unknown) {
            if (prismaUniqueViolation(e)) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "DUPLICATE_SKU",
                }),
              );
            } else {
              throw e;
            }
          }
          break;
        }

        case "PRODUCT_UPDATED": {
          const productId = getPayloadString(ev.payload, "productId")?.trim();
          if (!productId) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "MISSING_PRODUCT_ID",
              }),
            );
            break;
          }
          const existing = await tx.product.findFirst({
            where: { id: productId, storeId: params.storeId },
          });
          if (!existing) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "UNKNOWN_PRODUCT",
              }),
            );
            break;
          }

          const pl = ev.payload as Record<string, unknown>;
          const data: Prisma.ProductUpdateInput = {};

          if ("sku" in pl && typeof pl.sku === "string") {
            const s = pl.sku.trim();
            if (!s) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_SKU",
                }),
              );
              break;
            }
            data.sku = s;
          }
          if ("name" in pl && typeof pl.name === "string") {
            const n = pl.name.trim();
            if (!n) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_NAME",
                }),
              );
              break;
            }
            data.name = n;
          }
          if ("priceCents" in pl) {
            const v = getPayloadIntNonneg(pl, "priceCents");
            if (v === undefined) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_PRICE_CENTS",
                }),
              );
              break;
            }
            data.priceCents = v;
          }
          if ("priceUsdCents" in pl) {
            const v = getPayloadIntNonneg(pl, "priceUsdCents");
            if (v === undefined) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_PRICE_USD_CENTS",
                }),
              );
              break;
            }
            data.priceUsdCents = v;
          }
          if ("unitsPerBox" in pl) {
            const v = getPayloadIntNonneg(pl, "unitsPerBox");
            if (v === undefined || v < 1) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_UNITS_PER_BOX",
                }),
              );
              break;
            }
            data.unitsPerBox = v;
          }
          if ("stockQty" in pl) {
            const v = getPayloadIntNonneg(pl, "stockQty");
            if (v === undefined) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_STOCK_QTY",
                }),
              );
              break;
            }
            data.stockQty = v;
          }
          if ("lowStockAt" in pl) {
            const v = getPayloadIntNonneg(pl, "lowStockAt");
            if (v === undefined) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_LOW_STOCK",
                }),
              );
              break;
            }
            data.lowStockAt = v;
          }
          if ("active" in pl && typeof pl.active === "boolean") {
            data.active = pl.active;
          }
          if ("supplierName" in pl) {
            if (pl.supplierName === null) {
              data.supplierName = null;
            } else if (typeof pl.supplierName === "string") {
              data.supplierName =
                pl.supplierName.trim() === "" ? null : pl.supplierName.trim().slice(0, 120);
            } else {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_SUPPLIER_NAME",
                }),
              );
              break;
            }
          }
          if ("supplierId" in pl) {
            if (pl.supplierId === null) {
              data.supplier = { disconnect: true };
              data.supplierName = null;
            } else if (typeof pl.supplierId === "string") {
              const sid = pl.supplierId.trim();
              if (!sid) {
                results.push(
                  await record({
                    status: "REJECTED",
                    correctionNote: "INVALID_SUPPLIER_ID",
                  }),
                );
                break;
              }
              const sup = await tx.supplier.findFirst({
                where: { id: sid, storeId: params.storeId },
                select: { id: true, name: true, active: true },
              });
              if (!sup) {
                results.push(
                  await record({
                    status: "REJECTED",
                    correctionNote: "INVALID_SUPPLIER",
                  }),
                );
                break;
              }
              const sameAsCurrent = existing.supplierId === sup.id;
              if (!sup.active && !sameAsCurrent) {
                results.push(
                  await record({
                    status: "REJECTED",
                    correctionNote: "INVALID_SUPPLIER",
                  }),
                );
                break;
              }
              data.supplier = { connect: { id: sup.id } };
              data.supplierName = sup.name;
            } else {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "INVALID_SUPPLIER_ID",
                }),
              );
              break;
            }
          }
          if ("wholesaleCupCents" in pl) {
            if (pl.wholesaleCupCents === null) {
              data.wholesaleCupCents = null;
            } else {
              const w = getPayloadIntNonneg(pl, "wholesaleCupCents");
              if (w === undefined) {
                results.push(
                  await record({
                    status: "REJECTED",
                    correctionNote: "INVALID_WHOLESALE_CENTS",
                  }),
                );
                break;
              }
              data.wholesaleCupCents = w;
            }
          }

          if (Object.keys(data).length === 0) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "EMPTY_PRODUCT_UPDATE",
              }),
            );
            break;
          }

          try {
            const updated = await tx.product.update({
              where: { id: productId },
              data,
            });
            if (!updated.active) {
              productById.delete(productId);
              stock.delete(productId);
            } else {
              productById.set(updated.id, updated);
              stock.set(updated.id, updated.stockQty);
            }
            results.push(await record({ status: "ACCEPTED" }));
          } catch (e: unknown) {
            if (prismaUniqueViolation(e)) {
              results.push(
                await record({
                  status: "REJECTED",
                  correctionNote: "DUPLICATE_SKU",
                }),
              );
            } else {
              throw e;
            }
          }
          break;
        }

        case "PRODUCT_DELETED": {
          const productId = getPayloadString(ev.payload, "productId")?.trim();
          if (!productId) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "MISSING_PRODUCT_ID",
              }),
            );
            break;
          }
          const row = await tx.product.findFirst({
            where: { id: productId, storeId: params.storeId },
          });
          if (!row) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "UNKNOWN_PRODUCT",
              }),
            );
            break;
          }
          if (!row.active) {
            productById.delete(productId);
            stock.delete(productId);
            results.push(
              await record({
                status: "ACCEPTED",
                correctionNote: "ALREADY_INACTIVE",
              }),
            );
            break;
          }
          await tx.product.update({
            where: { id: productId },
            data: { active: false },
          });
          productById.delete(productId);
          stock.delete(productId);
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        default: {
          results.push(
            await record({
              status: "REJECTED",
              correctionNote: `UNKNOWN_EVENT_TYPE:${ev.type}`,
            }),
          );
        }
      }
    }
  });

  return results;
}
