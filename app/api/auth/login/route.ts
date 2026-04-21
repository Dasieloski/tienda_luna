import { NextResponse } from "next/server";
import { z } from "zod";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { sessionCookieName } from "@/lib/auth";
import { signUserSession } from "@/lib/jwt";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type RateLimitState = { count: number; firstAt: number; blockedUntil: number };

function getClientIp(request: Request) {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function getRlStore() {
  const g = globalThis as typeof globalThis & { __tlLoginRl?: Map<string, RateLimitState> };
  if (!g.__tlLoginRl) g.__tlLoginRl = new Map();
  return g.__tlLoginRl;
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
    }

    const { email, password } = parsed.data;
    const emailNorm = email.trim().toLowerCase();
    const ip = getClientIp(request);

    // Rate limit básico (memoria del runtime). Protege contra fuerza bruta.
    const now = Date.now();
    const key = `login:${ip}:${emailNorm}`;
    const store = getRlStore();
    const st = store.get(key) ?? { count: 0, firstAt: now, blockedUntil: 0 };
    const windowMs = 10 * 60_000;
    const maxAttempts = 8;
    const blockMs = 15 * 60_000;
    const inWindow = now - st.firstAt <= windowMs;
    const state = inWindow ? st : { count: 0, firstAt: now, blockedUntil: st.blockedUntil };

    if (state.blockedUntil > now) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    state.count += 1;
    if (state.count > maxAttempts) {
      state.blockedUntil = now + blockMs;
      store.set(key, state);
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    store.set(key, state);

    // Usuarios reales en BD
    const user = await prisma.user.findUnique({
      where: { email: emailNorm },
      select: { id: true, passwordHash: true, role: true, storeId: true },
    });
    if (!user) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }
    const ok = await compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // Éxito: limpia contador para este par (ip+email)
    store.delete(key);

    const token = await signUserSession(user.id, user.storeId, user.role);
    const res = NextResponse.json({
      token,
      role: user.role,
      storeId: user.storeId,
      userId: user.id,
      mode: "db_user",
    });
    res.cookies.set(sessionCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "LOGIN_ERROR";
    console.error("[api/auth/login]", e);
    return NextResponse.json(
      {
        error: "LOGIN_FAILED",
        ...(process.env.NODE_ENV === "development" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
