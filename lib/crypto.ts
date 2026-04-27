import crypto from "node:crypto";

function keyBytes(): Buffer {
  const b64 = process.env.TOTP_ENC_KEY?.trim() || "";
  if (!b64) {
    throw new Error("Falta TOTP_ENC_KEY (base64, 32 bytes) para cifrar secretos TOTP.");
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error("TOTP_ENC_KEY debe decodificar a 32 bytes (base64).");
  }
  return buf;
}

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = keyBytes();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptString(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Formato de cifrado inválido.");
  }
  const iv = Buffer.from(parts[2]!, "base64");
  const tag = Buffer.from(parts[3]!, "base64");
  const data = Buffer.from(parts[4]!, "base64");
  const key = keyBytes();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

