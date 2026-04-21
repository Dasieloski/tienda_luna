import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(5).max(100).default(25),
  q: z.string().trim().max(120).optional(),
  productId: z.string().trim().optional(),
  actorType: z.enum(["USER", "DEVICE"]).optional(),
  actorId: z.string().trim().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortKey: z
    .enum(["createdAt", "product", "delta", "actorType", "reason"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

function safeDate(iso: string | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false, message: "Base de datos no disponible para esta sesión." },
      rows: [],
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    productId: url.searchParams.get("productId") ?? undefined,
    actorType: url.searchParams.get("actorType") ?? undefined,
    actorId: url.searchParams.get("actorId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    sortKey: url.searchParams.get("sortKey") ?? undefined,
    sortDir: url.searchParams.get("sortDir") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const { page, limit, q, productId, actorType, actorId, from, to, sortKey, sortDir } = parsed.data;
  const fromD = safeDate(from);
  const toD = safeDate(to);

  const needle = q?.trim().toLowerCase() || "";

  const where: Record<string, unknown> = {
    storeId: session.storeId,
    ...(productId ? { productId } : {}),
    ...(actorType ? { actorType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(fromD || toD
      ? {
          createdAt: {
            ...(fromD ? { gte: fromD } : {}),
            ...(toD ? { lte: toD } : {}),
          },
        }
      : {}),
    ...(needle
      ? {
          OR: [
            { reason: { contains: needle, mode: "insensitive" } },
            { actorId: { contains: needle, mode: "insensitive" } },
            { product: { name: { contains: needle, mode: "insensitive" } } },
            { product: { sku: { contains: needle, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.InventoryMovementOrderByWithRelationInput[] =
    sortKey === "delta"
      ? [{ delta: sortDir ?? "desc" }]
      : sortKey === "actorType"
        ? [{ actorType: sortDir ?? "asc" }, { createdAt: "desc" }]
        : sortKey === "reason"
          ? [{ reason: sortDir ?? "asc" }, { createdAt: "desc" }]
          : sortKey === "product"
            ? [{ product: { name: sortDir ?? "asc" } }, { createdAt: "desc" }]
            : [{ createdAt: sortDir ?? "desc" }];

  const skip = (page - 1) * limit;

  try {
    const [total, rows] = await Promise.all([
      prisma.inventoryMovement.count({ where }),
      prisma.inventoryMovement.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        page,
        limit,
        total,
        totalPages,
      },
      rows: rows.map((r: any) => ({
        id: r.id,
        createdAt: r.createdAt,
        productId: r.productId,
        product: r.product ? { id: r.product.id, name: r.product.name, sku: r.product.sku } : null,
        delta: r.delta,
        beforeQty: r.beforeQty,
        afterQty: r.afterQty,
        reason: r.reason,
        actorType: r.actorType,
        actorId: r.actorId,
        eventId: r.eventId ?? null,
      })),
    });
  } catch (e) {
    console.error("[api/admin/inventory/movements]", e);
    return NextResponse.json(
      { meta: { dbAvailable: false, message: "No se pudo cargar el kardex." }, rows: [] },
      { status: 200 },
    );
  }
}

