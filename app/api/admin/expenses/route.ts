import { NextResponse } from "next/server";
import { z } from "zod";
import { ExpenseSplitStrategy, OwnerName, PaymentCurrency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";

const listSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  categoryId: z.string().min(1).optional(),
  owner: z.enum(["OSMAR", "ALEX"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});

const createSchema = z.object({
  concept: z.string().trim().min(1).max(160),
  categoryId: z.string().min(1).optional().nullable(),
  categoryName: z.string().trim().max(80).optional().nullable(),
  currency: z.enum(["CUP", "USD"]).default("CUP"),
  amountCupCents: z.number().int().min(0).optional(),
  amountUsdCents: z.number().int().min(0).optional(),
  usdRateCup: z.number().int().min(1).max(100000).optional(),
  occurredAt: z.string().datetime(),
  paidBy: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  splitStrategy: z.enum(["PARTES_IGUALES", "PORCENTAJE_CUSTOM", "UN_SOLO_DUENO"]).default("PARTES_IGUALES"),
  osmarPct: z.number().int().min(0).max(100).optional(),
  singleOwner: z.enum(["OSMAR", "ALEX"]).optional().nullable(),
});

const updateSchema = createSchema
  .partial()
  .extend({ id: z.string().min(1) })
  .refine((v) => Object.keys(v).some((k) => k !== "id"), "EMPTY_UPDATE");

function getStoreUsdRateFallback(): number {
  const env = Number(process.env.NEXT_PUBLIC_USD_RATE_CUP ?? "250");
  return Number.isFinite(env) && env > 0 ? Math.round(env) : 250;
}

function computeAmountCents(input: {
  currency: "CUP" | "USD";
  amountCupCents?: number;
  amountUsdCents?: number;
  usdRateCup?: number;
  storeUsdRateCup: number;
}) {
  if (input.currency === "USD") {
    const usd = input.amountUsdCents ?? 0;
    const rate = input.usdRateCup ?? input.storeUsdRateCup;
    return {
      currency: PaymentCurrency.USD,
      amountCents: Math.round((usd / 100) * Math.round(rate) * 100),
      originalAmount: usd,
      usdRateCup: Math.round(rate),
    };
  }
  return {
    currency: PaymentCurrency.CUP,
    amountCents: input.amountCupCents ?? 0,
    originalAmount: null,
    usdRateCup: null,
  };
}

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    categoryId: url.searchParams.get("categoryId") ?? undefined,
    owner: url.searchParams.get("owner") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const { from, to, categoryId, owner, q, limit } = parsed.data;
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const where: Prisma.ExpenseWhereInput = {
    storeId: guard.session.storeId,
    ...(from || to ? { occurredAt: dateFilter } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(q
      ? {
          OR: [
            { concept: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { paidBy: { contains: q, mode: "insensitive" } },
            { categoryName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  if (owner) {
    // Heurística simple: si split=UN_SOLO_DUENO y coincide, o split=PORCENTAJE_CUSTOM y pct>0/<100.
    if (owner === "OSMAR") {
      where.OR = [
        ...(where.OR ?? []),
        { splitStrategy: ExpenseSplitStrategy.UN_SOLO_DUENO, singleOwner: OwnerName.OSMAR },
        { splitStrategy: ExpenseSplitStrategy.PORCENTAJE_CUSTOM, osmarPct: { gt: 0 } },
        { splitStrategy: ExpenseSplitStrategy.PARTES_IGUALES },
      ];
    } else {
      where.OR = [
        ...(where.OR ?? []),
        { splitStrategy: ExpenseSplitStrategy.UN_SOLO_DUENO, singleOwner: OwnerName.ALEX },
        { splitStrategy: ExpenseSplitStrategy.PORCENTAJE_CUSTOM, osmarPct: { lt: 100 } },
        { splitStrategy: ExpenseSplitStrategy.PARTES_IGUALES },
      ];
    }
  }

  const rows = await prisma.expense.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: { category: { select: { id: true, name: true } } },
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.totalCents += r.amountCents;
      const pct = r.splitStrategy === "PORCENTAJE_CUSTOM" ? Math.max(0, Math.min(100, r.osmarPct ?? 50)) : 50;
      const osmarShare =
        r.splitStrategy === "UN_SOLO_DUENO"
          ? r.singleOwner === "OSMAR"
            ? 100
            : 0
          : r.splitStrategy === "PORCENTAJE_CUSTOM"
            ? pct
            : 50;
      acc.osmarCents += Math.round((r.amountCents * osmarShare) / 100);
      acc.alexCents += r.amountCents - Math.round((r.amountCents * osmarShare) / 100);
      return acc;
    },
    { totalCents: 0, osmarCents: 0, alexCents: 0 },
  );

  return NextResponse.json({
    expenses: rows.map((r) => ({
      id: r.id,
      concept: r.concept,
      categoryId: r.categoryId,
      categoryName: r.category?.name ?? r.categoryName ?? null,
      amountCents: r.amountCents,
      currency: r.currency,
      originalAmount: r.originalAmount ?? null,
      usdRateCup: r.usdRateCup ?? null,
      occurredAt: r.occurredAt.toISOString(),
      paidBy: r.paidBy ?? null,
      notes: r.notes ?? null,
      splitStrategy: r.splitStrategy,
      osmarPct: r.osmarPct ?? null,
      singleOwner: r.singleOwner ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    totals,
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const store = await prisma.store.findUnique({
    where: { id: guard.session.storeId },
    select: { usdRateCup: true },
  });
  const storeUsd = store?.usdRateCup ?? getStoreUsdRateFallback();
  const computed = computeAmountCents({
    currency: parsed.data.currency,
    amountCupCents: parsed.data.amountCupCents,
    amountUsdCents: parsed.data.amountUsdCents,
    usdRateCup: parsed.data.usdRateCup,
    storeUsdRateCup: storeUsd,
  });

  const row = await prisma.expense.create({
    data: {
      storeId: guard.session.storeId,
      concept: parsed.data.concept,
      categoryId: parsed.data.categoryId ?? null,
      categoryName: parsed.data.categoryName ?? null,
      amountCents: computed.amountCents,
      currency: computed.currency,
      originalAmount: computed.originalAmount,
      usdRateCup: computed.usdRateCup,
      occurredAt: new Date(parsed.data.occurredAt),
      paidBy: parsed.data.paidBy ?? null,
      notes: parsed.data.notes ?? null,
      splitStrategy:
        parsed.data.splitStrategy === "PORCENTAJE_CUSTOM"
          ? ExpenseSplitStrategy.PORCENTAJE_CUSTOM
          : parsed.data.splitStrategy === "UN_SOLO_DUENO"
            ? ExpenseSplitStrategy.UN_SOLO_DUENO
            : ExpenseSplitStrategy.PARTES_IGUALES,
      osmarPct: parsed.data.splitStrategy === "PORCENTAJE_CUSTOM" ? parsed.data.osmarPct ?? 50 : null,
      singleOwner:
        parsed.data.splitStrategy === "UN_SOLO_DUENO"
          ? parsed.data.singleOwner === "ALEX"
            ? OwnerName.ALEX
            : OwnerName.OSMAR
          : null,
      createdByUserId: guard.user.id,
      updatedByUserId: guard.user.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "EXPENSE_CREATED_ADMIN",
      entityType: "Expense",
      entityId: row.id,
      after: row as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true, id: row.id });
}

export async function PATCH(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const existing = await prisma.expense.findFirst({
    where: { id: parsed.data.id, storeId: guard.session.storeId },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const store = await prisma.store.findUnique({
    where: { id: guard.session.storeId },
    select: { usdRateCup: true },
  });
  const storeUsd = store?.usdRateCup ?? getStoreUsdRateFallback();

  const data: Prisma.ExpenseUpdateInput = {
    updatedByUserId: guard.user.id,
  };
  if (parsed.data.concept != null) data.concept = parsed.data.concept;
  if ("categoryId" in parsed.data) {
    const id = parsed.data.categoryId ?? null;
    data.category = id ? { connect: { id } } : { disconnect: true };
  }
  if ("categoryName" in parsed.data) data.categoryName = parsed.data.categoryName ?? null;
  if ("paidBy" in parsed.data) data.paidBy = parsed.data.paidBy ?? null;
  if ("notes" in parsed.data) data.notes = parsed.data.notes ?? null;
  if (parsed.data.occurredAt != null) data.occurredAt = new Date(parsed.data.occurredAt);
  if (parsed.data.splitStrategy != null) {
    data.splitStrategy =
      parsed.data.splitStrategy === "PORCENTAJE_CUSTOM"
        ? ExpenseSplitStrategy.PORCENTAJE_CUSTOM
        : parsed.data.splitStrategy === "UN_SOLO_DUENO"
          ? ExpenseSplitStrategy.UN_SOLO_DUENO
          : ExpenseSplitStrategy.PARTES_IGUALES;
  }
  if ("osmarPct" in parsed.data) data.osmarPct = parsed.data.osmarPct ?? null;
  if ("singleOwner" in parsed.data) {
    data.singleOwner =
      parsed.data.singleOwner == null
        ? null
        : parsed.data.singleOwner === "ALEX"
          ? OwnerName.ALEX
          : OwnerName.OSMAR;
  }

  if (parsed.data.currency != null || parsed.data.amountCupCents != null || parsed.data.amountUsdCents != null) {
    const computed = computeAmountCents({
      currency: parsed.data.currency ?? (existing.currency === "USD" ? "USD" : "CUP"),
      amountCupCents: parsed.data.amountCupCents ?? existing.amountCents,
      amountUsdCents: parsed.data.amountUsdCents ?? existing.originalAmount ?? 0,
      usdRateCup: parsed.data.usdRateCup ?? existing.usdRateCup ?? undefined,
      storeUsdRateCup: storeUsd,
    });
    data.amountCents = computed.amountCents;
    data.currency = computed.currency;
    data.originalAmount = computed.originalAmount;
    data.usdRateCup = computed.usdRateCup;
  }

  const updated = await prisma.expense.update({ where: { id: existing.id }, data });

  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "EXPENSE_UPDATED_ADMIN",
      entityType: "Expense",
      entityId: updated.id,
      before: existing as unknown as Prisma.InputJsonValue,
      after: updated as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });

  const existing = await prisma.expense.findFirst({ where: { id, storeId: guard.session.storeId } });
  if (!existing) return NextResponse.json({ ok: true });

  await prisma.expense.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      storeId: guard.session.storeId,
      actorType: "USER",
      actorId: guard.user.id,
      action: "EXPENSE_DELETED_ADMIN",
      entityType: "Expense",
      entityId: id,
      before: existing as unknown as Prisma.InputJsonValue,
      after: { deleted: true } as unknown as Prisma.InputJsonValue,
      meta: auditRequestMeta(request) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true });
}

