import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const { limit, cursor } = parsed.data;

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      events: [],
      nextCursor: null,
      meta: { dbAvailable: false, hint: "LOCAL_ADMIN_STORE" },
    });
  }

  try {
    const rows = await prisma.event.findMany({
      where: { storeId: session.storeId },
      orderBy: { serverTimestamp: "desc" },
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        clientEventId: true,
        type: true,
        payload: true,
        deviceId: true,
        clientTimestamp: true,
        serverTimestamp: true,
        status: true,
        isFraud: true,
        fraudReason: true,
        correctionNote: true,
        relatedClientSaleId: true,
      },
    });

    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
      items = rows;
    }

    return NextResponse.json({
      events: items.map((e) => ({
        ...e,
        clientTimestamp: e.clientTimestamp.toString(),
      })),
      nextCursor,
      meta: { dbAvailable: true },
    });
  } catch (err) {
    console.error("[api/events]", err);
    return NextResponse.json(
      {
        events: [],
        nextCursor: null,
        meta: {
          dbAvailable: false,
          message: err instanceof Error ? err.message : "DB_ERROR",
        },
      },
      { status: 200 },
    );
  }
}
