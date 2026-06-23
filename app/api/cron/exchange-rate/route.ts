/**
 * API Route: GET /api/cron/exchange-rate
 *
 * Endpoint para ejecución programada desde GitHub Actions.
 * No requiere sesión de administrador porque las invocaciones vienen
 * protegidas por CRON_SECRET.
 *
 * Schedule en .github/workflows/exchange-rate-scraper.yml (Cuba UTC-4):
 * - 01:00 UTC = 21:00 Cuba (noche)
 * - 10:00 UTC = 06:00 Cuba (mañana)
 * - 17:00 UTC = 13:00 Cuba (mediodía)
 */

import { NextResponse } from "next/server";
import { scrapeAndUpdateUsdRate } from "@/services/exchange-rate-scraper-service";
import { prisma } from "@/lib/db";

/**
 * Verifica que la petición provenga del scheduler autorizado.
 * Vercel Cron envía el header `Authorization: Bearer <CRON_SECRET>`
 * cuando se configura CRON_SECRET en el dashboard.
 */
function verifyCronAuth(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    // Si no hay CRON_SECRET configurado, bloqueamos en producción pero
    // permitimos en desarrollo para facilitar pruebas.
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/exchange-rate] CRON_SECRET no configurado en producción");
      return false;
    }
    return true;
  }

  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer === expected;
}

/**
 * GET handler para GitHub Actions Cron.
 * Actualiza automáticamente la tasa de cambio USD/CUP para TODAS las tiendas.
 *
 * Schedule en .github/workflows/exchange-rate-scraper.yml (Cuba UTC-4):
 * - 01:00 UTC = 21:00 Cuba (noche)
 * - 10:00 UTC = 06:00 Cuba (mañana)
 * - 17:00 UTC = 13:00 Cuba (mediodía)
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Obtener todas las tiendas activas para actualizar independientemente.
  // El campo `usdRateCup` es por tienda, aunque en la práctica el valor es global.
  let stores: { id: string; name: string }[];
  try {
    stores = await prisma.store.findMany({
      select: { id: true, name: true },
    });
  } catch (e) {
    console.error("[cron/exchange-rate] Error leyendo tiendas:", e);
    return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  }

  const results = [];
  for (const store of stores) {
    const result = await scrapeAndUpdateUsdRate(store.id);
    results.push({
      storeId: store.id,
      storeName: store.name,
      ...result,
    });
  }

  const okCount = results.filter((r) => r.success).length;
  const failCount = results.length - okCount;

  return NextResponse.json({
    success: failCount === 0,
    totalStores: results.length,
    updated: okCount,
    failed: failCount,
    results,
  });
}
