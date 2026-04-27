import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@prisma/client";

export type SessionClaims = {
  sub: string;
  storeId: string;
  role?: UserRole;
  typ: "user" | "device";
  /** MFA pasado (p. ej. TOTP) para esta sesión. */
  mfa?: boolean;
  /** Epoch ms: momento en que se validó MFA. */
  mfaAt?: number;
  /** Indica que este usuario requiere MFA; el token debe llevar mfa=true. */
  mfaRequired?: boolean;
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

export async function signUserSession(
  userId: string,
  storeId: string,
  role: UserRole,
  extra?: { mfa?: boolean; mfaAt?: number; mfaRequired?: boolean },
) {
  return new SignJWT({ typ: "user", storeId, role, ...(extra ?? {}) })
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
    const mfa = typeof (payload as any).mfa === "boolean" ? ((payload as any).mfa as boolean) : undefined;
    const mfaAt = typeof (payload as any).mfaAt === "number" ? ((payload as any).mfaAt as number) : undefined;
    const mfaRequired =
      typeof (payload as any).mfaRequired === "boolean" ? ((payload as any).mfaRequired as boolean) : undefined;
    return { sub, storeId, role, typ, mfa, mfaAt, mfaRequired };
  } catch {
    return null;
  }
}
