import { prisma } from "@/lib/db";

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function nextUtcDayExclusive(d: Date) {
  const x = startOfUtcDay(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

export type DailySnapshot = {
  day: Date;
  revenueCents: number;
  saleCount: number;
  ticketAvgCents: number;
  marginCents: number;
  marginPct: number | null;
  linesWithCost: number;
  linesWithoutCost: number;
  paymentMix: { method: string; revenueCents: number; sales: number; pctOfRevenue: number }[];
};

export async function computeDailySnapshot(storeId: string, dayUtc: Date): Promise<DailySnapshot> {
  const day = startOfUtcDay(dayUtc);
  const toExclusive = nextUtcDayExclusive(dayUtc);

  const [saleAgg, marginRows, paymentRows] = await Promise.all([
    prisma.sale.aggregate({
      where: { storeId, status: "COMPLETED", completedAt: { gte: day, lt: toExclusive } },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.$queryRaw<
      { revenue: bigint; cost: bigint; lines_with_cost: bigint; lines_without_cost: bigint }[]
    >`
      SELECT
        COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN sl."subtotalCents" ELSE 0 END), 0)::bigint AS revenue,
        COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN p."costCents" * sl."quantity" ELSE 0 END), 0)::bigint AS cost,
        COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_with_cost,
        COALESCE(SUM(CASE WHEN p."costCents" IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_without_cost
      FROM "SaleLine" sl
      INNER JOIN "Sale" s ON s."id" = sl."saleId"
      INNER JOIN "Product" p ON p."id" = sl."productId"
      WHERE s."storeId" = ${storeId}
        AND s."status" = 'COMPLETED'
        AND s."completedAt" >= ${day}
        AND s."completedAt" < ${toExclusive}
    `,
    prisma.$queryRaw<{ method: string; revenue: bigint; cnt: bigint }[]>`
      SELECT COALESCE(NULLIF(trim(e.payload->>'paymentMethod'), ''), '(sin método)') AS method,
             COALESCE(SUM(s."totalCents"), 0)::bigint AS revenue,
             COUNT(*)::bigint AS cnt
      FROM "Event" e
      INNER JOIN "Sale" s ON s."storeId" = e."storeId"
        AND s."clientSaleId" = (e.payload->>'saleId')
      WHERE e."storeId" = ${storeId}
        AND e."type" = 'SALE_COMPLETED'
        AND e."status" IN ('ACCEPTED', 'CORRECTED')
        AND s."status" = 'COMPLETED'
        AND s."completedAt" >= ${day}
        AND s."completedAt" < ${toExclusive}
      GROUP BY 1
      ORDER BY revenue DESC
      LIMIT 30
    `,
  ]);

  const revenueCents = Number(saleAgg._sum.totalCents ?? 0);
  const saleCount = Number(saleAgg._count ?? 0);
  const ticketAvgCents = saleCount > 0 ? Math.round(revenueCents / saleCount) : 0;

  const m = marginRows[0];
  const revenueWithCostCents = Number(m?.revenue ?? 0);
  const estimatedCostCents = Number(m?.cost ?? 0);
  const marginCents = revenueWithCostCents - estimatedCostCents;
  const marginPct = revenueWithCostCents > 0 ? (marginCents / revenueWithCostCents) * 100 : null;
  const linesWithCost = Number(m?.lines_with_cost ?? 0);
  const linesWithoutCost = Number(m?.lines_without_cost ?? 0);

  const paymentTotal = paymentRows.reduce((acc, r) => acc + Number(r.revenue ?? 0), 0);
  const paymentMix = paymentRows.map((r) => {
    const rev = Number(r.revenue ?? 0);
    const sales = Number(r.cnt ?? 0);
    return {
      method: r.method,
      revenueCents: rev,
      sales,
      pctOfRevenue: paymentTotal > 0 ? (rev / paymentTotal) * 100 : 0,
    };
  });

  return {
    day,
    revenueCents,
    saleCount,
    ticketAvgCents,
    marginCents,
    marginPct,
    linesWithCost,
    linesWithoutCost,
    paymentMix,
  };
}

export async function upsertDailySnapshot(storeId: string, dayUtc: Date) {
  const snap = await computeDailySnapshot(storeId, dayUtc);
  return prisma.metricSnapshot.upsert({
    where: { storeId_day: { storeId, day: snap.day } },
    create: {
      storeId,
      day: snap.day,
      revenueCents: snap.revenueCents,
      saleCount: snap.saleCount,
      ticketAvgCents: snap.ticketAvgCents,
      marginCents: snap.marginCents,
      marginPct: snap.marginPct ?? null,
      linesWithCost: snap.linesWithCost,
      linesWithoutCost: snap.linesWithoutCost,
      paymentMix: snap.paymentMix as any,
    },
    update: {
      revenueCents: snap.revenueCents,
      saleCount: snap.saleCount,
      ticketAvgCents: snap.ticketAvgCents,
      marginCents: snap.marginCents,
      marginPct: snap.marginPct ?? null,
      linesWithCost: snap.linesWithCost,
      linesWithoutCost: snap.linesWithoutCost,
      paymentMix: snap.paymentMix as any,
    },
  });
}

export async function backfillSnapshots(storeId: string, fromDayUtc: Date, toDayUtcInclusive: Date) {
  const from = startOfUtcDay(fromDayUtc);
  const to = startOfUtcDay(toDayUtcInclusive);
  if (from.getTime() > to.getTime()) return { ok: true, days: 0 };

  let days = 0;
  const cur = new Date(from);
  while (cur.getTime() <= to.getTime()) {
    // secuencial: evita saturar pool en Supabase
    // eslint-disable-next-line no-await-in-loop
    await upsertDailySnapshot(storeId, cur);
    days += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return { ok: true, days };
}

