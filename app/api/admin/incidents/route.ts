import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.enum(["OPEN", "ACK", "RESOLVED"]).optional(),
  severity: z.enum(["INFO", "WARN", "ERROR"]).optional(),
  deviceId: z.string().trim().optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(80),
  cursor: z.string().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["ACK", "RESOLVE", "REOPEN"]),
  note: z.string().trim().max(2000).optional().nullable(),
});

export async function GET(request: Request) {
  const guard = await requireAdminRequest(request);
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const }, rows: [], nextCursor: null }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    severity: url.searchParams.get("severity") ?? undefined,
    deviceId: url.searchParams.get("deviceId") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const needle = parsed.data.q?.toLowerCase().trim() ?? "";
  const dayFilter: Prisma.DailyIncidentWhereInput =
    parsed.data.date
      ? { dayYmd: parsed.data.date }
      : parsed.data.year
        ? { dayYmd: { gte: `${parsed.data.year}-01-01`, lte: `${parsed.data.year}-12-31` } }
        : parsed.data.from || parsed.data.to
          ? {
              dayYmd: {
                ...(parsed.data.from ? { gte: parsed.data.from } : {}),
                ...(parsed.data.to ? { lte: parsed.data.to } : {}),
              },
            }
          : {};
  const where: Prisma.DailyIncidentWhereInput = {
    storeId: guard.session.storeId,
    ...dayFilter,
    ...(parsed.data.status ? { status: parsed.data.status as any } : {}),
    ...(parsed.data.severity ? { severity: parsed.data.severity as any } : {}),
    ...(parsed.data.deviceId ? { deviceId: parsed.data.deviceId } : {}),
    ...(needle
      ? {
          OR: [
            { title: { contains: needle, mode: "insensitive" } },
            { message: { contains: needle, mode: "insensitive" } },
            { actorId: { contains: needle, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await prisma.dailyIncident.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: parsed.data.limit + 1,
    ...(parsed.data.cursor
      ? {
          cursor: { id: parsed.data.cursor },
          skip: 1,
        }
      : {}),
    select: {
      id: true,
      dayYmd: true,
      status: true,
      severity: true,
      title: true,
      message: true,
      tags: true,
      actorType: true,
      actorId: true,
      deviceId: true,
      ackedAt: true,
      ackedByUserId: true,
      ackNote: true,
      resolvedAt: true,
      resolvedByUserId: true,
      resolutionNote: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  let nextCursor: string | null = null;
  let items = rows;
  if (rows.length > parsed.data.limit) {
    const next = rows.pop();
    nextCursor = next?.id ?? null;
    items = rows;
  }

  return NextResponse.json({
    meta: { dbAvailable: true as const },
    rows: items,
    nextCursor,
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;
  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const row = await prisma.dailyIncident.findFirst({
    where: { id: parsed.data.id, storeId: guard.session.storeId },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const note = parsed.data.note?.trim() ?? null;
  const now = new Date();

  if (parsed.data.action === "ACK") {
    const updated = await prisma.dailyIncident.update({
      where: { id: row.id },
      data: {
        status: "ACK",
        ackedAt: now,
        ackedByUserId: guard.user.id,
        ackNote: note,
      },
      select: { id: true, status: true, ackedAt: true },
    });
    return NextResponse.json({ ok: true, incident: updated });
  }

  if (parsed.data.action === "RESOLVE") {
    const updated = await prisma.dailyIncident.update({
      where: { id: row.id },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
        resolvedByUserId: guard.user.id,
        resolutionNote: note,
      },
      select: { id: true, status: true, resolvedAt: true },
    });
    return NextResponse.json({ ok: true, incident: updated });
  }

  const updated = await prisma.dailyIncident.update({
    where: { id: row.id },
    data: {
      status: "OPEN",
      ackedAt: null,
      ackedByUserId: null,
      ackNote: null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNote: null,
    },
    select: { id: true, status: true },
  });
  return NextResponse.json({ ok: true, incident: updated });
}

