import { compare } from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID, STATIC_ADMIN_JWT_SUB } from "@/lib/static-admin-auth";
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
  if (jwtClaims) {
    // Best-effort: si es un dispositivo autenticado por JWT, marcar "visto".
    if (jwtClaims.typ === "device") {
      try {
        await prisma.device.updateMany({
          where: {
            storeId: jwtClaims.storeId,
            OR: [{ id: jwtClaims.sub }, { label: jwtClaims.sub }],
          },
          data: { lastSeenAt: new Date() },
        });
      } catch {
        // ignore
      }
    }
    return jwtClaims;
  }

  const devices = await prisma.device.findMany({
    select: { id: true, storeId: true, label: true, tokenHash: true },
  });
  for (const d of devices) {
    const ok = await compare(token, d.tokenHash);
    if (ok) {
      // Best-effort: marcar "visto" (conexión) del dispositivo.
      try {
        await prisma.device.updateMany({
          where: { id: d.id, storeId: d.storeId },
          data: { lastSeenAt: new Date() },
        });
      } catch {
        // ignore
      }
      // Para compat con sesiones antiguas, devolvemos `sub` como label (estable) si existe.
      return { sub: d.label || d.id, storeId: d.storeId, typ: "device" };
    }
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
    const claims = await verifySessionToken(decodeURIComponent(m[1]));
    // Best-effort: si es un dispositivo, marcarlo como "visto" en cualquier request.
    if (claims?.typ === "device") {
      try {
        await prisma.device.updateMany({
          where: {
            storeId: claims.storeId,
            OR: [{ id: claims.sub }, { label: claims.sub }],
          },
          data: { lastSeenAt: new Date() },
        });
      } catch {
        // ignore
      }
    }
    return claims;
  } catch {
    return null;
  }
}

export function requireStoreMatch(claims: SessionClaims, storeId: string) {
  return claims.storeId === storeId;
}

export function requireAdmin(claims: SessionClaims) {
  if (!(claims.typ === "user" && claims.role === "ADMIN")) return false;
  // Endurecer seguridad: bloquear el "admin estático" legacy en tiendas reales.
  // Si aparece, suele indicar un token forjado o un flujo antiguo.
  if (claims.sub === STATIC_ADMIN_JWT_SUB && claims.storeId !== LOCAL_ADMIN_STORE_ID) return false;
  return true;
}

export function canSync(claims: SessionClaims) {
  if (claims.typ === "device") return true;
  if (claims.typ === "user" && (claims.role === "ADMIN" || claims.role === "CASHIER")) return true;
  return false;
}
