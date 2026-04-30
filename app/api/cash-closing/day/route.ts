import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canSync, getSessionFromRequest } from "@/lib/auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import {
  computeCashClosingExpected,
  storeTzOffsetMinutes,
  utcRangeForLocalDate,
} from "@/lib/cash-closing";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD"),
  scope: z.enum(["store", "device"]).optional().default("device"),
});

const upsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["CORRECT", "INCORRECT"]),
  cashCountedCents: z.number().int().min(0),
  transferCountedCents: z.number().int().min(0),
  usdChannelCountedCents: z.number().int().min(0),
  category: z
    .enum(["CASH_SHORT", "CASH_OVER", "HUMAN_ERROR", "SYSTEM_BUG", "DESYNC", "TZ_DRIFT", "OTHER"])
    .optional()
    .nullable(),
  observation: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

/**
 * Endpoint para la APK (sesión device/cajero) para consumir el cuadre:
 * - Esperado por método (SalePayment.paidAt)
 * - FX USD→CUP
 * - Findings automáticos (en vivo)
 * - Último estado validado (si existe) + findings persistidos
 */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const, message: "DB_NOT_AVAILABLE" } }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? "",
    scope: url.searchParams.get("scope") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const storeId = session.storeId;
  const offset = storeTzOffsetMinutes();
  const { from, to } = utcRangeForLocalDate(parsed.data.date, offset);

  try {
    const computed = await computeCashClosingExpected(storeId, from, to);

    const day = await prisma.cashClosingDay.findUnique({
      where: { storeId_dayYmd: { storeId, dayYmd: parsed.data.date } },
      include: {
        findings: { orderBy: { createdAt: "desc" }, take: 60 },
      },
    });

    const scope = parsed.data.scope;
    const deviceId = session.typ === "device" ? session.sub : null;

    const byDevice = computed.byDevice
      .map((r) => ({
        deviceId: r.device_id,
        salesCount: Number(r.sales_count ?? BigInt(0)),
        cashExpectedCents: Number(r.cash_cents ?? BigInt(0)),
        transferExpectedCents: Number(r.transfer_cents ?? BigInt(0)),
        usdChannelExpectedCents: Number(r.usd_cents ?? BigInt(0)),
        unknownPaymentMethodSales: Number(r.unknown_method_sales ?? BigInt(0)),
      }))
      .filter((r) => (scope === "store" ? true : deviceId ? r.deviceId === deviceId : true));

    const fxByDevice = computed.fxByDevice
      .map((r) => ({
        deviceId: r.device_id,
        fxCount: Number(r.fx_count ?? BigInt(0)),
        cupGivenCents: Number(r.cup_given_cents ?? BigInt(0)),
        usdValueCupCents: Number(r.usd_value_cup_cents ?? BigInt(0)),
        spreadCupCents: Number(r.spread_cup_cents ?? BigInt(0)),
      }))
      .filter((r) => (scope === "store" ? true : deviceId ? r.deviceId === deviceId : true));

    return NextResponse.json({
      meta: { dbAvailable: true as const, tzOffsetMinutes: offset, scope, deviceId },
      dayYmd: parsed.data.date,
      utcRange: { from: from.toISOString(), to: to.toISOString() },
      computed: {
        totals: computed.totals,
        byDevice,
        fxByDevice,
        findings: computed.findings,
      },
      lastValidated: day
        ? {
            status: day.status,
            counted: {
              cashCountedCents: day.cashCountedCents,
              transferCountedCents: day.transferCountedCents,
              usdChannelCountedCents: day.usdChannelCountedCents,
            },
            expectedSnapshot: {
              cashExpectedCents: day.cashExpectedCents,
              transferExpectedCents: day.transferExpectedCents,
              usdChannelExpectedCents: day.usdChannelExpectedCents,
            },
            diffTotalCents: day.diffTotalCents,
            updatedAt: day.updatedAt.toISOString(),
            findings: day.findings.map((f) => ({
              code: f.code,
              severity: f.severity,
              title: f.title,
              detail: f.detail,
              suggestion: f.suggestion,
              evidence: f.evidence,
              createdAt: f.createdAt.toISOString(),
            })),
          }
        : null,
    });
  } catch (err) {
    console.error("[api/cash-closing/day]", err);
    return NextResponse.json(
      { meta: { dbAvailable: false as const, message: err instanceof Error ? err.message : "DB" } },
      { status: 200 },
    );
  }
}

