import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  role: z.enum(["ADMIN", "CASHIER"]).optional(),
  newPassword: z.string().min(6).max(200).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, storeId: true },
  });
  if (!existing || existing.storeId !== session.storeId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const data: { role?: "ADMIN" | "CASHIER"; passwordHash?: string } = {};
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.newPassword) {
    data.passwordHash = await hash(parsed.data.newPassword, 10);
  }

  await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, storeId: true },
  });
  if (!existing || existing.storeId !== session.storeId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Evita borrarte a ti mismo si estás autenticado con un usuario real.
  if (session.typ === "user" && session.sub === id) {
    return NextResponse.json({ error: "CANNOT_DELETE_SELF" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

