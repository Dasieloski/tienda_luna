import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const bodySchema = z.object({
  productId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "NO_DB" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const storeId = session.storeId;
  const productId = parsed.data.productId;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const p = await tx.product.findFirst({
        where: { id: productId, storeId },
        select: { id: true, sku: true, name: true, priceCents: true, stockQty: true, supplierName: true, deletedAt: true, active: true },
      });
      if (!p) return { ok: false as const, code: "NOT_FOUND" as const };

      // Backfill snapshots y desvincular FKs (mantener historial)
      await tx.saleLine.updateMany({
        where: { productId: p.id },
        data: { productName: p.name, productSku: p.sku, productId: null },
      });
      await tx.inventoryMovement.updateMany({
        where: { productId: p.id },
        data: { productName: p.name, productSku: p.sku, productId: null },
      });
      await (tx as any).ownerSaleLine.updateMany({
        where: { productId: p.id },
        data: { productName: p.name, productSku: p.sku, productId: null },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: session.sub,
          action: "PRODUCT_HARD_DELETE_ADMIN",
          entityType: "Product",
          entityId: p.id,
          before: p as any,
          after: { deleted: true } as any,
        },
      });

      await tx.product.delete({ where: { id: p.id } });
      return { ok: true as const };
    });

    if (!out.ok) return NextResponse.json({ error: out.code }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/products/hard-delete]", err);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

