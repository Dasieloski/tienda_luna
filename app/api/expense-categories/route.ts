import { NextResponse } from "next/server";
import { getSessionFromRequest, canSync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ categories: [], meta: { dbAvailable: false as const } });
  }

  try {
    const rows = await prisma.expenseCategory.findMany({
      where: { storeId: session.storeId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true, updatedAt: true },
    });
    return NextResponse.json({
      categories: rows.map((r) => ({
        id: r.id,
        name: r.name,
        active: r.active,
        updatedAt: r.updatedAt.toISOString(),
      })),
      meta: { dbAvailable: true as const },
    });
  } catch (e) {
    console.error("[api/expense-categories]", e);
    return NextResponse.json({ categories: [], meta: { dbAvailable: false as const } }, { status: 200 });
  }
}

