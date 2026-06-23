/**
 * API Route: POST /api/admin/exchange-rate/scrape
 *
 * Fuerza la ejecución del scraper de tasa de cambio USD/CUP
 * desde eltoque.com usando Cloudflare Browser Run.
 *
 * Protegido por autenticación de administrador.
 * Puede ser invocado manualmente desde el panel o automáticamente
 * por un Verdicel Cron programado.
 */

import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { scrapeAndUpdateUsdRate } from "@/services/exchange-rate-scraper-service";

export async function POST(request: Request) {
  // ── Guardia de autenticación ──
  const guard = await requireAdminRequest(request);
  if (!guard.ok) {
    return guard.res;
  }

  const { storeId } = guard.user;

  // ── Ejecutar scraping ──
  const result = await scrapeAndUpdateUsdRate(storeId);

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        executionId: result.executionId,
        details: result.details,
        previousRate: result.previousRate,
      },
      { status: 502 } // Bad Gateway: el upstream (Browser Run) falló
    );
  }

  return NextResponse.json({
    success: true,
    rateCup: result.rateCup,
    previousRate: result.previousRate,
    updated: result.updated,
    executionId: result.executionId,
    details: result.details,
  });
}
