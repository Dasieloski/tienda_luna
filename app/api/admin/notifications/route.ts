import { NextResponse } from "next/server";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ notifications: [], meta: { dbAvailable: false } });
  }

  const [lowStock, anomalies] = await Promise.all([
    prisma.product.findMany({
      where: { storeId: session.storeId, active: true },
      select: { id: true, name: true, sku: true, stockQty: true, lowStockAt: true },
      orderBy: { stockQty: "asc" },
      take: 25,
    }),
    prisma.event.findMany({
      where: {
        storeId: session.storeId,
        OR: [{ isFraud: true }, { status: "REJECTED" }],
      },
      orderBy: { serverTimestamp: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        isFraud: true,
        fraudReason: true,
        correctionNote: true,
        serverTimestamp: true,
        deviceId: true,
      },
    }),
  ]);

  const low = lowStock
    .filter((p) => p.stockQty <= (p.lowStockAt ?? 0))
    .slice(0, 10)
    .map((p) => ({
      id: `stock:${p.id}`,
      kind: "LOW_STOCK" as const,
      title: `Stock bajo: ${p.name}`,
      body: `${p.stockQty} ≤ ${p.lowStockAt} · ${p.sku}`,
      ts: new Date().toISOString(),
    }));

  const an = anomalies.map((e) => ({
    id: `event:${e.id}`,
    kind: e.isFraud ? ("FRAUD" as const) : ("REJECTED_EVENT" as const),
    title: e.isFraud ? "Evento marcado como fraude" : "Evento rechazado",
    body: `${e.type} · ${e.deviceId}${e.correctionNote ? ` · ${e.correctionNote}` : ""}`,
    ts: e.serverTimestamp.toISOString(),
  }));

  return NextResponse.json({
    meta: { dbAvailable: true as const },
    notifications: [...low, ...an].slice(0, 20),
  });
}

