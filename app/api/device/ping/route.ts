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
  let debug:
    | {
        lookupLabel: string;
        storeIdFromToken: string;
        matchesInStore: { id: string; storeId: string; label: string; lastSeenAt: string | null }[];
        matchesOtherStores: { id: string; storeId: string; label: string; lastSeenAt: string | null }[];
        devicesInStoreCount: number;
      }
    | null = null;
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

    if (touchedCount === 0) {
      const [inStore, anyStore, countInStore] = await Promise.all([
        prisma.device.findMany({
          where: { storeId: session.storeId, label: session.sub },
          take: 5,
          select: { id: true, storeId: true, label: true, lastSeenAt: true },
        }),
        prisma.device.findMany({
          where: { label: session.sub },
          take: 5,
          select: { id: true, storeId: true, label: true, lastSeenAt: true },
        }),
        prisma.device.count({ where: { storeId: session.storeId } }),
      ]);
      debug = {
        lookupLabel: session.sub,
        storeIdFromToken: session.storeId,
        matchesInStore: inStore.map((d) => ({
          id: d.id,
          storeId: d.storeId,
          label: d.label,
          lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        })),
        matchesOtherStores: anyStore
          .filter((d) => d.storeId !== session.storeId)
          .map((d) => ({
            id: d.id,
            storeId: d.storeId,
            label: d.label,
            lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
          })),
        devicesInStoreCount: countInStore,
      };
      console.log("[api/device/ping] touchedCount=0", debug);
    }
  } catch (e) {
    console.error("[api/device/ping]", e);
    // No bloquear: ping es best-effort
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    session: { typ: session.typ, deviceId: session.sub, storeId: session.storeId },
    touchedCount,
    debug,
  });
}

