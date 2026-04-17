import { loadCatalogProducts } from "@/lib/catalog-products";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
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
  const dayStart = startOfDay(now);
  const monthStart = startOfMonth(now);

  // Importante: evitar muchas consultas en paralelo porque Supabase + Prisma
  // están configurados con un connection_limit bajo (1), lo que puede provocar
  // timeouts en el pool. Aquí hacemos las consultas de forma secuencial.

  const dailyAgg = await prisma.sale.aggregate({
    where: { storeId, completedAt: { gte: dayStart } },
    _sum: { totalCents: true },
    _count: true,
  });

  const monthlyAgg = await prisma.sale.aggregate({
    where: { storeId, completedAt: { gte: monthStart } },
    _sum: { totalCents: true },
    _count: true,
  });

  const topProducts = await prisma.saleLine.groupBy({
    by: ["productId"],
    where: { sale: { storeId } },
    _sum: { quantity: true, subtotalCents: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 8,
  });

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

  const revenueTotal = await prisma.sale.aggregate({
    where: { storeId },
    _sum: { totalCents: true },
  });

  const fraudCount = await prisma.event.count({
    where: { storeId, isFraud: true },
  });

  const topIds = [...new Set(topProducts.map((t) => t.productId))];
  const catalogForTop = (await loadCatalogProducts(prisma, storeId)).filter((p) =>
    topIds.includes(p.id),
  );
  const metaById = new Map(catalogForTop.map((p) => [p.id, p]));

  const salesByHour = await prisma.$queryRaw<
    { hour: number; ventas: bigint; ingreso_cents: bigint }[]
  >`
    SELECT EXTRACT(HOUR FROM "completedAt")::int AS hour,
           COUNT(*)::bigint AS ventas,
           COALESCE(SUM("totalCents"),0)::bigint AS ingreso_cents
    FROM "Sale"
    WHERE "storeId" = ${storeId}
      AND "completedAt" >= ${dayStart}
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

  const level1 = {
    ventasHoy: dailyAgg._count,
    ingresosHoyCents: dailyAgg._sum.totalCents ?? 0,
    ventasMes: monthlyAgg._count,
    ingresosMesCents: monthlyAgg._sum.totalCents ?? 0,
    ingresosTotalesCents: revenueTotal._sum.totalCents ?? 0,
    ticketMedioHoyCents:
      dailyAgg._count > 0
        ? Math.round((dailyAgg._sum.totalCents ?? 0) / dailyAgg._count)
        : 0,
    ticketMedioMesCents:
      monthlyAgg._count > 0
        ? Math.round((monthlyAgg._sum.totalCents ?? 0) / monthlyAgg._count)
        : 0,
    horaPicoHoy: {
      hora: pico.ventas > 0 ? pico.hora : null,
      ventas: pico.ventas,
      ingresosCents: pico.ingresosCents,
    },
    productosTop: topProducts.map((t) => ({
      productId: t.productId,
      nombre: metaById.get(t.productId)?.name ?? t.productId,
      sku: metaById.get(t.productId)?.sku,
      unidades: t._sum.quantity ?? 0,
      subtotalCents: t._sum.subtotalCents ?? 0,
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
  const sales30d = await prisma.sale.findMany({
    where: { storeId, completedAt: { gte: thirtyDaysAgo } },
    include: { lines: true },
  });

  const productCosts = await prisma.product.findMany({
    where: { storeId },
    select: { id: true, costCents: true },
  });
  const costById = new Map(productCosts.map((p) => [p.id, p.costCents]));

  /** COGS y PVP solo en líneas con precio de compra en catálogo (misma regla que Economía). */
  let cogs = 0;
  let revenueLinesWithCost = 0;
  for (const s of sales30d) {
    for (const l of s.lines) {
      const unitCost = costById.get(l.productId);
      if (unitCost == null) continue;
      cogs += unitCost * l.quantity;
      revenueLinesWithCost += l.subtotalCents;
    }
  }
  const revenue30 = sales30d.reduce((a, s) => a + s.totalCents, 0);
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
