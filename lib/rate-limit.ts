type State = { count: number; firstAt: number; blockedUntil: number };

function store() {
  const g = globalThis as typeof globalThis & { __tlRl?: Map<string, State> };
  if (!g.__tlRl) g.__tlRl = new Map();
  return g.__tlRl;
}

export function getClientIp(request: Request) {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitOrThrow(input: {
  key: string;
  max: number;
  windowMs: number;
  blockMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const m = store();
  const prev = m.get(input.key) ?? { count: 0, firstAt: now, blockedUntil: 0 };
  if (prev.blockedUntil > now) {
    const retryAfterSec = Math.max(1, Math.ceil((prev.blockedUntil - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  const inWindow = now - prev.firstAt <= input.windowMs;
  const st = inWindow ? prev : { count: 0, firstAt: now, blockedUntil: prev.blockedUntil };
  st.count += 1;
  if (st.count > input.max) {
    st.blockedUntil = now + input.blockMs;
    m.set(input.key, st);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(input.blockMs / 1000)) };
  }
  m.set(input.key, st);
  return { ok: true };
}

