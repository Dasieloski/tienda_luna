import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  supplierId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, payments: [] });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    supplierId: url.searchParams.get("supplierId") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const fromD = new Date(parsed.data.from);
  const toD = new Date(parsed.data.to);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (fromD > toD) return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });

  const from = startOfDay(fromD);
  const toExclusive = addDays(startOfDay(toD), 1);

  const payments = await (prisma as any).supplierDebtPayment.findMany({
    where: {
      storeId: guard.session.storeId,
      supplierId: parsed.data.supplierId,
      paidAt: { gte: from, lt: toExclusive },
    },
    orderBy: { paidAt: "desc" },
    take: 400,
    select: { id: true, amountCents: true, paidAt: true, method: true, note: true, actorUserId: true },
  });

  return NextResponse.json({
    meta: { dbAvailable: true as const },
    range: { from: parsed.data.from, to: parsed.data.to },
    supplierId: parsed.data.supplierId,
    payments: payments.map((p: any) => ({
      id: p.id,
      amountCents: p.amountCents,
      paidAt: p.paidAt.toISOString(),
      method: p.method ?? null,
      note: p.note ?? null,
      actorUserId: p.actorUserId,
    })),
  });
}

