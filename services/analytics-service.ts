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
    },
    level2: {
      rotacionInventario30d: 0,
      margenAprox30d: 0,
      clientesFrecuentes: [] as {
        customerId: string | null;
        nombre: string | null;
        telefono: string | null;
        compras: number;
        totalCents: number;
      }[],
      ventasPorHoraHoy: [] as { hora: number; ventas: number; ingresosCents: number }[],
      rendimientoDispositivoMes: [] as {
        deviceId: string;
        ventas: number;
        ingresosCents: number;
      }[],
    },
    level3: {
      cohortesClientesNuevos: [] as { mes: string; clientes: number }[],
      ltvTop: [] as { customerId: string; pedidos: number; totalCents: number }[],
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

  const [dailyAgg, monthlyAgg, topProducts, stockRows, revenueTotal, fraudCount] =
    await Promise.all([
      prisma.sale.aggregate({
        where: { storeId, completedAt: { gte: dayStart } },
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { storeId, completedAt: { gte: monthStart } },
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.saleLine.groupBy({
        by: ["productId"],
        where: { sale: { storeId } },
        _sum: { quantity: true, subtotalCents: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 8,
      }),
      prisma.product.findMany({
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
      }),
      prisma.sale.aggregate({
        where: { storeId },
        _sum: { totalCents: true },
      }),
      prisma.event.count({
        where: { storeId, isFraud: true },
      }),
    ]);

  const productMeta = await prisma.product.findMany({
    where: { storeId, id: { in: topProducts.map((t) => t.productId) } },
  });
  const metaById = new Map(productMeta.map((p) => [p.id, p]));

  const level1 = {
    ventasHoy: dailyAgg._count,
    ingresosHoyCents: dailyAgg._sum.totalCents ?? 0,
    ventasMes: monthlyAgg._count,
    ingresosMesCents: monthlyAgg._sum.totalCents ?? 0,
    ingresosTotalesCents: revenueTotal._sum.totalCents ?? 0,
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
  const costById = new Map(productCosts.map((p) => [p.id, p.costCents ?? 0]));

  let cogs = 0;
  for (const s of sales30d) {
    for (const l of s.lines) {
      cogs += (costById.get(l.productId) ?? 0) * l.quantity;
    }
  }
  const revenue30 =
    sales30d.reduce((a, s) => a + s.totalCents, 0) || 1;
  const inventoryValue = stockRows.reduce(
    (a, p) => a + p.stockQty * (p.costCents ?? p.priceCents),
    0,
  );
  const rotacionInventario = inventoryValue > 0 ? cogs / inventoryValue : 0;

  const topCustomers = await prisma.sale.groupBy({
    by: ["customerId"],
    where: { storeId, customerId: { not: null } },
    _sum: { totalCents: true },
    _count: true,
    orderBy: { _sum: { totalCents: "desc" } },
    take: 8,
  });
  const custIds = topCustomers.map((c) => c.customerId).filter(Boolean) as string[];
  const customers = await prisma.customer.findMany({
    where: { id: { in: custIds } },
  });
  const custById = new Map(customers.map((c) => [c.id, c]));

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
    margenAprox30d: revenue30 - cogs,
    clientesFrecuentes: topCustomers.map((c) => ({
      customerId: c.customerId,
      nombre: c.customerId ? custById.get(c.customerId)?.name : null,
      telefono: c.customerId ? custById.get(c.customerId)?.phone : null,
      compras: c._count,
      totalCents: c._sum.totalCents ?? 0,
    })),
    ventasPorHoraHoy: salesByHour.map((r) => ({
      hora: r.hour,
      ventas: Number(r.ventas),
      ingresosCents: Number(r.ingreso_cents ?? 0),
    })),
    rendimientoDispositivoMes: devicePerf.map((d) => ({
      deviceId: d.deviceId,
      ventas: d._count,
      ingresosCents: d._sum.totalCents ?? 0,
    })),
  };

  const cohortRows = await prisma.$queryRaw<{ month: string; clientes: bigint }[]>`
    SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
           COUNT(*)::bigint AS clientes
    FROM "Customer"
    WHERE "storeId" = ${storeId}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12
  `;

  const ltvRows = await prisma.$queryRaw<
    { customerId: string; orders: bigint; total_cents: bigint }[]
  >`
    SELECT "customerId",
           COUNT(*)::bigint AS orders,
           COALESCE(SUM("totalCents"),0)::bigint AS total_cents
    FROM "Sale"
    WHERE "storeId" = ${storeId} AND "customerId" IS NOT NULL
    GROUP BY "customerId"
    ORDER BY total_cents DESC
    LIMIT 20
  `;

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
    cohortesClientesNuevos: cohortRows.map((r) => ({
      mes: r.month,
      clientes: Number(r.clientes),
    })),
    ltvTop: ltvRows.map((r) => ({
      customerId: r.customerId,
      pedidos: Number(r.orders),
      totalCents: Number(r.total_cents),
    })),
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
