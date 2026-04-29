import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentCurrency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { upsertDailySnapshot } from "@/services/snapshot-service";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  saleId: z.string().min(1), // Sale.id (server)
  method: z.string().trim().min(1).max(40),
  currency: z.enum(["CUP", "USD"]).default("CUP"),
  amountCupCents: z.number().int().min(0).optional(),
  amountUsdCents: z.number().int().min(0).optional(),
  usdRateCup: z.number().int().min(1).max(100000).optional(),
  paidAt: z.string().datetime().optional(),
  note: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const { saleId, method, currency, amountCupCents, amountUsdCents, usdRateCup, paidAt, note } = parsed.data;
  const paidAtDate = paidAt ? new Date(paidAt) : new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, storeId: guard.session.storeId },
        select: {
          id: true,
          storeId: true,
          totalCents: true,
          paidTotalCents: true,
          balanceCents: true,
          paymentStatus: true,
          completedAt: true,
          clientSaleId: true,
        },
      });
      if (!sale) return { ok: false as const, error: "NOT_FOUND" as const };

      let computedCup = 0;
      let originalAmount: number | null = null;
      let rate: number | null = null;
      if (currency === "USD") {
        const usd = amountUsdCents ?? null;
        if (usd == null) return { ok: false as const, error: "MISSING_AMOUNT" as const };
        originalAmount = usd;
        rate = usdRateCup ?? (await tx.store.findUnique({ where: { id: sale.storeId }, select: { usdRateCup: true } }))?.usdRateCup ?? 250;
        computedCup = Math.round((usd / 100) * Math.round(rate) * 100);
      } else {
        const cup = amountCupCents ?? null;
        if (cup == null) return { ok: false as const, error: "MISSING_AMOUNT" as const };
        computedCup = cup;
      }

      const p = await tx.salePayment.create({
        data: {
          storeId: guard.session.storeId,
          saleId: sale.id,
          amountCupCents: computedCup,
          currency: currency === "USD" ? PaymentCurrency.USD : PaymentCurrency.CUP,
          originalAmount,
          usdRateCup: rate,
          method,
          paidAt: paidAtDate,
        },
        select: { id: true },
      });

      const nextPaid = sale.paidTotalCents + computedCup;
      const nextBalance = sale.totalCents - nextPaid;
      const nextStatus =
        nextPaid === 0 ? "CREDIT_OPEN" : nextBalance === 0 ? "PAID" : nextBalance > 0 ? "PARTIAL" : "OVERPAID";

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          paidTotalCents: nextPaid,
          balanceCents: nextBalance,
          paymentStatus: nextStatus,
          editedAt: new Date(),
          revisionCount: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          storeId: guard.session.storeId,
          actorType: "USER",
          actorId: guard.user.id,
          action: "SALE_PAYMENT_APPLIED_ADMIN",
          entityType: "Sale",
          entityId: sale.id,
          meta: {
            saleId: sale.id,
            clientSaleId: sale.clientSaleId,
            paymentId: p.id,
            amountCupCents: computedCup,
            currency,
            method,
            note: note ?? null,
            ...auditRequestMeta(request),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ok: true as const,
        saleId: sale.id,
        paidTotalCents: nextPaid,
        balanceCents: nextBalance,
        paymentStatus: nextStatus,
        snapshotDayUtc: new Date(Date.UTC(paidAtDate.getUTCFullYear(), paidAtDate.getUTCMonth(), paidAtDate.getUTCDate(), 0, 0, 0, 0)),
      };
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

    await upsertDailySnapshot(guard.session.storeId, result.snapshotDayUtc).catch(() => null);
    return NextResponse.json({ ok: true, saleId: result.saleId });
  } catch (e) {
    console.error("[api/admin/sales/apply-payment]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

