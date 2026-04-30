import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canSync,
  getSessionFromRequest,
  requireStoreMatch,
} from "@/lib/auth";
import { syncBatch } from "@/services/sync-service";

const eventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  timestamp: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
});

const batchSchema = z.object({
  deviceId: z.string().min(1),
  storeId: z.string().min(1),
  lastSyncTimestamp: z.number().optional(),
  events: z.array(eventSchema),
});

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canSync(session)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = batchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { deviceId, storeId, events, lastSyncTimestamp } = parsed.data;
  if (!requireStoreMatch(session, storeId)) {
    return NextResponse.json({ error: "STORE_MISMATCH" }, { status: 403 });
  }

  if (session.typ === "device" && session.sub !== deviceId) {
    return NextResponse.json({ error: "DEVICE_MISMATCH" }, { status: 403 });
  }

  try {
    const results = await syncBatch({ storeId, deviceId, events });
    return NextResponse.json({
      ok: true,
      lastSyncTimestamp: lastSyncTimestamp ?? null,
      processed: results,
    });
  } catch (e) {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const msg = e instanceof Error ? e.message : "SYNC_ERROR";
    if (msg === "STORE_NOT_FOUND") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error("SYNC_ERROR", {
      requestId,
      storeId,
      deviceId,
      eventsCount: events.length,
      error: e,
    });
    return NextResponse.json({ error: "SYNC_ERROR", requestId }, { status: 500 });
  }
}
