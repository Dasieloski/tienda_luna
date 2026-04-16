import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  /** Catálogo para tablet (JWT de dispositivo) o panel (usuario cajero/admin). */
  const canReadCatalog =
    session.typ === "device" ||
    (session.typ === "user" && (session.role === "ADMIN" || session.role === "CASHIER"));

  if (!canReadCatalog) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const products = await prisma.product.findMany({
    where: { storeId: session.storeId, active: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ products });
}

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  priceUsdCents: z.number().int().nonnegative().default(0),
  unitsPerBox: z.number().int().positive().default(1),
  wholesaleCupCents: z.number().int().nonnegative().optional().nullable(),
  costCents: z.number().int().nonnegative().optional(),
  supplierName: z.string().max(120).optional().nullable(),
  stockQty: z.number().int().nonnegative().default(0),
  lowStockAt: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  try {
    const p = await prisma.product.create({
      data: {
        storeId: session.storeId,
        sku: parsed.data.sku,
        name: parsed.data.name,
        priceCents: parsed.data.priceCents,
        priceUsdCents: parsed.data.priceUsdCents,
        unitsPerBox: parsed.data.unitsPerBox,
        wholesaleCupCents: parsed.data.wholesaleCupCents ?? null,
        costCents: parsed.data.costCents,
        supplierName: parsed.data.supplierName?.trim() || null,
        stockQty: parsed.data.stockQty,
        lowStockAt: parsed.data.lowStockAt ?? 5,
      },
    });
    return NextResponse.json({ product: p });
  } catch {
    return NextResponse.json({ error: "DUPLICATE_SKU_OR_DB" }, { status: 409 });
  }
}
