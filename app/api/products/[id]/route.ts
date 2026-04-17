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
    supplierName: z.string().max(120).nullable().optional(),
    stockQty: z.number().int().nonnegative().optional(),
    lowStockAt: z.number().int().nonnegative().optional(),
    active: z.boolean().optional(),
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

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(data.sku !== undefined ? { sku: data.sku } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
        ...(data.priceUsdCents !== undefined ? { priceUsdCents: data.priceUsdCents } : {}),
        ...(data.unitsPerBox !== undefined ? { unitsPerBox: data.unitsPerBox } : {}),
        ...(data.wholesaleCupCents !== undefined
          ? { wholesaleCupCents: data.wholesaleCupCents }
          : {}),
        ...(data.costCents !== undefined ? { costCents: data.costCents } : {}),
        ...(data.supplierName !== undefined ? { supplierName: data.supplierName } : {}),
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
