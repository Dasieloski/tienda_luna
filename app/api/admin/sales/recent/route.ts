import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

type SaleRecentRow = Prisma.SaleGetPayload<{
  include: {
    lines: { include: { product: { select: { name: true; sku: true } } } };
    payments: {
      orderBy: { paidAt: "asc" };
      take: 12;
      select: {
        id: true;
        amountCupCents: true;
        currency: true;
        originalAmount: true;
        usdRateCup: true;
        method: true;
        paidAt: true;
      };
    };
    returns: {
      orderBy: { returnedAt: "asc" };
      take: 8;
      include: {
        lines: {
          select: {
            id: true;
            productId: true;
            productName: true;
            productSku: true;
            quantity: true;
            unitPriceCents: true;
            subtotalCents: true;
          };
        };
      };
    };
  };
}>;

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).optional().default(35),
    /** ISO datetime (recomendado) */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Día local YYYY-MM-DD (se interpreta con TL_TZ_OFFSET_MINUTES / NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES) */
    fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.from && val.to && val.from.getTime() > val.to.getTime()) {
      ctx.addIssue({ code: "custom", message: "from debe ser <= to" });
    }
    if (val.fromDay && val.from) {
      ctx.addIssue({ code: "custom", message: "No mezcles fromDay con from" });
    }
    if (val.toDay && val.to) {
      ctx.addIssue({ code: "custom", message: "No mezcles toDay con to" });
    }
  });

function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw); // default Cuba (UTC-4)
  return Number.isFinite(v) ? v : -240;
}

function localDayBoundsUtc(dayYmd: string, endExclusive: boolean) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayYmd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const offsetMinutes = storeTzOffsetMinutes();
  const localStart = new Date(y, mo, d, 0, 0, 0, 0);
  const localEnd = endExclusive ? new Date(y, mo, d + 1, 0, 0, 0, 0) : localStart;
  const toUtc = (dt: Date) => new Date(dt.getTime() - offsetMinutes * 60_000);
  return { fromUtc: toUtc(localStart), toUtc: toUtc(localEnd) };
}

function getPayloadNumberMaybe(payload: unknown, keys: string[]): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    fromDay: url.searchParams.get("fromDay") ?? undefined,
    toDay: url.searchParams.get("toDay") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ sales: [], meta: { dbAvailable: false } });
  }

  try {
    const q = parsed.data;
    let completedAt:
      | undefined
      | {
          gte?: Date;
          lte?: Date;
          lt?: Date;
        } = undefined;

    if (q.fromDay || q.toDay) {
      const fromB = q.fromDay ? localDayBoundsUtc(q.fromDay, false) : null;
      const toB = q.toDay ? localDayBoundsUtc(q.toDay, true) : null;
      if ((q.fromDay && !fromB) || (q.toDay && !toB)) {
        return NextResponse.json({ error: "INVALID_DAY" }, { status: 400 });
      }
      completedAt = {
        ...(fromB ? { gte: fromB.fromUtc } : {}),
        ...(toB ? { lt: toB.toUtc } : {}),
      };
    } else if (q.from || q.to) {
      completedAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }

    const sales = (await prisma.sale.findMany({
      where: { storeId: session.storeId, ...(completedAt ? { completedAt } : {}) },
      orderBy: { completedAt: "desc" },
      take: parsed.data.limit,
      include: {
        lines: {
          include: {
            product: { select: { name: true, sku: true } },
          },
        },
        payments: {
          orderBy: { paidAt: "asc" },
          take: 12,
          select: {
            id: true,
            amountCupCents: true,
            currency: true,
            originalAmount: true,
            usdRateCup: true,
            method: true,
            paidAt: true,
          },
        },
        returns: {
          orderBy: { returnedAt: "asc" },
          take: 8,
          include: {
            lines: {
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
        },
      },
    })) as SaleRecentRow[];

    const clientSaleIds = sales.map((s) => s.clientSaleId).filter(Boolean) as string[];
    const events = clientSaleIds.length
      ? await prisma.event.findMany({
          where: {
            storeId: session.storeId,
            type: "SALE_COMPLETED",
            status: { in: ["ACCEPTED", "CORRECTED"] },
            relatedClientSaleId: { in: clientSaleIds },
          },
          orderBy: { serverTimestamp: "desc" },
          select: {
            relatedClientSaleId: true,
            payload: true,
            serverTimestamp: true,
          },
        })
      : [];

    const eventBySaleId = new Map<string, { payload: unknown; serverTimestamp: Date }>();
    for (const e of events) {
      const k = e.relatedClientSaleId;
      if (!k) continue;
      if (!eventBySaleId.has(k)) eventBySaleId.set(k, { payload: e.payload, serverTimestamp: e.serverTimestamp });
    }

    return NextResponse.json({
      sales: sales.map((s) => ({
        clientSaleId: s.clientSaleId ?? null,
        id: s.id,
        deviceId: s.deviceId,
        totalCents: s.totalCents,
        paidTotalCents: s.paidTotalCents,
        balanceCents: s.balanceCents,
        paymentStatus: s.paymentStatus,
        editedAt: s.editedAt ? s.editedAt.toISOString() : null,
        revisionCount: s.revisionCount,
        status: s.status,
        completedAt: s.completedAt.toISOString(),
        paymentMethod:
          (() => {
            const payload = eventBySaleId.get(s.clientSaleId ?? "")?.payload;
            if (!payload || typeof payload !== "object") return null;
            const pm = (payload as Record<string, unknown>).paymentMethod;
            return typeof pm === "string" && pm.trim() ? pm : null;
          })(),
        paidCents:
          getPayloadNumberMaybe(eventBySaleId.get(s.clientSaleId ?? "")?.payload, [
            "paidCents",
            "amountPaidCents",
            "cashGivenCents",
            "cashReceivedCents",
          ]),
        changeCents:
          getPayloadNumberMaybe(eventBySaleId.get(s.clientSaleId ?? "")?.payload, [
            "changeCents",
            "vueltoCents",
          ]),
        payments: s.payments.map((p) => ({
          id: p.id,
          amountCupCents: p.amountCupCents,
          currency: String(p.currency),
          originalAmount: p.originalAmount ?? null,
          usdRateCup: p.usdRateCup ?? null,
          method: p.method,
          paidAt: p.paidAt.toISOString(),
        })),
        returns: s.returns.map((r) => ({
          id: r.id,
          amountCupCents: r.amountCupCents,
          reason: r.reason ?? null,
          returnedAt: r.returnedAt.toISOString(),
          lines: r.lines.map((l) => ({
            id: l.id,
            productId: l.productId,
            productName: l.productName ?? "—",
            sku: l.productSku ?? "—",
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            subtotalCents: l.subtotalCents,
          })),
        })),
        lines: s.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          subtotalCents: l.subtotalCents,
          productName: l.product?.name ?? l.productName ?? "—",
          sku: l.product?.sku ?? l.productSku ?? "—",
        })),
      })),
      meta: { dbAvailable: true as const },
    });
  } catch (err) {
    console.error("[api/admin/sales/recent]", err);
    return NextResponse.json(
      { sales: [], meta: { dbAvailable: false, message: err instanceof Error ? err.message : "DB" } },
      { status: 200 },
    );
  }
}
