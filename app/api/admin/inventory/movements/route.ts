import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID, STATIC_ADMIN_JWT_SUB } from "@/lib/static-admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";

type MovementWithRelations = Prisma.InventoryMovementGetPayload<{
  include: {
    product: { select: { id: true; name: true; sku: true } };
    event: {
      select: {
        id: true;
        type: true;
        deviceId: true;
        serverTimestamp: true;
        clientTimestamp: true;
      };
    };
  };
}>;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(5).max(100).default(25),
  q: z.string().trim().max(120).optional(),
  productId: z.string().trim().optional(),
  actorType: z.enum(["USER", "DEVICE"]).optional(),
  actorId: z.string().trim().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortKey: z
    .enum(["createdAt", "product", "delta", "actorType", "reason"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

function safeDate(iso: string | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtEsDateTime(d: Date) {
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" });
}

function fmtFromClientTimestampMs(ms: bigint): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return fmtEsDateTime(d);
}

function buildActorHoverText(input: {
  createdAt: Date;
  reason: string;
  actorType: string;
  actorId: string;
  actorLabel: string;
  event:
    | null
    | {
        type: string;
        deviceId: string;
        serverTimestamp: Date;
        clientTimestamp: bigint;
      };
  eventDeviceLabel: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Fecha registro (servidor): ${fmtEsDateTime(input.createdAt)}`);
  lines.push(`Motivo: ${input.reason}`);
  lines.push(`Quién: ${input.actorLabel} (${input.actorType})`);
  lines.push(`Id técnico: ${input.actorId}`);

  if (input.event) {
    lines.push("Origen: sincronización desde terminal POS");
    lines.push(`Tipo de evento: ${input.event.type}`);
    const term = input.eventDeviceLabel?.trim() || input.event.deviceId;
    lines.push(`Terminal: ${term}`);
    const clock = fmtFromClientTimestampMs(input.event.clientTimestamp);
    if (clock) lines.push(`Reloj del terminal (al generar el evento): ${clock}`);
    lines.push(`Recepción del evento en servidor: ${fmtEsDateTime(input.event.serverTimestamp)}`);
    lines.push(
      "Ubicación física o IP no se guardan en la base de datos; solo hora del terminal y hora de recepción.",
    );
    return lines.join("\n");
  }

  if (input.actorType === "USER") {
    lines.push("Origen: panel web de administración");
    lines.push(
      "No se guarda dispositivo, navegador, IP ni ubicación para cambios hechos desde el panel; solo esta hora de registro.",
    );
    return lines.join("\n");
  }

  lines.push("Origen: terminal POS (sin evento enlazado en este registro)");
  lines.push("Puede ser un movimiento antiguo o creado fuera del flujo de sincronización estándar.");
  return lines.join("\n");
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({
      meta: { dbAvailable: false, message: "Base de datos no disponible para esta sesión." },
      rows: [],
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    productId: url.searchParams.get("productId") ?? undefined,
    actorType: url.searchParams.get("actorType") ?? undefined,
    actorId: url.searchParams.get("actorId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    sortKey: url.searchParams.get("sortKey") ?? undefined,
    sortDir: url.searchParams.get("sortDir") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const { page, limit, q, productId, actorType, actorId, from, to, sortKey, sortDir } = parsed.data;
  const fromD = safeDate(from);
  const toD = safeDate(to);

  const needle = q?.trim().toLowerCase() || "";

  let userIdsMatchingEmail: string[] = [];
  if (needle.length >= 3) {
    try {
      const usersHit = await prisma.user.findMany({
        where: {
          storeId: session.storeId,
          email: { contains: needle, mode: "insensitive" },
        },
        select: { id: true },
      });
      userIdsMatchingEmail = usersHit.map((u) => u.id);
    } catch {
      userIdsMatchingEmail = [];
    }
  }

  const needleOr: Record<string, unknown>[] = [
    { reason: { contains: needle, mode: "insensitive" } },
    { actorId: { contains: needle, mode: "insensitive" } },
    { product: { name: { contains: needle, mode: "insensitive" } } },
    { product: { sku: { contains: needle, mode: "insensitive" } } },
  ];
  if (userIdsMatchingEmail.length > 0) {
    needleOr.push({ actorId: { in: userIdsMatchingEmail } });
  }
  if (needle && process.env.STATIC_ADMIN_EMAIL?.trim().toLowerCase().includes(needle)) {
    needleOr.push({ actorId: STATIC_ADMIN_JWT_SUB });
  }

  const where: Record<string, unknown> = {
    storeId: session.storeId,
    ...(productId ? { productId } : {}),
    ...(actorType ? { actorType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(fromD || toD
      ? {
          createdAt: {
            ...(fromD ? { gte: fromD } : {}),
            ...(toD ? { lte: toD } : {}),
          },
        }
      : {}),
    ...(needle ? { OR: needleOr } : {}),
  };

  const orderBy: Prisma.InventoryMovementOrderByWithRelationInput[] =
    sortKey === "delta"
      ? [{ delta: sortDir ?? "desc" }]
      : sortKey === "actorType"
        ? [{ actorType: sortDir ?? "asc" }, { createdAt: "desc" }]
        : sortKey === "reason"
          ? [{ reason: sortDir ?? "asc" }, { createdAt: "desc" }]
          : sortKey === "product"
            ? [{ product: { name: sortDir ?? "asc" } }, { createdAt: "desc" }]
            : [{ createdAt: sortDir ?? "desc" }];

  const skip = (page - 1) * limit;

  try {
    const [total, rows] = await Promise.all([
      prisma.inventoryMovement.count({ where }),
      prisma.inventoryMovement.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          event: {
            select: {
              id: true,
              type: true,
              deviceId: true,
              serverTimestamp: true,
              clientTimestamp: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const userActorIds = [
      ...new Set(
        rows.filter((r) => r.actorType === "USER").map((r) => r.actorId),
      ),
    ];
    const deviceActorIds = [
      ...new Set(
        rows.filter((r) => r.actorType === "DEVICE").map((r) => r.actorId),
      ),
    ];
    const deviceIdsFromEvents = [
      ...new Set(
        rows.map((r) => r.event?.deviceId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const allDeviceIds = [...new Set([...deviceActorIds, ...deviceIdsFromEvents])];

    const [usersById, devicesById] = await Promise.all([
      userActorIds.length
        ? prisma.user.findMany({
            where: { storeId: session.storeId, id: { in: userActorIds } },
            select: { id: true, email: true },
          })
        : Promise.resolve([] as { id: string; email: string }[]),
      allDeviceIds.length
        ? prisma.device.findMany({
            where: { storeId: session.storeId, id: { in: allDeviceIds } },
            select: { id: true, label: true },
          })
        : Promise.resolve([] as { id: string; label: string }[]),
    ]);

    const emailByUserId = new Map(usersById.map((u) => [u.id, u.email]));
    const labelByDeviceId = new Map(devicesById.map((d) => [d.id, d.label]));

    const staticAdminEmail = process.env.STATIC_ADMIN_EMAIL?.trim() || null;

    function actorLabel(actorType: string, actorId: string): string {
      if (actorType === "USER") {
        const mail = emailByUserId.get(actorId);
        if (mail) return mail;
        if (actorId === STATIC_ADMIN_JWT_SUB) {
          // No mostrar un "email" como si fuera un usuario real: esto es un marcador legacy.
          return staticAdminEmail ? `${staticAdminEmail} (legacy)` : "Administrador (legacy)";
        }
        return actorId;
      }
      if (actorType === "DEVICE") {
        return labelByDeviceId.get(actorId) ?? actorId;
      }
      return actorId;
    }

    return NextResponse.json({
      meta: {
        dbAvailable: true as const,
        page,
        limit,
        total,
        totalPages,
      },
      rows: (rows as MovementWithRelations[]).map((r) => {
        const label = actorLabel(r.actorType, r.actorId);
        const ev = r.event;
        const eventPayload =
          ev && typeof ev.deviceId === "string"
            ? {
                type: String(ev.type),
                deviceId: ev.deviceId,
                serverTimestamp: ev.serverTimestamp as Date,
                clientTimestamp: ev.clientTimestamp as bigint,
              }
            : null;
        const eventDevLabel = eventPayload ? labelByDeviceId.get(eventPayload.deviceId) ?? null : null;
        return {
          id: r.id,
          createdAt: r.createdAt,
          productId: r.productId,
          product: r.product ? { id: r.product.id, name: r.product.name, sku: r.product.sku } : null,
          delta: r.delta,
          beforeQty: r.beforeQty,
          afterQty: r.afterQty,
          reason: r.reason,
          actorType: r.actorType,
          actorId: r.actorId,
          actorLabel: label,
          actorHover: buildActorHoverText({
            createdAt: r.createdAt as Date,
            reason: String(r.reason),
            actorType: String(r.actorType),
            actorId: String(r.actorId),
            actorLabel: label,
            event: eventPayload,
            eventDeviceLabel: eventDevLabel,
          }),
          auditMeta: auditRequestMeta(request),
          eventId: r.eventId ?? null,
        };
      }),
    });
  } catch (e) {
    console.error("[api/admin/inventory/movements]", e);
    return NextResponse.json(
      { meta: { dbAvailable: false, message: "No se pudo cargar el kardex." }, rows: [] },
      { status: 200 },
    );
  }
}

