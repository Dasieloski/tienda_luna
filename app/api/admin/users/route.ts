import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
  role: z.enum(["ADMIN", "CASHIER"]).default("ADMIN"),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { storeId: session.storeId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const passwordHash = await hash(parsed.data.password, 10);
  try {
    const created = await prisma.user.create({
      data: {
        storeId: session.storeId,
        email: parsed.data.email.toLowerCase(),
        passwordHash,
        role: parsed.data.role,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json({
      user: {
        id: created.id,
        email: created.email,
        role: created.role,
        createdAt: created.createdAt.toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ error: "DUPLICATE_EMAIL_OR_DB" }, { status: 409 });
  }
}

