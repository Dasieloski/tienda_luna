import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeInactiveSuppliers: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v === "1" || v.toLowerCase() === "true")),
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

type ProductMatrixRowRaw = {
  product_id: string;
  name: string;
  sku: string;
  supplier_id: string | null;
  supplier_name: string | null;
  stock_qty: bigint;
  low_stock_at: bigint;
  units_per_box: bigint;
  price_cents: bigint;
  catalog_cost_cents: bigint | null;
  qty_total: bigint;
  revenue_cents: bigint;
  revenue_cash_cents: bigint;
  revenue_transfer_cents: bigint;
  cost_cents: bigint;
  profit_cents: bigint;
  revenue_cost_known_cents: bigint;
  profit_cost_known_cents: bigint;
  lines_missing_cost: bigint;
};

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false as const },
      range: null,
      suppliers: [],
      rows: [],
      totals: {
        qtyTotal: 0,
        revenueCents: 0,
        revenueCashCents: 0,
        revenueTransferCents: 0,
        costCents: 0,
        profitCents: 0,
        linesMissingCost: 0,
        bySupplierPayableCents: {} as Record<string, number>,
        bySupplierMissingCostLines: {} as Record<string, number>,
      },
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    includeInactiveSuppliers: url.searchParams.get("includeInactiveSuppliers") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const fromD = new Date(parsed.data.from);
  const toD = new Date(parsed.data.to);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (fromD > toD) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const from = startOfDay(fromD);
  const toExclusive = addDays(startOfDay(toD), 1);
  const includeInactiveSuppliers = parsed.data.includeInactiveSuppliers ?? true;

  try {
    const suppliers = await prisma.supplier.findMany({
      where: { storeId: guard.session.storeId, ...(includeInactiveSuppliers ? {} : { active: true }) },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    });

    const rowsRaw = await prisma.$queryRaw<ProductMatrixRowRaw[]>`
      WITH products_base AS (
        SELECT
          p.id AS product_id,
          p.name,
          p.sku,
          p."supplierId" AS supplier_id,
          COALESCE(su.name, p."supplierName") AS supplier_name,
          p."stockQty"::bigint AS stock_qty,
          p."lowStockAt"::bigint AS low_stock_at,
          p."unitsPerBox"::bigint AS units_per_box,
          p."priceCents"::bigint AS price_cents,
          p."costCents"::bigint AS catalog_cost_cents
        FROM "Product" p
        LEFT JOIN "Supplier" su ON su.id = p."supplierId"
        WHERE p."storeId" = ${guard.session.storeId}
          AND p."deletedAt" IS NULL
      ),
      sales_in_range AS (
        SELECT s.id AS sale_id
        FROM "Sale" s
        WHERE s."storeId" = ${guard.session.storeId}
          AND s."status" = 'COMPLETED'
          AND s."completedAt" >= ${from}
          AND s."completedAt" < ${toExclusive}
      ),
      pay_by_sale AS (
        SELECT
          sp."saleId" AS sale_id,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%trans%'
                OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%bank%'
                OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%banco%'
              THEN sp."amountCupCents"
              ELSE 0
            END
          ), 0)::bigint AS transfer_cents,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%trans%'
                OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%bank%'
                OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%banco%'
              THEN 0
              ELSE sp."amountCupCents"
            END
          ), 0)::bigint AS cash_cents
        FROM "SalePayment" sp
        INNER JOIN sales_in_range r ON r.sale_id = sp."saleId"
        WHERE sp."storeId" = ${guard.session.storeId}
        GROUP BY sp."saleId"
      ),
      sale_totals AS (
        SELECT
          sl."saleId" AS sale_id,
          COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS sale_subtotal_cents
        FROM "SaleLine" sl
        INNER JOIN sales_in_range r ON r.sale_id = sl."saleId"
        GROUP BY sl."saleId"
      ),
      base_lines AS (
        SELECT
          sl."saleId" AS sale_id,
          p.id AS product_id,
          pb.name,
          pb.sku,
          pb.supplier_id,
          pb.supplier_name,
          sl.quantity AS qty,
          sl."subtotalCents" AS revenue_cents,
          sl."unitPriceCents" AS unit_price_cents,
          COALESCE(sl."unitCostCents", p."costCents") AS cost_cents
        FROM "SaleLine" sl
        INNER JOIN sales_in_range r ON r.sale_id = sl."saleId"
        INNER JOIN "Product" p ON p.id = sl."productId"
        INNER JOIN products_base pb ON pb.product_id = p.id
        WHERE sl."productId" IS NOT NULL
      ),
      agg_by_product AS (
        SELECT
          bl.product_id,
          bl.name,
          bl.sku,
          bl.supplier_id,
          bl.supplier_name,
          COALESCE(SUM(bl.qty), 0)::bigint AS qty_total,
          COALESCE(SUM(bl.revenue_cents), 0)::bigint AS revenue_cents,
          COALESCE(SUM(
            CASE
              WHEN pay.sale_id IS NULL THEN bl.revenue_cents
              WHEN (pay.cash_cents + pay.transfer_cents) > 0
              THEN ROUND((bl.revenue_cents::numeric * pay.cash_cents::numeric) / (pay.cash_cents + pay.transfer_cents)::numeric)
              ELSE bl.revenue_cents
            END
          ), 0)::bigint AS revenue_cash_cents,
          COALESCE(SUM(
            CASE
              WHEN pay.sale_id IS NULL THEN 0
              WHEN (pay.cash_cents + pay.transfer_cents) > 0
              THEN ROUND((bl.revenue_cents::numeric * pay.transfer_cents::numeric) / (pay.cash_cents + pay.transfer_cents)::numeric)
              ELSE 0
            END
          ), 0)::bigint AS revenue_transfer_cents,
          COALESCE(SUM(
            CASE
              WHEN bl.cost_cents IS NULL THEN 0
              ELSE bl.cost_cents * bl.qty
            END
          ), 0)::bigint AS cost_cents,
          COALESCE(SUM(
            CASE
              WHEN bl.cost_cents IS NULL THEN 0
              ELSE (bl.unit_price_cents - bl.cost_cents) * bl.qty
            END
          ), 0)::bigint AS profit_cents,
          COALESCE(SUM(
            CASE
              WHEN bl.cost_cents IS NULL THEN 0
              ELSE bl.revenue_cents
            END
          ), 0)::bigint AS revenue_cost_known_cents,
          COALESCE(SUM(
            CASE
              WHEN bl.cost_cents IS NULL THEN 0
              ELSE (bl.unit_price_cents - bl.cost_cents) * bl.qty
            END
          ), 0)::bigint AS profit_cost_known_cents,
          COALESCE(SUM(CASE WHEN bl.cost_cents IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_missing_cost
        FROM base_lines bl
        INNER JOIN sale_totals st ON st.sale_id = bl.sale_id
        LEFT JOIN pay_by_sale pay ON pay.sale_id = bl.sale_id
        GROUP BY bl.product_id, bl.name, bl.sku, bl.supplier_id, bl.supplier_name
      )
      SELECT
        pb.product_id,
        pb.name,
        pb.sku,
        pb.supplier_id,
        pb.supplier_name,
        pb.stock_qty,
        pb.low_stock_at,
        pb.units_per_box,
        pb.price_cents,
        pb.catalog_cost_cents,
        COALESCE(a.qty_total, 0)::bigint AS qty_total,
        COALESCE(a.revenue_cents, 0)::bigint AS revenue_cents,
        COALESCE(a.revenue_cash_cents, 0)::bigint AS revenue_cash_cents,
        COALESCE(a.revenue_transfer_cents, 0)::bigint AS revenue_transfer_cents,
        COALESCE(a.cost_cents, 0)::bigint AS cost_cents,
        COALESCE(a.profit_cents, 0)::bigint AS profit_cents,
        COALESCE(a.revenue_cost_known_cents, 0)::bigint AS revenue_cost_known_cents,
        COALESCE(a.profit_cost_known_cents, 0)::bigint AS profit_cost_known_cents,
        COALESCE(a.lines_missing_cost, 0)::bigint AS lines_missing_cost
      FROM products_base pb
      LEFT JOIN agg_by_product a ON a.product_id = pb.product_id
      ORDER BY pb.name ASC
    `;

    const supplierIds = suppliers.map((s) => s.id);
    const totalsBySupplierPayable: Record<string, number> = Object.fromEntries(supplierIds.map((id) => [id, 0]));
    const totalsBySupplierMissingCostLines: Record<string, number> = Object.fromEntries(supplierIds.map((id) => [id, 0]));

    const rows = rowsRaw.map((r) => {
      const qtyTotal = Number(r.qty_total ?? BigInt(0));
      const revenueCents = Number(r.revenue_cents ?? BigInt(0));
      const revenueCashCents = Number(r.revenue_cash_cents ?? BigInt(0));
      const revenueTransferCents = Number(r.revenue_transfer_cents ?? BigInt(0));
      const costCents = Number(r.cost_cents ?? BigInt(0));
      const profitCents = Number(r.profit_cents ?? BigInt(0));
      const revenueCostKnownCents = Number(r.revenue_cost_known_cents ?? BigInt(0));
      const profitCostKnownCents = Number(r.profit_cost_known_cents ?? BigInt(0));
      const linesMissingCost = Number(r.lines_missing_cost ?? BigInt(0));
      const stockQty = Number(r.stock_qty ?? BigInt(0));
      const lowStockAt = Number(r.low_stock_at ?? BigInt(0));
      const unitsPerBox = Number(r.units_per_box ?? BigInt(1));
      const priceCents = Number(r.price_cents ?? BigInt(0));
      const catalogCostCents = r.catalog_cost_cents == null ? null : Number(r.catalog_cost_cents);

      const marginPct =
        revenueCostKnownCents > 0 ? (profitCostKnownCents / revenueCostKnownCents) * 100 : null;

      const bySupplierPayableCents: Record<string, number> = {};
      const bySupplierMissingCostLines: Record<string, number> = {};

      if (r.supplier_id) {
        bySupplierPayableCents[r.supplier_id] = costCents;
        bySupplierMissingCostLines[r.supplier_id] = linesMissingCost;
        if (totalsBySupplierPayable[r.supplier_id] != null) totalsBySupplierPayable[r.supplier_id] += costCents;
        if (totalsBySupplierMissingCostLines[r.supplier_id] != null) totalsBySupplierMissingCostLines[r.supplier_id] += linesMissingCost;
      }

      return {
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        stockQty,
        lowStockAt,
        unitsPerBox,
        priceCents,
        catalogCostCents,
        qtyTotal,
        revenueCents,
        revenueCashCents,
        revenueTransferCents,
        costCents,
        profitCents,
        marginPct,
        linesMissingCost,
        bySupplierPayableCents,
        bySupplierMissingCostLines,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.qtyTotal += r.qtyTotal;
        acc.revenueCents += r.revenueCents;
        acc.revenueCashCents += r.revenueCashCents;
        acc.revenueTransferCents += r.revenueTransferCents;
        acc.costCents += r.costCents;
        acc.profitCents += r.profitCents;
        acc.linesMissingCost += r.linesMissingCost;
        return acc;
      },
      {
        qtyTotal: 0,
        revenueCents: 0,
        revenueCashCents: 0,
        revenueTransferCents: 0,
        costCents: 0,
        profitCents: 0,
        linesMissingCost: 0,
      },
    );

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      range: { from: parsed.data.from, to: parsed.data.to },
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, active: s.active })),
      rows,
      totals: {
        ...totals,
        bySupplierPayableCents: totalsBySupplierPayable,
        bySupplierMissingCostLines: totalsBySupplierMissingCostLines,
      },
    });
  } catch (err) {
    console.error("[api/admin/suppliers/product-matrix]", err);
    return NextResponse.json(
      {
        meta: { dbAvailable: false as const, message: err instanceof Error ? err.message : "DB" },
        range: { from: parsed.data.from, to: parsed.data.to },
        suppliers: [],
        rows: [],
        totals: {
          qtyTotal: 0,
          revenueCents: 0,
          revenueCashCents: 0,
          revenueTransferCents: 0,
          costCents: 0,
          profitCents: 0,
          linesMissingCost: 0,
          bySupplierPayableCents: {} as Record<string, number>,
          bySupplierMissingCostLines: {} as Record<string, number>,
        },
      },
      { status: 200 },
    );
  }
}

