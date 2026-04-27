import { decryptString, encryptString } from "@/lib/crypto";
import { generateSecret, generateURI, verifySync } from "otplib";

export function generateTotpSecret(): { secret: string; otpauth: string } {
  const issuer = process.env.TOTP_ISSUER?.trim() || "Tienda Luna";
  const account = process.env.TOTP_ACCOUNT_LABEL?.trim() || "admin";
  const secret = generateSecret();
  const otpauth = generateURI({ strategy: "totp", issuer, label: account, secret });
  return { secret, otpauth };
}

export function encryptTotpSecret(secret: string): string {
  return encryptString(secret);
}

export function verifyTotpCode(encSecret: string, code: string): boolean {
  const secret = decryptString(encSecret);
  const r = verifySync({ strategy: "totp", secret, token: code }) as any;
  if (typeof r === "boolean") return r;
  return r?.valid === true || r?.isValid === true;
}

