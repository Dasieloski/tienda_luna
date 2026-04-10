import { processBatch } from "@/lib/event-processor";
import { prisma } from "@/lib/db";
import type { ClientSyncEvent } from "@/types/events";

export async function syncBatch(input: {
  storeId: string;
  deviceId: string;
  events: ClientSyncEvent[];
}) {
  const store = await prisma.store.findUnique({ where: { id: input.storeId } });
  if (!store) {
    throw new Error("STORE_NOT_FOUND");
  }
  return processBatch(prisma, {
    storeId: input.storeId,
    deviceId: input.deviceId,
    events: input.events,
  });
}
