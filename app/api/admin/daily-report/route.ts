import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { queryDailyReportRows } from "@/lib/daily-report-query";
import { cacheGetOrSet } from "@/lib/ttl-cache";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD")
    .optional(),
});

/**
 * Interpreta `YYYY-MM-DD` como fecha local de la tienda y la convierte a rango UTC.
 * Evita desfases cuando el servidor corre en UTC (Vercel) pero el negocio opera en otra zona.
 *
 * Convención: offset en minutos respecto a UTC (ej. Cuba suele ser -240).
 */
function utcRangeForLocalDate(dateStr: string, offsetMinutes: number) {
  const [yy, mm, dd] = dateStr.split("-").map((x) => Number(x));
  const baseUtcMidnight = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  const from = new Date(baseUtcMidnight - offsetMinutes * 60_000);
  const to = new Date(from.getTime() + 24 * 60 * 60_000);
  return { from, to };
}

function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw); // default Cuba (UTC-4)
  return Number.isFinite(v) ? v : -240;
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

  const offset = storeTzOffsetMinutes();
  const dateStr =
    parsed.data.date ??
    (() => {
      // “hoy” en zona local de tienda, pero calculado desde UTC
      const now = new Date();
      const local = new Date(now.getTime() + offset * 60_000);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, "0");
      const d = String(local.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();

  const { from, to } = utcRangeForLocalDate(dateStr, offset);

  try {
    const rows = await cacheGetOrSet(
      `daily-report:${session.storeId}:${from.toISOString()}`,
      30_000,
      () => queryDailyReportRows(prisma, session.storeId, from, to),
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

