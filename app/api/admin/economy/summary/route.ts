import { NextResponse } from "next/server";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

type EconomyBucket = {
  method: string;
  ventas: number;
  totalCents: number;
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false },
      totals: {
        ventas: 0,
        totalCents: 0,
        efectivoCents: 0,
        transferenciaCents: 0,
        usdCents: 0,
      },
      buckets: [],
    });
  }

  try {
    const rows = await prisma.$queryRaw<
      { method: string | null; ventas: bigint; total_cents: bigint }[]
    >`
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
      GROUP BY 1
    `;

    const buckets: EconomyBucket[] = rows.map((r) => ({
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

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      totals: {
        ventas,
        totalCents,
        efectivoCents,
        transferenciaCents,
        usdCents,
      },
      buckets,
    });
  } catch (err) {
    console.error("[api/admin/economy/summary]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false,
          message:
            err instanceof Error ? err.message : "No se pudo leer la información económica.",
        },
        totals: {
          ventas: 0,
          totalCents: 0,
          efectivoCents: 0,
          transferenciaCents: 0,
          usdCents: 0,
        },
        buckets: [],
      },
      { status: 200 },
    );
  }
}

