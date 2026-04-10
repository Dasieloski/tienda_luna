import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.typ !== "user") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.role !== "ADMIN" && session.role !== "CASHIER") {
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
  costCents: z.number().int().nonnegative().optional(),
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
        costCents: parsed.data.costCents,
        stockQty: parsed.data.stockQty,
        lowStockAt: parsed.data.lowStockAt ?? 5,
      },
    });
    return NextResponse.json({ product: p });
  } catch {
    return NextResponse.json({ error: "DUPLICATE_SKU_OR_DB" }, { status: 409 });
  }
}
