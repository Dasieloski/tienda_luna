import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentCurrency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const ENTRY_TYPES = ["ACCRUAL", "ADJUSTMENT", "RECLASS", "NOTE"] as const;

const listSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  impactMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  entryType: z.enum(ENTRY_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});

const createSchema = z
  .object({
    entryType: z.enum(ENTRY_TYPES),
    postedAt: z.string().datetime(),
    impactMonth: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
    description: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(1000).optional().nullable(),
    currency: z.enum(["CUP", "USD"]).default("CUP"),
    /** Importe con signo en centavos CUP (negativo = egreso). */
    amountCupSignedCents: z.number().int().optional(),
    /** Importe con signo en centavos USD (negativo = egreso). Se convierte a CUP vía tasa. */
    amountUsdSignedCents: z.number().int().optional(),
    usdRateCup: z.number().int().min(1).max(100000).optional(),
    relatedExpenseId: z.string().min(1).optional().nullable(),
    relatedSaleId: z.string().min(1).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.currency === "CUP") {
      if (v.amountCupSignedCents == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amountCupSignedCents", path: ["amountCupSignedCents"] });
      }
    } else if (v.amountUsdSignedCents == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amountUsdSignedCents", path: ["amountUsdSignedCents"] });
    }
  });

function getStoreUsdRateFallback(): number {
  const env = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  return Number.isFinite(env) && env > 0 ? Math.round(env) : 250;
}

function signedAmountParts(input: {
  currency: "CUP" | "USD";
  amountCupSignedCents?: number;
  amountUsdSignedCents?: number;
  usdRateCup?: number;
  storeUsdRateCup: number;
}) {
  if (input.currency === "USD") {
    const usd = input.amountUsdSignedCents ?? 0;
    const rate = input.usdRateCup ?? input.storeUsdRateCup;
    const cup = Math.round((usd / 100) * Math.round(rate) * 100);
    return {
      currency: PaymentCurrency.USD,
      amountCents: cup,
      originalAmount: usd,
      usdRateCup: Math.round(rate),
    };
  }
  return {
    currency: PaymentCurrency.CUP,
    amountCents: input.amountCupSignedCents ?? 0,
    originalAmount: null,
    usdRateCup: null,
  };
}

function serializeEntry(r: {
  id: string;
  postedAt: Date;
  impactMonth: string | null;
  entryType: string;
  amountCents: number;
  currency: PaymentCurrency;
  originalAmount: number | null;
  usdRateCup: number | null;
  description: string;
  notes: string | null;
  relatedExpenseId: string | null;
  relatedSaleId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    postedAt: r.postedAt.toISOString(),
    impactMonth: r.impactMonth,
    entryType: r.entryType,
    amountCents: r.amountCents,
    currency: r.currency,
    originalAmount: r.originalAmount,
    usdRateCup: r.usdRateCup,
    description: r.description,
    notes: r.notes,
    relatedExpenseId: r.relatedExpenseId,
    relatedSaleId: r.relatedSaleId,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ entries: [], meta: { dbAvailable: false as const } }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    impactMonth: url.searchParams.get("impactMonth") ?? undefined,
    entryType: url.searchParams.get("entryType") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (parsed.data.from) dateFilter.gte = new Date(parsed.data.from);
  if (parsed.data.to) dateFilter.lte = new Date(parsed.data.to);

  const rows = await prisma.accountingEntry.findMany({
    where: {
      storeId: guard.session.storeId,
      ...(parsed.data.from || parsed.data.to ? { postedAt: dateFilter } : {}),
      ...(parsed.data.impactMonth != null ? { impactMonth: parsed.data.impactMonth } : {}),
      ...(parsed.data.entryType ? { entryType: parsed.data.entryType } : {}),
    },
    orderBy: { postedAt: "desc" },
    take: parsed.data.limit,
  });

  return NextResponse.json({
    entries: rows.map(serializeEntry),
    meta: { dbAvailable: true as const },
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const store = await prisma.store.findUnique({
    where: { id: guard.session.storeId },
    select: { usdRateCup: true },
  });
  const storeUsd = store?.usdRateCup ?? getStoreUsdRateFallback();

  const parts = signedAmountParts({
    currency: parsed.data.currency,
    amountCupSignedCents: parsed.data.amountCupSignedCents,
    amountUsdSignedCents: parsed.data.amountUsdSignedCents,
    usdRateCup: parsed.data.usdRateCup,
    storeUsdRateCup: storeUsd,
  });

  const row = await prisma.accountingEntry.create({
    data: {
      storeId: guard.session.storeId,
      postedAt: new Date(parsed.data.postedAt),
      impactMonth: parsed.data.impactMonth ?? null,
      entryType: parsed.data.entryType,
      amountCents: parts.amountCents,
      currency: parts.currency,
      originalAmount: parts.originalAmount,
      usdRateCup: parts.usdRateCup,
      description: parsed.data.description,
      notes: parsed.data.notes ?? null,
      relatedExpenseId: parsed.data.relatedExpenseId ?? null,
      relatedSaleId: parsed.data.relatedSaleId ?? null,
      createdByUserId: guard.user.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "ACCOUNTING_ENTRY_CREATED",
      entityType: "AccountingEntry",
      entityId: row.id,
      after: row as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true, entry: serializeEntry(row) });
}
