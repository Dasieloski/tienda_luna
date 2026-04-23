import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { upsertDailySnapshot } from "@/services/snapshot-service";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

type DeletedSaleSnapshot = {
  id: string;
  clientSaleId: string | null;
  deviceId: string;
  soldBy: string | null;
  totalCents: number;
  completedAt: string;
  lines: {
    productId: string | null;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
  }[];
};

function buildSearch(snapshot: DeletedSaleSnapshot) {
  const parts = [
    snapshot.id,
    snapshot.clientSaleId ?? "",
    snapshot.deviceId,
    snapshot.soldBy ?? "",
    snapshot.totalCents ? String(snapshot.totalCents) : "",
    ...snapshot.lines.flatMap((l) => [l.name, l.sku, String(l.quantity)]),
  ];
  return parts.join(" ").toLowerCase();
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "NO_DB" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const storeId = session.storeId;
  const ids = Array.from(new Set(parsed.data.ids));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sales = await tx.sale.findMany({
        where: { storeId, id: { in: ids } },
        include: { lines: { include: { product: { select: { id: true, sku: true, name: true } } } } },
      });

      const foundIds = new Set(sales.map((s) => s.id));
      const missing = ids.filter((id) => !foundIds.has(id));

      const touchedDays = new Set<string>(); // YYYY-MM-DD (UTC)

      for (const s of sales) {
        const snapshot: DeletedSaleSnapshot = {
          id: s.id,
          clientSaleId: s.clientSaleId ?? null,
          deviceId: s.deviceId,
          soldBy: s.soldBy ?? null,
          totalCents: s.totalCents,
          completedAt: s.completedAt.toISOString(),
          lines: s.lines.map((l) => ({
            productId: l.productId,
            sku: (l as any).product?.sku ?? (l as any).productSku ?? "—",
            name: (l as any).product?.name ?? (l as any).productName ?? "—",
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            subtotalCents: l.subtotalCents,
          })),
        };

        // Restaurar stock (sin crear movimientos: la única evidencia debe ser Historial/AuditLog).
        for (const l of s.lines) {
          if (!l.productId) continue;
          await tx.product.update({
            where: { id: l.productId },
            data: { stockQty: { increment: l.quantity } },
          });
        }

        // Borrar movimientos/evidencias vinculadas a los eventos del ticket (si existe clientSaleId).
        if (s.clientSaleId) {
          const evs = await tx.event.findMany({
            where: { storeId, relatedClientSaleId: s.clientSaleId },
            select: { id: true },
          });
          const evIds = evs.map((e) => e.id);
          if (evIds.length > 0) {
            await tx.inventoryMovement.deleteMany({ where: { storeId, eventId: { in: evIds } } });
            await tx.event.deleteMany({ where: { storeId, id: { in: evIds } } });
          }
        }

        // Registrar en historial (AuditLog) ANTES de borrar Sale.
        await tx.auditLog.create({
          data: {
            storeId,
            actorType: "USER",
            actorId: session.sub,
            action: "SALE_DELETED_ADMIN",
            entityType: "Sale",
            entityId: s.id,
            before: snapshot as any,
            after: { deleted: true } as any,
            meta: { search: buildSearch(snapshot) } as any,
          },
        });

        // Borrado duro
        await tx.saleLine.deleteMany({ where: { saleId: s.id } });
        await tx.sale.delete({ where: { id: s.id } });

        touchedDays.add(s.completedAt.toISOString().slice(0, 10));
      }

      return { deleted: sales.length, missing, touchedDays: Array.from(touchedDays) };
    });

    // Recalcular snapshots diarios afectados (best-effort, fuera de transacción).
    for (const d of result.touchedDays) {
      const [y, m, day] = d.split("-").map(Number) as [number, number, number];
      const dayUtc = new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
      // eslint-disable-next-line no-await-in-loop
      await upsertDailySnapshot(storeId, dayUtc).catch(() => null);
    }

    return NextResponse.json({ ok: true, deleted: result.deleted, missing: result.missing });
  } catch (err) {
    console.error("[api/admin/sales/delete]", err);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

