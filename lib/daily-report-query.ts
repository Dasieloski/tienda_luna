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
    SELECT
      p.id AS product_id,
      p.name,
      p.sku,
      p."priceCents" AS price_cents,
      p."priceUsdCents" AS price_usd_cents,
      COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
      COALESCE(SUM(
        CASE
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%usd%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dolar%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dólar%'
          THEN 0
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%trans%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%bank%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%banco%'
          THEN 0
          ELSE sl."subtotalCents"
        END
      ), 0)::bigint AS efectivo_cents,
      COALESCE(SUM(
        CASE
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%trans%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%bank%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%banco%'
          THEN sl."subtotalCents"
          ELSE 0
        END
      ), 0)::bigint AS transfer_cents,
      COALESCE(SUM(
        CASE
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%usd%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dolar%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dólar%'
          THEN sl."subtotalCents"
          ELSE 0
        END
      ), 0)::bigint AS usd_cents
    FROM "Sale" s
    JOIN "SaleLine" sl ON sl."saleId" = s.id
    JOIN "Product" p ON p.id = sl."productId"
    LEFT JOIN "Event" e
      ON e."storeId" = s."storeId"
     AND e.type = 'SALE_COMPLETED'
     AND e.status IN ('ACCEPTED', 'CORRECTED')
     AND (e.payload->>'saleId') = s."clientSaleId"
    WHERE s."storeId" = ${storeId}
      AND s."completedAt" >= ${from}
      AND s."completedAt" < ${to}
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
    SELECT
      p.id AS product_id,
      p.name,
      p.sku,
      p."priceCents" AS price_cents,
      0::int AS price_usd_cents,
      COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
      COALESCE(SUM(
        CASE
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%usd%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dolar%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dólar%'
          THEN 0
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%trans%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%bank%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%banco%'
          THEN 0
          ELSE sl."subtotalCents"
        END
      ), 0)::bigint AS efectivo_cents,
      COALESCE(SUM(
        CASE
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%trans%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%bank%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%banco%'
          THEN sl."subtotalCents"
          ELSE 0
        END
      ), 0)::bigint AS transfer_cents,
      COALESCE(SUM(
        CASE
          WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%usd%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dolar%'
            OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dólar%'
          THEN sl."subtotalCents"
          ELSE 0
        END
      ), 0)::bigint AS usd_cents
    FROM "Sale" s
    JOIN "SaleLine" sl ON sl."saleId" = s.id
    JOIN "Product" p ON p.id = sl."productId"
    LEFT JOIN "Event" e
      ON e."storeId" = s."storeId"
     AND e.type = 'SALE_COMPLETED'
     AND e.status IN ('ACCEPTED', 'CORRECTED')
     AND (e.payload->>'saleId') = s."clientSaleId"
    WHERE s."storeId" = ${storeId}
      AND s."completedAt" >= ${from}
      AND s."completedAt" < ${to}
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
