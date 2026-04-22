import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { cacheGetOrSet } from "@/lib/ttl-cache";

const querySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw); // default Cuba (UTC-4)
  return Number.isFinite(v) ? v : -240;
}

type DayRow = {
  day_local: string; // YYYY-MM-DD
  revenue_cents: bigint;
  sale_count: bigint;
  margin_cents: bigint;
  cost_cents: bigint;
  units_with_cost: bigint;
  units_total: bigint;
};

type TopProductRow = {
  day_local: string;
  product_id: string;
  name: string;
  qty: bigint;
  revenue_cents: bigint;
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false as const },
      year: null,
      days: [],
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ year: url.searchParams.get("year") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const now = new Date();
  const year = parsed.data.year ? Number(parsed.data.year) : now.getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "INVALID_YEAR" }, { status: 400 });
  }

  const offsetMinutes = storeTzOffsetMinutes();
  const storeId = session.storeId;

  try {
    const payload = await cacheGetOrSet(`economy-calendar:${storeId}:${year}:v1`, 60_000, async () => {
      const fromUtc = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      const toUtcExclusive = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));

      const offsetInterval = `${offsetMinutes} minutes`;

      const days = await prisma.$queryRaw<DayRow[]>`
        SELECT
          to_char(date_trunc('day', (s."completedAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS day_local,
          COALESCE(SUM(s."totalCents"), 0)::bigint AS revenue_cents,
          COUNT(DISTINCT s.id)::bigint AS sale_count,
          COALESCE(SUM(
            CASE
              WHEN p."costCents" IS NOT NULL THEN (sl."subtotalCents" - (p."costCents" * sl."quantity"))
              ELSE 0
            END
          ), 0)::bigint AS margin_cents,
          COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN (p."costCents" * sl."quantity") ELSE 0 END), 0)::bigint AS cost_cents,
          COALESCE(SUM(CASE WHEN p."costCents" IS NOT NULL THEN sl."quantity" ELSE 0 END), 0)::bigint AS units_with_cost,
          COALESCE(SUM(sl."quantity"), 0)::bigint AS units_total
        FROM "Sale" s
        LEFT JOIN "SaleLine" sl ON sl."saleId" = s.id
        LEFT JOIN "Product" p ON p.id = sl."productId"
        WHERE s."storeId" = ${storeId}
          AND s."status" = 'COMPLETED'
          AND s."completedAt" >= ${fromUtc}
          AND s."completedAt" < ${toUtcExclusive}
        GROUP BY 1
        ORDER BY 1 ASC
      `;

      const tops = await prisma.$queryRaw<TopProductRow[]>`
        WITH per_product AS (
          SELECT
            to_char(date_trunc('day', (s."completedAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS day_local,
            p.id AS product_id,
            p.name AS name,
            COALESCE(SUM(sl.quantity), 0)::bigint AS qty,
            COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue_cents
          FROM "Sale" s
          JOIN "SaleLine" sl ON sl."saleId" = s.id
          JOIN "Product" p ON p.id = sl."productId"
          WHERE s."storeId" = ${storeId}
            AND s."status" = 'COMPLETED'
            AND s."completedAt" >= ${fromUtc}
            AND s."completedAt" < ${toUtcExclusive}
          GROUP BY 1, 2, 3
        ),
        ranked AS (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY day_local ORDER BY qty DESC, revenue_cents DESC, name ASC) AS rn
          FROM per_product
        )
        SELECT day_local, product_id, name, qty, revenue_cents
        FROM ranked
        WHERE rn = 1
        ORDER BY day_local ASC
      `;

      const topByDay = new Map<string, { id: string; name: string; qty: number; revenueCents: number }>();
      for (const t of tops) {
        topByDay.set(t.day_local, {
          id: t.product_id,
          name: t.name,
          qty: Number(t.qty ?? BigInt(0)),
          revenueCents: Number(t.revenue_cents ?? BigInt(0)),
        });
      }

      const out = days.map((d) => {
        const revenueCents = Number(d.revenue_cents ?? BigInt(0));
        const saleCount = Number(d.sale_count ?? BigInt(0));
        const marginCents = Number(d.margin_cents ?? BigInt(0));
        const costCents = Number(d.cost_cents ?? BigInt(0));
        const unitsWithCost = Number(d.units_with_cost ?? BigInt(0));
        const unitsTotal = Number(d.units_total ?? BigInt(0));
        const ticketAvgCents = saleCount > 0 ? Math.round(revenueCents / saleCount) : 0;
        const avgUnitCostCents = unitsWithCost > 0 ? Math.round(costCents / unitsWithCost) : null;
        const top = topByDay.get(d.day_local) ?? null;
        return {
          day: d.day_local,
          revenueCents,
          saleCount,
          marginCents,
          ticketAvgCents,
          avgUnitCostCents,
          unitsTotal,
          topProduct: top,
        };
      });

      return {
        meta: {
          dbAvailable: true as const,
          year,
          tzOffsetMinutes: offsetMinutes,
          note:
            "Ganancia y coste medios usan costCents del catálogo en el momento de la consulta. Líneas sin costCents no entran en margen ni en coste medio.",
        },
        year,
        days: out,
      };
    });

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/admin/economy/calendar]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false as const,
          message: err instanceof Error ? err.message : "Error",
        },
        year,
        days: [],
      },
      { status: 200 },
    );
  }
}

