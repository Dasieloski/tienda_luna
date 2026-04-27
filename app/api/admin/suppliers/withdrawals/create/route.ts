import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  supplierId: z.string().min(1),
  note: z.string().trim().max(240).optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(100000),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) return NextResponse.json({ error: "NO_DB" }, { status: 503 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const storeId = guard.session.storeId;
  const supplierId = parsed.data.supplierId;
  const note = parsed.data.note?.trim() || null;

  // compactar por producto
  const byProduct = new Map<string, number>();
  for (const l of parsed.data.lines) {
    byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.quantity);
  }
  const compact = Array.from(byProduct.entries()).map(([productId, quantity]) => ({ productId, quantity }));

  try {
    const out = await prisma.$transaction(async (tx) => {
      const sup = await tx.supplier.findFirst({ where: { id: supplierId, storeId }, select: { id: true, name: true } });
      if (!sup) return { ok: false as const, code: "SUPPLIER_NOT_FOUND" as const };

      const products = await tx.product.findMany({
        where: { storeId, id: { in: compact.map((c) => c.productId) }, active: true, deletedAt: null },
        select: { id: true, name: true, sku: true, stockQty: true, priceCents: true, costCents: true, supplierId: true },
      });
      const pById = new Map(products.map((p) => [p.id, p]));

      const missing: string[] = [];
      const wrongSupplier: string[] = [];
      const insufficient: { productId: string; name: string; requested: number; stock: number }[] = [];
      const missingCost: string[] = [];

      for (const c of compact) {
        const p = pById.get(c.productId);
        if (!p) {
          missing.push(c.productId);
          continue;
        }
        if (p.supplierId !== supplierId) {
          wrongSupplier.push(p.id);
        }
        if (p.stockQty < c.quantity) {
          insufficient.push({ productId: p.id, name: p.name, requested: c.quantity, stock: p.stockQty });
        }
        if (p.costCents == null) missingCost.push(p.id);
      }
      if (missing.length) return { ok: false as const, code: "MISSING_PRODUCTS" as const, missing };
      if (wrongSupplier.length) return { ok: false as const, code: "WRONG_SUPPLIER" as const, wrongSupplier };
      if (insufficient.length) return { ok: false as const, code: "INSUFFICIENT_STOCK" as const, insufficient };
      if (missingCost.length) return { ok: false as const, code: "MISSING_COST" as const, missingCost };

      let totalCostCents = 0;
      let totalRetailCents = 0;

      const linesCreate = compact.map((c) => {
        const p = pById.get(c.productId)!;
        const unitCostCents = p.costCents!;
        const unitRetailCents = p.priceCents;
        const subtotalCostCents = unitCostCents * c.quantity;
        const subtotalRetailCents = unitRetailCents * c.quantity;
        totalCostCents += subtotalCostCents;
        totalRetailCents += subtotalRetailCents;
        return {
          productId: p.id,
          productName: p.name,
          productSku: p.sku,
          quantity: c.quantity,
          unitCostCents,
          unitRetailCents,
          subtotalCostCents,
          subtotalRetailCents,
        };
      });

      // actualizar stock + movimientos
      for (const c of compact) {
        const p = pById.get(c.productId)!;
        const before = p.stockQty;
        const after = before - c.quantity;
        await tx.product.update({ where: { id: p.id }, data: { stockQty: after } });
        await (tx.inventoryMovement as any).create({
          data: {
            storeId,
            productId: p.id,
            productName: p.name,
            productSku: p.sku,
            delta: -c.quantity,
            beforeQty: before,
            afterQty: after,
            reason: "SUPPLIER_WITHDRAWAL",
            actorType: "USER",
            actorId: guard.session.sub,
            eventId: null,
          },
        });
      }

      const w = await (tx as any).supplierWithdrawal.create({
        data: {
          storeId,
          supplierId,
          totalCostCents,
          totalRetailCents,
          note,
          actorUserId: guard.session.sub,
          lines: { create: linesCreate },
        },
        select: { id: true, createdAt: true },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: guard.session.sub,
          action: "SUPPLIER_WITHDRAWAL_CREATE",
          entityType: "SupplierWithdrawal",
          entityId: w.id,
          after: { supplierId, totalCostCents, totalRetailCents, note, lineCount: linesCreate.length } as any,
          meta: auditRequestMeta(request) as any,
        },
      });

      return { ok: true as const, withdrawalId: w.id, createdAt: w.createdAt, totalCostCents, totalRetailCents, supplierName: sup.name };
    });

    if (!out.ok) return NextResponse.json({ error: out.code, ...out }, { status: 409 });
    return NextResponse.json({
      ok: true,
      withdrawal: {
        id: out.withdrawalId,
        supplierId,
        supplierName: out.supplierName,
        createdAt: out.createdAt.toISOString(),
        totalCostCents: out.totalCostCents,
        totalRetailCents: out.totalRetailCents,
      },
    });
  } catch (e) {
    console.error("[api/admin/suppliers/withdrawals/create]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

