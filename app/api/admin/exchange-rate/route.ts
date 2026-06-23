import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";

const patchSchema = z.object({
  usdRateCup: z.number().int().min(1).max(100000).optional(),
  exchangeRateMode: z.enum(["MANUAL", "AUTO"]).optional(),
});

async function hasStoreColumn(columnName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: number }[]>`
    SELECT 1::int AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Store'
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function readUsdRateCupCookie(): Promise<number | null> {
  try {
    const jar = await cookies();
    const v = jar.get("tl-usdRateCup")?.value ?? null;
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  } catch {
    return null;
  }
}

function setUsdRateCupCookie(res: NextResponse, rate: number) {
  const n = Math.round(rate);
  // 400 días para evitar problemas con navegadores que capan cookies muy largas
  res.cookies.set("tl-usdRateCup", String(n), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const store = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: {
        usdRateCup: true,
        exchangeRateMode: true,
        exchangeRateAutoUpdatedAt: true,
        dashboardLayout: true,
      },
    });
    const cookieRate = await readUsdRateCupCookie();
    const usdRateCup =
      store?.usdRateCup ??
      (typeof (store?.dashboardLayout as any)?.usdRateCup === "number"
        ? Number((store?.dashboardLayout as any).usdRateCup)
        : cookieRate ?? 250);
    return NextResponse.json({
      usdRateCup,
      exchangeRateMode: store?.exchangeRateMode ?? "AUTO",
      exchangeRateAutoUpdatedAt: store?.exchangeRateAutoUpdatedAt?.toISOString() ?? null,
    });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      // Modo legacy: sin columna usdRateCup. Intentamos leer de dashboardLayout si existe.
      try {
        const hasLayout = await hasStoreColumn("dashboardLayout");
        if (hasLayout) {
          const rows = await prisma.$queryRaw<{ dashboardLayout: any | null }[]>`
            SELECT "dashboardLayout"
            FROM "Store"
            WHERE id = ${session.storeId}
            LIMIT 1
          `;
          const layout = rows[0]?.dashboardLayout ?? null;
          const fromLayout =
            layout && typeof layout.usdRateCup === "number" ? Number(layout.usdRateCup) : null;
          const cookieRate = await readUsdRateCupCookie();
          return NextResponse.json({
            usdRateCup:
              fromLayout ??
              cookieRate ??
              Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250"),
            exchangeRateMode: "MANUAL",
            exchangeRateAutoUpdatedAt: null,
            meta: {
              schemaLegacy: true as const,
              hint: "BD sin columna Store.usdRateCup: usando dashboardLayout.usdRateCup (si existe) o NEXT_PUBLIC_USD_RATE_CUP.",
            },
          });
        }
      } catch {
        // ignore y cae al fallback de env
      }
      const cookieRate = await readUsdRateCupCookie();
      return NextResponse.json({
        usdRateCup: cookieRate ?? Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250"),
        exchangeRateMode: "MANUAL",
        exchangeRateAutoUpdatedAt: null,
        meta: {
          schemaLegacy: true as const,
          hint: "BD legacy: ejecuta prisma/sql/add_store_usd_rate.sql en Supabase o npx prisma db push para persistir en Store.usdRateCup.",
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

  const { usdRateCup, exchangeRateMode } = parsed.data;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({
        where: { id: session.storeId },
        select: { usdRateCup: true, exchangeRateMode: true, dashboardLayout: true },
      });

      const updateData: Record<string, unknown> = {};
      if (usdRateCup !== undefined) updateData.usdRateCup = usdRateCup;
      if (exchangeRateMode !== undefined) updateData.exchangeRateMode = exchangeRateMode;

      const next = await tx.store.update({
        where: { id: session.storeId },
        data: updateData,
        select: {
          usdRateCup: true,
          exchangeRateMode: true,
          exchangeRateAutoUpdatedAt: true,
          dashboardLayout: true,
        },
      });

      const beforePayload: Record<string, unknown> = { usdRateCup: before?.usdRateCup ?? null };
      if (exchangeRateMode !== undefined) beforePayload.exchangeRateMode = before?.exchangeRateMode ?? "AUTO";

      const afterPayload: Record<string, unknown> = { usdRateCup: next.usdRateCup };
      if (exchangeRateMode !== undefined) afterPayload.exchangeRateMode = exchangeRateMode;

      await tx.auditLog.create({
        data: {
          storeId: session.storeId,
          actorType: "USER",
          actorId: session.sub,
          action: "EXCHANGE_RATE_UPDATE",
          entityType: "Store",
          entityId: session.storeId,
          before: beforePayload as any,
          after: afterPayload as any,
        },
      });
      return next;
    });

    const res = NextResponse.json({
      usdRateCup: updated.usdRateCup,
      exchangeRateMode: updated.exchangeRateMode,
      exchangeRateAutoUpdatedAt: updated.exchangeRateAutoUpdatedAt?.toISOString() ?? null,
    });
    const rate = updated.usdRateCup ?? (usdRateCup ?? 250);
    setUsdRateCupCookie(res, rate);
    return res;
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      const rate = usdRateCup ?? 250;
      const res = NextResponse.json(
        {
          usdRateCup: rate,
          exchangeRateMode: "MANUAL",
          exchangeRateAutoUpdatedAt: null,
          meta: {
            schemaLegacy: true as const,
            hint: "BD legacy: ejecuta prisma/sql/add_store_usd_rate.sql en Supabase o npx prisma db push para persistir.",
          },
        },
        { status: 200 },
      );
      setUsdRateCupCookie(res, rate);
      return res;
    }
    console.error("[api/admin/exchange-rate]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

