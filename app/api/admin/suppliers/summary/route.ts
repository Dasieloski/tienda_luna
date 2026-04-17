import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { cacheGetOrSet } from "@/lib/ttl-cache";

const querySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z
      .string()
      .optional()
      .transform((v) => (v == null || v === "" ? undefined : Number(v)))
      .pipe(z.number().int().min(1).max(365).optional()),
  })
  .refine((v) => !(v.from && !v.to) && !(!v.from && v.to), {
    message: "from/to deben venir juntos",
  });

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

type SupplierRow = {
  supplier: string;
  products: number;
  units: number;
  revenueCents: number;
  profitCents: number;
  /** Coste proveedor × uds vendidas (líneas con precio de compra en ficha). */
  payableCents: number;
  linesMissingCost: number;
};

type SupplierTopProduct = {
  supplier: string;
  productId: string;
  name: string;
  sku: string;
  units: number;
  revenueCents: number;
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false as const },
      from: null,
      to: null,
      suppliers: [] as SupplierRow[],
      topProducts: [] as SupplierTopProduct[],
      totals: {
        payableCents: 0,
        revenueCents: 0,
        units: 0,
        linesMissingCost: 0,
      },
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  let from: Date;
  let to: Date;

  if (parsed.data.from && parsed.data.to) {
    const fromD = new Date(parsed.data.from);
    const toD = new Date(parsed.data.to);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
    }
    from = startOfDay(fromD);
    // `to` es inclusivo a nivel de UI (fecha). En SQL usamos límite exclusivo.
    to = addDays(startOfDay(toD), 1);
  } else {
    const days = parsed.data.days ?? 30;
    const today = startOfDay(new Date());
    from = addDays(today, -days + 1);
    to = addDays(today, 1);
  }

  try {
    const key = `suppliers:${session.storeId}:${from.toISOString()}:${to.toISOString()}`;
    const out = await cacheGetOrSet(key, 30_000, async () => {
      const suppliersRaw = await prisma.$queryRaw<
        {
          supplier: string;
          products: bigint;
          units: bigint;
          revenue_cents: bigint;
          profit_cents: bigint;
          payable_cents: bigint;
          lines_missing_cost: bigint;
        }[]
      >`
        WITH base AS (
          SELECT
            COALESCE(su.name, p."supplierName", 'Sin proveedor') AS supplier,
            p.id AS product_id,
            p.name,
            p.sku,
            p."costCents" AS cost_cents,
            sl.quantity,
            sl."unitPriceCents" AS unit_price_cents,
            sl."subtotalCents" AS revenue_cents
          FROM "Sale" s
          JOIN "SaleLine" sl ON sl."saleId" = s.id
          JOIN "Product" p ON p.id = sl."productId"
          LEFT JOIN "Supplier" su ON su.id = p."supplierId"
          WHERE s."storeId" = ${session.storeId}
            AND s."status" = 'COMPLETED'
            AND s."completedAt" >= ${from}
            AND s."completedAt" < ${to}
        )
        SELECT
          supplier,
          COUNT(DISTINCT product_id)::bigint AS products,
          COALESCE(SUM(quantity), 0)::bigint AS units,
          COALESCE(SUM(revenue_cents), 0)::bigint AS revenue_cents,
          COALESCE(SUM(
            CASE
              WHEN cost_cents IS NULL THEN 0
              ELSE (unit_price_cents - cost_cents) * quantity
            END
          ), 0)::bigint AS profit_cents,
          COALESCE(SUM(
            CASE
              WHEN cost_cents IS NULL THEN 0
              ELSE cost_cents * quantity
            END
          ), 0)::bigint AS payable_cents,
          COALESCE(SUM(CASE WHEN cost_cents IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_missing_cost
        FROM base
        GROUP BY supplier
        ORDER BY revenue_cents DESC
      `;

      const topProductsRaw = await prisma.$queryRaw<
        {
          supplier: string;
          product_id: string;
          name: string;
          sku: string;
          units: bigint;
          revenue_cents: bigint;
        }[]
      >`
        WITH base AS (
          SELECT
            COALESCE(su.name, p."supplierName", 'Sin proveedor') AS supplier,
            p.id AS product_id,
            p.name,
            p.sku,
            sl.quantity,
            sl."subtotalCents" AS revenue_cents
          FROM "Sale" s
          JOIN "SaleLine" sl ON sl."saleId" = s.id
          JOIN "Product" p ON p.id = sl."productId"
          LEFT JOIN "Supplier" su ON su.id = p."supplierId"
          WHERE s."storeId" = ${session.storeId}
            AND s."status" = 'COMPLETED'
            AND s."completedAt" >= ${from}
            AND s."completedAt" < ${to}
        ),
        agg AS (
          SELECT
            supplier,
            product_id,
            name,
            sku,
            COALESCE(SUM(quantity), 0)::bigint AS units,
            COALESCE(SUM(revenue_cents), 0)::bigint AS revenue_cents,
            ROW_NUMBER() OVER (
              PARTITION BY supplier
              ORDER BY COALESCE(SUM(revenue_cents), 0) DESC, COALESCE(SUM(quantity), 0) DESC
            ) AS rn
          FROM base
          GROUP BY supplier, product_id, name, sku
        )
        SELECT supplier, product_id, name, sku, units, revenue_cents
        FROM agg
        WHERE rn <= 5
        ORDER BY supplier, revenue_cents DESC
      `;

      const suppliers: SupplierRow[] = suppliersRaw.map((r) => ({
        supplier: r.supplier,
        products: Number(r.products ?? BigInt(0)),
        units: Number(r.units ?? BigInt(0)),
        revenueCents: Number(r.revenue_cents ?? BigInt(0)),
        profitCents: Number(r.profit_cents ?? BigInt(0)),
        payableCents: Number(r.payable_cents ?? BigInt(0)),
        linesMissingCost: Number(r.lines_missing_cost ?? BigInt(0)),
      }));

      const totals = suppliers.reduce(
        (acc, s) => ({
          payableCents: acc.payableCents + s.payableCents,
          revenueCents: acc.revenueCents + s.revenueCents,
          units: acc.units + s.units,
          linesMissingCost: acc.linesMissingCost + s.linesMissingCost,
        }),
        { payableCents: 0, revenueCents: 0, units: 0, linesMissingCost: 0 },
      );

      const topProducts: SupplierTopProduct[] = topProductsRaw.map((r) => ({
        supplier: r.supplier,
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        units: Number(r.units ?? BigInt(0)),
        revenueCents: Number(r.revenue_cents ?? BigInt(0)),
      }));

      return { suppliers, topProducts, totals };
    });

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      from: from.toISOString(),
      to: to.toISOString(),
      suppliers: out.suppliers,
      topProducts: out.topProducts,
      totals: out.totals,
    });
  } catch (err) {
    console.error("[api/admin/suppliers/summary]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false as const,
          message:
            err instanceof Error ? err.message : "No se pudo calcular el resumen de proveedores.",
        },
        from: from.toISOString(),
        to: to.toISOString(),
        suppliers: [] as SupplierRow[],
        topProducts: [] as SupplierTopProduct[],
        totals: {
          payableCents: 0,
          revenueCents: 0,
          units: 0,
          linesMissingCost: 0,
        },
      },
      { status: 200 },
    );
  }
}

