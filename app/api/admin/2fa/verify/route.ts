import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifyTotpCode } from "@/lib/totp";

const bodySchema = z.object({
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
    select: { id: true, totpSecret: true },
  });
  if (!u?.totpSecret) {
    return NextResponse.json({ error: "NO_SETUP" }, { status: 409 });
  }

  const ok = verifyTotpCode(u.totpSecret, parsed.data.code);
  if (!ok) {
    return NextResponse.json({ error: "INVALID_CODE" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: guard.user.id },
    data: { totpEnabled: true, totpVerifiedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

