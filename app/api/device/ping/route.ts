import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

/**
 * Endpoint liviano para que la APK mantenga "presencia" online.
 * Recomendación: llamar cada 30-60s mientras la caja esté abierta.
 */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.typ !== "device") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      meta: { dbAvailable: false as const },
      session: { typ: session.typ, deviceId: session.sub, storeId: session.storeId },
      touchedCount: 0,
    });
  }

  const now = new Date();
  let touchedCount = 0;
  try {
    // Best-effort: mantener lastSeenAt fresco.
    const r = await prisma.device.updateMany({
      where: {
        storeId: session.storeId,
        OR: [{ id: session.sub }, { label: session.sub }],
      },
      data: { lastSeenAt: now },
    });
    touchedCount = r.count;
  } catch (e) {
    console.error("[api/device/ping]", e);
    // No bloquear: ping es best-effort
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    session: { typ: session.typ, deviceId: session.sub, storeId: session.storeId },
    touchedCount,
  });
}

