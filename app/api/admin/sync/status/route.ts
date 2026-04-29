import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

function minutesBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, status: null });
  }

  const storeId = guard.session.storeId;
  const now = new Date();
  try {
    const [maxDeviceEvent, maxDeviceSeen, maxUserAudit, recentDevices] = await Promise.all([
      prisma.event.aggregate({
        where: { storeId },
        _max: { serverTimestamp: true },
      }),
      prisma.device.aggregate({
        where: { storeId },
        _max: { lastSeenAt: true },
      }),
      prisma.auditLog.aggregate({
        where: { storeId, actorType: "USER" },
        _max: { createdAt: true },
      }),
      prisma.device.findMany({
        where: { storeId },
        orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: { id: true, label: true, lastSeenAt: true, createdAt: true },
      }),
    ]);

    const lastDeviceEventAt = maxDeviceEvent._max.serverTimestamp ?? null;
    const lastDeviceSeenAt = maxDeviceSeen._max.lastSeenAt ?? null;
    const lastWebChangeAt = maxUserAudit._max.createdAt ?? null;

    const ref = lastDeviceSeenAt ?? lastDeviceEventAt;
    const minutesSinceDevice = ref ? minutesBetween(now, ref) : null;

    // "Pendiente" si hubo cambios web después del último contacto del tablet (con tolerancia).
    const pendingForTablet =
      Boolean(lastWebChangeAt && ref && lastWebChangeAt.getTime() > ref.getTime() + 5000);

    // "Offline/atrasado" si hace mucho que no vemos al dispositivo.
    const deviceStale = minutesSinceDevice != null ? minutesSinceDevice >= 15 : true;

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      status: {
        now: now.toISOString(),
        lastDeviceEventAt: lastDeviceEventAt?.toISOString() ?? null,
        lastDeviceSeenAt: lastDeviceSeenAt?.toISOString() ?? null,
        lastWebChangeAt: lastWebChangeAt?.toISOString() ?? null,
        minutesSinceDevice,
        pendingForTablet,
        deviceStale,
        debug: {
          recentDevices: recentDevices.map((d) => ({
            id: d.id,
            label: d.label,
            lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
            createdAt: d.createdAt.toISOString(),
          })),
        },
      },
    });
  } catch (e) {
    console.error("[api/admin/sync/status]", e);
    return NextResponse.json({ meta: { dbAvailable: false as const }, status: null }, { status: 200 });
  }
}

