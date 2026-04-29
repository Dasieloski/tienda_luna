import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, canSync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  updatedSince: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(400),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ fxExchanges: [], meta: { dbAvailable: false as const } });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    updatedSince: url.searchParams.get("updatedSince") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const exchangedAtFilter: { gte?: Date; lte?: Date } = {};
  if (parsed.data.from) exchangedAtFilter.gte = new Date(parsed.data.from);
  if (parsed.data.to) exchangedAtFilter.lte = new Date(parsed.data.to);

  const updatedAtFilter: { gt?: Date } = {};
  if (parsed.data.updatedSince) updatedAtFilter.gt = new Date(parsed.data.updatedSince);

  try {
    const rows = await prisma.fxExchange.findMany({
      where: {
        storeId: session.storeId,
        ...(parsed.data.from || parsed.data.to ? { exchangedAt: exchangedAtFilter } : {}),
        ...(parsed.data.updatedSince ? { updatedAt: updatedAtFilter } : {}),
      },
      orderBy: { exchangedAt: "desc" },
      take: parsed.data.limit,
    });

    return NextResponse.json({
      fxExchanges: rows.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        direction: r.direction,
        usdCentsReceived: r.usdCentsReceived,
        cupCentsGiven: r.cupCentsGiven,
        usdRateCup: r.usdRateCup,
        usdValueCupCents: r.usdValueCupCents,
        spreadCupCents: r.spreadCupCents,
        exchangedAt: r.exchangedAt.toISOString(),
        note: r.note ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
      meta: { dbAvailable: true as const },
    });
  } catch (e) {
    console.error("[api/fx-exchanges]", e);
    return NextResponse.json({ fxExchanges: [], meta: { dbAvailable: false as const } }, { status: 200 });
  }
}

