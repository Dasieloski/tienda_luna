/**
 * API Route: GET /api/admin/exchange-rate/history
 *
 * Devuelve el historial de actualizaciones automáticas de la tasa de cambio
 * leyendo desde los audit logs. Útil para monitoreo y debugging.
 */

import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type AuditLogMeta = {
  executionId?: string;
  source?: string;
  method?: string;
};

type AuditLogRate = {
  usdRateCup?: number;
};

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) {
    return guard.res;
  }

  const { storeId } = guard.user;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  try {
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          storeId,
          action: "EXCHANGE_RATE_AUTO_UPDATE",
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          createdAt: true,
          before: true,
          after: true,
          meta: true,
        },
      }),
      prisma.auditLog.count({
        where: {
          storeId,
          action: "EXCHANGE_RATE_AUTO_UPDATE",
        },
      }),
    ]);

    return NextResponse.json({
      logs: logs.map((log) => {
        const before = log.before as Prisma.JsonValue;
        const after = log.after as Prisma.JsonValue;
        const meta = log.meta as Prisma.JsonValue;

        return {
          id: log.id,
          timestamp: log.createdAt.toISOString(),
          previousRate:
            before && typeof before === "object" && "usdRateCup" in before
              ? (before as AuditLogRate).usdRateCup ?? null
              : null,
          newRate:
            after && typeof after === "object" && "usdRateCup" in after
              ? (after as AuditLogRate).usdRateCup ?? null
              : null,
          executionId:
            meta && typeof meta === "object" && "executionId" in meta
              ? (meta as AuditLogMeta).executionId ?? null
              : null,
          source:
            meta && typeof meta === "object" && "source" in meta
              ? (meta as AuditLogMeta).source ?? "eltoque.com"
              : "eltoque.com",
          method:
            meta && typeof meta === "object" && "method" in meta
              ? (meta as AuditLogMeta).method ?? "cloudflare-browser-run-json"
              : "cloudflare-browser-run-json",
        };
      }),
      total,
      limit,
      offset,
    });
  } catch (e) {
    console.error("[api/admin/exchange-rate/history]", e);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}
