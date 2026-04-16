import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { cacheGetOrSet } from "@/lib/ttl-cache";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD")
    .optional(),
});

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

type Row = {
  productId: string;
  name: string;
  sku: string;
  priceCents: number;
  priceUsdCents: number;
  qty: number;
  efectivoCents: number;
  transferenciaCents: number;
  usdCents: number;
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false },
      date: null,
      rows: [] as Row[],
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const baseDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const from = startOfDay(baseDate);
  const to = endOfDay(baseDate);

  try {
    const rows = await cacheGetOrSet(
      `daily-report:${session.storeId}:${from.toISOString()}`,
      30_000,
      () =>
        prisma.$queryRaw<
          {
            product_id: string;
            name: string;
            sku: string;
            price_cents: number;
            price_usd_cents: number;
            qty: bigint;
            efectivo_cents: bigint;
            transfer_cents: bigint;
            usd_cents: bigint;
          }[]
        >`
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
          JOIN "SaleLine" sl
            ON sl."saleId" = s.id
          JOIN "Product" p
            ON p.id = sl."productId"
          LEFT JOIN "Event" e
            ON e."storeId" = s."storeId"
          AND e.type = 'SALE_COMPLETED'
          AND e.status IN ('ACCEPTED', 'CORRECTED')
          AND (e.payload->>'saleId') = s."clientSaleId"
          WHERE s."storeId" = ${session.storeId}
            AND s."completedAt" >= ${from}
            AND s."completedAt" < ${to}
          GROUP BY p.id, p.name, p.sku, p."priceCents", p."priceUsdCents"
          ORDER BY p.name
        `,
    );

    const mapped: Row[] = rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku,
      priceCents: Number(r.price_cents ?? 0),
      priceUsdCents: Number(r.price_usd_cents ?? 0),
      qty: Number(r.qty ?? BigInt(0)),
      efectivoCents: Number(r.efectivo_cents ?? BigInt(0)),
      transferenciaCents: Number(r.transfer_cents ?? BigInt(0)),
      usdCents: Number(r.usd_cents ?? BigInt(0)),
    }));

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      date: from.toISOString(),
      rows: mapped,
    });
  } catch (err) {
    console.error("[api/admin/daily-report]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false,
          message:
            err instanceof Error
              ? err.message
              : "No se pudo generar el control diario de ventas.",
        },
        date: from.toISOString(),
        rows: [] as Row[],
      },
      { status: 200 },
    );
  }
}

