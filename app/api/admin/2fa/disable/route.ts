import { NextResponse } from "next/server";
import { z } from "zod";
import { compare } from "bcryptjs";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifyTotpCode } from "@/lib/totp";

const bodySchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().trim().min(6).max(10),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const u = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: { id: true, passwordHash: true, totpSecret: true, totpEnabled: true },
  });
  if (!u) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const passOk = await compare(parsed.data.password, u.passwordHash);
  if (!passOk) return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  if (!u.totpSecret || !u.totpEnabled) return NextResponse.json({ error: "NOT_ENABLED" }, { status: 409 });
  const codeOk = verifyTotpCode(u.totpSecret, parsed.data.code);
  if (!codeOk) return NextResponse.json({ error: "INVALID_CODE" }, { status: 401 });

  await prisma.user.update({
    where: { id: guard.user.id },
    data: { totpEnabled: false, totpSecret: null, totpVerifiedAt: null },
  });
  return NextResponse.json({ ok: true });
}

