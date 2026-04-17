import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ suppliers: [], meta: { dbAvailable: false } });
  }

  const url = new URL(request.url);
  const includeInactive =
    url.searchParams.get("includeInactive") === "1" ||
    url.searchParams.get("includeInactive")?.toLowerCase() === "true";

  try {
    const suppliers = await prisma.supplier.findMany({
      where: {
        storeId: session.storeId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    return NextResponse.json({
      meta: { dbAvailable: true as const },
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        notes: s.notes,
        active: s.active,
        productCount: s._count.products,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[api/admin/suppliers GET]", err);
    return NextResponse.json(
      {
        meta: {
          dbAvailable: false as const,
          message: err instanceof Error ? err.message : "DB",
        },
        suppliers: [],
      },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  const phone = parsed.data.phone?.trim() || null;
  const notes = parsed.data.notes?.trim() || null;

  try {
    const s = await prisma.supplier.create({
      data: {
        storeId: session.storeId,
        name,
        phone,
        notes,
        active: true,
      },
    });
    return NextResponse.json({
      supplier: {
        id: s.id,
        name: s.name,
        phone: s.phone,
        notes: s.notes,
        active: s.active,
        productCount: 0,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ error: "DUPLICATE_NAME_OR_DB" }, { status: 409 });
  }
}
