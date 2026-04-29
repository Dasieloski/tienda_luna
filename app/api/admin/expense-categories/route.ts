import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().optional().default(true),
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
});

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  const rows = await prisma.expenseCategory.findMany({
    where: { storeId: guard.session.storeId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    categories: rows.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const row = await prisma.expenseCategory.create({
    data: { storeId: guard.session.storeId, name: parsed.data.name, active: parsed.data.active },
  });
  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "EXPENSE_CATEGORY_CREATED_ADMIN",
      entityType: "ExpenseCategory",
      entityId: row.id,
      after: row as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

export async function PATCH(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const existing = await prisma.expenseCategory.findFirst({
    where: { id: parsed.data.id, storeId: guard.session.storeId },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const updated = await prisma.expenseCategory.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name != null ? { name: parsed.data.name } : {}),
      ...(parsed.data.active != null ? { active: parsed.data.active } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "EXPENSE_CATEGORY_UPDATED_ADMIN",
      entityType: "ExpenseCategory",
      entityId: updated.id,
      before: existing as unknown as Prisma.InputJsonValue,
      after: updated as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true });
}

