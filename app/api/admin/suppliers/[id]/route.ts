import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: RouteCtx) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const existing = await prisma.supplier.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const data = parsed.data;
  const name = data.name !== undefined ? data.name.trim() : undefined;
  const phone =
    data.phone === undefined ? undefined : data.phone === null || data.phone.trim() === "" ? null : data.phone.trim();
  const notes =
    data.notes === undefined ? undefined : data.notes === null || data.notes.trim() === "" ? null : data.notes.trim();

  try {
    const s = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });

    if (name !== undefined) {
      await prisma.product.updateMany({
        where: { storeId: session.storeId, supplierId: id },
        data: { supplierName: s.name },
      });
    }

    const count = await prisma.product.count({ where: { supplierId: id } });
    return NextResponse.json({
      supplier: {
        id: s.id,
        name: s.name,
        phone: s.phone,
        notes: s.notes,
        active: s.active,
        productCount: count,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ error: "DUPLICATE_NAME_OR_DB" }, { status: 409 });
  }
}

export async function DELETE(request: Request, ctx: RouteCtx) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  const existing = await prisma.supplier.findFirst({
    where: { id, storeId: session.storeId },
    include: { _count: { select: { products: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (existing._count.products > 0) {
    return NextResponse.json(
      { error: "SUPPLIER_IN_USE", productCount: existing._count.products },
      { status: 409 },
    );
  }

  await prisma.supplier.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
