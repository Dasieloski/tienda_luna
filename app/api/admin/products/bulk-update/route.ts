import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";
import { prisma } from "@/lib/db";
import { auditRequestMeta } from "@/lib/audit-meta";

const changeSchema = z.union([
  z.object({ field: z.literal("name"), value: z.string().min(1).max(200) }),
  z.object({ field: z.literal("priceCents"), value: z.number().int().nonnegative() }),
  z.object({ field: z.literal("transferPriceCents"), value: z.number().int().nonnegative() }),
  z.object({ field: z.literal("priceUsdCents"), value: z.number().int().nonnegative() }),
  z.object({ field: z.literal("costCents"), value: z.number().int().nonnegative().nullable() }),
  z.object({ field: z.literal("unitsPerBox"), value: z.number().int().positive() }),
  z.object({ field: z.literal("wholesaleCupCents"), value: z.number().int().nonnegative().nullable() }),
  z.object({ field: z.literal("stockQty"), value: z.number().int().nonnegative() }),
  z.object({ field: z.literal("lowStockAt"), value: z.number().int().nonnegative() }),
  z.object({ field: z.literal("supplierName"), value: z.string().max(120) }),
  z.object({ field: z.literal("active"), value: z.boolean() }),
]);

const updateSchema = z.object({
  productId: z.string().min(1),
  changes: z.array(changeSchema).min(1).max(20),
});

