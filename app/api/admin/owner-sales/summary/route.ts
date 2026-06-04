import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { storeTzOffsetIntervalSql, storeTzOffsetMinutes } from "@/lib/economy-store-tz";

const querySchema = z.object({
  mode: z.enum(["day", "month", "range"]).optional().default("day"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

type OwnerAggRow = { owner: "OSMAR" | "ALEX"; total_cents: bigint; cnt: bigint };
type StatusAggRow = { status: "PENDING_PAYMENT" | "PAID"; total_cents: bigint; cnt: bigint };

type OwnerSaleLineRow = {
  id: string;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  quantity: number;
  unitCostCents: number;
  subtotalCents: number;
};

type OwnerSaleRow = {
  id: string;
  owner: "OSMAR" | "ALEX";
  totalCents: number;
  createdAt: Date;
  status: "PENDING_PAYMENT" | "PAID";
  paidAt: Date | null;
  paidSaleId: string | null;
  lines: OwnerSaleLineRow[];
};

/** Convierte un YYYY-MM-DD local a ms UTC equivalentes al inicio de ese día local. */
function localYmdToUtcMs(ymd: string, offsetMinutes: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Interpretamos la fecha como si fuera UTC y luego restamos el offset para obtener el UTC real.
  return Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetMinutes * 60_000;
}

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
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
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
    let from: string | null = null;
    let to: string | null = null;
    let rangeFromUtc: Date | null = null;
    let rangeToUtcExclusive: Date | null = null;

    if (mode === "day") {
      key = parsed.data.date ?? "";
      if (!key) {
        const todayRow = await prisma.$queryRaw<{ d: string }[]>`
          SELECT to_char(date_trunc('day', (now() + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS d
        `;
        key = todayRow[0]?.d ?? new Date().toISOString().slice(0, 10);
      }
    } else if (mode === "month") {
      key = parsed.data.month ?? "";
      if (!key) {
        const nowRow = await prisma.$queryRaw<{ ym: string }[]>`
          SELECT to_char(date_trunc('month', (now() + (${offsetInterval}::interval))), 'YYYY-MM') AS ym
        `;
        key = nowRow[0]?.ym ?? new Date().toISOString().slice(0, 7);
      }
    } else {
      // range
      const todayRow = await prisma.$queryRaw<{ d: string }[]>`
        SELECT to_char(date_trunc('day', (now() + (${offsetInterval}::interval))), 'YYYY-MM-DD') AS d
      `;
      const today = todayRow[0]?.d ?? new Date().toISOString().slice(0, 10);
      from = parsed.data.from ?? today;
      to = parsed.data.to ?? today;
      if (from > to) {
        const swap = from;
        from = to;
        to = swap;
      }
      key = `${from}..${to}`;
      const fromMs = localYmdToUtcMs(from, offsetMinutes);
      const toMs = localYmdToUtcMs(to, offsetMinutes);
      if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
        rangeFromUtc = new Date(fromMs);
        rangeToUtcExclusive = new Date(toMs + 86400_000);
      }
    }

    const ownerAgg = await prisma.$queryRaw<OwnerAggRow[]>`
      SELECT
        os.owner::text AS owner,
        COALESCE(SUM(os."totalCents"), 0)::bigint AS total_cents,
        COUNT(*)::bigint AS cnt
      FROM "OwnerSale" os
      WHERE os."storeId" = ${storeId}
        AND os."status" = 'PENDING_PAYMENT'
        AND (
          CASE
            WHEN ${mode} = 'day' THEN to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') = ${key}
            WHEN ${mode} = 'month' THEN to_char(date_trunc('month', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM') = ${key}
            WHEN ${mode} = 'range' THEN
              to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') >= ${from ?? ""}
              AND to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') <= ${to ?? ""}
            ELSE FALSE
          END
        )
      GROUP BY 1
    `;

    const statusAggWindow = await prisma.$queryRaw<StatusAggRow[]>`
      SELECT
        os.status::text AS status,
        COALESCE(SUM(os."totalCents"), 0)::bigint AS total_cents,
        COUNT(*)::bigint AS cnt
      FROM "OwnerSale" os
      WHERE os."storeId" = ${storeId}
        AND (
          CASE
            WHEN ${mode} = 'day' THEN to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') = ${key}
            WHEN ${mode} = 'month' THEN to_char(date_trunc('month', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM') = ${key}
            WHEN ${mode} = 'range' THEN
              to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') >= ${from ?? ""}
              AND to_char(date_trunc('day', (os."createdAt" + (${offsetInterval}::interval))), 'YYYY-MM-DD') <= ${to ?? ""}
            ELSE FALSE
          END
        )
      GROUP BY 1
    `;

    const statusAggAll = await prisma.$queryRaw<StatusAggRow[]>`
      SELECT
        os.status::text AS status,
        COALESCE(SUM(os."totalCents"), 0)::bigint AS total_cents,
        COUNT(*)::bigint AS cnt
      FROM "OwnerSale" os
      WHERE os."storeId" = ${storeId}
      GROUP BY 1
    `;

    const totalsByOwner = new Map<string, { totalCents: number; count: number }>();
    for (const r of ownerAgg) {
      totalsByOwner.set(String(r.owner), { totalCents: Number(r.total_cents ?? BigInt(0)), count: Number(r.cnt ?? BigInt(0)) });
    }

    const windowByStatus = new Map<string, { totalCents: number; count: number }>();
    for (const r of statusAggWindow) {
      windowByStatus.set(String(r.status), { totalCents: Number(r.total_cents ?? BigInt(0)), count: Number(r.cnt ?? BigInt(0)) });
    }

    const allByStatus = new Map<string, { totalCents: number; count: number }>();
    for (const r of statusAggAll) {
      allByStatus.set(String(r.status), { totalCents: Number(r.total_cents ?? BigInt(0)), count: Number(r.cnt ?? BigInt(0)) });
    }

    const fetchWhere: Record<string, unknown> = { storeId };
    if (mode === "day") {
      fetchWhere.createdAt = { gte: new Date(Date.now() - 40 * 86400000) };
    } else if (mode === "month") {
      fetchWhere.createdAt = { gte: new Date(Date.now() - 400 * 86400000) };
    } else if (rangeFromUtc && rangeToUtcExclusive) {
      fetchWhere.createdAt = { gte: rangeFromUtc, lt: rangeToUtcExclusive };
    }

    const fetchTake = mode === "day" ? 80 : mode === "month" ? 250 : 1000;

    const sales: OwnerSaleRow[] = await (prisma as any).ownerSale.findMany({
      where: fetchWhere,
      orderBy: { createdAt: "desc" },
      take: fetchTake,
      select: {
        id: true,
        owner: true,
        totalCents: true,
        status: true,
        paidAt: true,
        paidSaleId: true,
        createdAt: true,
        lines: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            productId: true,
            productName: true,
            productSku: true,
            quantity: true,
            unitCostCents: true,
            subtotalCents: true,
          },
        },
      },
    });

    const inWindow: OwnerSaleRow[] = sales.filter((s: OwnerSaleRow) => {
      // Aplicar mismo criterio de "día/mes/rango local tienda" que el SQL.
      const local = new Date(s.createdAt.getTime() + offsetMinutes * 60_000);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, "0");
      const d = String(local.getUTCDate()).padStart(2, "0");
      const ymd = `${y}-${m}-${d}`;
      const ym = `${y}-${m}`;
      if (mode === "day") return ymd === key;
      if (mode === "month") return ym === key;
      if (mode === "range") return ymd >= (from ?? "") && ymd <= (to ?? "");
      return false;
    });

    const osmar = totalsByOwner.get("OSMAR")?.totalCents ?? 0;
    const alex = totalsByOwner.get("ALEX")?.totalCents ?? 0;
    const count = (totalsByOwner.get("OSMAR")?.count ?? 0) + (totalsByOwner.get("ALEX")?.count ?? 0);

    const windowMeta =
      mode === "range"
        ? { mode, key, from: from ?? "", to: to ?? "" }
        : { mode: mode as "day" | "month", key };

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        tzOffsetMinutes: offsetMinutes,
        note: "Deudas de dueños: descuenta stock al crear. Mientras está PENDIENTE no cuenta en ingresos/ganancia/cuadre. Al pagar, se crea una Sale normal a costo (sin tocar stock). Ventana calculada en ‘hora local tienda’ (TL_TZ_OFFSET_MINUTES).",
      },
      window: windowMeta,
      totals: {
        OSMAR: osmar,
        ALEX: alex,
        totalCents: osmar + alex,
        count,
      },
      ledger: {
        window: {
          pendingCents: windowByStatus.get("PENDING_PAYMENT")?.totalCents ?? 0,
          pendingCount: windowByStatus.get("PENDING_PAYMENT")?.count ?? 0,
          paidCents: windowByStatus.get("PAID")?.totalCents ?? 0,
          paidCount: windowByStatus.get("PAID")?.count ?? 0,
        },
        all: {
          pendingCents: allByStatus.get("PENDING_PAYMENT")?.totalCents ?? 0,
          pendingCount: allByStatus.get("PENDING_PAYMENT")?.count ?? 0,
          paidCents: allByStatus.get("PAID")?.totalCents ?? 0,
          paidCount: allByStatus.get("PAID")?.count ?? 0,
        },
      },
      sales: inWindow.map((s) => ({
        id: s.id,
        owner: s.owner,
        status: s.status,
        totalCents: s.totalCents,
        createdAt: s.createdAt.toISOString(),
        paidAt: s.paidAt ? s.paidAt.toISOString() : null,
        paidSaleId: s.paidSaleId ?? null,
        lineCount: s.lines.length,
        lines: s.lines.map((l: OwnerSaleLineRow) => ({
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          productSku: l.productSku,
          quantity: l.quantity,
          unitCostCents: l.unitCostCents,
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

