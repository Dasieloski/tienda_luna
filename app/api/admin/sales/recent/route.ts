import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).optional().default(35),
});

function getPayloadNumberMaybe(payload: unknown, keys: string[]): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

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

    const clientSaleIds = sales.map((s) => s.clientSaleId).filter(Boolean) as string[];
    const events = clientSaleIds.length
      ? await prisma.event.findMany({
          where: {
            storeId: session.storeId,
            type: "SALE_COMPLETED",
            status: { in: ["ACCEPTED", "CORRECTED"] },
            relatedClientSaleId: { in: clientSaleIds },
          },
          orderBy: { serverTimestamp: "desc" },
          select: {
            relatedClientSaleId: true,
            payload: true,
            serverTimestamp: true,
          },
        })
      : [];

    const eventBySaleId = new Map<string, { payload: unknown; serverTimestamp: Date }>();
    for (const e of events) {
      const k = e.relatedClientSaleId;
      if (!k) continue;
      if (!eventBySaleId.has(k)) eventBySaleId.set(k, { payload: e.payload, serverTimestamp: e.serverTimestamp });
    }

    return NextResponse.json({
      sales: sales.map((s) => ({
        clientSaleId: s.clientSaleId ?? null,
        id: s.id,
        deviceId: s.deviceId,
        totalCents: s.totalCents,
        status: s.status,
        completedAt: s.completedAt.toISOString(),
        paymentMethod:
          (eventBySaleId.get(s.clientSaleId ?? "")?.payload as any)?.paymentMethod ?? null,
        paidCents:
          getPayloadNumberMaybe(eventBySaleId.get(s.clientSaleId ?? "")?.payload, [
            "paidCents",
            "amountPaidCents",
            "cashGivenCents",
            "cashReceivedCents",
          ]),
        changeCents:
          getPayloadNumberMaybe(eventBySaleId.get(s.clientSaleId ?? "")?.payload, [
            "changeCents",
            "vueltoCents",
          ]),
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
