import { NextResponse } from "next/server";
import { z } from "zod";
import { compare, hash } from "bcryptjs";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(200),
});

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.typ !== "user") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // El usuario "static-admin" no vive en la tabla User, así que no se puede cambiar aquí.
  if (session.sub === "static-admin") {
    return NextResponse.json(
      {
        error: "UNSUPPORTED",
        hint: "Este usuario es static-admin (env). Cambia STATIC_ADMIN_PASSWORD en tu despliegue.",
      },
      { status: 400 },
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, passwordHash: true, storeId: true },
  });
  if (!user || user.storeId !== session.storeId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const ok = await compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "INVALID_CURRENT_PASSWORD" }, { status: 400 });
  }

  const nextHash = await hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: nextHash },
  });

  return NextResponse.json({ ok: true });
}

