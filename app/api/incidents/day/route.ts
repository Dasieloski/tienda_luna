import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canSync, getSessionFromRequest } from "@/lib/auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD"),
});

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  severity: z.enum(["INFO", "WARN", "ERROR"]).optional().default("INFO"),
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(2000),
  tags: z.array(z.string().trim().min(1).max(40)).optional().default([]),
});

/**
 * Endpoint para la APK (sesión device/cajero) para registrar y listar incidencias diarias.
 * - GET: lista incidencias del día (de la tienda; la APK puede filtrar localmente por deviceId si quiere).
 * - POST: crea una incidencia con actor DEVICE/USER según sesión.
 */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ meta: { dbAvailable: false as const, message: "DB_NOT_AVAILABLE" }, rows: [] }, { status: 200 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ date: url.searchParams.get("date") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });

  const rows = await prisma.dailyIncident.findMany({
    where: { storeId: session.storeId, dayYmd: parsed.data.date },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
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

  return NextResponse.json({
    meta: {
      dbAvailable: true as const,
      storeId: session.storeId,
      sessionType: session.typ,
      deviceId: session.typ === "device" ? session.sub : null,
    },
    rows,
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const actorType = session.typ === "device" ? "DEVICE" : "USER";
  const actorId = session.sub;
  const deviceId = session.typ === "device" ? session.sub : null;

  const row = await prisma.dailyIncident.create({
    data: {
      storeId: session.storeId,
      dayYmd: parsed.data.date,
      actorType,
      actorId,
      deviceId,
      severity: parsed.data.severity as any,
      status: "OPEN",
      title: parsed.data.title,
      message: parsed.data.message,
      tags: parsed.data.tags.length ? (parsed.data.tags as any) : undefined,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: row.id });
}

