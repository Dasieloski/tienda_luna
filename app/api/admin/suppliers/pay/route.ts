import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  supplierId: z.string().min(1),
  amountCents: z.number().int().positive(),
  method: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(240).optional().nullable(),
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
  const { supplierId, amountCents } = parsed.data;
  const method = parsed.data.method?.trim() || null;
  const note = parsed.data.note?.trim() || null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const sup = await tx.supplier.findFirst({ where: { id: supplierId, storeId }, select: { id: true, name: true } });
      if (!sup) return { ok: false as const, code: "SUPPLIER_NOT_FOUND" as const };

      const pay = await (tx as any).supplierDebtPayment.create({
        data: { storeId, supplierId, amountCents, paidAt: new Date(), method, note, actorUserId: guard.session.sub },
        select: { id: true, amountCents: true, paidAt: true },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: guard.session.sub,
          action: "SUPPLIER_DEBT_PAYMENT_CREATE",
          entityType: "SupplierDebtPayment",
          entityId: pay.id,
          after: { supplierId, amountCents, method, note, paidAt: pay.paidAt.toISOString() } as any,
          meta: auditRequestMeta(request) as any,
        },
      });

      return { ok: true as const, payment: pay, supplierName: sup.name };
    });

    if (!created.ok) return NextResponse.json({ error: created.code }, { status: 404 });
    return NextResponse.json({
      ok: true,
      supplierId,
      supplierName: created.supplierName,
      payment: { id: created.payment.id, amountCents: created.payment.amountCents, paidAt: created.payment.paidAt.toISOString() },
    });
  } catch (e) {
    console.error("[api/admin/suppliers/pay]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

