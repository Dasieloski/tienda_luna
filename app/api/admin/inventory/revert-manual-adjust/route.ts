import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  movementId: z.string().min(1),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const storeId = guard.session.storeId;
  const movementId = parsed.data.movementId;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const m = await tx.inventoryMovement.findFirst({
        where: { id: movementId, storeId },
        select: { id: true, productId: true, beforeQty: true, afterQty: true, reason: true },
      });
      if (!m) return { ok: false as const, code: "NOT_FOUND" as const };
      if (m.reason !== "MANUAL_ADJUST") return { ok: false as const, code: "NOT_MANUAL_ADJUST" as const };
      if (!m.productId) return { ok: false as const, code: "NO_PRODUCT" as const };

      const p = await tx.product.findFirst({
        where: { id: m.productId, storeId },
        select: { id: true, stockQty: true, name: true, sku: true },
      });
      if (!p) return { ok: false as const, code: "PRODUCT_NOT_FOUND" as const };

      const beforeQty = p.stockQty;
      const afterQty = m.beforeQty;
      const delta = afterQty - beforeQty;

      await tx.product.update({ where: { id: p.id }, data: { stockQty: afterQty } });

      const revertMovement = await tx.inventoryMovement.create({
        data: {
          storeId,
          productId: p.id,
          productName: p.name,
          productSku: p.sku,
          delta,
          beforeQty,
          afterQty,
          reason: "MANUAL_ADJUST_REVERT",
          actorType: "USER",
          actorId: guard.session.sub,
          eventId: null,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: guard.session.sub,
          action: "INVENTORY_MANUAL_ADJUST_REVERT",
          entityType: "InventoryMovement",
          entityId: revertMovement.id,
          before: { movementId: m.id, productId: p.id, stockQty: beforeQty, reason: m.reason, afterQty: m.afterQty } as any,
          after: { stockQty: afterQty, revertMovementId: revertMovement.id, revertedMovementId: m.id } as any,
          meta: { ...auditRequestMeta(request), revertedMovementId: m.id } as any,
        },
      });

      return { ok: true as const, revertMovementId: revertMovement.id, productId: p.id, from: beforeQty, to: afterQty };
    });

    if (!out.ok) {
      if (out.code === "NOT_FOUND") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ error: out.code }, { status: 409 });
    }

    return NextResponse.json(out);
  } catch (e) {
    console.error("[api/admin/inventory/revert-manual-adjust]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