const bodySchema = z.object({
  updates: z.array(updateSchema).min(1).max(500),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const ids = Array.from(new Set(parsed.data.updates.map((u) => u.productId)));
  if (ids.length === 0) {
    return NextResponse.json({ error: "EMPTY" }, { status: 400 });
  }

  const existing = await prisma.product.findMany({
    where: { id: { in: ids }, storeId: guard.session.storeId },
  });
  const byId = new Map(existing.map((p) => [p.id, p]));

  const missingIds = ids.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    return NextResponse.json(
      { error: "PRODUCTS_NOT_FOUND", missingIds },
      { status: 404 },
    );
  }

  const summary: {
    productId: string;
    sku: string;
    name: string;
    applied: { field: string; before: unknown; after: unknown }[];
    stockChanged: boolean;
  }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const update of parsed.data.updates) {
        const cur = byId.get(update.productId);
        if (!cur) continue;

        const data: Record<string, unknown> = {};
        const applied: { field: string; before: unknown; after: unknown }[] = [];
        let stockChanged = false;

        for (const c of update.changes) {
          switch (c.field) {
            case "name":
              if (cur.name !== c.value) {
                applied.push({ field: "name", before: cur.name, after: c.value });
                data.name = c.value;
              }
              break;
            case "priceCents":
              if (cur.priceCents !== c.value) {
                applied.push({ field: "priceCents", before: cur.priceCents, after: c.value });
                data.priceCents = c.value;
              }
              break;
            case "transferPriceCents": {
              const curX = cur as unknown as { transferPriceCents?: number };
              const curVal = curX.transferPriceCents ?? cur.priceCents;
              if (curVal !== c.value) {
                applied.push({ field: "transferPriceCents", before: curVal, after: c.value });
                data.transferPriceCents = c.value;
              }
              break;
            }
            case "priceUsdCents": {
              const curX = cur as unknown as { priceUsdCents?: number };
              const curVal = curX.priceUsdCents ?? 0;
              if (curVal !== c.value) {
                applied.push({ field: "priceUsdCents", before: curVal, after: c.value });
                data.priceUsdCents = c.value;
              }
              break;
            }
            case "costCents": {
              const curX = cur as unknown as { costCents?: number | null };
              const curVal = curX.costCents ?? null;
              if (curVal !== c.value) {
                applied.push({ field: "costCents", before: curVal, after: c.value });
                data.costCents = c.value;
              }
              break;
            }
            case "unitsPerBox": {
              const curX = cur as unknown as { unitsPerBox?: number };
              const curVal = curX.unitsPerBox ?? 1;
              if (curVal !== c.value) {
                applied.push({ field: "unitsPerBox", before: curVal, after: c.value });
                data.unitsPerBox = c.value;
              }
              break;
            }
            case "wholesaleCupCents": {
              const curX = cur as unknown as { wholesaleCupCents?: number | null };
              const curVal = curX.wholesaleCupCents ?? null;
              if (curVal !== c.value) {
                applied.push({ field: "wholesaleCupCents", before: curVal, after: c.value });
                data.wholesaleCupCents = c.value;
              }
              break;
            }
            case "stockQty":
              if (cur.stockQty !== c.value) {
                applied.push({ field: "stockQty", before: cur.stockQty, after: c.value });
                data.stockQty = c.value;
                stockChanged = true;
              }
              break;
            case "lowStockAt":
              if (cur.lowStockAt !== c.value) {
                applied.push({ field: "lowStockAt", before: cur.lowStockAt, after: c.value });
                data.lowStockAt = c.value;
              }
              break;
            case "supplierName": {
              const curX = cur as unknown as { supplierName?: string | null; supplierId?: string | null };
              const curVal = curX.supplierName ?? "";
              const newVal = c.value ?? "";
              if (curVal !== newVal) {
                applied.push({ field: "supplierName", before: curVal, after: newVal });
                data.supplierName = newVal === "" ? null : newVal;
              }
              break;
            }
            case "active":
              if (cur.active !== c.value) {
                applied.push({ field: "active", before: cur.active, after: c.value });
                data.active = c.value;
              }
              break;
          }
        }

        if (Object.keys(data).length === 0) continue;

        const updated = await tx.product.update({
          where: { id: cur.id },
          data,
        });

        if (stockChanged && typeof data.stockQty === "number") {
          await tx.inventoryMovement.create({
            data: {
              storeId: guard.session.storeId,
              productId: cur.id,
              delta: (data.stockQty as number) - cur.stockQty,
              beforeQty: cur.stockQty,
              afterQty: data.stockQty as number,
              reason: "CSV_IMPORT",
              actorType: "USER",
              actorId: guard.session.sub,
              eventId: null,
            },
          });
        }

        const before: Record<string, unknown> = {
          sku: cur.sku,
          name: cur.name,
          priceCents: cur.priceCents,
          transferPriceCents: (cur as unknown as { transferPriceCents?: number }).transferPriceCents ?? cur.priceCents,
          priceUsdCents: (cur as unknown as { priceUsdCents?: number }).priceUsdCents ?? 0,
          unitsPerBox: (cur as unknown as { unitsPerBox?: number }).unitsPerBox ?? 1,
          wholesaleCupCents: (cur as unknown as { wholesaleCupCents?: number | null }).wholesaleCupCents ?? null,
          costCents: (cur as unknown as { costCents?: number | null }).costCents ?? null,
          supplierId: (cur as unknown as { supplierId?: string | null }).supplierId ?? null,
          supplierName: (cur as unknown as { supplierName?: string | null }).supplierName ?? null,
          stockQty: cur.stockQty,
          lowStockAt: cur.lowStockAt,
          active: cur.active,
        };
        const after: Record<string, unknown> = {
          ...before,
          ...data,
          sku: updated.sku,
        };
        const changedKeys = applied.map((a) => a.field);

        await tx.auditLog.create({
          data: {
            storeId: guard.session.storeId,
            actorType: "USER",
            actorId: guard.session.sub,
            action: stockChanged ? "PRODUCT_UPDATE_STOCK" : "PRODUCT_UPDATE",
            entityType: "Product",
            entityId: cur.id,
            before: before as Prisma.InputJsonValue,
            after: after as Prisma.InputJsonValue,
            meta: ({
              source: "csv-import",
              changedKeys,
              ...auditRequestMeta(request),
            } satisfies Record<string, unknown>) as Prisma.InputJsonValue,
          },
        });

        summary.push({
          productId: cur.id,
          sku: cur.sku,
          name: updated.name,
          applied,
          stockChanged,
        });
      }
    });

    return NextResponse.json({
      ok: true,
      appliedCount: summary.reduce((acc, s) => acc + s.applied.length, 0),
      productsUpdated: summary.length,
      summary,
    });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          hint: "Faltan columnas nuevas (transferPriceCents/priceUsdCents/etc). Ejecuta migraciones antes de importar CSV.",
        },
        { status: 409 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/admin/products/bulk-update]", e);
    return NextResponse.json({ error: "BULK_UPDATE_FAILED", message: msg }, { status: 500 });
  }
}
