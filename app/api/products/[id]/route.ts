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
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(restoring ? { deletedAt: null } : {}),
        ...(data.sku !== undefined ? { sku: data.sku } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
        ...(data.priceUsdCents !== undefined ? { priceUsdCents: data.priceUsdCents } : {}),
        ...(data.unitsPerBox !== undefined ? { unitsPerBox: data.unitsPerBox } : {}),
        ...(data.wholesaleCupCents !== undefined
          ? { wholesaleCupCents: data.wholesaleCupCents }
          : {}),
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
    await prisma.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        active: false,
        sku: skuArchived,
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
