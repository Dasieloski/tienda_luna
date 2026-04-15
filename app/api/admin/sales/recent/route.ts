import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).optional().default(35),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ sales: [], meta: { dbAvailable: false } });
  }

  try {
    const sales = await prisma.sale.findMany({
      where: { storeId: session.storeId },
      orderBy: { completedAt: "desc" },
      take: parsed.data.limit,
      include: {
        lines: {
          include: {
            product: { select: { name: true, sku: true } },
          },
        },
      },
    });

    return NextResponse.json({
      sales: sales.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        totalCents: s.totalCents,
        status: s.status,
        completedAt: s.completedAt.toISOString(),
        lines: s.lines.map((l) => ({
          id: l.id,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          subtotalCents: l.subtotalCents,
          productName: l.product.name,
          sku: l.product.sku,
        })),
      })),
      meta: { dbAvailable: true as const },
    });
  } catch (err) {
    console.error("[api/admin/sales/recent]", err);
    return NextResponse.json(
      { sales: [], meta: { dbAvailable: false, message: err instanceof Error ? err.message : "DB" } },
      { status: 200 },
    );
  }
}
