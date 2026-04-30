import type { PrismaClient } from "@prisma/client";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";

export type DailyReportRawRow = {
  product_id: string;
  name: string;
  sku: string;
  price_cents: number;
  price_usd_cents: number;
  qty: bigint;
  efectivo_cents: bigint;
  transfer_cents: bigint;
  usd_cents: bigint;
};

/** Informe diario con columnas nuevas de Product (tras prisma db push). */
async function queryDailyReportModern(
  prisma: PrismaClient,
  storeId: string,
  from: Date,
  to: Date,
): Promise<DailyReportRawRow[]> {
  return prisma.$queryRaw<DailyReportRawRow[]>`
    WITH pay_by_sale AS (
      SELECT
        sp."saleId" AS sale_id,
        COALESCE(SUM(
          CASE
            WHEN sp.currency::text = 'USD'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dolar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dólar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_cash%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_channel%'
            THEN sp."amountCupCents"
            ELSE 0
          END
        ), 0)::bigint AS usd_cents,
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
            WHEN sp.currency::text = 'USD'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dolar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dólar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_cash%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_channel%'
            THEN 0
            WHEN COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%trans%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%bank%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%banco%'
            THEN 0
            ELSE sp."amountCupCents"
          END
        ), 0)::bigint AS efectivo_cents
      FROM "SalePayment" sp
      INNER JOIN "Sale" s ON s.id = sp."saleId"
      WHERE sp."storeId" = ${storeId}
        AND sp."paidAt" >= ${from}
        AND sp."paidAt" < ${to}
        AND s.status = 'COMPLETED'
      GROUP BY sp."saleId"
    ),
    line_by_sale_product AS (
      SELECT
        sl."saleId" AS sale_id,
        sl."productId" AS product_id,
        COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
        COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS subtotal_cents
      FROM "SaleLine" sl
      WHERE sl."productId" IS NOT NULL
      GROUP BY sl."saleId", sl."productId"
    ),
    sale_totals AS (
      SELECT
        sale_id,
        COALESCE(SUM(subtotal_cents), 0)::bigint AS sale_subtotal_cents
      FROM line_by_sale_product
      GROUP BY sale_id
    )
    SELECT
      p.id AS product_id,
      p.name,
      p.sku,
      p."priceCents" AS price_cents,
      p."priceUsdCents" AS price_usd_cents,
      COALESCE(SUM(l.qty), 0)::bigint AS qty,
      COALESCE(SUM(
        CASE
          WHEN st.sale_subtotal_cents > 0
          THEN ROUND((l.subtotal_cents::numeric * pay.efectivo_cents::numeric) / st.sale_subtotal_cents::numeric)
          ELSE 0
        END
      ), 0)::bigint AS efectivo_cents,
      COALESCE(SUM(
        CASE
          WHEN st.sale_subtotal_cents > 0
          THEN ROUND((l.subtotal_cents::numeric * pay.transfer_cents::numeric) / st.sale_subtotal_cents::numeric)
          ELSE 0
        END
      ), 0)::bigint AS transfer_cents,
      COALESCE(SUM(
        CASE
          WHEN st.sale_subtotal_cents > 0
          THEN ROUND((l.subtotal_cents::numeric * pay.usd_cents::numeric) / st.sale_subtotal_cents::numeric)
          ELSE 0
        END
      ), 0)::bigint AS usd_cents
    FROM pay_by_sale pay
    INNER JOIN sale_totals st ON st.sale_id = pay.sale_id
    INNER JOIN line_by_sale_product l ON l.sale_id = pay.sale_id
    INNER JOIN "Product" p ON p.id = l.product_id
    GROUP BY p.id, p.name, p.sku, p."priceCents", p."priceUsdCents"
    ORDER BY p.name
  `;
}

