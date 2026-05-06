import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  supplierId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

type Row = {
  product_id: string;
  name: string;
  sku: string;
  unit_price_cents: bigint;
  cost_cents: bigint | null;
  qty: bigint;
  revenue_cents: bigint;
  payable_cents: bigint;
  lines_missing_cost: bigint;
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, totals: null, rows: [] });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    supplierId: url.searchParams.get("supplierId") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
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

  try {
    const sup = await prisma.supplier.findFirst({
      where: { id: parsed.data.supplierId, storeId: session.storeId },
      select: { name: true },
    });
    if (!sup) {
      return NextResponse.json({ error: "SUPPLIER_NOT_FOUND" }, { status: 404 });
    }
    const supplierName = sup.name;

    const rows = await prisma.$queryRaw<Row[]>`
      WITH base AS (
        SELECT
          p.id AS product_id,
          p.name AS name,
          p.sku AS sku,
          sl."unitPriceCents" AS unit_price_cents,
          COALESCE(sl."unitCostCents", p."costCents") AS cost_cents,
          sl.quantity AS quantity,
          sl."subtotalCents" AS revenue_cents
        FROM "Sale" s
        JOIN "SaleLine" sl ON sl."saleId" = s.id
        JOIN "Product" p ON p.id = sl."productId"
        WHERE s."storeId" = ${session.storeId}
          AND s."status" = 'COMPLETED'
          AND s."completedAt" >= ${from}
          AND s."completedAt" < ${toExclusive}
          AND (
            p."supplierId" = ${parsed.data.supplierId}
            OR (p."supplierId" IS NULL AND p."supplierName" = ${supplierName})
          )
      )
      SELECT
        product_id,
        name,
        sku,
        unit_price_cents,
        cost_cents,
        COALESCE(SUM(quantity), 0)::bigint AS qty,
        COALESCE(SUM(revenue_cents), 0)::bigint AS revenue_cents,
        COALESCE(SUM(CASE WHEN cost_cents IS NULL THEN 0 ELSE cost_cents * quantity END), 0)::bigint AS payable_cents,
        COALESCE(SUM(CASE WHEN cost_cents IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_missing_cost
      FROM base
      GROUP BY product_id, name, sku, unit_price_cents, cost_cents
      ORDER BY payable_cents DESC, revenue_cents DESC, name ASC
    `;

    const outRows = rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku,
      units: Number(r.qty ?? BigInt(0)),
      unitPriceCents: Number(r.unit_price_cents ?? BigInt(0)),
      costCents: r.cost_cents == null ? null : Number(r.cost_cents),
      revenueCents: Number(r.revenue_cents ?? BigInt(0)),
      payableCents: Number(r.payable_cents ?? BigInt(0)),
      linesMissingCost: Number(r.lines_missing_cost ?? BigInt(0)),
    }));

    const totals = outRows.reduce(
      (acc, r) => {
        acc.units += r.units;
        acc.revenueCents += r.revenueCents;
        acc.payableCents += r.payableCents;
        acc.linesMissingCost += r.linesMissingCost;
        return acc;
      },
      { units: 0, revenueCents: 0, payableCents: 0, linesMissingCost: 0 },
    );

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      range: { from: parsed.data.from, to: parsed.data.to },
      supplierId: parsed.data.supplierId,
      totals,
      rows: outRows,
      note:
        "A pagar = costo proveedor × unidades. Se usa el snapshot de coste en la venta (SaleLine.unitCostCents) y, si falta (ventas antiguas), se usa el coste actual del producto (Product.costCents).",
    });
  } catch (err) {
    console.error("[api/admin/suppliers/payable-detail]", err);
    return NextResponse.json(
      { meta: { dbAvailable: false as const, message: err instanceof Error ? err.message : "DB" }, totals: null, rows: [] },
      { status: 200 },
    );
  }
}

