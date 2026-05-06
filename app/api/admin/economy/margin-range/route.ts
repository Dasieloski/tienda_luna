import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseUtcYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** Instante exclusivo: primer instante del día siguiente a `d` (UTC). */
function endUtcDayExclusive(d: Date) {
  const x = startOfUtcDay(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

type MarginAggRow = {
  revenue: bigint;
  cost: bigint;
  lines_with_cost: bigint;
  lines_without_cost: bigint;
};

const MAX_RANGE_DAYS = 400;

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false as const, message: "Sin base de datos en modo local." },
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const { from: fromStr, to: toStr } = parsed.data;
  const fromDay = parseUtcYmd(fromStr);
  const toDay = parseUtcYmd(toStr);
  if (fromDay.getTime() > toDay.getTime()) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const spanMs = toDay.getTime() - fromDay.getTime();
  const spanDays = Math.ceil(spanMs / 86400000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: "RANGE_TOO_LONG", maxDays: MAX_RANGE_DAYS },
      { status: 400 },
    );
  }

  const fromStart = startOfUtcDay(fromDay);
  const toEndExclusive = endUtcDayExclusive(toDay);
  const storeId = session.storeId;

  try {
    const [marginRows, saleCount] = await Promise.all([
      prisma.$queryRaw<MarginAggRow[]>`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN COALESCE(sl."unitCostCents", p."costCents") IS NOT NULL THEN sl."subtotalCents"
              ELSE 0
            END
          ), 0)::bigint AS revenue,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(sl."unitCostCents", p."costCents") IS NOT NULL THEN COALESCE(sl."unitCostCents", p."costCents") * sl."quantity"
              ELSE 0
            END
          ), 0)::bigint AS cost,
          COALESCE(SUM(CASE WHEN COALESCE(sl."unitCostCents", p."costCents") IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_with_cost,
          COALESCE(SUM(CASE WHEN COALESCE(sl."unitCostCents", p."costCents") IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_without_cost
        FROM "SaleLine" sl
        INNER JOIN "Sale" s ON s."id" = sl."saleId"
        INNER JOIN "Product" p ON p."id" = sl."productId"
        WHERE s."storeId" = ${storeId}
          AND s."status" = 'COMPLETED'
          AND s."completedAt" >= ${fromStart}
          AND s."completedAt" < ${toEndExclusive}
      `,
      prisma.sale.count({
        where: {
          storeId,
          status: "COMPLETED",
          completedAt: { gte: fromStart, lt: toEndExclusive },
        },
      }),
    ]);

    const row = marginRows[0];
    const soldRevenueCents = Number(row?.revenue ?? 0);
    const supplierCostCents = Number(row?.cost ?? 0);
    const marginCents = soldRevenueCents - supplierCostCents;
    const marginPct = soldRevenueCents > 0 ? (marginCents / soldRevenueCents) * 100 : null;
    const grossPlusHalfProfitCents = Math.round(soldRevenueCents + 0.5 * marginCents);

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        timezone: "UTC",
        fromInclusive: fromStr,
        toInclusive: toStr,
        note:
          "Ventas COMPLETED. Ganancia = PVP de línea − (precio proveedor × uds) solo donde el producto tiene precio de compra en catálogo. Las líneas sin coste no entran en la ganancia ni en el ingreso de este bloque.",
      },
      totals: {
        soldRevenueCents,
        supplierCostCents,
        marginCents,
        marginPct,
        grossPlusHalfProfitCents,
        salesCount: saleCount,
        linesWithCost: Number(row?.lines_with_cost ?? 0),
        linesWithoutCost: Number(row?.lines_without_cost ?? 0),
      },
    });
  } catch (err) {
    console.error("[api/admin/economy/margin-range]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false as const,
          message: err instanceof Error ? err.message : "DB",
        },
      },
      { status: 200 },
    );
  }
}
