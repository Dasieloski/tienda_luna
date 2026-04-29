import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { storeTzOffsetIntervalSql, storeTzOffsetMinutes } from "@/lib/economy-store-tz";

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

type MarginRow = { revenue: bigint; cost: bigint };

function ymdToMonth(ymd: string) {
  return ymd.slice(0, 7);
}

function previousYm(ym: string): string {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

function classifyMethod(methodRaw: string): "cash" | "transfer" | "usd" | "other" {
  const m = (methodRaw ?? "").toLowerCase();
  if (m.includes("usd") || m.includes("dolar") || m.includes("dólar")) return "usd";
  if (m.includes("trans") || m.includes("bank") || m.includes("banco")) return "transfer";
  if (!m.trim() || m.includes("cash") || m.includes("efect")) return "cash";
  return "other";
}

type MonthKpis = {
  month: string;
  fromUtc: Date;
  toUtc: Date;
  revenueGrossCents: number;
  saleCount: number;
  cashInCents: number;
  cashInCount: number;
  cashOutExpensesCents: number;
  cashOutExpensesCount: number;
  accrualExpensesCents: number;
  accrualExpensesCount: number;
  revenueWithCostCents: number;
  cogsCents: number;
  grossProfitCents: number;
  accountingEntriesCents: number;
  accountingEntriesCount: number;
  netProfitCents: number;
  netCashFlowCents: number;
  incomeChannels: {
    totalCents: number;
    cashCents: number;
    transferCents: number;
    usdChannelCents: number;
    otherCents: number;
  };
  expensesByCategory: { category: string; totalCents: number }[];
};

async function loadMonthKpis(storeId: string, month: string, offsetInterval: string): Promise<MonthKpis | null> {
  const bounds = await prisma.$queryRaw<{ from_utc: Date; to_utc: Date }[]>`
    WITH m AS (
      SELECT to_date(${month} || '-01', 'YYYY-MM-DD')::date AS m0
    )
    SELECT
      ((m.m0::timestamp - (${offsetInterval}::interval))) AS from_utc,
      (((m.m0 + interval '1 month')::timestamp - (${offsetInterval}::interval))) AS to_utc
    FROM m
  `;
  const fromUtc = bounds[0]?.from_utc;
  const toUtc = bounds[0]?.to_utc;
  if (!fromUtc || !toUtc) return null;

  const [
    salesAgg,
    paymentsAgg,
    paymentsRows,
    cashFlowExpensesAgg,
    accrualExpensesAgg,
    marginRows,
    entriesAgg,
    categoryRows,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { storeId, status: "COMPLETED", completedAt: { gte: fromUtc, lt: toUtc } },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.salePayment.aggregate({
      where: { storeId, paidAt: { gte: fromUtc, lt: toUtc } },
      _sum: { amountCupCents: true },
      _count: true,
    }),
    prisma.salePayment.findMany({
      where: { storeId, paidAt: { gte: fromUtc, lt: toUtc } },
      select: { amountCupCents: true, method: true },
    }),
    prisma.expense.aggregate({
      where: { storeId, occurredAt: { gte: fromUtc, lt: toUtc } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.$queryRaw<{ total: bigint; cnt: bigint }[]>`
      SELECT
        COALESCE(SUM(e."amountCents"), 0)::bigint AS total,
        COUNT(*)::bigint AS cnt
      FROM "Expense" e
      WHERE e."storeId" = ${storeId}
        AND COALESCE(e."impactMonth", to_char(date_trunc('month', (e."occurredAt" + (${offsetInterval}::interval))), 'YYYY-MM')) = ${month}
    `,
    prisma.$queryRaw<MarginRow[]>`
      SELECT
        COALESCE(SUM(CASE WHEN sl."unitCostCents" IS NOT NULL THEN sl."subtotalCents" ELSE 0 END), 0)::bigint AS revenue,
        COALESCE(SUM(CASE WHEN sl."unitCostCents" IS NOT NULL THEN sl."unitCostCents" * sl."quantity" ELSE 0 END), 0)::bigint AS cost
      FROM "SaleLine" sl
      INNER JOIN "Sale" s ON s."id" = sl."saleId"
      WHERE s."storeId" = ${storeId}
        AND s."status" = 'COMPLETED'
        AND s."completedAt" >= ${fromUtc}
        AND s."completedAt" < ${toUtc}
    `,
    prisma.$queryRaw<{ total: bigint; cnt: bigint }[]>`
      SELECT
        COALESCE(SUM(a."amountCents"), 0)::bigint AS total,
        COUNT(*)::bigint AS cnt
      FROM "AccountingEntry" a
      WHERE a."storeId" = ${storeId}
        AND COALESCE(a."impactMonth", to_char(date_trunc('month', (a."postedAt" + (${offsetInterval}::interval))), 'YYYY-MM')) = ${month}
    `,
    prisma.$queryRaw<{ cat_name: string; total_cents: bigint }[]>`
      SELECT
        COALESCE(ec.name, e."categoryName", 'Sin categoría') AS cat_name,
        SUM(e."amountCents")::bigint AS total_cents
      FROM "Expense" e
      LEFT JOIN "ExpenseCategory" ec ON ec.id = e."categoryId"
      WHERE e."storeId" = ${storeId}
        AND COALESCE(e."impactMonth", to_char(date_trunc('month', (e."occurredAt" + (${offsetInterval}::interval))), 'YYYY-MM')) = ${month}
      GROUP BY 1
      ORDER BY total_cents DESC
      LIMIT 24
    `,
  ]);

  const revenueGrossCents = salesAgg._sum.totalCents ?? 0;
  const saleCount = salesAgg._count ?? 0;
  const cashInCents = paymentsAgg._sum.amountCupCents ?? 0;
  const cashInCount = paymentsAgg._count ?? 0;
  const cashOutExpensesCents = cashFlowExpensesAgg._sum.amountCents ?? 0;
  const cashOutExpensesCount = cashFlowExpensesAgg._count ?? 0;

  const accrualExpenseRow = accrualExpensesAgg[0];
  const accrualExpensesCents = Number(accrualExpenseRow?.total ?? BigInt(0));
  const accrualExpensesCount = Number(accrualExpenseRow?.cnt ?? BigInt(0));

  const m = marginRows[0];
  const revenueWithCostCents = Number(m?.revenue ?? BigInt(0));
  const cogsCents = Number(m?.cost ?? BigInt(0));
  const grossProfitCents = revenueWithCostCents - cogsCents;

  const entryRow = entriesAgg[0];
  const accountingEntriesCents = Number(entryRow?.total ?? BigInt(0));
  const accountingEntriesCount = Number(entryRow?.cnt ?? BigInt(0));

  const netProfitCents = grossProfitCents - accrualExpensesCents + accountingEntriesCents;
  const netCashFlowCents = cashInCents - cashOutExpensesCents;

  const incomeChannels = paymentsRows.reduce(
    (acc, p) => {
      const kind = classifyMethod(p.method);
      acc.totalCents += p.amountCupCents;
      if (kind === "cash") acc.cashCents += p.amountCupCents;
      else if (kind === "transfer") acc.transferCents += p.amountCupCents;
      else if (kind === "usd") acc.usdChannelCents += p.amountCupCents;
      else acc.otherCents += p.amountCupCents;
      return acc;
    },
    { totalCents: 0, cashCents: 0, transferCents: 0, usdChannelCents: 0, otherCents: 0 },
  );

  const expensesByCategory = categoryRows.map((r) => ({
    category: r.cat_name ?? "Sin categoría",
    totalCents: Number(r.total_cents ?? BigInt(0)),
  }));

  return {
    month,
    fromUtc,
    toUtc,
    revenueGrossCents,
    saleCount,
    cashInCents,
    cashInCount,
    cashOutExpensesCents,
    cashOutExpensesCount,
    accrualExpensesCents,
    accrualExpensesCount,
    revenueWithCostCents,
    cogsCents,
    grossProfitCents,
    accountingEntriesCents,
    accountingEntriesCount,
    netProfitCents,
    netCashFlowCents,
    incomeChannels,
    expensesByCategory,
  };
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, month: null }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ month: url.searchParams.get("month") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const storeId = guard.session.storeId;
  const offsetMinutes = storeTzOffsetMinutes();
  const offsetInterval = storeTzOffsetIntervalSql();

  try {
    const month =
      parsed.data.month ??
      (
        await prisma.$queryRaw<{ d: string }[]>`
          SELECT to_char(date_trunc('month', (now() + (${offsetInterval}::interval))), 'YYYY-MM') AS d
        `
      )[0]?.d ??
      ymdToMonth(new Date().toISOString().slice(0, 10));

    const current = await loadMonthKpis(storeId, month, offsetInterval);
    if (!current) return NextResponse.json({ error: "INVALID_MONTH" }, { status: 400 });

    const prevYm = previousYm(month);
    const previous = await loadMonthKpis(storeId, prevYm, offsetInterval);

    const recentEntries = await prisma.accountingEntry.findMany({
      where: { storeId },
      orderBy: { postedAt: "desc" },
      take: 15,
      select: {
        id: true,
        postedAt: true,
        impactMonth: true,
        entryType: true,
        amountCents: true,
        description: true,
      },
    });

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        tzOffsetMinutes: offsetMinutes,
      },
      month: current.month,
      windowUtc: { from: current.fromUtc.toISOString(), to: current.toUtc.toISOString() },
      revenue: {
        grossSalesCents: current.revenueGrossCents,
        saleCount: current.saleCount,
        paymentCount: current.cashInCount,
      },
      margin: {
        revenueWithCostCents: current.revenueWithCostCents,
        cogsCents: current.cogsCents,
        grossProfitCents: current.grossProfitCents,
        note: "Margen bruto usa solo líneas con `unitCostCents` definido (igual que Economía).",
      },
      expenses: {
        cash: {
          totalCents: current.cashOutExpensesCents,
          count: current.cashOutExpensesCount,
          basedOn: "occurredAt" as const,
        },
        accrual: {
          totalCents: current.accrualExpensesCents,
          count: current.accrualExpensesCount,
          basedOn: "impactMonth||occurredAt" as const,
        },
      },
      incomeChannels: current.incomeChannels,
      expensesByCategory: current.expensesByCategory,
      adjustments: {
        accountingEntriesCents: current.accountingEntriesCents,
        count: current.accountingEntriesCount,
      },
      net: {
        netProfitCents: current.netProfitCents,
        netCashFlowCents: current.netCashFlowCents,
      },
      comparison: previous
        ? {
            previousMonth: prevYm,
            previous: {
              grossSalesCents: previous.revenueGrossCents,
              grossProfitCents: previous.grossProfitCents,
              accrualExpensesCents: previous.accrualExpensesCents,
              netProfitCents: previous.netProfitCents,
              netCashFlowCents: previous.netCashFlowCents,
            },
            pctVsPrevious: {
              grossSales: pctChange(current.revenueGrossCents, previous.revenueGrossCents),
              grossProfit: pctChange(current.grossProfitCents, previous.grossProfitCents),
              accrualExpenses: pctChange(current.accrualExpensesCents, previous.accrualExpensesCents),
              netProfit: pctChange(current.netProfitCents, previous.netProfitCents),
              netCashFlow: pctChange(current.netCashFlowCents, previous.netCashFlowCents),
            },
          }
        : null,
      recentAccountingEntries: recentEntries.map((r) => ({
        id: r.id,
        postedAt: r.postedAt.toISOString(),
        impactMonth: r.impactMonth,
        entryType: r.entryType,
        amountCents: r.amountCents,
        description: r.description,
      })),
      rule: {
        ventasNoSeModificanPorGastos: true,
        note:
          "Ventas brutas vienen de Sale (COMPLETED) y nunca se ajustan por Expense. Expense solo afecta utilidad neta/reportes.",
      },
    });
  } catch (e) {
    console.error("[api/admin/accounting/dashboard]", e);
    return NextResponse.json({ meta: { dbAvailable: false as const, message: "DB" } }, { status: 200 });
  }
}
