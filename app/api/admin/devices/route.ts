import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const patchSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
});

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, devices: [] });
  }

  const rows = await prisma.device.findMany({
    where: { storeId: guard.session.storeId },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, label: true, lastSeenAt: true, createdAt: true },
  });
  return NextResponse.json({
    meta: { dbAvailable: true as const },
    devices: rows.map((d) => ({
      id: d.id,
      label: d.label,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const exists = await prisma.device.findFirst({
    where: { id: parsed.data.id, storeId: guard.session.storeId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.device.update({
    where: { id: parsed.data.id },
    data: { label: parsed.data.label },
  });

  return NextResponse.json({ ok: true });
}

