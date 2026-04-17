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

/** Entero ≥ 0 en payload (rechaza decimales). */
function getPayloadIntNonneg(p: Record<string, unknown>, key: string): number | undefined {
  const v = getPayloadNumber(p, key);
  if (v === undefined || !Number.isInteger(v) || v < 0) return undefined;
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
          draft.lines.push({ productId: resolvedProductId, quantity });
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

          // La app no gestiona datos de cliente; cada venta cuenta como 1 cliente.

          const sale = await tx.sale.create({
            data: {
              storeId: params.storeId,
              deviceId: params.deviceId,
              clientSaleId: saleId,
              customerId: null,
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