/**
 * Endpoint para la APK (sesión device/cajero) para validar/guardar el "contado" del día.
 * No usa CSRF (se autentica por Bearer/session `canSync`).
 */
export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  if (parsed.data.status === "INCORRECT") {
    const obs = parsed.data.observation?.trim() ?? "";
    if (!obs) return NextResponse.json({ error: "OBSERVATION_REQUIRED" }, { status: 400 });
    if (!parsed.data.category) return NextResponse.json({ error: "CATEGORY_REQUIRED" }, { status: 400 });
  }

  const storeId = session.storeId;
  const offset = storeTzOffsetMinutes();
  const { from, to } = utcRangeForLocalDate(parsed.data.date, offset);

  const actorId = session.typ === "device" ? `device:${session.sub}` : session.sub;

  const computed = await computeCashClosingExpected(storeId, from, to);
  const expectedTotal =
    computed.totals.cashExpectedCents + computed.totals.transferExpectedCents + computed.totals.usdChannelExpectedCents;
  const countedTotal =
    parsed.data.cashCountedCents + parsed.data.transferCountedCents + parsed.data.usdChannelCountedCents;
  const diffTotalCents = countedTotal - expectedTotal;

  const existing = await prisma.cashClosingDay.findUnique({
    where: { storeId_dayYmd: { storeId, dayYmd: parsed.data.date } },
  });

  const next = await prisma.cashClosingDay.upsert({
    where: { storeId_dayYmd: { storeId, dayYmd: parsed.data.date } },
    create: {
      storeId,
      dayYmd: parsed.data.date,
      status: parsed.data.status,
      cashCountedCents: parsed.data.cashCountedCents,
      transferCountedCents: parsed.data.transferCountedCents,
      usdChannelCountedCents: parsed.data.usdChannelCountedCents,
      cashExpectedCents: computed.totals.cashExpectedCents,
      transferExpectedCents: computed.totals.transferExpectedCents,
      usdChannelExpectedCents: computed.totals.usdChannelExpectedCents,
      diffTotalCents,
      category: parsed.data.category ?? null,
      observation: parsed.data.observation ?? null,
      validatedByUserId: actorId,
    },
    update: {
      status: parsed.data.status,
      cashCountedCents: parsed.data.cashCountedCents,
      transferCountedCents: parsed.data.transferCountedCents,
      usdChannelCountedCents: parsed.data.usdChannelCountedCents,
      cashExpectedCents: computed.totals.cashExpectedCents,
      transferExpectedCents: computed.totals.transferExpectedCents,
      usdChannelExpectedCents: computed.totals.usdChannelExpectedCents,
      diffTotalCents,
      category: parsed.data.category ?? null,
      observation: parsed.data.observation ?? null,
      validatedByUserId: actorId,
    },
  });

  await prisma.cashClosingRevision.create({
    data: {
      storeId,
      cashClosingDayId: next.id,
      actorUserId: actorId,
      action: existing ? "UPDATE_DEVICE" : "CREATE_DEVICE",
      before: existing as any,
      after: next as any,
      meta: {
        computed: computed.totals,
        byDevice: computed.byDevice.map((r) => ({
          deviceId: r.device_id,
          salesCount: Number(r.sales_count ?? BigInt(0)),
          cashExpectedCents: Number(r.cash_cents ?? BigInt(0)),
          transferExpectedCents: Number(r.transfer_cents ?? BigInt(0)),
          usdChannelExpectedCents: Number(r.usd_cents ?? BigInt(0)),
          unknownPaymentMethodSales: Number(r.unknown_method_sales ?? BigInt(0)),
        })),
      },
    },
  });

  if (parsed.data.note?.trim()) {
    await prisma.cashClosingNote.create({
      data: {
        storeId,
        cashClosingDayId: next.id,
        category: parsed.data.category ?? null,
        message: parsed.data.note.trim(),
        actorUserId: actorId,
      },
    });
  }

  // Persistir findings automáticos (diagnóstico) para trazabilidad histórica.
  await prisma.cashClosingFinding.deleteMany({
    where: { storeId, cashClosingDayId: next.id },
  });
  if (computed.findings.length > 0) {
    await prisma.cashClosingFinding.createMany({
      data: computed.findings.map((f) => ({
        storeId,
        cashClosingDayId: next.id,
        code: f.code,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        suggestion: f.suggestion ?? null,
        evidence: "evidence" in f ? ((f as any).evidence ?? null) : null,
      })),
    });
  }

  return NextResponse.json({ ok: true, id: next.id, diffTotalCents });
}

