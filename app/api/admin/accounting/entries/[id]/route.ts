import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentCurrency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const ENTRY_TYPES = ["ACCRUAL", "ADJUSTMENT", "RECLASS", "NOTE"] as const;

const updateSchema = z
  .object({
    entryType: z.enum(ENTRY_TYPES).optional(),
    postedAt: z.string().datetime().optional(),
    impactMonth: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
    description: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().max(1000).optional().nullable(),
    currency: z.enum(["CUP", "USD"]).optional(),
    amountCupSignedCents: z.number().int().optional(),
    amountUsdSignedCents: z.number().int().optional(),
    usdRateCup: z.number().int().min(1).max(100000).optional(),
    relatedExpenseId: z.string().min(1).optional().nullable(),
    relatedSaleId: z.string().min(1).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, "EMPTY_UPDATE");

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

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const json = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const existing = await prisma.accountingEntry.findFirst({
    where: { id, storeId: guard.session.storeId },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const store = await prisma.store.findUnique({
    where: { id: guard.session.storeId },
    select: { usdRateCup: true },
  });
  const storeUsd = store?.usdRateCup ?? getStoreUsdRateFallback();

  const data: Prisma.AccountingEntryUpdateInput = {};
  if (parsed.data.entryType != null) data.entryType = parsed.data.entryType;
  if (parsed.data.postedAt != null) data.postedAt = new Date(parsed.data.postedAt);
  if ("impactMonth" in parsed.data) data.impactMonth = parsed.data.impactMonth ?? null;
  if (parsed.data.description != null) data.description = parsed.data.description;
  if ("notes" in parsed.data) data.notes = parsed.data.notes ?? null;
  if ("relatedExpenseId" in parsed.data) data.relatedExpenseId = parsed.data.relatedExpenseId ?? null;
  if ("relatedSaleId" in parsed.data) data.relatedSaleId = parsed.data.relatedSaleId ?? null;

  const touchAmount =
    parsed.data.currency != null ||
    parsed.data.amountCupSignedCents != null ||
    parsed.data.amountUsdSignedCents != null ||
    parsed.data.usdRateCup != null;

  if (touchAmount) {
    const cur = (parsed.data.currency ?? existing.currency) === "USD" ? "USD" : "CUP";
    const rateRounded = Math.round(parsed.data.usdRateCup ?? existing.usdRateCup ?? storeUsd);

    let cupSigned: number;
    let usdSigned: number;
    if (cur === "CUP") {
      cupSigned = parsed.data.amountCupSignedCents ?? existing.amountCents;
      const parts = signedAmountParts({
        currency: "CUP",
        amountCupSignedCents: cupSigned,
        storeUsdRateCup: storeUsd,
      });
      data.amountCents = parts.amountCents;
      data.currency = parts.currency;
      data.originalAmount = parts.originalAmount;
      data.usdRateCup = parts.usdRateCup;
    } else {
      usdSigned =
        parsed.data.amountUsdSignedCents ??
        (existing.currency === "USD"
          ? existing.originalAmount ?? 0
          : Math.round((existing.amountCents * 100) / rateRounded));
      const parts = signedAmountParts({
        currency: "USD",
        amountUsdSignedCents: usdSigned,
        usdRateCup: parsed.data.usdRateCup ?? existing.usdRateCup ?? undefined,
        storeUsdRateCup: storeUsd,
      });
      data.amountCents = parts.amountCents;
      data.currency = parts.currency;
      data.originalAmount = parts.originalAmount;
      data.usdRateCup = parts.usdRateCup;
    }
  }

  const updated = await prisma.accountingEntry.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "ACCOUNTING_ENTRY_UPDATED",
      entityType: "AccountingEntry",
      entityId: updated.id,
      before: existing as unknown as Prisma.InputJsonValue,
      after: updated as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true, entry: serializeEntry(updated) });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.accountingEntry.findFirst({
    where: { id, storeId: guard.session.storeId },
  });
  if (!existing) return NextResponse.json({ ok: true });

  await prisma.accountingEntry.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "ACCOUNTING_ENTRY_DELETED",
      entityType: "AccountingEntry",
      entityId: id,
      before: existing as unknown as Prisma.InputJsonValue,
      after: { deleted: true } as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true });
}
