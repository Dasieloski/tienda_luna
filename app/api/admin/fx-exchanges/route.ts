import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const listSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  deviceId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});

const createSchema = z.object({
  usdCentsReceived: z.number().int().min(1),
  cupCentsGiven: z.number().int().min(1),
  usdRateCup: z.number().int().min(1).max(100000),
  exchangedAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ fxExchanges: [], meta: { dbAvailable: false as const } }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    deviceId: url.searchParams.get("deviceId") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (parsed.data.from) dateFilter.gte = new Date(parsed.data.from);
  if (parsed.data.to) dateFilter.lte = new Date(parsed.data.to);

  const rows = await prisma.fxExchange.findMany({
    where: {
      storeId: guard.session.storeId,
      ...(parsed.data.deviceId ? { deviceId: parsed.data.deviceId } : {}),
      ...(parsed.data.from || parsed.data.to ? { exchangedAt: dateFilter } : {}),
      ...(parsed.data.q
        ? {
            OR: [
              { note: { contains: parsed.data.q, mode: "insensitive" } },
              { deviceId: { contains: parsed.data.q, mode: "insensitive" } },
            ],
          }
        : {}),
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
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const usdValueCupCents = Math.round(parsed.data.usdCentsReceived * Math.round(parsed.data.usdRateCup));
  const spreadCupCents = usdValueCupCents - parsed.data.cupCentsGiven;

  const row = await prisma.fxExchange.create({
    data: {
      storeId: guard.session.storeId,
      deviceId: "WEB_ADMIN",
      direction: "USD_TO_CUP",
      usdCentsReceived: parsed.data.usdCentsReceived,
      cupCentsGiven: parsed.data.cupCentsGiven,
      usdRateCup: Math.round(parsed.data.usdRateCup),
      usdValueCupCents,
      spreadCupCents,
      exchangedAt: parsed.data.exchangedAt ? new Date(parsed.data.exchangedAt) : new Date(),
      note: parsed.data.note ?? null,
    },
  });

  const meta = {
    ...auditRequestMeta(request),
    usdCentsReceived: row.usdCentsReceived,
    cupCentsGiven: row.cupCentsGiven,
    usdRateCup: row.usdRateCup,
  } as Prisma.InputJsonValue;

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "FX_EXCHANGE_CREATED",
      entityType: "FxExchange",
      entityId: row.id,
      meta,
    },
  });

  return NextResponse.json({
    ok: true,
    fxExchange: {
      id: row.id,
      deviceId: row.deviceId,
      direction: row.direction,
      usdCentsReceived: row.usdCentsReceived,
      cupCentsGiven: row.cupCentsGiven,
      usdRateCup: row.usdRateCup,
      usdValueCupCents: row.usdValueCupCents,
      spreadCupCents: row.spreadCupCents,
      exchangedAt: row.exchangedAt.toISOString(),
      note: row.note ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
  });
}

