import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

/**
 * Convierte “hoy” local (por offset minutos) a rango UTC [from, to).
 * Convención de offset: minutos respecto a UTC (ej. Cuba suele ser -240).
 */
function utcRangeForLocalDayContaining(now: Date, offsetMinutes: number) {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth(); // 0-based
  const d = local.getUTCDate();
  const baseUtcMidnight = Date.UTC(y, m, d, 0, 0, 0, 0);
  const from = new Date(baseUtcMidnight - offsetMinutes * 60_000);
  const to = new Date(from.getTime() + 24 * 60 * 60_000);
  return { from, to, localYmd: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

function utcStartOfLocalMonth(now: Date, offsetMinutes: number) {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth(); // 0-based
  const baseUtcMonthStart = Date.UTC(y, m, 1, 0, 0, 0, 0);
  return new Date(baseUtcMonthStart - offsetMinutes * 60_000);
}

function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw); // default Cuba (UTC-4)
  return Number.isFinite(v) ? v : -240;
}

export function emptyOverviewPayload(now = new Date()) {
  return {
    level1: {
      ventasHoy: 0,
      ingresosHoyCents: 0,
      ventasMes: 0,
      ingresosMesCents: 0,
      ingresosTotalesCents: 0,
      productosTop: [] as {
        productId: string;
        nombre: string;
        sku?: string;
        unidades: number;
        subtotalCents: number;
      }[],
      stockActual: [] as {
        id: string;
        sku: string;
        nombre: string;
        stock: number;
        umbral: number | null;
      }[],
      eventosFraudulentos: 0,
      ticketMedioHoyCents: 0,
      ticketMedioMesCents: 0,
      horaPicoHoy: { hora: null as number | null, ventas: 0, ingresosCents: 0 },
    },
    level2: {
      rotacionInventario30d: 0,
      margenAprox30d: 0,
      ventasPorHoraHoy: [] as { hora: number; ventas: number; ingresosCents: number }[],
      rendimientoDispositivoMes: [] as {
        deviceId: string;
        ventas: number;
        ingresosCents: number;
      }[],
    },
    level3: {
      alertasStock: [] as {
        productId: string;
        sku: string;
        nombre: string;
        stock: number;
        umbral: number | null;
      }[],
      anomalias: [] as {
        id: string;
        type: string;
        deviceId: string;
        status: string;
        isFraud: boolean;
        fraudReason: string | null;
        serverTimestamp: string;
      }[],
      demandaHeuristica30d: [] as { productId: string; unidades: number }[],
      dashboardLayout: null as unknown,
    },
    generatedAt: now.toISOString(),
  };
}

export async function getOverview(storeId: string, now = new Date()) {
  if (storeId === LOCAL_ADMIN_STORE_ID) {
    return {
      ...emptyOverviewPayload(now),
      meta: {
        dbAvailable: false,
        hint:
          "Sesión sin tienda en base de datos. Configura STATIC_ADMIN_STORE_ID con el id real de Store o arregla DATABASE_URL / Supabase.",
      },
    };
  }

  try {
    return await computeOverviewFromDb(storeId, now);
  } catch (err) {
    console.error("[analytics] getOverview", err);
    return {
      ...emptyOverviewPayload(now),
      meta: {
        dbAvailable: false,
        message:
          err instanceof Error
            ? err.message
            : "No se pudo leer la base de datos (revisa DATABASE_URL o el Data Proxy de Prisma).",
      },
    };
  }
}

