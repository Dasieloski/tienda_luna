import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { upsertDailySnapshot } from "@/services/snapshot-service";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  saleId: z.string().min(1), // Sale.id (server)
  note: z.string().trim().max(200).optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(0),
        unitPriceCupCentsOverride: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(400),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: parsed.data.saleId, storeId: guard.session.storeId },
        include: { lines: true },
      });
      if (!sale) return { ok: false as const, error: "NOT_FOUND" as const };

      const desired = new Map<string, { quantity: number; override?: number }>();
      for (const l of parsed.data.lines) {
        const prev = desired.get(l.productId) ?? { quantity: 0 };
        desired.set(l.productId, { quantity: prev.quantity + l.quantity, override: l.unitPriceCupCentsOverride ?? prev.override });
      }

      const actual = new Map<string, { quantity: number; unitPriceCents: number }>();
      for (const l of sale.lines) {
        if (!l.productId) continue;
        const prev = actual.get(l.productId) ?? { quantity: 0, unitPriceCents: l.unitPriceCents };
        actual.set(l.productId, { quantity: prev.quantity + l.quantity, unitPriceCents: prev.unitPriceCents });
      }

      const allPids = new Set<string>([...actual.keys(), ...desired.keys()]);
      const deltas = new Map<string, number>();
      for (const pid of allPids) {
        const a = actual.get(pid)?.quantity ?? 0;
        const d = desired.get(pid)?.quantity ?? 0;
        deltas.set(pid, d - a);
      }

      // Validar stock si hay incrementos
      for (const [pid, delta] of deltas.entries()) {
        if (delta <= 0) continue;
        const p = await tx.product.findFirst({ where: { id: pid, storeId: guard.session.storeId }, select: { stockQty: true } });
        if (!p) return { ok: false as const, error: "UNKNOWN_PRODUCT" as const };
        if (p.stockQty < delta) return { ok: false as const, error: "NEGATIVE_STOCK" as const };
      }

      const beforeSnapshot = {
        totalCents: sale.totalCents,
        paidTotalCents: sale.paidTotalCents,
        balanceCents: sale.balanceCents,
        paymentStatus: sale.paymentStatus,
        lines: sale.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          productSku: l.productSku,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          subtotalCents: l.subtotalCents,
        })),
      };

      // Aplicar stock deltas + movimientos
      for (const [pid, delta] of deltas.entries()) {
        if (delta === 0) continue;
        const p = await tx.product.findFirst({
          where: { id: pid, storeId: guard.session.storeId },
          select: { id: true, stockQty: true, name: true, sku: true, costCents: true, priceCents: true },
        });
        if (!p) continue;
        const beforeQty = p.stockQty;
        const afterQty = beforeQty - delta; // delta positivo consume
        await tx.product.update({ where: { id: pid }, data: { stockQty: afterQty } });
        await tx.inventoryMovement.create({
          data: {
            storeId: guard.session.storeId,
            productId: pid,
            productName: p.name,
            productSku: p.sku,
            delta: -delta,
            beforeQty,
            afterQty,
            reason: "SALE_EDITED_ADMIN",
            actorType: "USER",
            actorId: guard.user.id,
          },
        });
      }

      // Rebuild SaleLines
      let nextTotal = 0;
      const createLines: Prisma.SaleLineCreateWithoutSaleInput[] = [];
      for (const [pid, d] of desired.entries()) {
        if (d.quantity <= 0) continue;
        const p = await tx.product.findFirst({
          where: { id: pid, storeId: guard.session.storeId },
          select: { id: true, name: true, sku: true, costCents: true, priceCents: true },
        });
        if (!p) continue;
        const unitPriceCents = typeof d.override === "number" ? d.override : actual.get(pid)?.unitPriceCents ?? p.priceCents;
        const subtotalCents = d.quantity * unitPriceCents;
        nextTotal += subtotalCents;
        const unitCostCents = p.costCents ?? null;
        createLines.push({
          productId: pid,
          productName: p.name,
          productSku: p.sku,
          quantity: d.quantity,
          unitPriceCents,
          subtotalCents,
          unitCostCents,
          subtotalCostCents: unitCostCents == null ? null : d.quantity * unitCostCents,
        });
      }

      await tx.saleLine.deleteMany({ where: { saleId: sale.id } });
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          totalCents: nextTotal,
          balanceCents: nextTotal - sale.paidTotalCents,
          paymentStatus:
            sale.paidTotalCents === 0
              ? "CREDIT_OPEN"
              : nextTotal - sale.paidTotalCents === 0
                ? "PAID"
                : nextTotal - sale.paidTotalCents > 0
                  ? "PARTIAL"
                  : "OVERPAID",
          editedAt: new Date(),
          revisionCount: { increment: 1 },
          lines: { create: createLines },
        },
      });

      await tx.auditLog.create({
        data: {
          storeId: guard.session.storeId,
          actorType: "USER",
          actorId: guard.user.id,
          action: "SALE_EDITED_ADMIN",
          entityType: "Sale",
          entityId: sale.id,
          before: beforeSnapshot as Prisma.InputJsonValue,
          after: { totalCents: nextTotal, lines: createLines } as Prisma.InputJsonValue,
          meta: { note: parsed.data.note ?? null, ...auditRequestMeta(request) } as Prisma.InputJsonValue,
        },
      });

      return {
        ok: true as const,
        saleId: sale.id,
        dayUtc: new Date(Date.UTC(sale.completedAt.getUTCFullYear(), sale.completedAt.getUTCMonth(), sale.completedAt.getUTCDate(), 0, 0, 0, 0)),
      };
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await upsertDailySnapshot(guard.session.storeId, result.dayUtc).catch(() => null);
    return NextResponse.json({ ok: true, saleId: result.saleId });
  } catch (e) {
    console.error("[api/admin/sales/edit]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

