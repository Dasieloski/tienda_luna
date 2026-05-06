import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  supplierId: z.string().min(1).optional(),
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

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, range: null, suppliers: [], transferPoolCents: 0 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    supplierId: url.searchParams.get("supplierId") ?? undefined,
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const fromD = new Date(parsed.data.from);
  const toD = new Date(parsed.data.to);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (fromD > toD) return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });

  const from = startOfDay(fromD);
  const toExclusive = addDays(startOfDay(toD), 1);
  const storeId = guard.session.storeId;
  const supplierId = parsed.data.supplierId ?? null;

  type Row = {
    supplier_id: string | null;
    supplier_name: string;
    sales_cost_cents: bigint;
    sales_retail_cents: bigint;
    payments_cents: bigint;
    withdrawals_cost_cents: bigint;
    withdrawals_retail_cents: bigint;
    balance_pending_cents: bigint;
    pending_in_range_cents: bigint;
  };

  // Bolsa de transferencias: total transfer recibido por la tienda en el rango (por pagos persistidos).
  // Nota: se usa `paidAt` porque representa cuándo entró el dinero, no necesariamente cuándo se completó la venta.
  const transferPool = await prisma.$queryRaw<{ transfer_cents: bigint }[]>`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%trans%'
            OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%bank%'
            OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%banco%'
          THEN sp."amountCupCents"
          ELSE 0
        END
      ), 0)::bigint AS transfer_cents
    FROM "SalePayment" sp
    INNER JOIN "Sale" s ON s.id = sp."saleId"
    WHERE sp."storeId" = ${storeId}
      AND sp."paidAt" >= ${from}
      AND sp."paidAt" < ${toExclusive}
      AND s."status" = 'COMPLETED'
  `;

  // Pendiente (rolling) = ventas a costo - pagos - retiros a costo
  // Nota: ventas a costo usan snapshot SaleLine.unitCostCents y, si falta (ventas antiguas), Product.costCents.
  const rows = await prisma.$queryRaw<Row[]>`
    WITH sales AS (
      SELECT
        p."supplierId" AS supplier_id,
        COALESCE(su.name, p."supplierName", 'Sin proveedor') AS supplier_name,
        COALESCE(SUM(CASE WHEN COALESCE(sl."unitCostCents", p."costCents") IS NULL THEN 0 ELSE COALESCE(sl."unitCostCents", p."costCents") * sl.quantity END),0)::bigint AS sales_cost_cents,
        COALESCE(SUM(sl."subtotalCents"),0)::bigint AS sales_retail_cents
      FROM "Sale" s
      JOIN "SaleLine" sl ON sl."saleId" = s.id
      JOIN "Product" p ON p.id = sl."productId"
      LEFT JOIN "Supplier" su ON su.id = p."supplierId"
      WHERE s."storeId" = ${storeId}
        AND s."status" = 'COMPLETED'
        AND s."completedAt" >= ${from}
        AND s."completedAt" < ${toExclusive}
        AND (${supplierId}::text IS NULL OR p."supplierId" = ${supplierId})
      GROUP BY 1,2
    ),
    payments AS (
      SELECT
        dp."supplierId" AS supplier_id,
        COALESCE(SUM(dp."amountCents"),0)::bigint AS payments_cents
      FROM "SupplierDebtPayment" dp
      WHERE dp."storeId" = ${storeId}
        AND dp."paidAt" >= ${from}
        AND dp."paidAt" < ${toExclusive}
        AND (${supplierId}::text IS NULL OR dp."supplierId" = ${supplierId})
      GROUP BY 1
    ),
    withdrawals AS (
      SELECT
        w."supplierId" AS supplier_id,
        COALESCE(SUM(w."totalCostCents"),0)::bigint AS withdrawals_cost_cents,
        COALESCE(SUM(w."totalRetailCents"),0)::bigint AS withdrawals_retail_cents
      FROM "SupplierWithdrawal" w
      WHERE w."storeId" = ${storeId}
        AND w."createdAt" >= ${from}
        AND w."createdAt" < ${toExclusive}
        AND (${supplierId}::text IS NULL OR w."supplierId" = ${supplierId})
      GROUP BY 1
    ),
    balance AS (
      SELECT
        p."supplierId" AS supplier_id,
        COALESCE(SUM(CASE WHEN COALESCE(sl."unitCostCents", p."costCents") IS NULL THEN 0 ELSE COALESCE(sl."unitCostCents", p."costCents") * sl.quantity END),0)::bigint
        - COALESCE((SELECT SUM(dp."amountCents") FROM "SupplierDebtPayment" dp WHERE dp."storeId"=${storeId} AND dp."supplierId"=p."supplierId"),0)::bigint
        - COALESCE((SELECT SUM(w."totalCostCents") FROM "SupplierWithdrawal" w WHERE w."storeId"=${storeId} AND w."supplierId"=p."supplierId"),0)::bigint
        AS balance_pending_cents
      FROM "Sale" s
      JOIN "SaleLine" sl ON sl."saleId" = s.id
      JOIN "Product" p ON p.id = sl."productId"
      WHERE s."storeId" = ${storeId}
        AND s."status" = 'COMPLETED'
        AND (${supplierId}::text IS NULL OR p."supplierId" = ${supplierId})
      GROUP BY 1
    )
    SELECT
      s.supplier_id,
      s.supplier_name,
      s.sales_cost_cents,
      s.sales_retail_cents,
      COALESCE(p.payments_cents,0)::bigint AS payments_cents,
      COALESCE(w.withdrawals_cost_cents,0)::bigint AS withdrawals_cost_cents,
      COALESCE(w.withdrawals_retail_cents,0)::bigint AS withdrawals_retail_cents,
      COALESCE(b.balance_pending_cents,0)::bigint AS balance_pending_cents,
      (
        s.sales_cost_cents
        - COALESCE(p.payments_cents,0)::bigint
        - COALESCE(w.withdrawals_cost_cents,0)::bigint
      )::bigint AS pending_in_range_cents
    FROM sales s
    LEFT JOIN payments p ON p.supplier_id = s.supplier_id
    LEFT JOIN withdrawals w ON w.supplier_id = s.supplier_id
    LEFT JOIN balance b ON b.supplier_id = s.supplier_id
    ORDER BY balance_pending_cents DESC, sales_cost_cents DESC, supplier_name ASC
  `;

  return NextResponse.json({
    meta: { dbAvailable: true as const },
    range: { from: parsed.data.from, to: parsed.data.to },
    supplierId,
    transferPoolCents: Number(transferPool?.[0]?.transfer_cents ?? BigInt(0)),
    suppliers: rows.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      window: {
        salesCostCents: Number(r.sales_cost_cents ?? BigInt(0)),
        salesRetailCents: Number(r.sales_retail_cents ?? BigInt(0)),
        paymentsCents: Number(r.payments_cents ?? BigInt(0)),
        withdrawalsCostCents: Number(r.withdrawals_cost_cents ?? BigInt(0)),
        withdrawalsRetailCents: Number(r.withdrawals_retail_cents ?? BigInt(0)),
      },
      pendingCents: Number(r.balance_pending_cents ?? BigInt(0)),
      pendingInRangeCents: Number(r.pending_in_range_cents ?? BigInt(0)),
    })),
  });
}

