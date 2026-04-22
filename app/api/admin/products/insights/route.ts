import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z
  .object({
    productId: z.string().min(1).optional(),
    fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    top: z.coerce.number().int().min(1).max(50).optional().default(12),
  })
  .superRefine((val, ctx) => {
    if (val.fromDay && val.toDay && val.fromDay > val.toDay) {
      ctx.addIssue({ code: "custom", message: "fromDay debe ser <= toDay" });
    }
  });

function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw);
  return Number.isFinite(v) ? v : -240;
}

function localDayStartUtc(dayYmd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayYmd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const offsetMinutes = storeTzOffsetMinutes();
  const localStart = new Date(y, mo, d, 0, 0, 0, 0);
  return new Date(localStart.getTime() - offsetMinutes * 60_000);
}

function localDayEndExclusiveUtc(dayYmd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayYmd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const offsetMinutes = storeTzOffsetMinutes();
  const localNext = new Date(y, mo, d + 1, 0, 0, 0, 0);
  return new Date(localNext.getTime() - offsetMinutes * 60_000);
}

type DaySeriesRow = {
  day_local: string;
  qty: bigint;
  revenue_cents: bigint;
  margin_cents: bigint;
};

type TopRow = {
  product_id: string;
  name: string;
  sku: string;
  qty: bigint;
  revenue_cents: bigint;
  margin_cents: bigint;
};

