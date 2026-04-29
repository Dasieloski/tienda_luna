import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

function classifyMethod(methodRaw: string): "cash" | "transfer" | "usd" | "other" {
  const m = (methodRaw ?? "").toLowerCase();
  if (m.includes("usd") || m.includes("dolar") || m.includes("dólar")) return "usd";
  if (m.includes("trans") || m.includes("bank") || m.includes("banco")) return "transfer";
  if (!m.trim() || m.includes("cash") || m.includes("efect")) return "cash";
  return "other";
}

function osmarSharePct(exp: { splitStrategy: string; osmarPct: number | null; singleOwner: string | null }) {
  if (exp.splitStrategy === "UN_SOLO_DUENO") return exp.singleOwner === "OSMAR" ? 100 : 0;
  if (exp.splitStrategy === "PORCENTAJE_CUSTOM") return Math.max(0, Math.min(100, exp.osmarPct ?? 50));
  return 50;
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, totals: null }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (!(from.getTime() <= to.getTime())) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const storeId = guard.session.storeId;

  try {
    const [payments, expenses, marginRows] = await Promise.all([
      prisma.salePayment.findMany({
        where: { storeId, paidAt: { gte: from, lte: to } },
        select: { amountCupCents: true, method: true },
      }),
      prisma.expense.findMany({
        where: { storeId, occurredAt: { gte: from, lte: to } },
        select: { amountCents: true, splitStrategy: true, osmarPct: true, singleOwner: true },
      }),
      prisma.$queryRaw<
        { revenue: bigint; cost: bigint }[]
      >`
        SELECT
          COALESCE(SUM(CASE WHEN sl."unitCostCents" IS NOT NULL THEN sl."subtotalCents" ELSE 0 END), 0)::bigint AS revenue,
          COALESCE(SUM(CASE WHEN sl."unitCostCents" IS NOT NULL THEN sl."unitCostCents" * sl."quantity" ELSE 0 END), 0)::bigint AS cost
        FROM "SaleLine" sl
        INNER JOIN "Sale" s ON s."id" = sl."saleId"
        WHERE s."storeId" = ${storeId}
          AND s."status" = 'COMPLETED'
          AND s."completedAt" >= ${from}
          AND s."completedAt" <= ${to}
      `,
    ]);

    const income = payments.reduce(
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

    const expensesTotals = expenses.reduce(
      (acc, e) => {
        acc.totalCents += e.amountCents;
        const pct = osmarSharePct({
          splitStrategy: String(e.splitStrategy),
          osmarPct: e.osmarPct,
          singleOwner: e.singleOwner,
        });
        const osmarCents = Math.round((e.amountCents * pct) / 100);
        acc.osmarCents += osmarCents;
        acc.alexCents += e.amountCents - osmarCents;
        return acc;
      },
      { totalCents: 0, osmarCents: 0, alexCents: 0 },
    );

    const m = marginRows[0];
    const revenueCents = Number(m?.revenue ?? BigInt(0));
    const estimatedCostCents = Number(m?.cost ?? BigInt(0));
    const grossMarginCents = revenueCents - estimatedCostCents;
    const netProfitCents = grossMarginCents - expensesTotals.totalCents;

    // Reparto de ganancia neta (default 50/50) menos gastos asignados
    const osmarNetCents = Math.round(netProfitCents / 2) - expensesTotals.osmarCents;
    const alexNetCents = netProfitCents - Math.round(netProfitCents / 2) - expensesTotals.alexCents;

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      window: { from: from.toISOString(), to: to.toISOString() },
      income,
      expenses: expensesTotals,
      margin: { revenueCents, estimatedCostCents, grossMarginCents },
      net: {
        netProfitCents,
        owners: {
          OSMAR: osmarNetCents,
          ALEX: alexNetCents,
        },
      },
      note:
        "Ingreso usa SalePayment (por paidAt). Egresos usa Expense (por occurredAt). Margen bruto usa solo líneas con unitCostCents definido.",
    });
  } catch (e) {
    console.error("[api/admin/accounting/summary]", e);
    return NextResponse.json({ meta: { dbAvailable: false as const, message: "DB" } }, { status: 200 });
  }
}

