import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(30).optional().default(10),
});

function parseMoneyNeedle(q: string): { cupCents?: number; usdCents?: number } {
  const t = q.replace(/\s+/g, " ").trim().toLowerCase();
  const cleaned = t
    .replace("cup", "")
    .replace("usd", "")
    .replace("$", "")
    .replace("mn", "")
    .trim();

  const n = Number.parseFloat(cleaned.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return {};
  const cents = Math.round(n * 100);
  return { cupCents: cents, usdCents: cents };
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false }, q: "", products: [], suppliers: [] });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const { q, limit } = parsed.data;
  const money = parseMoneyNeedle(q);

  try {
    const [suppliers, products] = await Promise.all([
      prisma.supplier.findMany({
        where: {
          storeId: session.storeId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        take: Math.min(10, limit),
        select: { id: true, name: true, active: true, phone: true },
      }),
      prisma.product.findMany({
        where: {
          storeId: session.storeId,
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { supplierName: { contains: q, mode: "insensitive" } },
            { supplier: { name: { contains: q, mode: "insensitive" } } },
            ...(money.cupCents != null
              ? [
                  { priceCents: money.cupCents },
                  { costCents: money.cupCents },
                  { wholesaleCupCents: money.cupCents },
                ]
              : []),
            ...(money.usdCents != null ? [{ priceUsdCents: money.usdCents }] : []),
          ],
        },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        take: limit,
        select: {
          id: true,
          sku: true,
          name: true,
          active: true,
          deletedAt: true,
          supplierName: true,
          priceCents: true,
          costCents: true,
          priceUsdCents: true,
          stockQty: true,
          lowStockAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      q,
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        active: s.active,
        phone: s.phone ?? null,
      })),
      products: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        active: p.active,
        deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
        supplierName: p.supplierName ?? null,
        priceCents: p.priceCents,
        costCents: p.costCents,
        priceUsdCents: p.priceUsdCents,
        stockQty: p.stockQty,
        lowStockAt: p.lowStockAt,
      })),
    });
  } catch (err) {
    console.error("[api/admin/search]", err);
    return NextResponse.json(
      { meta: { dbAvailable: false as const }, q, suppliers: [], products: [] },
      { status: 200 },
    );
  }
}