function readJsonObj(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function numFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, product: null, range: null, series: [], top: [] });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    productId: url.searchParams.get("productId") ?? undefined,
    fromDay: url.searchParams.get("fromDay") ?? undefined,
    toDay: url.searchParams.get("toDay") ?? undefined,
    top: url.searchParams.get("top") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const storeId = session.storeId;
  const offsetMinutes = storeTzOffsetMinutes();
  const offsetInterval = `${offsetMinutes} minutes`;

  const now = new Date();
  const defaultToDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const defaultFromDate = new Date(now);
  defaultFromDate.setDate(defaultFromDate.getDate() - 89);
  const defaultFromDay = `${defaultFromDate.getFullYear()}-${String(defaultFromDate.getMonth() + 1).padStart(2, "0")}-${String(defaultFromDate.getDate()).padStart(2, "0")}`;

  const fromDay = parsed.data.fromDay ?? defaultFromDay;
  const toDay = parsed.data.toDay ?? defaultToDay;
  if (fromDay > toDay) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const fromUtc = localDayStartUtc(fromDay);
  const toUtcExclusive = localDayEndExclusiveUtc(toDay);
  if (!fromUtc || !toUtcExclusive) {
    return NextResponse.json({ error: "INVALID_DAY" }, { status: 400 });
  }

  const msPerDay = 86_400_000;
  const spanDays = Math.ceil((toUtcExclusive.getTime() - fromUtc.getTime()) / msPerDay);
  if (spanDays > 370) {
    return NextResponse.json({ error: "RANGE_TOO_LARGE" }, { status: 400 });
  }

  try {
    const productId = parsed.data.productId ?? null;

    if (productId) {
      const product = await prisma.product.findFirst({
        where: { id: productId, storeId },
        select: {
          id: true,
          sku: true,
          name: true,
          priceCents: true,
          priceUsdCents: true,
          unitsPerBox: true,
          wholesaleCupCents: true,
          costCents: true,
          supplierName: true,
          stockQty: true,
          lowStockAt: true,
          active: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!product) {
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      }

      const series = await prisma.$queryRaw<DaySeriesRow[]>`
        SELECT
          to_char(date_trunc('day', (s."completedAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS day_local,
          COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
          COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue_cents,
          COALESCE(SUM(
            CASE
              WHEN p."costCents" IS NOT NULL THEN (sl."subtotalCents" - (p."costCents" * sl."quantity"))
              ELSE 0
            END
          ), 0)::bigint AS margin_cents
        FROM "Sale" s
        JOIN "SaleLine" sl ON sl."saleId" = s.id
        JOIN "Product" p ON p.id = sl."productId"
        WHERE s."storeId" = ${storeId}
          AND s."status" = 'COMPLETED'
          AND sl."productId" = ${productId}
          AND s."completedAt" >= ${fromUtc}
          AND s."completedAt" < ${toUtcExclusive}
        GROUP BY 1
        ORDER BY 1 ASC
      `;

      const totals = series.reduce(
        (acc, r) => {
          acc.qty += Number(r.qty ?? BigInt(0));
          acc.revenueCents += Number(r.revenue_cents ?? BigInt(0));
          acc.marginCents += Number(r.margin_cents ?? BigInt(0));
          return acc;
        },
        { qty: 0, revenueCents: 0, marginCents: 0 },
      );

      const distinctSales = await prisma.sale.count({
        where: {
          storeId,
          status: "COMPLETED",
          completedAt: { gte: fromUtc, lt: toUtcExclusive },
          lines: { some: { productId } },
        },
      });

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          storeId,
          entityType: "Product",
          entityId: productId,
          action: { in: ["PRODUCT_UPDATE", "PRODUCT_UPDATE_STOCK", "PRODUCT_RESTORE", "PRODUCT_CREATE"] },
          createdAt: { gte: fromUtc, lt: toUtcExclusive },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, action: true, createdAt: true, before: true, after: true, meta: true },
      });

      const pricePoints: {
        at: string;
        action: string;
        priceCents: number | null;
        priceUsdCents: number | null;
        costCents: number | null;
        wholesaleCupCents: number | null;
      }[] = [];

      for (const a of auditLogs) {
        const after = readJsonObj(a.after);
        if (!after) continue;
        pricePoints.push({
          at: a.createdAt.toISOString(),
          action: a.action,
          priceCents: numFromUnknown(after.priceCents),
          priceUsdCents: numFromUnknown(after.priceUsdCents),
          costCents: numFromUnknown(after.costCents),
          wholesaleCupCents: numFromUnknown(after.wholesaleCupCents),
        });
      }

      const inventory = await prisma.inventoryMovement.findMany({
        where: { storeId, productId, createdAt: { gte: fromUtc, lt: toUtcExclusive } },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true,
          createdAt: true,
          delta: true,
          beforeQty: true,
          afterQty: true,
          reason: true,
          actorType: true,
          actorId: true,
        },
      });

      const firstInboundGlobal = await prisma.inventoryMovement.findFirst({
        where: { storeId, productId, delta: { gt: 0 } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, delta: true, reason: true, afterQty: true },
      });

      return NextResponse.json({
        meta: {
          dbAvailable: true as const,
          tzOffsetMinutes: offsetMinutes,
          note:
            "Margen aproximado usa costCents actual del catálogo × unidades vendidas históricas (no reconstruye coste histórico).",
        },
        range: { fromDay, toDay, fromUtc: fromUtc.toISOString(), toUtcExclusive: toUtcExclusive.toISOString() },
        product,
        kpis: {
          unitsSold: totals.qty,
          revenueCents: totals.revenueCents,
          marginCentsApprox: totals.marginCents,
          salesCount: distinctSales,
        },
        series: series.map((r) => ({
          day: r.day_local,
          units: Number(r.qty ?? BigInt(0)),
          revenueCents: Number(r.revenue_cents ?? BigInt(0)),
          marginCentsApprox: Number(r.margin_cents ?? BigInt(0)),
        })),
        priceHistory: pricePoints,
        inventoryMovements: inventory,
        milestones: {
          productCreatedAt: product.createdAt.toISOString(),
          firstStockIncreaseAt: firstInboundGlobal?.createdAt.toISOString() ?? null,
        },
        top: [],
      });
    }

    const top = await prisma.$queryRaw<TopRow[]>`
      SELECT
        p.id AS product_id,
        p.name AS name,
        p.sku AS sku,
        COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
        COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue_cents,
        COALESCE(SUM(
          CASE
            WHEN p."costCents" IS NOT NULL THEN (sl."subtotalCents" - (p."costCents" * sl."quantity"))
            ELSE 0
          END
        ), 0)::bigint AS margin_cents
      FROM "Sale" s
      JOIN "SaleLine" sl ON sl."saleId" = s.id
      JOIN "Product" p ON p.id = sl."productId"
      WHERE s."storeId" = ${storeId}
        AND s."status" = 'COMPLETED'
        AND s."completedAt" >= ${fromUtc}
        AND s."completedAt" < ${toUtcExclusive}
      GROUP BY p.id, p.name, p.sku
      ORDER BY revenue_cents DESC, qty DESC, name ASC
      LIMIT ${parsed.data.top}
    `;

    const totalsAll = top.reduce(
      (acc, r) => {
        acc.units += Number(r.qty ?? BigInt(0));
        acc.revenueCents += Number(r.revenue_cents ?? BigInt(0));
        acc.marginCents += Number(r.margin_cents ?? BigInt(0));
        return acc;
      },
      { units: 0, revenueCents: 0, marginCents: 0 },
    );

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        tzOffsetMinutes: offsetMinutes,
        note:
          "Vista agregada: ranking por ingresos (subtotal) en el rango. Margen es aproximado por coste actual del catálogo.",
      },
      range: { fromDay, toDay, fromUtc: fromUtc.toISOString(), toUtcExclusive: toUtcExclusive.toISOString() },
      product: null,
      kpis: {
        unitsSoldTopN: totalsAll.units,
        revenueCentsTopN: totalsAll.revenueCents,
        marginCentsApproxTopN: totalsAll.marginCents,
      },
      series: [],
      priceHistory: [],
      inventoryMovements: [],
      milestones: {},
      top: top.map((r) => ({
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        units: Number(r.qty ?? BigInt(0)),
        revenueCents: Number(r.revenue_cents ?? BigInt(0)),
        marginCentsApprox: Number(r.margin_cents ?? BigInt(0)),
      })),
    });
  } catch (err) {
    console.error("[api/admin/products/insights]", err);
    return NextResponse.json(
      {
        meta: { dbAvailable: false as const, message: err instanceof Error ? err.message : "DB" },
        product: null,
        range: { fromDay, toDay },
        series: [],
        top: [],
      },
      { status: 200 },
    );
  }
}
