import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionCookieName } from "@/lib/auth";
import {
  LOCAL_ADMIN_STORE_ID,
  matchesStaticAdmin,
} from "@/lib/static-admin-auth";
import { signUserSession } from "@/lib/jwt";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const STATIC_ADMIN_USER_ID = "static-admin";

async function resolveStoreId(): Promise<string> {
  const fromEnv = process.env.STATIC_ADMIN_STORE_ID?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.STATIC_ADMIN_SKIP_DB === "1") {
    return LOCAL_ADMIN_STORE_ID;
  }

  try {
    const s = await prisma.store.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return s?.id ?? LOCAL_ADMIN_STORE_ID;
  } catch {
    return LOCAL_ADMIN_STORE_ID;
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
    }

    const { email, password } = parsed.data;

    if (!matchesStaticAdmin(email, password)) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const storeId = await resolveStoreId();
    const token = await signUserSession(STATIC_ADMIN_USER_ID, storeId, "ADMIN");
    const res = NextResponse.json({
      token,
      role: "ADMIN",
      storeId,
      userId: STATIC_ADMIN_USER_ID,
      mode: "static_admin",
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
