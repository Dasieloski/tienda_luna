import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";

const patchSchema = z.object({
  usdRateCup: z.number().int().min(1).max(100000),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const store = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { usdRateCup: true },
    });
    const usdRateCup = store?.usdRateCup ?? 250;
    return NextResponse.json({ usdRateCup });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      return NextResponse.json({
        usdRateCup: Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250"),
        meta: {
          schemaLegacy: true as const,
          hint: "Ejecuta prisma/sql/add_store_usd_rate.sql en Supabase o npx prisma db push.",
        },
      });
    }
    console.error("[api/admin/exchange-rate]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({
        where: { id: session.storeId },
        select: { usdRateCup: true },
      });
      const next = await tx.store.update({
        where: { id: session.storeId },
        data: { usdRateCup: parsed.data.usdRateCup },
        select: { usdRateCup: true },
      });
      await tx.auditLog.create({
        data: {
          storeId: session.storeId,
          actorType: "USER",
          actorId: session.sub,
          action: "EXCHANGE_RATE_UPDATE",
          entityType: "Store",
          entityId: session.storeId,
          before: { usdRateCup: before?.usdRateCup ?? null } as any,
          after: { usdRateCup: next.usdRateCup } as any,
        },
      });
      return next;
    });
    return NextResponse.json({ usdRateCup: updated.usdRateCup });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          hint: "Ejecuta prisma/sql/add_store_usd_rate.sql en Supabase o npx prisma db push.",
        },
        { status: 503 },
      );
    }
    console.error("[api/admin/exchange-rate]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

