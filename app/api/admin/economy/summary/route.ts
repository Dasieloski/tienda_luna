import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { cacheGetOrSet } from "@/lib/ttl-cache";
import { storeTzOffsetIntervalSql, storeTzOffsetMinutes } from "@/lib/economy-store-tz";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD")
    .optional(),
});

type EconomyBucket = {
  method: string;
  ventas: number;
  totalCents: number;
};

type BucketRow = {
  method: string | null;
  ventas: bigint;
  total_cents: bigint;
};

type DayMarginRow = { revenue: bigint; cost: bigint };

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false },
      totals: {
        ventas: 0,
        totalCents: 0,
        efectivoCents: 0,
        transferenciaCents: 0,
        usdCents: 0,
        gastosCents: 0,
        gastosCount: 0,
        cajaNetaCents: 0,
      },
      buckets: [],
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const offsetMinutes = storeTzOffsetMinutes();
  const offsetInterval = storeTzOffsetIntervalSql();

  try {
    let dayYmd = parsed.data.date ?? null;
    if (!dayYmd) {
      const todayRow = await prisma.$queryRaw<{ d: string }[]>`
        SELECT to_char(date_trunc('day', (now() + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS d
      `;
      dayYmd = todayRow[0]?.d ?? new Date().toISOString().slice(0, 10);
    }

    const rows = await cacheGetOrSet(
      `economy-summary:${session.storeId}:${dayYmd}:tz${offsetMinutes}:v2`,
      30_000,
      () =>
        prisma.$queryRaw<BucketRow[]>`
          WITH day_sales AS (
            SELECT
              s.id,
              s."totalCents",
              s."clientSaleId"
            FROM "Sale" s
            WHERE s."storeId" = ${session.storeId}
              AND s."status" = 'COMPLETED'
              AND to_char(
                date_trunc('day', (s."completedAt" + (${offsetInterval}::interval))),
                'YYYY-MM-DD'
              ) = ${dayYmd}
          )
          SELECT
            COALESCE(pay.method, 'desconocido') AS method,
            COUNT(*)::bigint AS ventas,
            COALESCE(SUM(ds."totalCents"), 0)::bigint AS total_cents
          FROM day_sales ds
          LEFT JOIN LATERAL (
            SELECT e.payload->>'paymentMethod' AS method
            FROM "Event" e
            WHERE e."storeId" = ${session.storeId}
              AND e.type = 'SALE_COMPLETED'
              AND e.status IN ('ACCEPTED', 'CORRECTED')
              AND ds."clientSaleId" IS NOT NULL
              AND (
                (e."relatedClientSaleId" IS NOT NULL AND e."relatedClientSaleId" = ds."clientSaleId")
                OR ((e.payload->>'saleId') IS NOT NULL AND (e.payload->>'saleId') = ds."clientSaleId")
              )
            ORDER BY e."serverTimestamp" DESC NULLS LAST
            LIMIT 1
          ) pay ON TRUE
          GROUP BY 1
        `,
    );

    const expenseRows = await cacheGetOrSet(
      `economy-summary-expenses:${session.storeId}:${dayYmd}:tz${offsetMinutes}:v1`,
      30_000,
      () =>
        prisma.$queryRaw<{ total_cents: bigint; count: bigint }[]>`
          SELECT
            COALESCE(SUM(e."amountCents"), 0)::bigint AS total_cents,
            COUNT(*)::bigint AS count
          FROM "Expense" e
          WHERE e."storeId" = ${session.storeId}
            AND to_char(
              date_trunc('day', (e."occurredAt" + (${offsetInterval}::interval))),
              'YYYY-MM-DD'
            ) = ${dayYmd}
        `,
    );

    const marginRows = await cacheGetOrSet(
      `economy-summary-margin:${session.storeId}:${dayYmd}:tz${offsetMinutes}:v1`,
      30_000,
      () =>
        prisma.$queryRaw<DayMarginRow[]>`
          WITH day_sales AS (
            SELECT s.id
            FROM "Sale" s
            WHERE s."storeId" = ${session.storeId}
              AND s."status" = 'COMPLETED'
              AND to_char(
                date_trunc('day', (s."completedAt" + (${offsetInterval}::interval))),
                'YYYY-MM-DD'
              ) = ${dayYmd}
          )
          SELECT
            COALESCE(SUM(
              CASE
                WHEN COALESCE(sl."unitCostCents", p."costCents") IS NOT NULL THEN sl."subtotalCents"
                ELSE 0
              END
            ), 0)::bigint AS revenue,
            COALESCE(SUM(
              CASE
                WHEN COALESCE(sl."unitCostCents", p."costCents") IS NOT NULL THEN COALESCE(sl."unitCostCents", p."costCents") * sl.quantity
                ELSE 0
              END
            ), 0)::bigint AS cost
          FROM "SaleLine" sl
          INNER JOIN day_sales ds ON ds.id = sl."saleId"
          INNER JOIN "Product" p ON p.id = sl."productId"
        `,
    );

    const buckets: EconomyBucket[] = rows.map((r) => ({
      method: r.method ?? "desconocido",
      ventas: Number(r.ventas ?? BigInt(0)),
      totalCents: Number(r.total_cents ?? BigInt(0)),
    }));

    let efectivoCents = 0;
    let transferenciaCents = 0;
    let usdCents = 0;

    for (const b of buckets) {
      const m = b.method.toLowerCase();
      if (m.includes("usd") || m.includes("dolar") || m.includes("dólar")) {
        usdCents += b.totalCents;
      } else if (m.includes("trans") || m.includes("bank") || m.includes("banco")) {
        transferenciaCents += b.totalCents;
      } else {
        efectivoCents += b.totalCents;
      }
    }

    const totalCents = buckets.reduce((acc, b) => acc + b.totalCents, 0);
    const ventas = buckets.reduce((acc, b) => acc + b.ventas, 0);

    const er = expenseRows[0];
    const gastosCents = Number(er?.total_cents ?? BigInt(0));
    const gastosCount = Number(er?.count ?? BigInt(0));

    const cajaNetaCents = totalCents - gastosCents;

    const mr = marginRows[0];
    const soldRevenueWithCostCents = Number(mr?.revenue ?? BigInt(0));
    const supplierCostCents = Number(mr?.cost ?? BigInt(0));
    const marginCents = soldRevenueWithCostCents - supplierCostCents;
    const grossPlusHalfProfitCents = Math.round(soldRevenueWithCostCents + 0.5 * marginCents);

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        dayLocal: dayYmd,
        tzOffsetMinutes: offsetMinutes,
        note:
          "Misma regla que el calendario: día local tienda (TL_TZ_OFFSET_MINUTES). Ingreso = suma de totalCents por venta; cajas = último evento SALE_COMPLETED por ticket.",
      },
      date: dayYmd,
      totals: {
        ventas,
        totalCents,
        efectivoCents,
        transferenciaCents,
        usdCents,
        gastosCents,
        gastosCount,
        cajaNetaCents,
        soldRevenueWithCostCents,
        supplierCostCents,
        marginCents,
        grossPlusHalfProfitCents,
      },
      buckets,
    });
  } catch (err) {
    console.error("[api/admin/economy/summary]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false,
          message:
            err instanceof Error ? err.message : "No se pudo leer la información económica.",
        },
        totals: {
          ventas: 0,
          totalCents: 0,
          efectivoCents: 0,
          transferenciaCents: 0,
          usdCents: 0,
          gastosCents: 0,
          gastosCount: 0,
          cajaNetaCents: 0,
          soldRevenueWithCostCents: 0,
          supplierCostCents: 0,
          marginCents: 0,
          grossPlusHalfProfitCents: 0,
        },
        buckets: [],
      },
      { status: 200 },
    );
  }
}
