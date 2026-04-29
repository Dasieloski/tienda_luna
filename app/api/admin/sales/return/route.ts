import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { upsertDailySnapshot } from "@/services/snapshot-service";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  saleId: z.string().min(1), // Sale.id (server)
  reason: z.string().trim().max(200).optional().nullable(),
  returnedAt: z.string().datetime().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const returnedAt = parsed.data.returnedAt ? new Date(parsed.data.returnedAt) : new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: parsed.data.saleId, storeId: guard.session.storeId },
        include: { lines: true },
      });
      if (!sale) return { ok: false as const, error: "NOT_FOUND" as const };

      const soldByProduct = new Map<string, { quantity: number; unitPriceCents: number }>();
      for (const l of sale.lines) {
        if (!l.productId) continue;
        const prev = soldByProduct.get(l.productId) ?? { quantity: 0, unitPriceCents: l.unitPriceCents };
        soldByProduct.set(l.productId, { quantity: prev.quantity + l.quantity, unitPriceCents: prev.unitPriceCents });
      }

      const toReturn = new Map<string, number>();
      for (const l of parsed.data.lines) {
        toReturn.set(l.productId, (toReturn.get(l.productId) ?? 0) + l.quantity);
      }
      for (const [pid, qty] of toReturn.entries()) {
        const sold = soldByProduct.get(pid)?.quantity ?? 0;
        if (qty > sold) return { ok: false as const, error: "RETURN_EXCEEDS_SOLD" as const };
      }

      let returnTotalCents = 0;
      // Stock + movements
      const productSnap = new Map<string, { name: string; sku: string }>();
      for (const [pid, qty] of toReturn.entries()) {
        const p = await tx.product.findFirst({ where: { id: pid, storeId: guard.session.storeId }, select: { id: true, stockQty: true, name: true, sku: true } });
        if (!p) continue;
        productSnap.set(pid, { name: p.name, sku: p.sku });
        const beforeQty = p.stockQty;
        const afterQty = beforeQty + qty;
        await tx.product.update({ where: { id: pid }, data: { stockQty: afterQty } });
        await tx.inventoryMovement.create({
          data: {
            storeId: guard.session.storeId,
            productId: pid,
            productName: p.name,
            productSku: p.sku,
            delta: qty,
            beforeQty,
            afterQty,
            reason: "SALE_RETURNED_ADMIN",
            actorType: "USER",
            actorId: guard.user.id,
          },
        });
        const unitPriceCents = soldByProduct.get(pid)?.unitPriceCents ?? 0;
        returnTotalCents += qty * unitPriceCents;
      }

      // actualizar SaleLine (restar cantidades)
      const remaining = new Map(toReturn);
      for (const l of sale.lines) {
        const pid = l.productId;
        if (!pid) continue;
        const rem = remaining.get(pid) ?? 0;
        if (rem <= 0) continue;
        const dec = Math.min(rem, l.quantity);
        const nextQty = l.quantity - dec;
        remaining.set(pid, rem - dec);
        if (nextQty <= 0) await tx.saleLine.delete({ where: { id: l.id } });
        else await tx.saleLine.update({ where: { id: l.id }, data: { quantity: nextQty, subtotalCents: nextQty * l.unitPriceCents } });
      }

      const nextTotal = Math.max(0, sale.totalCents - returnTotalCents);
      const nextBalance = nextTotal - sale.paidTotalCents;
      const nextPaymentStatus =
        sale.paidTotalCents === 0 ? "CREDIT_OPEN" : nextBalance === 0 ? "PAID" : nextBalance > 0 ? "PARTIAL" : "OVERPAID";

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          totalCents: nextTotal,
          balanceCents: nextBalance,
          paymentStatus: nextPaymentStatus,
          editedAt: new Date(),
          revisionCount: { increment: 1 },
        },
      });

      const createdReturn = await tx.saleReturn.create({
        data: {
          storeId: guard.session.storeId,
          saleId: sale.id,
          amountCupCents: -returnTotalCents,
          reason: parsed.data.reason ?? null,
          returnedAt,
        },
        select: { id: true },
      });

      const returnLines = Array.from(toReturn.entries()).map(([pid, qty]) => {
        const unitPriceCents = soldByProduct.get(pid)?.unitPriceCents ?? 0;
        const snap = productSnap.get(pid);
        return {
          saleReturnId: createdReturn.id,
          productId: pid,
          productName: snap?.name ?? pid,
          productSku: snap?.sku ?? "—",
          quantity: qty,
          unitPriceCents,
          subtotalCents: qty * unitPriceCents,
        };
      });
      await tx.saleReturnLine.createMany({ data: returnLines satisfies Prisma.SaleReturnLineCreateManyInput[] });

      await tx.auditLog.create({
        data: {
          storeId: guard.session.storeId,
          actorType: "USER",
          actorId: guard.user.id,
          action: "SALE_RETURNED_ADMIN",
          entityType: "Sale",
          entityId: sale.id,
          meta: {
            saleId: sale.id,
            clientSaleId: sale.clientSaleId,
            amountCupCents: -returnTotalCents,
            reason: parsed.data.reason ?? null,
            ...auditRequestMeta(request),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ok: true as const,
        saleId: sale.id,
        dayUtc: new Date(Date.UTC(returnedAt.getUTCFullYear(), returnedAt.getUTCMonth(), returnedAt.getUTCDate(), 0, 0, 0, 0)),
      };
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await upsertDailySnapshot(guard.session.storeId, result.dayUtc).catch(() => null);
    return NextResponse.json({ ok: true, saleId: result.saleId });
  } catch (e) {
    console.error("[api/admin/sales/return]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

