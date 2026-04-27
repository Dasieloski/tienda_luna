import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { upsertDailySnapshot } from "@/services/snapshot-service";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  ownerSaleId: z.string().min(1),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "NO_DB" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const storeId = guard.session.storeId;
  const ownerSaleId = parsed.data.ownerSaleId;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const os = await (tx as any).ownerSale.findFirst({
        where: { id: ownerSaleId, storeId },
        include: { lines: { orderBy: { id: "asc" } } },
      });

      if (!os) return { ok: false as const, code: "NOT_FOUND" as const };
      if (os.status !== "PENDING_PAYMENT") return { ok: false as const, code: "NOT_PENDING" as const };

      // Crear una Sale "normal" a costo para que entre en cuadre/analítica, sin tocar stock (ya se descontó al crear la deuda).
      const completedAt = new Date();
      const saleLines = (os.lines ?? []).map((l: any) => ({
        productId: l.productId,
        productName: l.productName ?? null,
        productSku: l.productSku ?? null,
        quantity: l.quantity,
        unitPriceCents: l.unitCostCents,
        subtotalCents: l.subtotalCents,
      }));

      const createdSale = await tx.sale.create({
        data: {
          storeId,
          deviceId: guard.session.sub,
          soldBy: "OWNER_DEBT_PAYMENT",
          totalCents: os.totalCents,
          status: "COMPLETED",
          completedAt,
          lines: { create: saleLines },
        },
        select: { id: true, completedAt: true },
      });

      const updated = await (tx as any).ownerSale.update({
        where: { id: os.id },
        data: {
          status: "PAID",
          paidAt: completedAt,
          paidSaleId: createdSale.id,
        },
        select: { id: true, status: true, paidAt: true, paidSaleId: true },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: guard.session.sub,
          action: "OWNER_SALE_PAID",
          entityType: "OwnerSale",
          entityId: os.id,
          before: { status: os.status, paidAt: os.paidAt ?? null, paidSaleId: os.paidSaleId ?? null } as any,
          after: {
            status: updated.status,
            paidAt: updated.paidAt?.toISOString?.() ?? null,
            paidSaleId: updated.paidSaleId ?? null,
            saleId: createdSale.id,
          } as any,
          meta: auditRequestMeta(request) as any,
        },
      });

      return { ok: true as const, ownerSale: updated, saleId: createdSale.id, completedAt: createdSale.completedAt };
    });

    if (!out.ok) {
      if (out.code === "NOT_FOUND") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      if (out.code === "NOT_PENDING") return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
      return NextResponse.json({ error: "UNKNOWN" }, { status: 400 });
    }

    // Best-effort: recalcular snapshot del día del pago.
    await upsertDailySnapshot(storeId, new Date(Date.UTC(out.completedAt.getUTCFullYear(), out.completedAt.getUTCMonth(), out.completedAt.getUTCDate(), 0, 0, 0, 0))).catch(
      () => null,
    );

    return NextResponse.json({
      ok: true,
      paid: {
        ownerSaleId: out.ownerSale.id,
        paidAt: out.ownerSale.paidAt?.toISOString?.() ?? new Date().toISOString(),
        saleId: out.saleId,
      },
    });
  } catch (err) {
    console.error("[api/admin/owner-sales/pay]", err);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

