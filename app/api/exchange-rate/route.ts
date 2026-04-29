import { NextResponse } from "next/server";
import { getSessionFromRequest, canSync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Si es el store placeholder local, devolvemos el env (no hay BD real).
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    const env = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
    return NextResponse.json({
      usdRateCup: Number.isFinite(env) && env > 0 ? Math.round(env) : 250,
      meta: { dbAvailable: false as const },
    });
  }

  try {
    const store = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { usdRateCup: true },
    });
    const env = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
    const fallback = Number.isFinite(env) && env > 0 ? Math.round(env) : 250;
    const usdRateCup =
      typeof store?.usdRateCup === "number" && Number.isFinite(store.usdRateCup) && store.usdRateCup > 0
        ? Math.round(store.usdRateCup)
        : fallback;
    return NextResponse.json({ usdRateCup, meta: { dbAvailable: true as const } });
  } catch (e) {
    console.error("[api/exchange-rate]", e);
    const env = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
    return NextResponse.json({
      usdRateCup: Number.isFinite(env) && env > 0 ? Math.round(env) : 250,
      meta: { dbAvailable: false as const },
    });
  }
}

