import { NextResponse } from "next/server";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { cacheGetOrSet } from "@/lib/ttl-cache";

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function startOfDayUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfDayUtc(d: Date) {
  const x = startOfDayUtc(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

type MarginAggRow = {
  revenue: bigint;
  cost: bigint;
  lines_with_cost: bigint;
  lines_without_cost: bigint;
};

function marginSliceFromRow(row: MarginAggRow | undefined) {
  const revenueCents = Number(row?.revenue ?? 0);
  const estimatedCostCents = Number(row?.cost ?? 0);
  const marginCents = revenueCents - estimatedCostCents;
  const marginPct = revenueCents > 0 ? (marginCents / revenueCents) * 100 : null;
  return {
    revenueCents,
    estimatedCostCents,
    marginCents,
    marginPct,
    linesWithCost: Number(row?.lines_with_cost ?? 0),
    linesWithoutCost: Number(row?.lines_without_cost ?? 0),
  };
}

const DOW_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, windows: {} });
  }

  const url = new URL(request.url);
  const windowDays = Math.min(120, Math.max(30, Number(url.searchParams.get("windowDays") ?? "90") || 90));

  try {
    const payload = await cacheGetOrSet(
      `economy-analytics:${session.storeId}:${windowDays}`,
      45_000,
      async () => {
        const now = new Date();
        const fromWin = new Date(now.getTime() - windowDays * 86400000);
        const from30 = new Date(now.getTime() - 30 * 86400000);
        const from7 = new Date(now.getTime() - 7 * 86400000);
        const from90 = new Date(now.getTime() - 90 * 86400000);
        const from365 = new Date(now.getTime() - 365 * 86400000);
        const from6m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));

        const curMonthStart = startOfMonth(now);
        const curMonthEnd = endOfMonth(now);
        const prevMonthRef = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
        const prevMonthStart = startOfMonth(prevMonthRef);
        const prevMonthEnd = endOfMonth(prevMonthRef);

        const todayStart = startOfDayUtc(now);
        const todayEnd = endOfDayUtc(now);

        const storeId = session.storeId;

        const [
          sumWindow,
          sum30,
          sum7,
          sumToday,
          sumCurMonth,
          sumPrevMonth,
          dailyAgg,
          marginRow,
          marginTodayRow,
          marginMonthRow,
          paymentMix,
          topDevices,
          hourAgg,
          dowAgg,
          last6Months,
        ] = await Promise.all([
          prisma.sale.aggregate({
            where: { storeId, status: "COMPLETED", completedAt: { gte: fromWin } },
            _sum: { totalCents: true },
            _count: true,
          }),
          prisma.sale.aggregate({
            where: { storeId, status: "COMPLETED", completedAt: { gte: from30 } },
            _sum: { totalCents: true },
            _count: true,
          }),
          prisma.sale.aggregate({
            where: { storeId, status: "COMPLETED", completedAt: { gte: from7 } },
            _sum: { totalCents: true },
            _count: true,
          }),
          prisma.sale.aggregate({
            where: { storeId, status: "COMPLETED", completedAt: { gte: todayStart, lt: todayEnd } },
            _sum: { totalCents: true },
            _count: true,
          }),
          prisma.sale.aggregate({
            where: {
              storeId,
              status: "COMPLETED",
              completedAt: { gte: curMonthStart, lte: curMonthEnd },
            },
            _sum: { totalCents: true },
            _count: true,
          }),
          prisma.sale.aggregate({
            where: {
              storeId,
              status: "COMPLETED",
              completedAt: { gte: prevMonthStart, lte: prevMonthEnd },
            },
            _sum: { totalCents: true },
            _count: true,
          }),
          prisma.$queryRaw<{ d: Date; revenue: bigint; cnt: bigint }[]>`
            SELECT date_trunc('day', s."completedAt")::date AS d,
                   SUM(s."totalCents")::bigint AS revenue,
                   COUNT(*)::bigint AS cnt
            FROM "Sale" s
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from90}
            GROUP BY 1
            ORDER BY 1 ASC
          `,
          prisma.$queryRaw<MarginAggRow[]>`
            SELECT
              COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue,
              COALESCE(SUM(COALESCE(p."costCents", 0) * sl."quantity"), 0)::bigint AS cost,
              COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_with_cost,
              COALESCE(SUM(CASE WHEN p."costCents" IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_without_cost
            FROM "SaleLine" sl
            INNER JOIN "Sale" s ON s."id" = sl."saleId"
            INNER JOIN "Product" p ON p."id" = sl."productId"
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from30}
          `,
          prisma.$queryRaw<MarginAggRow[]>`
            SELECT
              COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue,
              COALESCE(SUM(COALESCE(p."costCents", 0) * sl."quantity"), 0)::bigint AS cost,
              COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_with_cost,
              COALESCE(SUM(CASE WHEN p."costCents" IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_without_cost
            FROM "SaleLine" sl
            INNER JOIN "Sale" s ON s."id" = sl."saleId"
            INNER JOIN "Product" p ON p."id" = sl."productId"
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${todayStart}
              AND s."completedAt" < ${todayEnd}
          `,
          prisma.$queryRaw<MarginAggRow[]>`
            SELECT
              COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue,
              COALESCE(SUM(COALESCE(p."costCents", 0) * sl."quantity"), 0)::bigint AS cost,
              COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_with_cost,
              COALESCE(SUM(CASE WHEN p."costCents" IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_without_cost
            FROM "SaleLine" sl
            INNER JOIN "Sale" s ON s."id" = sl."saleId"
            INNER JOIN "Product" p ON p."id" = sl."productId"
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${curMonthStart}
              AND s."completedAt" <= ${curMonthEnd}
          `,
          prisma.$queryRaw<{ method: string; revenue: bigint; cnt: bigint }[]>`
            SELECT COALESCE(NULLIF(trim(e.payload->>'paymentMethod'), ''), '(sin método)') AS method,
                   SUM(s."totalCents")::bigint AS revenue,
                   COUNT(*)::bigint AS cnt
            FROM "Event" e
            INNER JOIN "Sale" s ON s."storeId" = e."storeId"
              AND s."clientSaleId" = (e.payload->>'saleId')
            WHERE e."storeId" = ${storeId}
              AND e."type" = 'SALE_COMPLETED'
              AND e."status" IN ('ACCEPTED', 'CORRECTED')
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from30}
            GROUP BY 1
            ORDER BY revenue DESC
            LIMIT 12
          `,
          prisma.$queryRaw<{ device_id: string; revenue: bigint; cnt: bigint }[]>`
            SELECT s."deviceId" AS device_id,
                   SUM(s."totalCents")::bigint AS revenue,
                   COUNT(*)::bigint AS cnt
            FROM "Sale" s
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from30}
            GROUP BY 1
            ORDER BY revenue DESC
            LIMIT 8
          `,
          prisma.$queryRaw<{ h: number; revenue: bigint; cnt: bigint }[]>`
            SELECT EXTRACT(HOUR FROM s."completedAt")::int AS h,
                   SUM(s."totalCents")::bigint AS revenue,
                   COUNT(*)::bigint AS cnt
            FROM "Sale" s
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from30}
            GROUP BY 1
            ORDER BY 1 ASC
          `,
          prisma.$queryRaw<{ dow: number; revenue: bigint; cnt: bigint }[]>`
            SELECT EXTRACT(ISODOW FROM s."completedAt")::int AS dow,
                   SUM(s."totalCents")::bigint AS revenue,
                   COUNT(*)::bigint AS cnt
            FROM "Sale" s
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from365}
            GROUP BY 1
            ORDER BY 1 ASC
          `,
          prisma.$queryRaw<{ ym: string; revenue: bigint; cnt: bigint }[]>`
            SELECT to_char(s."completedAt", 'YYYY-MM') AS ym,
                   SUM(s."totalCents")::bigint AS revenue,
                   COUNT(*)::bigint AS cnt
            FROM "Sale" s
            WHERE s."storeId" = ${storeId}
              AND s."status" = 'COMPLETED'
              AND s."completedAt" >= ${from6m}
            GROUP BY 1
            ORDER BY 1 ASC
          `,
        ]);

        const revWin = Number(sumWindow._sum.totalCents ?? 0);
        const cntWin = sumWindow._count;
        const rev30 = Number(sum30._sum.totalCents ?? 0);
        const cnt30 = sum30._count;
        const rev7 = Number(sum7._sum.totalCents ?? 0);
        const cnt7 = sum7._count;
        const revToday = Number(sumToday._sum.totalCents ?? 0);
        const cntToday = sumToday._count;
        const revCurM = Number(sumCurMonth._sum.totalCents ?? 0);
        const cntCurM = sumCurMonth._count;
        const revPrevM = Number(sumPrevMonth._sum.totalCents ?? 0);
        const cntPrevM = sumPrevMonth._count;

        const dailyRows = dailyAgg.map((r) => ({
          date: r.d.toISOString().slice(0, 10),
          revenueCents: Number(r.revenue),
          sales: Number(r.cnt),
        }));
        const revenues = dailyRows.map((x) => x.revenueCents);
        const minDaily =
          revenues.length > 0
            ? dailyRows.reduce((a, b) => (a.revenueCents <= b.revenueCents ? a : b), dailyRows[0]!)
            : null;
        const maxDaily =
          revenues.length > 0
            ? dailyRows.reduce((a, b) => (a.revenueCents >= b.revenueCents ? a : b), dailyRows[0]!)
            : null;

        const avgDaily30 = cnt30 > 0 ? Math.round(rev30 / 30) : 0;
        const avgDaily7 = cnt7 > 0 ? Math.round(rev7 / 7) : 0;
        const avgTicket30 = cnt30 > 0 ? Math.round(rev30 / cnt30) : 0;
        const avgTicket7 = cnt7 > 0 ? Math.round(rev7 / cnt7) : 0;
        const avgTicketMonth = cntCurM > 0 ? Math.round(revCurM / cntCurM) : 0;

        const months = last6Months.map((m) => ({
          month: m.ym,
          revenueCents: Number(m.revenue),
          sales: Number(m.cnt),
        }));
        const monthRevenues = months.map((m) => m.revenueCents);
        const avgMonthlyLastN =
          monthRevenues.length > 0
            ? Math.round(monthRevenues.reduce((a, b) => a + b, 0) / monthRevenues.length)
            : 0;

        const trendShortVsLongPct = pctChange(avgDaily7, avgDaily30);

        const mRow = marginRow[0];
        const margin30 = marginSliceFromRow(mRow);
        const marginToday = marginSliceFromRow(marginTodayRow[0]);
        const marginMonth = marginSliceFromRow(marginMonthRow[0]);

        const totalPayMix = paymentMix.reduce((a, r) => a + Number(r.revenue), 0);
        const paymentMixPct = paymentMix.map((r) => {
          const rev = Number(r.revenue);
          return {
            method: r.method,
            revenueCents: rev,
            sales: Number(r.cnt),
            pctOfRevenue: totalPayMix > 0 ? (rev / totalPayMix) * 100 : 0,
          };
        });

        const totalDev = topDevices.reduce((a, r) => a + Number(r.revenue), 0);
        const devicesRanked = topDevices.map((r) => {
          const rev = Number(r.revenue);
          return {
            deviceId: r.device_id,
            revenueCents: rev,
            sales: Number(r.cnt),
            pctOfRevenue: totalDev > 0 ? (rev / totalDev) * 100 : 0,
          };
        });

        const hours = Array.from({ length: 24 }, (_, h) => {
          const row = hourAgg.find((x) => Number(x.h) === h);
          return {
            hour: h,
            revenueCents: row ? Number(row.revenue) : 0,
            sales: row ? Number(row.cnt) : 0,
          };
        });
        const peakHour = hours.reduce((a, b) => (a.revenueCents >= b.revenueCents ? a : b), hours[0]!);

        const dow = [1, 2, 3, 4, 5, 6, 7].map((d) => {
          const row = dowAgg.find((x) => Number(x.dow) === d);
          return {
            isoDow: d,
            label: DOW_ES[d - 1] ?? String(d),
            revenueCents: row ? Number(row.revenue) : 0,
            sales: row ? Number(row.cnt) : 0,
          };
        });
        const peakDow = dow.reduce((a, b) => (a.revenueCents >= b.revenueCents ? a : b), dow[0]!);

        const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
        const dayOfMonth = now.getUTCDate();
        const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
        const dailyPaceFrom7 = cnt7 > 0 ? rev7 / 7 : 0;
        const projectionMonthEndCents =
          dailyPaceFrom7 > 0 ? Math.round(revCurM + dailyPaceFrom7 * remainingDays) : null;

        const momRevenuePct = pctChange(revCurM, revPrevM);
        const momCountPct = pctChange(cntCurM, cntPrevM);

        return {
          meta: {
            dbAvailable: true as const,
            generatedAt: now.toISOString(),
            windowDays,
            note: "Cifras basadas en ventas cerradas. Las fechas siguen el reloj del servidor.",
          },
          totals: {
            lastWindow: { revenueCents: revWin, saleCount: cntWin, days: windowDays },
            last30: { revenueCents: rev30, saleCount: cnt30, ticketAvgCents: avgTicket30 },
            last7: { revenueCents: rev7, saleCount: cnt7, ticketAvgCents: avgTicket7 },
            today: { revenueCents: revToday, saleCount: cntToday },
            currentMonth: { revenueCents: revCurM, saleCount: cntCurM, ticketAvgCents: avgTicketMonth },
            previousMonth: { revenueCents: revPrevM, saleCount: cntPrevM },
          },
          averages: {
            dailyRevenueLast30Cents: avgDaily30,
            dailyRevenueLast7Cents: avgDaily7,
            monthlyRevenueAvgRecentCents: avgMonthlyLastN,
            monthsIncluded: months.length,
          },
          comparisons: {
            momRevenuePct,
            momSaleCountPct: momCountPct,
            trendShortVsLongPct,
            shortLabel: "promedio diario últimos 7 días",
            longLabel: "promedio diario últimos 30 días",
          },
          extrema: {
            last90Days: {
              minDaily: minDaily,
              maxDaily: maxDaily,
            },
          },
          projection: {
            monthEndRevenueCents: projectionMonthEndCents,
            method: "Tendencia del mes según los últimos 7 días (orientativo).",
          },
          marginFromCost: {
            window: "last30DaysSaleLines",
            revenueCents: margin30.revenueCents,
            estimatedCostCents: margin30.estimatedCostCents,
            marginCents: margin30.marginCents,
            marginPct: margin30.marginPct,
            linesWithCost: margin30.linesWithCost,
            linesWithoutCost: margin30.linesWithoutCost,
            note: "Solo se usa el costo guardado en cada producto; si falta, esa línea no suma al coste estimado.",
          },
          marginTodayFromCost: {
            window: "todayUtcSaleLines",
            ...marginToday,
            note: "Día calendario en UTC del servidor (misma convención que el resto de analytics).",
          },
          marginMonthFromCost: {
            window: "currentCalendarMonthUtcSaleLines",
            ...marginMonth,
            note: "Mes calendario en curso (UTC), mismas reglas de coste que el margen a 30 días.",
          },
          paymentMixLast30: paymentMixPct,
          devicesLast30: devicesRanked,
          hourOfDayLast30: hours,
          peakHourLast30: peakHour,
          seasonalityByWeekday365d: dow,
          peakWeekday365d: peakDow,
          monthlySeries: months,
        };
      },
    );

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/admin/economy/analytics]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false as const,
          message: err instanceof Error ? err.message : "Error",
        },
      },
      { status: 200 },
    );
  }
}
