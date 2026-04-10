import type { Prisma } from "@prisma/client";
import { payloadHash } from "@/lib/hash";

type DbTx = Prisma.TransactionClient;

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const SPIKE_WINDOW_MS = 60 * 60 * 1000;
const SPIKE_MAX_COMPLETED = 80;

export type FraudSignal = {
  isFraud: boolean;
  fraudReason?: string;
};

export function checkTimestampFraud(clientTs: number, serverNow: number): FraudSignal {
  if (clientTs > serverNow + FUTURE_SKEW_MS) {
    return {
      isFraud: true,
      fraudReason: "TIMESTAMP_IN_FUTURE",
    };
  }
  return { isFraud: false };
}

export function checkDuplicateInBatch(
  key: string,
  seen: Set<string>,
): FraudSignal {
  if (seen.has(key)) {
    return {
      isFraud: true,
      fraudReason: "DUPLICATE_IN_BATCH",
    };
  }
  seen.add(key);
  return { isFraud: false };
}

export async function checkDuplicateInDb(
  prisma: DbTx,
  storeId: string,
  deviceId: string,
  clientTimestamp: bigint,
  hash: string,
): Promise<FraudSignal> {
  const existing = await prisma.event.findFirst({
    where: {
      storeId,
      deviceId,
      clientTimestamp,
      payloadHash: hash,
      status: { in: ["ACCEPTED", "CORRECTED"] },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      isFraud: true,
      fraudReason: "DUPLICATE_DEVICE_TS_HASH",
    };
  }
  return { isFraud: false };
}

export async function checkSalesSpike(
  prisma: DbTx,
  storeId: string,
  deviceId: string,
  serverNow: Date,
): Promise<FraudSignal> {
  const from = new Date(serverNow.getTime() - SPIKE_WINDOW_MS);
  const count = await prisma.event.count({
    where: {
      storeId,
      deviceId,
      type: "SALE_COMPLETED",
      status: { in: ["ACCEPTED", "CORRECTED"] },
      serverTimestamp: { gte: from },
    },
  });
  if (count >= SPIKE_MAX_COMPLETED) {
    return {
      isFraud: true,
      fraudReason: "DEVICE_SALES_SPIKE",
    };
  }
  return { isFraud: false };
}

export function buildDuplicateKey(
  deviceId: string,
  timestamp: number,
  payload: Record<string, unknown>,
): string {
  return `${deviceId}|${timestamp}|${payloadHash(payload)}`;
}
