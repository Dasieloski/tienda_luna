import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, canSync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(400),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ expenses: [], meta: { dbAvailable: false as const } });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (parsed.data.from) dateFilter.gte = new Date(parsed.data.from);
  if (parsed.data.to) dateFilter.lte = new Date(parsed.data.to);

  try {
    const rows = await prisma.expense.findMany({
      where: {
        storeId: session.storeId,
        ...(parsed.data.from || parsed.data.to ? { occurredAt: dateFilter } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: parsed.data.limit,
    });

    return NextResponse.json({
      expenses: rows.map((r) => ({
        id: r.id,
        concept: r.concept,
        categoryId: r.categoryId,
        categoryName: r.categoryName ?? null,
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
        updatedAt: r.updatedAt.toISOString(),
      })),
      meta: { dbAvailable: true as const },
    });
  } catch (e) {
    console.error("[api/expenses]", e);
    return NextResponse.json({ expenses: [], meta: { dbAvailable: false as const } }, { status: 200 });
  }
}

