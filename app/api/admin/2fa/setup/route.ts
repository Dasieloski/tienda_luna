import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { encryptTotpSecret, generateTotpSecret } from "@/lib/totp";

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const { secret, otpauth } = generateTotpSecret();
  const enc = encryptTotpSecret(secret);

  await prisma.user.update({
    where: { id: guard.user.id },
    data: { totpEnabled: false, totpSecret: enc, totpVerifiedAt: null },
  });

  return NextResponse.json({
    ok: true,
    setup: {
      otpauth,
      secret,
      note: "Guarda este secreto en tu app (Google Authenticator/Authy). Luego confirma con el código para activar 2FA.",
    },
  });
}

