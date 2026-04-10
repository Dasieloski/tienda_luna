import { compare } from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type SessionClaims,
  signDeviceSession,
  signUserSession,
  verifySessionToken,
} from "@/lib/jwt";

export type { SessionClaims };
export { signDeviceSession, signUserSession, verifySessionToken };

const COOKIE = "tl_session";

export function sessionCookieName() {
  return COOKIE;
}

export async function verifyBearer(request: Request): Promise<SessionClaims | null> {
  const h = request.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token) return null;

  const jwtClaims = await verifySessionToken(token);
  if (jwtClaims) return jwtClaims;

  const devices = await prisma.device.findMany({
    select: { id: true, storeId: true, tokenHash: true },
  });
  for (const d of devices) {
    const ok = await compare(token, d.tokenHash);
    if (ok) return { sub: d.id, storeId: d.storeId, typ: "device" };
  }
  return null;
}

export async function getSessionFromRequest(request: Request): Promise<SessionClaims | null> {
  const fromBearer = await verifyBearer(request);
  if (fromBearer) return fromBearer;
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m?.[1]) return null;
  try {
    return await verifySessionToken(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

export function requireStoreMatch(claims: SessionClaims, storeId: string) {
  return claims.storeId === storeId;
}

export function requireAdmin(claims: SessionClaims) {
  return claims.typ === "user" && claims.role === "ADMIN";
}

export function canSync(claims: SessionClaims) {
  if (claims.typ === "device") return true;
  if (claims.typ === "user" && (claims.role === "ADMIN" || claims.role === "CASHIER")) return true;
  return false;
}
