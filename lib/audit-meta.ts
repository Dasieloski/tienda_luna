import crypto from "node:crypto";

function salt(): string {
  return process.env.AUDIT_SALT?.trim() || "";
}

export function auditRequestMeta(request: Request): Record<string, unknown> {
  const ua = request.headers.get("user-agent")?.slice(0, 300) || null;
  const origin = request.headers.get("origin")?.slice(0, 200) || null;
  const referer = request.headers.get("referer")?.slice(0, 200) || null;
  const xf = request.headers.get("x-forwarded-for") || "";
  const ip = (xf ? xf.split(",")[0]!.trim() : request.headers.get("x-real-ip")?.trim()) || "";
  const s = salt();
  const ipHash =
    ip && s ? crypto.createHash("sha256").update(`${s}:${ip}`).digest("hex").slice(0, 24) : null;
  return { userAgent: ua, origin, referer, ipHash };
}

