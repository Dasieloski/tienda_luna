import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
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
    `economy:${session.storeId}:${from.toISOString()}`,
    30_000,
    () =>
      prisma.$queryRaw<{ method: string | null; ventas: bigint; total_cents: bigint }[]>`
        SELECT
          (e.payload->>'paymentMethod') AS method,
          COUNT(*)::bigint AS ventas,
          COALESCE(SUM(s."totalCents"), 0)::bigint AS total_cents
        FROM "Event" e
        JOIN "Sale" s
          ON s."storeId" = e."storeId"
        AND s."clientSaleId" = (e.payload->>'saleId')
        WHERE e."storeId" = ${session.storeId}
          AND e.type = 'SALE_COMPLETED'
          AND e.status IN ('ACCEPTED', 'CORRECTED')
          AND s."completedAt" >= ${from}
          AND s."completedAt" < ${to}
        GROUP BY 1
      `,
  );

  const buckets = rows.map((r) => ({
    method: r.method ?? "desconocido",
    ventas: Number(r.ventas ?? BigInt(0)),
    totalCents: Number(r.total_cents ?? BigInt(0)),
  }));

  let efectivoCents = 0;
  let transferenciaCents = 0;
  let usdCents = 0;
  for (const b of buckets) {
    const m = b.method.toLowerCase();
    if (m.includes("usd") || m.includes("dolar") || m.includes("dólar")) {
      usdCents += b.totalCents;
    } else if (m.includes("trans") || m.includes("bank") || m.includes("banco")) {
      transferenciaCents += b.totalCents;
    } else {
      efectivoCents += b.totalCents;
    }
  }

  const totalCents = buckets.reduce((acc, b) => acc + b.totalCents, 0);
  const ventas = buckets.reduce((acc, b) => acc + b.ventas, 0);

  const csv = toCsv(
    ["Fecha", "Ventas", "Total CUP", "Total USD(eq)", "Efectivo CUP", "Transferencia CUP", "USD CUP(eq)"],
    [
      [
        from.toISOString().slice(0, 10),
        ventas,
        formatMoney(totalCents),
        formatUsdFromCupCents(totalCents),
        formatMoney(efectivoCents),
        formatMoney(transferenciaCents),
        formatMoney(usdCents),
      ],
      [],
      ["Método", "Ventas", "Total CUP", "Total USD(eq)"],
      ...buckets.map((b) => [
        b.method,
        b.ventas,
        formatMoney(b.totalCents),
        formatUsdFromCupCents(b.totalCents),
      ]),
    ],
  );

  const fileDate = from.toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"economia-${fileDate}.csv\"`,
      "Cache-Control": "no-store",
    },
  });
}