async function computeOverviewFromDb(storeId: string, now: Date) {
  const offset = storeTzOffsetMinutes();
  const dayRange = utcRangeForLocalDayContaining(now, offset);
  const dayStart = dayRange.from;
  const dayEnd = dayRange.to;
  const monthStart = utcStartOfLocalMonth(now, offset);

  // Importante: evitar muchas consultas en paralelo porque Supabase + Prisma
  // están configurados con un connection_limit bajo (1), lo que puede provocar
  // timeouts en el pool. Aquí hacemos las consultas de forma secuencial.

  const aggRows = await prisma.$queryRaw<
    {
      ventas_hoy: bigint;
      ingresos_hoy_cents: bigint;
      ventas_mes: bigint;
      ingresos_mes_cents: bigint;
      ingresos_total_cents: bigint;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE "completedAt" >= ${dayStart} AND "completedAt" < ${dayEnd})::bigint AS ventas_hoy,
      COALESCE(SUM("totalCents") FILTER (WHERE "completedAt" >= ${dayStart} AND "completedAt" < ${dayEnd}), 0)::bigint AS ingresos_hoy_cents,
      COUNT(*) FILTER (WHERE "completedAt" >= ${monthStart})::bigint AS ventas_mes,
      COALESCE(SUM("totalCents") FILTER (WHERE "completedAt" >= ${monthStart}), 0)::bigint AS ingresos_mes_cents,
      COALESCE(SUM("totalCents"), 0)::bigint AS ingresos_total_cents
    FROM "Sale"
    WHERE "storeId" = ${storeId}
  `;
  const agg = aggRows[0] ?? {
    ventas_hoy: BigInt(0),
    ingresos_hoy_cents: BigInt(0),
    ventas_mes: BigInt(0),
    ingresos_mes_cents: BigInt(0),
    ingresos_total_cents: BigInt(0),
  };

  const topProducts = await prisma.$queryRaw<
    { productId: string; unidades: bigint; subtotal_cents: bigint; name: string | null; sku: string | null }[]
  >`
    SELECT
      sl."productId" AS "productId",
      SUM(sl.quantity)::bigint AS unidades,
      COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS subtotal_cents,
      p.name AS name,
      p.sku AS sku
    FROM "SaleLine" sl
    JOIN "Sale" s ON s.id = sl."saleId"
    LEFT JOIN "Product" p ON p.id = sl."productId"
    WHERE s."storeId" = ${storeId}
    GROUP BY sl."productId", p.name, p.sku
    ORDER BY unidades DESC
    LIMIT 8
  `;

  const stockRows = await prisma.product.findMany({
    where: { storeId, active: true },
    select: {
      id: true,
      sku: true,
      name: true,
      stockQty: true,
      lowStockAt: true,
      priceCents: true,
      costCents: true,
    },
  });

  const fraudCount = await prisma.event.count({
    where: { storeId, isFraud: true },
  });

  const salesByHour = await prisma.$queryRaw<
    { hour: number; ventas: bigint; ingreso_cents: bigint }[]
  >`
    SELECT EXTRACT(HOUR FROM ("completedAt" + (${offset}::int * interval '1 minute')))::int AS hour,
           COUNT(*)::bigint AS ventas,
           COALESCE(SUM("totalCents"),0)::bigint AS ingreso_cents
    FROM "Sale"
    WHERE "storeId" = ${storeId}
      AND "completedAt" >= ${dayStart}
      AND "completedAt" < ${dayEnd}
    GROUP BY 1
    ORDER BY 1
  `;

  const hourMap = new Map(
    salesByHour.map((r) => [
      r.hour,
      { ventas: Number(r.ventas), ingresosCents: Number(r.ingreso_cents ?? 0) },
    ]),
  );
  const ventasPorHoraHoyFull = Array.from({ length: 24 }, (_, h) => {
    const x = hourMap.get(h);
    return {
      hora: h,
      ventas: x?.ventas ?? 0,
      ingresosCents: x?.ingresosCents ?? 0,
    };
  });
  const pico = ventasPorHoraHoyFull.reduce(
    (best, cur) => (cur.ventas > best.ventas ? cur : best),
    ventasPorHoraHoyFull[0]!,
  );

  const dailyCount = Number(agg.ventas_hoy ?? BigInt(0));
  const dailyRevenueCents = Number(agg.ingresos_hoy_cents ?? BigInt(0));
  const monthlyCount = Number(agg.ventas_mes ?? BigInt(0));
  const monthlyRevenueCents = Number(agg.ingresos_mes_cents ?? BigInt(0));

  const level1 = {
    ventasHoy: dailyCount,
    ingresosHoyCents: dailyRevenueCents,
    ventasMes: monthlyCount,
    ingresosMesCents: monthlyRevenueCents,
    ingresosTotalesCents: Number(agg.ingresos_total_cents ?? BigInt(0)),
    ticketMedioHoyCents:
      dailyCount > 0
        ? Math.round(dailyRevenueCents / dailyCount)
        : 0,
    ticketMedioMesCents:
      monthlyCount > 0
        ? Math.round(monthlyRevenueCents / monthlyCount)
        : 0,
    horaPicoHoy: {
      hora: pico.ventas > 0 ? pico.hora : null,
      ventas: pico.ventas,
      ingresosCents: pico.ingresosCents,
    },
    productosTop: topProducts.map((t) => ({
      productId: t.productId,
      nombre: t.name ?? t.productId,
      sku: t.sku ?? undefined,
      unidades: Number(t.unidades ?? BigInt(0)),
      subtotalCents: Number(t.subtotal_cents ?? BigInt(0)),
    })),
    stockActual: stockRows.map((p) => ({
      id: p.id,
      sku: p.sku,
      nombre: p.name,
      stock: p.stockQty,
      umbral: p.lowStockAt,
    })),
    eventosFraudulentos: fraudCount,
  };

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  const marginRows = await prisma.$queryRaw<
    { cogs_cents: bigint; revenue_with_cost_cents: bigint }[]
  >`
    SELECT
      COALESCE(SUM((p."costCents" * sl.quantity)), 0)::bigint AS cogs_cents,
      COALESCE(SUM(sl."subtotalCents"), 0)::bigint AS revenue_with_cost_cents
    FROM "SaleLine" sl
    JOIN "Sale" s ON s.id = sl."saleId"
    JOIN "Product" p ON p.id = sl."productId"
    WHERE s."storeId" = ${storeId}
      AND s."completedAt" >= ${thirtyDaysAgo}
      AND p."costCents" IS NOT NULL
  `;
  const margin = marginRows[0] ?? { cogs_cents: BigInt(0), revenue_with_cost_cents: BigInt(0) };
  const cogs = Number(margin.cogs_cents ?? BigInt(0));
  const revenueLinesWithCost = Number(margin.revenue_with_cost_cents ?? BigInt(0));

  const inventoryValue = stockRows.reduce(
    (a, p) => a + p.stockQty * (p.costCents ?? p.priceCents),
    0,
  );
  const rotacionInventario = inventoryValue > 0 ? cogs / inventoryValue : 0;

  const devicePerf = await prisma.sale.groupBy({
    by: ["deviceId"],
    where: { storeId, completedAt: { gte: monthStart } },
    _sum: { totalCents: true },
    _count: true,
    orderBy: { _count: { deviceId: "desc" } },
    take: 10,
  });

  const level2 = {
    rotacionInventario30d: Number(rotacionInventario.toFixed(4)),
    /** PVP − proveedor en líneas con coste registrado (no es ingreso bruto de ticket completo). */
    margenAprox30d: revenueLinesWithCost - cogs,
    ventasPorHoraHoy: ventasPorHoraHoyFull,
    rendimientoDispositivoMes: devicePerf.map((d) => ({
      deviceId: d.deviceId,
      ventas: d._count,
      ingresosCents: d._sum.totalCents ?? 0,
    })),
  };

  const demandHeuristic = await prisma.$queryRaw<
    { productId: string; qty: bigint }[]
  >`
    SELECT sl."productId",
           SUM(sl.quantity)::bigint AS qty
    FROM "SaleLine" sl
    JOIN "Sale" s ON s.id = sl."saleId"
    WHERE s."storeId" = ${storeId}
      AND s."completedAt" >= ${thirtyDaysAgo}
    GROUP BY sl."productId"
    ORDER BY qty DESC
    LIMIT 10
  `;

  const anomalies = await prisma.event.findMany({
    where: {
      storeId,
      OR: [{ isFraud: true }, { status: "REJECTED" }],
    },
    orderBy: { serverTimestamp: "desc" },
    take: 15,
    select: {
      id: true,
      type: true,
      deviceId: true,
      status: true,
      isFraud: true,
      fraudReason: true,
      serverTimestamp: true,
    },
  });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { dashboardLayout: true },
  });

  const lowStockAlerts = stockRows
    .filter((p) => p.stockQty <= (p.lowStockAt ?? 0))
    .map((p) => ({
      productId: p.id,
      sku: p.sku,
      nombre: p.name,
      stock: p.stockQty,
      umbral: p.lowStockAt,
    }));

  const level3 = {
    alertasStock: lowStockAlerts,
    anomalias: anomalies,
    demandaHeuristica30d: demandHeuristic.map((d) => ({
      productId: d.productId,
      unidades: Number(d.qty),
    })),
    dashboardLayout: store?.dashboardLayout ?? null,
  };

  return {
    level1,
    level2,
    level3,
    generatedAt: now.toISOString(),
    meta: { dbAvailable: true as const },
  };
}
