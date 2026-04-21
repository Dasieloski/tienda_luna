import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";
import { prisma } from "@/lib/db";

const patchSchema = z
  .object({
    sku: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    priceCents: z.number().int().nonnegative().optional(),
    priceUsdCents: z.number().int().nonnegative().optional(),
    unitsPerBox: z.number().int().positive().optional(),
    wholesaleCupCents: z.number().int().nonnegative().nullable().optional(),
    costCents: z.number().int().nonnegative().nullable().optional(),
    supplierId: z.string().cuid().nullable().optional(),
    supplierName: z.string().max(120).nullable().optional(),
    stockQty: z.number().int().nonnegative().optional(),
    lowStockAt: z.number().int().nonnegative().optional(),
    active: z.boolean().optional(),
    /** Solo para restaurar producto archivado (admin). */
    restore: z.literal(true).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "EMPTY" });

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: RouteCtx) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const existing = await prisma.product.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const data = parsed.data;
  if (data.supplierName !== undefined) {
    data.supplierName = data.supplierName?.trim() || null;
  }

  let supplierNameFromId: string | null | undefined;
  if (data.supplierId !== undefined) {
    if (data.supplierId === null) {
      supplierNameFromId = null;
    } else {
      const sup = await prisma.supplier.findFirst({
        where: { id: data.supplierId, storeId: session.storeId },
      });
      if (!sup) {
        return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
      }
      const sameAsCurrent = existing.supplierId === sup.id;
      if (!sup.active && !sameAsCurrent) {
        return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
      }
      supplierNameFromId = sup.name;
    }
  }

  const restoring = data.restore === true && existing.deletedAt != null;

  try {
    const nextStockQty = data.stockQty !== undefined ? data.stockQty : existing.stockQty;
    const stockChanged = data.stockQty !== undefined && data.stockQty !== existing.stockQty;

    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          ...(restoring ? { deletedAt: null } : {}),
          ...(data.sku !== undefined ? { sku: data.sku } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
          ...(data.priceUsdCents !== undefined ? { priceUsdCents: data.priceUsdCents } : {}),
          ...(data.unitsPerBox !== undefined ? { unitsPerBox: data.unitsPerBox } : {}),
          ...(data.wholesaleCupCents !== undefined ? { wholesaleCupCents: data.wholesaleCupCents } : {}),
          ...(data.costCents !== undefined ? { costCents: data.costCents } : {}),
          ...(data.supplierId !== undefined
            ? { supplierId: data.supplierId, supplierName: supplierNameFromId ?? null }
            : {}),
          ...(data.supplierName !== undefined && data.supplierId === undefined
            ? { supplierName: data.supplierName }
            : {}),
          ...(data.stockQty !== undefined ? { stockQty: data.stockQty } : {}),
          ...(data.lowStockAt !== undefined ? { lowStockAt: data.lowStockAt } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      });

      if (stockChanged) {
        await tx.inventoryMovement.create({
          data: {
            storeId: session.storeId,
            productId: updated.id,
            delta: nextStockQty - existing.stockQty,
            beforeQty: existing.stockQty,
            afterQty: nextStockQty,
            reason: "MANUAL_ADJUST",
            actorType: "USER",
            actorId: session.sub,
            eventId: null,
          },
        });
      }

      const before = {
        sku: existing.sku,
        name: existing.name,
        priceCents: existing.priceCents,
        priceUsdCents: (existing as any).priceUsdCents ?? 0,
        unitsPerBox: (existing as any).unitsPerBox ?? 1,
        wholesaleCupCents: (existing as any).wholesaleCupCents ?? null,
        costCents: (existing as any).costCents ?? null,
        supplierId: (existing as any).supplierId ?? null,
        supplierName: (existing as any).supplierName ?? null,
        stockQty: existing.stockQty,
        lowStockAt: existing.lowStockAt,
        active: existing.active,
        deletedAt: (existing as any).deletedAt ?? null,
      };
      const after = {
        sku: updated.sku,
        name: updated.name,
        priceCents: updated.priceCents,
        priceUsdCents: (updated as any).priceUsdCents ?? 0,
        unitsPerBox: (updated as any).unitsPerBox ?? 1,
        wholesaleCupCents: (updated as any).wholesaleCupCents ?? null,
        costCents: (updated as any).costCents ?? null,
        supplierId: (updated as any).supplierId ?? null,
        supplierName: (updated as any).supplierName ?? null,
        stockQty: updated.stockQty,
        lowStockAt: updated.lowStockAt,
        active: updated.active,
        deletedAt: (updated as any).deletedAt ?? null,
      };
      const changedKeys = Object.keys(after).filter(
        (k) => (after as any)[k] !== (before as any)[k],
      );

      await tx.auditLog.create({
        data: {
          storeId: session.storeId,
          actorType: "USER",
          actorId: session.sub,
          action: restoring ? "PRODUCT_RESTORE" : stockChanged ? "PRODUCT_UPDATE_STOCK" : "PRODUCT_UPDATE",
          entityType: "Product",
          entityId: updated.id,
          before: before as any,
          after: after as any,
          meta: { changedKeys } as any,
        },
      });

      return updated;
    });

    return NextResponse.json({ product });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          hint: "Ejecuta prisma/sql/add_product_pricing_columns.sql en Supabase o npx prisma db push.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "DUPLICATE_SKU_OR_DB" }, { status: 409 });
  }
}

/** Borrado lógico: conserva fila y relaciones con ventas; libera SKU para nuevos productos. */
export async function DELETE(request: Request, ctx: RouteCtx) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  const existing = await prisma.product.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (existing.deletedAt) {
    return NextResponse.json({ ok: true, meta: { alreadyDeleted: true } });
  }

  const skuArchived = `__arch__${existing.id.slice(-12)}__${existing.sku}`.slice(0, 240);

  try {
    const before = {
      sku: existing.sku,
      name: existing.name,
      active: existing.active,
      deletedAt: existing.deletedAt ?? null,
    };
    const updated = await prisma.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        active: false,
        sku: skuArchived,
      },
    });
    const after = {
      sku: updated.sku,
      name: updated.name,
      active: updated.active,
      deletedAt: (updated as any).deletedAt ?? null,
    };
    await prisma.auditLog.create({
      data: {
        storeId: session.storeId,
        actorType: "USER",
        actorId: session.sub,
        action: "PRODUCT_ARCHIVE",
        entityType: "Product",
        entityId: existing.id,
        before: before as any,
        after: after as any,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          hint: "Añade la columna deletedAt en Product (npx prisma db push).",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }
}