/** Misma consulta sin `priceUsdCents` en Product (BD antigua). */
async function queryDailyReportLegacy(
  prisma: PrismaClient,
  storeId: string,
  from: Date,
  to: Date,
): Promise<DailyReportRawRow[]> {
  return prisma.$queryRaw<DailyReportRawRow[]>`
    WITH pay_by_sale AS (
      SELECT
        sp."saleId" AS sale_id,
        COALESCE(SUM(
          CASE
            WHEN sp.currency::text = 'USD'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dolar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dólar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_cash%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_channel%'
            THEN sp."amountCupCents"
            ELSE 0
          END
        ), 0)::bigint AS usd_cents,
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
            WHEN sp.currency::text = 'USD'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dolar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%dólar%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_cash%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%usd_channel%'
            THEN 0
            WHEN COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%trans%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%bank%'
              OR COALESCE(NULLIF(trim(sp.method), ''), '') ILIKE '%banco%'
            THEN 0
            ELSE sp."amountCupCents"
          END
        ), 0)::bigint AS efectivo_cents
      FROM "SalePayment" sp
      INNER JOIN "Sale" s ON s.id = sp."saleId"
      WHERE sp."storeId" = ${storeId}
        AND sp."paidAt" >= ${from}
        AND sp."paidAt" < ${to}
        AND s.status = 'COMPLETED'
      GROUP BY sp."saleId"
    ),
    line_by_sale_product AS (
      SELECT
        sl."saleId" AS sale_id,
        sl."productId" AS product_id,
        COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
        COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS subtotal_cents
      FROM "SaleLine" sl
      WHERE sl."productId" IS NOT NULL
      GROUP BY sl."saleId", sl."productId"
    ),
    sale_totals AS (
      SELECT
        sale_id,
        COALESCE(SUM(subtotal_cents), 0)::bigint AS sale_subtotal_cents
      FROM line_by_sale_product
      GROUP BY sale_id
    )
    SELECT
      p.id AS product_id,
      p.name,
      p.sku,
      p."priceCents" AS price_cents,
      0::int AS price_usd_cents,
      COALESCE(SUM(l.qty), 0)::bigint AS qty,
      COALESCE(SUM(
        CASE
          WHEN st.sale_subtotal_cents > 0
          THEN ROUND((l.subtotal_cents::numeric * pay.efectivo_cents::numeric) / st.sale_subtotal_cents::numeric)
          ELSE 0
        END
      ), 0)::bigint AS efectivo_cents,
      COALESCE(SUM(
        CASE
          WHEN st.sale_subtotal_cents > 0
          THEN ROUND((l.subtotal_cents::numeric * pay.transfer_cents::numeric) / st.sale_subtotal_cents::numeric)
          ELSE 0
        END
      ), 0)::bigint AS transfer_cents,
      COALESCE(SUM(
        CASE
          WHEN st.sale_subtotal_cents > 0
          THEN ROUND((l.subtotal_cents::numeric * pay.usd_cents::numeric) / st.sale_subtotal_cents::numeric)
          ELSE 0
        END
      ), 0)::bigint AS usd_cents
    FROM pay_by_sale pay
    INNER JOIN sale_totals st ON st.sale_id = pay.sale_id
    INNER JOIN line_by_sale_product l ON l.sale_id = pay.sale_id
    INNER JOIN "Product" p ON p.id = l.product_id
    GROUP BY p.id, p.name, p.sku, p."priceCents"
    ORDER BY p.name
  `;
}

export async function queryDailyReportRows(
  prisma: PrismaClient,
  storeId: string,
  from: Date,
  to: Date,
): Promise<DailyReportRawRow[]> {
  try {
    return await queryDailyReportModern(prisma, storeId, from, to);
  } catch (e) {
    if (!isMissingDbColumnError(e)) throw e;
    return queryDailyReportLegacy(prisma, storeId, from, to);
  }
}

export type DailyMarginAggRow = {
  revenue: bigint;
  cost: bigint;
  lines_with_cost: bigint;
  lines_without_cost: bigint;
};

/**
 * Ganancia del día (PVP en líneas − coste proveedor en catálogo), misma ventana temporal que el informe diario.
 * Solo ventas COMPLETED (cifra “limpia” alineada con Economía).
 */
export async function queryDailyMarginProfit(
  prisma: PrismaClient,
  storeId: string,
  from: Date,
  to: Date,
): Promise<DailyMarginAggRow[]> {
  return prisma.$queryRaw<DailyMarginAggRow[]>`
    SELECT
      COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN sl."subtotalCents" ELSE 0 END), 0)::bigint AS revenue,
      COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN p."costCents" * sl."quantity" ELSE 0 END), 0)::bigint AS cost,
      COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_with_cost,
      COALESCE(SUM(CASE WHEN p."costCents" IS NULL THEN 1 ELSE 0 END), 0)::bigint AS lines_without_cost
    FROM "SaleLine" sl
    INNER JOIN "Sale" s ON s."id" = sl."saleId"
    INNER JOIN "Product" p ON p."id" = sl."productId"
    WHERE s."storeId" = ${storeId}
      AND s."status" = 'COMPLETED'
      AND s."completedAt" >= ${from}
      AND s."completedAt" < ${to}
  `;
}
