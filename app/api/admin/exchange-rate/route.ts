import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";

const patchSchema = z.object({
  usdRateCup: z.number().int().min(1).max(100000),
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

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const store = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { usdRateCup: true, dashboardLayout: true },
    });
    const usdRateCup =
      store?.usdRateCup ??
      (typeof (store?.dashboardLayout as any)?.usdRateCup === "number"
        ? Number((store?.dashboardLayout as any).usdRateCup)
        : 250);
    return NextResponse.json({ usdRateCup });
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
          return NextResponse.json({
            usdRateCup: fromLayout ?? Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250"),
            meta: {
              schemaLegacy: true as const,
              hint: "BD sin columna Store.usdRateCup: usando dashboardLayout.usdRateCup (si existe) o NEXT_PUBLIC_USD_RATE_CUP.",
            },
          });
        }
      } catch {
        // ignore y cae al fallback de env
      }
      return NextResponse.json({
        usdRateCup: Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250"),
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

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({
        where: { id: session.storeId },
        select: { usdRateCup: true, dashboardLayout: true },
      });
      const next = await tx.store.update({
        where: { id: session.storeId },
        data: { usdRateCup: parsed.data.usdRateCup },
        select: { usdRateCup: true, dashboardLayout: true },
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
      // Modo legacy: persistimos la tasa dentro de dashboardLayout (si existe) para no bloquear el panel.
      try {
        const hasLayout = await hasStoreColumn("dashboardLayout");
        if (hasLayout) {
          await prisma.$executeRaw`
            UPDATE "Store"
            SET "dashboardLayout" = jsonb_set(
              COALESCE("dashboardLayout", '{}'::jsonb),
              '{usdRateCup}',
              to_jsonb(${parsed.data.usdRateCup}::int),
              true
            )
            WHERE id = ${session.storeId}
          `;
          await prisma.auditLog.create({
            data: {
              storeId: session.storeId,
              actorType: "USER",
              actorId: session.sub,
              action: "EXCHANGE_RATE_UPDATE",
              entityType: "Store",
              entityId: session.storeId,
              after: { usdRateCup: parsed.data.usdRateCup, storedIn: "dashboardLayout" } as any,
            },
          });
          return NextResponse.json({
            usdRateCup: parsed.data.usdRateCup,
            meta: {
              schemaLegacy: true as const,
              storedIn: "dashboardLayout" as const,
              hint: "BD sin Store.usdRateCup: guardado en Store.dashboardLayout.usdRateCup. Migra para persistir en la columna dedicada.",
            },
          });
        }
      } catch (err) {
        console.error("[api/admin/exchange-rate legacy PATCH]", err);
      }
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          hint: "La BD no tiene Store.usdRateCup y no se pudo usar dashboardLayout. Ejecuta prisma/sql/add_store_usd_rate.sql en Supabase o npx prisma db push.",
        },
        { status: 503 },
      );
    }
    console.error("[api/admin/exchange-rate]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

