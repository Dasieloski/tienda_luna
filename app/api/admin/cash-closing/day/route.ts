import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD"),
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

function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw);
  return Number.isFinite(v) ? v : -240;
}

function utcRangeForLocalDate(dateStr: string, offsetMinutes: number) {
  const [yy, mm, dd] = dateStr.split("-").map((x) => Number(x));
  const baseUtcMidnight = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  const from = new Date(baseUtcMidnight - offsetMinutes * 60_000);
  const to = new Date(from.getTime() + 24 * 60 * 60_000);
  return { from, to };
}

type ExpectedByDeviceRow = {
  device_id: string;
  sales_count: bigint;
  lines: bigint;
  cash_cents: bigint;
  transfer_cents: bigint;
  usd_cents: bigint;
  unknown_method_sales: bigint;
};

type FxByDeviceRow = {
  device_id: string;
  fx_count: bigint;
  cup_given_cents: bigint;
  usd_value_cup_cents: bigint;
  spread_cup_cents: bigint;
};

type EventWindowRow = { by_client_ts: bigint; by_server_ts: bigint };

async function computeExpected(storeId: string, from: Date, to: Date) {
  let byDevice: ExpectedByDeviceRow[] = [];
  try {
    // Preferir pagos persistidos (SalePayment) por ventana de pago.
    byDevice = await prisma.$queryRaw<ExpectedByDeviceRow[]>`
      WITH pday AS (
        SELECT
          sp."saleId" AS sale_id,
          s."deviceId" AS device_id,
          sp."amountCupCents" AS amount_cup_cents,
          COALESCE(NULLIF(trim(sp.method), ''), '') AS method_raw,
          LOWER(COALESCE(NULLIF(trim(sp.method), ''), '')) AS method_norm,
          sp.currency AS currency
        FROM "SalePayment" sp
        INNER JOIN "Sale" s ON s.id = sp."saleId"
        WHERE sp."storeId" = ${storeId}
          AND sp."paidAt" >= ${from}
          AND sp."paidAt" < ${to}
          AND s."status" = 'COMPLETED'
      ),
      lines_by_sale AS (
        SELECT sl."saleId" AS sale_id, COUNT(*)::bigint AS lines
        FROM "SaleLine" sl
        GROUP BY 1
      )
      SELECT
        pd.device_id AS device_id,
        COUNT(DISTINCT pd.sale_id)::bigint AS sales_count,
        COALESCE(SUM(lbs.lines), 0)::bigint AS lines,
        COALESCE(SUM(
          CASE
            WHEN pd.currency::text = 'USD'
              OR pd.method_norm IN ('usd', 'usd_cash', 'usd_channel')
              OR pd.method_raw ILIKE '%usd%'
              OR pd.method_raw ILIKE '%dolar%'
              OR pd.method_raw ILIKE '%dólar%'
            THEN 0
            WHEN pd.method_norm IN ('transfer', 'transferencia', 'bank', 'banco')
              OR pd.method_raw ILIKE '%trans%'
              OR pd.method_raw ILIKE '%bank%'
              OR pd.method_raw ILIKE '%banco%'
            THEN 0
            WHEN pd.method_norm = ''
            THEN 0
            ELSE pd.amount_cup_cents
          END
        ), 0)::bigint AS cash_cents,
        COALESCE(SUM(
          CASE
            WHEN pd.method_norm IN ('transfer', 'transferencia', 'bank', 'banco')
              OR pd.method_raw ILIKE '%trans%'
              OR pd.method_raw ILIKE '%bank%'
              OR pd.method_raw ILIKE '%banco%'
            THEN pd.amount_cup_cents
            ELSE 0
          END
        ), 0)::bigint AS transfer_cents,
        COALESCE(SUM(
          CASE
            WHEN pd.currency::text = 'USD'
              OR pd.method_norm IN ('usd', 'usd_cash', 'usd_channel')
              OR pd.method_raw ILIKE '%usd%'
              OR pd.method_raw ILIKE '%dolar%'
              OR pd.method_raw ILIKE '%dólar%'
            THEN pd.amount_cup_cents
            ELSE 0
          END
        ), 0)::bigint AS usd_cents,
        COALESCE(SUM(CASE WHEN pd.method_norm = '' THEN 1 ELSE 0 END), 0)::bigint AS unknown_method_sales
      FROM pday pd
      LEFT JOIN lines_by_sale lbs ON lbs.sale_id = pd.sale_id
      GROUP BY pd.device_id
      ORDER BY sales_count DESC, device_id ASC
    `;
  } catch {
    // Fallback legacy: inferir por Event.payload.paymentMethod y fecha de venta.
    byDevice = await prisma.$queryRaw<ExpectedByDeviceRow[]>`
      WITH sday AS (
        SELECT s.id, s."deviceId", s."clientSaleId"
        FROM "Sale" s
        WHERE s."storeId" = ${storeId}
          AND s."status" = 'COMPLETED'
          AND s."completedAt" >= ${from}
          AND s."completedAt" < ${to}
      )
      SELECT
        sd."deviceId" AS device_id,
        COUNT(DISTINCT sd.id)::bigint AS sales_count,
        COUNT(sl.id)::bigint AS lines,
        COALESCE(SUM(
          CASE
            WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%usd%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dolar%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dólar%'
            THEN 0
            WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%trans%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%bank%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%banco%'
            THEN 0
            WHEN e.id IS NULL THEN 0
            ELSE sl."subtotalCents"
          END
        ), 0)::bigint AS cash_cents,
        COALESCE(SUM(
          CASE
            WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%trans%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%bank%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%banco%'
            THEN sl."subtotalCents"
            ELSE 0
          END
        ), 0)::bigint AS transfer_cents,
        COALESCE(SUM(
          CASE
            WHEN (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%usd%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dolar%'
              OR (COALESCE(e.payload->>'paymentMethod','')) ILIKE '%dólar%'
            THEN sl."subtotalCents"
            ELSE 0
          END
        ), 0)::bigint AS usd_cents,
        COALESCE(SUM(CASE WHEN e.id IS NULL THEN 1 ELSE 0 END), 0)::bigint AS unknown_method_sales
      FROM sday sd
      JOIN "SaleLine" sl ON sl."saleId" = sd.id
      LEFT JOIN "Event" e
        ON e."storeId" = ${storeId}
       AND e.type = 'SALE_COMPLETED'
       AND e.status IN ('ACCEPTED', 'CORRECTED')
       AND (e.payload->>'saleId') = sd."clientSaleId"
      GROUP BY sd."deviceId"
      ORDER BY sales_count DESC, device_id ASC
    `;
  }

  const fxByDevice = await prisma.$queryRaw<FxByDeviceRow[]>`
    SELECT
      fx."deviceId" AS device_id,
      COUNT(*)::bigint AS fx_count,
      COALESCE(SUM(fx."cupCentsGiven"), 0)::bigint AS cup_given_cents,
      COALESCE(SUM(fx."usdValueCupCents"), 0)::bigint AS usd_value_cup_cents,
      COALESCE(SUM(fx."spreadCupCents"), 0)::bigint AS spread_cup_cents
    FROM "FxExchange" fx
    WHERE fx."storeId" = ${storeId}
      AND fx."exchangedAt" >= ${from}
      AND fx."exchangedAt" < ${to}
    GROUP BY fx."deviceId"
    ORDER BY fx_count DESC, device_id ASC
  `;

  const offsetMinutes = storeTzOffsetMinutes();
  const byWindow = await prisma.$queryRaw<EventWindowRow[]>`
    SELECT
      COALESCE(SUM(
        CASE WHEN to_timestamp(("clientTimestamp"::double precision)/1000.0) >= ${from}
              AND to_timestamp(("clientTimestamp"::double precision)/1000.0) < ${to}
          THEN 1 ELSE 0 END
      ),0)::bigint AS by_client_ts,
      COALESCE(SUM(
        CASE WHEN "serverTimestamp" >= ${from}
              AND "serverTimestamp" < ${to}
          THEN 1 ELSE 0 END
      ),0)::bigint AS by_server_ts
    FROM "Event"
    WHERE "storeId" = ${storeId}
      AND type = 'SALE_COMPLETED'
      AND status IN ('ACCEPTED','CORRECTED')
  `;

  const totals = byDevice.reduce(
    (acc, r) => {
      acc.cashExpectedCents += Number(r.cash_cents ?? BigInt(0));
      acc.transferExpectedCents += Number(r.transfer_cents ?? BigInt(0));
      acc.usdChannelExpectedCents += Number(r.usd_cents ?? BigInt(0));
      acc.salesCount += Number(r.sales_count ?? BigInt(0));
      acc.unknownPaymentMethodSales += Number(r.unknown_method_sales ?? BigInt(0));
      return acc;
    },
    {
      cashExpectedCents: 0,
      transferExpectedCents: 0,
      usdChannelExpectedCents: 0,
      salesCount: 0,
      unknownPaymentMethodSales: 0,
    },
  );

  const fxTotals = fxByDevice.reduce(
    (acc, r) => {
      acc.fxCount += Number(r.fx_count ?? BigInt(0));
      acc.cupGivenCents += Number(r.cup_given_cents ?? BigInt(0));
      acc.usdValueCupCents += Number(r.usd_value_cup_cents ?? BigInt(0));
      acc.spreadCupCents += Number(r.spread_cup_cents ?? BigInt(0));
      return acc;
    },
    { fxCount: 0, cupGivenCents: 0, usdValueCupCents: 0, spreadCupCents: 0 },
  );

  // Cambios USD→CUP: sale CUP (efectivo) y entra USD (canal USD, expresado en CUP céntimos)
  totals.cashExpectedCents -= fxTotals.cupGivenCents;
  totals.usdChannelExpectedCents += fxTotals.usdValueCupCents;

  const win = byWindow[0];
  const eventsByClientTs = Number(win?.by_client_ts ?? BigInt(0));
  const eventsByServerTs = Number(win?.by_server_ts ?? BigInt(0));

  const findings: Array<{
    code: string;
    severity: "INFO" | "WARN" | "ERROR";
    title: string;
    detail: string;
    suggestion?: string;
    evidence?: any;
  }> = [];

  if (totals.unknownPaymentMethodSales > 0) {
    findings.push({
      code: "MISSING_EVENT_LINK",
      severity: "WARN",
      title: "Ventas sin evento asociado (método de pago desconocido)",
      detail:
        `Hay ${totals.unknownPaymentMethodSales} venta(s)/línea(s) donde no se pudo enlazar el evento ` +
        `"SALE_COMPLETED" por "clientSaleId". Esto puede distorsionar efectivo/transferencia/USD en el esperado.`,
      suggestion:
        "Revisa sincronización del dispositivo y que el tablet esté enviando saleId consistentemente. También revisa si hubo ventas manuales desde web sin evento.",
      evidence: { unknownPaymentMethodSales: totals.unknownPaymentMethodSales },
    });
  }

  if (fxTotals.fxCount > 0 && fxTotals.spreadCupCents < 0) {
    findings.push({
      code: "FX_NEGATIVE_SPREAD",
      severity: "WARN",
      title: "Cambios con spread negativo",
      detail:
        `En el período hay cambios USD→CUP con spread total negativo de ${fxTotals.spreadCupCents} CUP céntimos. ` +
        `Esto suele indicar que se entregó más CUP que el equivalente por tasa.`,
      evidence: fxTotals,
    });
  }

  if (eventsByClientTs > eventsByServerTs + 2) {
    findings.push({
      code: "SYNC_LAG",
      severity: "WARN",
      title: "Probable retraso de sincronización (tablet → servidor)",
      detail:
        `Por timestamp del cliente, hay ${eventsByClientTs} evento(s) de venta para el día, ` +
        `pero por timestamp del servidor solo ${eventsByServerTs}. Esto suele pasar cuando el tablet sincroniza tarde.`,
      suggestion: "Forzar sincronización del tablet, verificar conexión y revisar el endpoint de sync del día.",
      evidence: { eventsByClientTs, eventsByServerTs },
    });
  }

  return { byDevice, totals: { ...totals, fx: fxTotals }, fxByDevice, findings, eventsByClientTs, eventsByServerTs };
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const, message: "DB_NOT_AVAILABLE" } }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ date: url.searchParams.get("date") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const offset = storeTzOffsetMinutes();
  const { from, to } = utcRangeForLocalDate(parsed.data.date, offset);
  const storeId = guard.session.storeId;

  try {
    const computed = await computeExpected(storeId, from, to);
    const day = await prisma.cashClosingDay.findUnique({
      where: { storeId_dayYmd: { storeId, dayYmd: parsed.data.date } },
      include: {
        notes: { orderBy: { createdAt: "desc" }, take: 40 },
        findings: { orderBy: { createdAt: "desc" }, take: 60 },
        revisions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    return NextResponse.json({
      meta: { dbAvailable: true as const, tzOffsetMinutes: offset },
      dayYmd: parsed.data.date,
      utcRange: { from: from.toISOString(), to: to.toISOString() },
      computed: {
        totals: computed.totals,
        byDevice: computed.byDevice.map((r) => ({
          deviceId: r.device_id,
          salesCount: Number(r.sales_count ?? BigInt(0)),
          cashExpectedCents: Number(r.cash_cents ?? BigInt(0)),
          transferExpectedCents: Number(r.transfer_cents ?? BigInt(0)),
          usdChannelExpectedCents: Number(r.usd_cents ?? BigInt(0)),
          unknownPaymentMethodSales: Number(r.unknown_method_sales ?? BigInt(0)),
        })),
        fxByDevice: computed.fxByDevice.map((r) => ({
          deviceId: r.device_id,
          fxCount: Number(r.fx_count ?? BigInt(0)),
          cupGivenCents: Number(r.cup_given_cents ?? BigInt(0)),
          usdValueCupCents: Number(r.usd_value_cup_cents ?? BigInt(0)),
          spreadCupCents: Number(r.spread_cup_cents ?? BigInt(0)),
        })),
        findings: computed.findings,
      },
      audit: day
        ? {
            id: day.id,
            status: day.status,
            category: day.category,
            observation: day.observation,
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
            validatedByUserId: day.validatedByUserId,
            updatedAt: day.updatedAt.toISOString(),
            notes: day.notes.map((n) => ({
              id: n.id,
              category: n.category,
              message: n.message,
              actorUserId: n.actorUserId,
              createdAt: n.createdAt.toISOString(),
            })),
            findings: day.findings.map((f) => ({
              id: f.id,
              code: f.code,
              severity: f.severity,
              title: f.title,
              detail: f.detail,
              suggestion: f.suggestion,
              createdAt: f.createdAt.toISOString(),
            })),
            revisions: day.revisions.map((r) => ({
              id: r.id,
              actorUserId: r.actorUserId,
              action: r.action,
              createdAt: r.createdAt.toISOString(),
            })),
          }
        : null,
    });
  } catch (err) {
    console.error("[api/admin/cash-closing/day]", err);
    return NextResponse.json(
      { meta: { dbAvailable: false as const, message: err instanceof Error ? err.message : "DB" } },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const { from, to } = utcRangeForLocalDate(parsed.data.date, storeTzOffsetMinutes());
  const storeId = guard.session.storeId;

  if (parsed.data.status === "INCORRECT") {
    const obs = parsed.data.observation?.trim() ?? "";
    if (!obs) return NextResponse.json({ error: "OBSERVATION_REQUIRED" }, { status: 400 });
    if (!parsed.data.category) return NextResponse.json({ error: "CATEGORY_REQUIRED" }, { status: 400 });
  }

  const computed = await computeExpected(storeId, from, to);
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
      validatedByUserId: guard.user.id,
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
      validatedByUserId: guard.user.id,
    },
  });

  await prisma.cashClosingRevision.create({
    data: {
      storeId,
      cashClosingDayId: next.id,
      actorUserId: guard.user.id,
      action: existing ? "UPDATE" : "CREATE",
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
        actorUserId: guard.user.id,
      },
    });
  }

  // Persistir findings automáticos (diagnóstico) para trazabilidad histórica.
  // Se recalculan en cada validación/actualización para reflejar el estado real del día.
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

  return NextResponse.json({ ok: true, id: next.id });
}

