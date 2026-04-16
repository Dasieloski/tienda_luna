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
import { unitPriceCupCentsForSale } from "@/lib/pricing";
import type { ClientSyncEvent } from "@/types/events";

type DraftSale = {
  customerId?: string;
  lines: { productId: string; quantity: number }[];
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
    const products = await tx.product.findMany({
      where: { storeId: params.storeId, active: true },
    });
    const stock = new Map(products.map((p) => [p.id, p.stockQty]));
    const productById = new Map(products.map((p) => [p.id, p]));

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
          const productId = getPayloadString(ev.payload, "productId");
          const quantity = getPayloadNumber(ev.payload, "quantity");
          const draft = saleId ? pendingSales.get(saleId) : undefined;
          if (!saleId || !productId || quantity === undefined || quantity <= 0 || !draft) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "INVALID_CART_LINE",
              }),
            );
            break;
          }
          if (!productById.has(productId)) {
            results.push(
              await record({
                status: "REJECTED",
                correctionNote: "UNKNOWN_PRODUCT",
              }),
            );
            break;
          }
          draft.lines.push({ productId, quantity });
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
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        case "SALE_CANCELLED": {
          const saleId = getPayloadString(ev.payload, "saleId");
          if (saleId) pendingSales.delete(saleId);
          results.push(await record({ status: "ACCEPTED" }));
          break;
        }

        case "SALE_COMPLETED": {
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
            resolvedLines.push({
              productId: line.productId,
              requested: line.quantity,
              fulfilled,
              unitPriceCents: unitPriceCupCentsForSale(
                {
                  priceCents: p.priceCents,
                  priceUsdCents: p.priceUsdCents,
                },
                paymentMethod,
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
          for (const l of resolvedLines) {
            if (l.fulfilled <= 0) continue;
            const cur = stock.get(l.productId) ?? 0;
            const next = cur - l.fulfilled;
            stock.set(l.productId, next);
            await tx.product.update({
              where: { id: l.productId },
              data: { stockQty: next },
            });
            totalCents += l.fulfilled * l.unitPriceCents;
          }

          const correctionNote = shortfall ? "SALE_PARTIALLY_FULFILLED_SERVER" : undefined;

          const main = await record({
            status,
            correctionNote,
          });
          results.push(main);

          let customerId: string | undefined = draft.customerId;
          if (
            customerId &&
            !(await tx.customer.findFirst({
              where: { id: customerId, storeId: params.storeId },
            }))
          ) {
            customerId = undefined;
          }

          const sale = await tx.sale.create({
            data: {
              storeId: params.storeId,
              deviceId: params.deviceId,
              clientSaleId: saleId,
              customerId: customerId ?? null,
              totalCents,
              status: shortfall ? "PARTIAL" : "COMPLETED",
              lines: {
                create: resolvedLines
                  .filter((l) => l.fulfilled > 0)
                  .map((l) => ({
                    productId: l.productId,
                    quantity: l.fulfilled,
                    unitPriceCents: l.unitPriceCents,
                    subtotalCents: l.fulfilled * l.unitPriceCents,
                  })),
              },
            },
          });

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
