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
          ],
        }
      : {}),
  };

  try {
    const [total, sales, devices] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        orderBy: { completedAt: "desc" },
        skip,
        take: limit,
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

    return NextResponse.json({
      sales: sales.map((s) => ({
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
          productName: l.product.name,
          sku: l.product.sku,
        })),
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

