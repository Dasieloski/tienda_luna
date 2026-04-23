import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  q: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ sales: [], meta: { dbAvailable: false } });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const { page, limit, q, from, to } = parsed.data;
  const skip = (page - 1) * limit;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const where = {
    storeId: session.storeId,
    ...(from || to ? { completedAt: dateFilter } : {}),
    ...(q
      ? {
          OR: [
            { deviceId: { contains: q, mode: "insensitive" as const } },
            { soldBy: { contains: q, mode: "insensitive" as const } },
            {
              lines: {
                some: {
                  product: {
                    OR: [
                      { name: { contains: q, mode: "insensitive" as const } },
                      { sku: { contains: q, mode: "insensitive" as const } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  try {
    const deletedRows = await prisma.auditLog.findMany({
      where: {
        storeId: session.storeId,
        action: "SALE_DELETED_ADMIN",
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: { id: true, createdAt: true, before: true, meta: true },
    });

    const deletedNormalized = (deletedRows ?? [])
      .map((r) => {
        const snap = r.before as any;
        if (!snap || typeof snap !== "object") return null;
        const completedAt = typeof snap.completedAt === "string" ? snap.completedAt : r.createdAt.toISOString();
        const search = String((r.meta as any)?.search ?? "").toLowerCase();
        return {
          kind: "deleted" as const,
          id: String(snap.id ?? r.id),
          deviceId: String(snap.deviceId ?? ""),
          deviceLabel: null as string | null,
          soldBy: snap.soldBy != null ? String(snap.soldBy) : null,
          totalCents: Number(snap.totalCents ?? 0),
          status: "deleted",
          completedAt,
          lines: Array.isArray(snap.lines)
            ? snap.lines.map((l: any, idx: number) => ({
                id: String(l.id ?? `${snap.id ?? r.id}:l${idx}`),
                quantity: Number(l.quantity ?? 0),
                unitPriceCents: Number(l.unitPriceCents ?? 0),
                subtotalCents: Number(l.subtotalCents ?? 0),
                productName: String(l.name ?? l.productName ?? "—"),
                sku: String(l.sku ?? "—"),
              }))
            : [],
          __search: search,
        };
      })
      .filter(Boolean) as any[];

    const [totalSales, sales, devices] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        orderBy: { completedAt: "desc" },
        // paginación se hará después de mezclar con eliminadas
        take: Math.min(800, limit * 6),
        include: {
          lines: {
            include: {
              product: { select: { name: true, sku: true } },
            },
          },
        },
      }),
      prisma.device.findMany({
        where: { storeId: session.storeId },
        select: { id: true, label: true },
      }),
    ]);

    const deviceLabelById = new Map(devices.map((d) => [d.id, d.label]));

    const live = sales.map((s) => ({
      kind: "sale" as const,
      id: s.id,
      deviceId: s.deviceId,
      deviceLabel: deviceLabelById.get(s.deviceId) ?? null,
      soldBy: s.soldBy ?? null,
      totalCents: s.totalCents,
      status: s.status,
      completedAt: s.completedAt.toISOString(),
      lines: s.lines.map((l) => ({
        id: l.id,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        subtotalCents: l.subtotalCents,
        productName: (l as any).product?.name ?? (l as any).productName ?? "—",
        sku: (l as any).product?.sku ?? (l as any).productSku ?? "—",
      })),
      __search: "",
    }));

    // Completar labels y filtrar por q usando meta.search en eliminadas.
    for (const d of deletedNormalized) {
      d.deviceLabel = deviceLabelById.get(d.deviceId) ?? null;
    }

    const qLower = (q ?? "").trim().toLowerCase();
    const merged = [...live, ...deletedNormalized]
      .filter((row) => {
        if (!qLower) return true;
        if (row.kind === "deleted") {
          return String(row.__search ?? "").includes(qLower);
        }
        // las ventas normales ya se filtran en DB con where/q
        return true;
      })
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));

    const total = totalSales + deletedNormalized.length;
    const pageRows = merged.slice(skip, skip + limit);

    return NextResponse.json({
      sales: pageRows.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        deviceLabel: s.deviceLabel ?? null,
        soldBy: s.soldBy ?? null,
        totalCents: s.totalCents,
        status: s.status,
        completedAt: s.completedAt,
        lines: s.lines,
      })),
      meta: {
        dbAvailable: true as const,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("[api/admin/sales/history]", err);
    return NextResponse.json(
      { sales: [], meta: { dbAvailable: false, message: err instanceof Error ? err.message : "DB" } },
      { status: 200 },
    );
  }
}

