import { NextResponse } from "next/server";
import type { SessionClaims } from "@/lib/auth";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID, STATIC_ADMIN_JWT_SUB } from "@/lib/static-admin-auth";

export type AdminGuardOk = {
  ok: true;
  session: SessionClaims;
  user: { id: string; email: string; role: "ADMIN" | "CASHIER"; storeId: string };
};

export type AdminGuardFail = {
  ok: false;
  res: NextResponse;
};

function sameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get("origin")?.trim() || "";
  const referer = request.headers.get("referer")?.trim() || "";
  const expected = `${url.protocol}//${url.host}`;
  if (origin) return origin === expected;
  if (referer) return referer.startsWith(expected);
  return false;
}

function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie") || "";
  return /(?:^|;\s*)tl_session=/.test(cookie);
}

/**
 * Guardia unificada para panel/admin APIs.
 * - Verifica JWT/cookie
 * - Exige admin real
 * - Bloquea `static-admin` fuera de LOCAL/dev
 * - Verifica que el usuario existe en BD (evita sesiones huérfanas)
 *
 * Nota: la exigencia de MFA (TOTP) se añade en el siguiente paso del plan.
 */
export async function requireAdminRequest(
  request: Request,
  opts?: { csrf?: boolean },
): Promise<AdminGuardOk | AdminGuardFail> {
  if (opts?.csrf && hasSessionCookie(request)) {
    const hdr = request.headers.get("x-tl-csrf")?.trim();
    if (hdr !== "1" || !sameOrigin(request)) {
      return { ok: false, res: NextResponse.json({ error: "CSRF" }, { status: 403 }) };
    }
  }

  const session = await getSessionFromRequest(request);
  if (!session || session.typ !== "user" || session.role !== "ADMIN") {
    return { ok: false, res: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }

  if (session.sub === STATIC_ADMIN_JWT_SUB && session.storeId !== LOCAL_ADMIN_STORE_ID) {
    return { ok: false, res: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, email: true, role: true, storeId: true },
    });
    if (!user || user.storeId !== session.storeId || user.role !== "ADMIN") {
      return { ok: false, res: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
    }
    return { ok: true, session, user: user as any };
  } catch {
    return { ok: false, res: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
}

