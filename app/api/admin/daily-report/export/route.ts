import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { queryDailyReportRows } from "@/lib/daily-report-query";
import { cacheGetOrSet } from "@/lib/ttl-cache";
import { toCsv } from "@/lib/csv";

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

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function formatUsdFromCupCents(cents: number) {
  const rate = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  const cup = cents / 100;
  return (cup / (rate > 0 ? rate : 1)).toFixed(2);
}

function formatUsdCatalog(usdCents: number, cupCents: number) {
  if (usdCents > 0) return (usdCents / 100).toFixed(2);
  return formatUsdFromCupCents(cupCents);
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const dateStr =
    parsed.data.date ??
    (() => {
      const offset = storeTzOffsetMinutes();
      const now = new Date();
      const local = new Date(now.getTime() + offset * 60_000);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, "0");
      const d = String(local.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();

  const { from, to } = utcRangeForLocalDate(dateStr, storeTzOffsetMinutes());

  const rows = await cacheGetOrSet(
    `daily-report:${session.storeId}:${from.toISOString()}:v2`,
    30_000,
    () => queryDailyReportRows(prisma, session.storeId, from, to),
  );

  const mapped = rows.map((r) => {
    const priceCents = Number(r.price_cents ?? 0);
    const priceUsdCents = Number(r.price_usd_cents ?? 0);
    const qty = Number(r.qty ?? BigInt(0));
    const efectivoCents = Number(r.efectivo_cents ?? BigInt(0));
    const transferenciaCents = Number(r.transfer_cents ?? BigInt(0));
    const usdCents = Number(r.usd_cents ?? BigInt(0));
    const subtotalCents = efectivoCents + transferenciaCents + usdCents;
    return {
      productName: r.name,
      sku: r.sku,
      priceUsd: formatUsdCatalog(priceUsdCents, priceCents),
      priceCup: formatMoney(priceCents),
      qty,
      efectivoCup: formatMoney(efectivoCents),
      transferenciaCup: formatMoney(transferenciaCents),
      usd: formatUsdFromCupCents(usdCents),
      subtotalCup: formatMoney(subtotalCents),
    };
  });

  const csv = toCsv(
    [
      "No",
      "Producto",
      "SKU",
      "Precio USD",
      "Precio CUP",
      "Cantidad",
      "CUP efectivo",
      "CUP transferencia",
      "USD",
      "Subtotal CUP",
      "OK",
    ],
    mapped.map((r, idx) => [
      idx + 1,
      r.productName,
      r.sku,
      r.priceUsd,
      r.priceCup,
      r.qty,
      r.efectivoCup,
      r.transferenciaCup,
      r.usd,
      r.subtotalCup,
      "",
    ]),
  );

  const fileDate = dateStr;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"control-diario-${fileDate}.csv\"`,
      "Cache-Control": "no-store",
    },
  });
}

