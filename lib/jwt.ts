import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@prisma/client";

export type SessionClaims = {
  sub: string;
  storeId: string;
  role?: UserRole;
  typ: "user" | "device";
};

/** Solo desarrollo: permite arrancar sin .env; en producción exige JWT_SECRET. */
const DEV_FALLBACK_JWT_SECRET =
  "tienda-luna-dev-only-cambiar-en-produccion-min-16";

function getSecretBytes(): Uint8Array {
  let s = process.env.JWT_SECRET?.trim();
  if (s && s.length >= 16) {
    return new TextEncoder().encode(s);
  }
  if (process.env.NODE_ENV === "development") {
    return new TextEncoder().encode(DEV_FALLBACK_JWT_SECRET);
  }
  throw new Error("JWT_SECRET debe tener al menos 16 caracteres (obligatorio en producción)");
}

export async function signUserSession(userId: string, storeId: string, role: UserRole) {
  return new SignJWT({ typ: "user", storeId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getSecretBytes());
}

export async function signDeviceSession(deviceId: string, storeId: string) {
  return new SignJWT({ typ: "device", storeId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(deviceId)
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(getSecretBytes());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretBytes());
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const storeId = typeof payload.storeId === "string" ? payload.storeId : null;
    const typ = payload.typ === "device" || payload.typ === "user" ? payload.typ : null;
    if (!sub || !storeId || !typ) return null;
    const role = payload.role === "ADMIN" || payload.role === "CASHIER" ? payload.role : undefined;
    return { sub, storeId, role, typ };
  } catch {
    return null;
  }
}
