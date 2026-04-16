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

  const baseDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const from = startOfDay(baseDate);
  const to = endOfDay(baseDate);

  const rows = await cacheGetOrSet(
    `daily-report:${session.storeId}:${from.toISOString()}`,
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

  const fileDate = from.toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"control-diario-${fileDate}.csv\"`,
      "Cache-Control": "no-store",
    },
  });
}

