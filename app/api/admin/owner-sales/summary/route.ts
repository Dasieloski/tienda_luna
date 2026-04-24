import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { storeTzOffsetIntervalSql, storeTzOffsetMinutes } from "@/lib/economy-store-tz";

const querySchema = z.object({
  mode: z.enum(["day", "month"]).optional().default("day"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

type OwnerAggRow = { owner: "OSMAR" | "ALEX"; total_cents: bigint; cnt: bigint };

type OwnerSaleLineRow = {
  id: string;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
};

type OwnerSaleRow = {
  id: string;
  owner: "OSMAR" | "ALEX";
  totalCents: number;
  createdAt: Date;
  lines: OwnerSaleLineRow[];
};

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false as const },
      window: null,
      totals: { OSMAR: 0, ALEX: 0, totalCents: 0, count: 0 },
      sales: [],
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    mode: url.searchParams.get("mode") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const offsetMinutes = storeTzOffsetMinutes();
  const offsetInterval = storeTzOffsetIntervalSql();
  const storeId = session.storeId;

  try {
    const mode = parsed.data.mode;
    let key: string;

    if (mode === "day") {
      key = parsed.data.date ?? "";
      if (!key) {
        const todayRow = await prisma.$queryRaw<{ d: string }[]>`
          SELECT to_char(date_trunc('day', (now() + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS d
        `;
        key = todayRow[0]?.d ?? new Date().toISOString().slice(0, 10);
      }
    } else {
      key = parsed.data.month ?? "";
      if (!key) {
        const nowRow = await prisma.$queryRaw<{ ym: string }[]>`
          SELECT to_char(date_trunc('month', (now() + (${offsetInterval}::interval))), 'YYYY-MM') AS ym
        `;
        key = nowRow[0]?.ym ?? new Date().toISOString().slice(0, 7);
      }
    }

    const ownerAgg = await prisma.$queryRaw<OwnerAggRow[]>`
      SELECT
        os.owner::text AS owner,
        COALESCE(SUM(os."totalCents"), 0)::bigint AS total_cents,
        COUNT(*)::bigint AS cnt
      FROM "OwnerSale" os
      WHERE os."storeId" = ${storeId}
        AND (
          CASE
            WHEN ${mode} = 'day' THEN to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') = ${key}
            ELSE to_char(date_trunc('month', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM') = ${key}
          END
        )
      GROUP BY 1
    `;

    const totalsByOwner = new Map<string, { totalCents: number; count: number }>();
    for (const r of ownerAgg) {
      totalsByOwner.set(String(r.owner), { totalCents: Number(r.total_cents ?? BigInt(0)), count: Number(r.cnt ?? BigInt(0)) });
    }

    const sales: OwnerSaleRow[] = await (prisma as any).ownerSale.findMany({
      where:
        mode === "day"
          ? {
              storeId,
              createdAt: {
                // filtrar en SQL por día local para no depender del huso del servidor
                // (lo hacemos abajo con queryRaw en agregados). Aquí traemos un rango amplio y filtramos después.
                gte: new Date(Date.now() - 40 * 86400000),
              },
            }
          : {
              storeId,
              createdAt: { gte: new Date(Date.now() - 400 * 86400000) },
            },
      orderBy: { createdAt: "desc" },
      take: mode === "day" ? 80 : 250,
      select: {
        id: true,
        owner: true,
        totalCents: true,
        createdAt: true,
        lines: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            productId: true,
            productName: true,
            productSku: true,
            quantity: true,
            unitPriceCents: true,
            subtotalCents: true,
          },
        },
      },
    });

    const inWindow: OwnerSaleRow[] = sales.filter((s: OwnerSaleRow) => {
      // Aplicar mismo criterio de "día/mes local tienda" que el SQL.
      const local = new Date(s.createdAt.getTime() + offsetMinutes * 60_000);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, "0");
      const d = String(local.getUTCDate()).padStart(2, "0");
      const ymd = `${y}-${m}-${d}`;
      const ym = `${y}-${m}`;
      return mode === "day" ? ymd === key : ym === key;
    });

    const osmar = totalsByOwner.get("OSMAR")?.totalCents ?? 0;
    const alex = totalsByOwner.get("ALEX")?.totalCents ?? 0;
    const count = (totalsByOwner.get("OSMAR")?.count ?? 0) + (totalsByOwner.get("ALEX")?.count ?? 0);

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        tzOffsetMinutes: offsetMinutes,
        note: "Este apartado descuenta stock pero NO se incluye en ingresos/ganancia. Ventana calculada en ‘hora local tienda’ (TL_TZ_OFFSET_MINUTES).",
      },
      window: { mode, key },
      totals: {
        OSMAR: osmar,
        ALEX: alex,
        totalCents: osmar + alex,
        count,
      },
      sales: inWindow.map((s) => ({
        id: s.id,
        owner: s.owner,
        totalCents: s.totalCents,
        createdAt: s.createdAt.toISOString(),
        lineCount: s.lines.length,
        lines: s.lines.map((l: OwnerSaleLineRow) => ({
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          productSku: l.productSku,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          subtotalCents: l.subtotalCents,
        })),
      })),
    });
  } catch (err) {
    console.error("[api/admin/owner-sales/summary]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false as const,
          message: err instanceof Error ? err.message : "DB",
        },
        window: null,
        totals: { OSMAR: 0, ALEX: 0, totalCents: 0, count: 0 },
        sales: [],
      },
      { status: 200 },
    );
  }
}

