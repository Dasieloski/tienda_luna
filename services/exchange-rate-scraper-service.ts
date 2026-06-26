import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

const TARGET_URL = "https://eltoque.com";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const USD_RATE_MIN = 20;
const USD_RATE_MAX = 5000;
const SYSTEM_ACTOR_ID = "SYSTEM_BROWSER_RUN";

function getGotoOptions(attempt: number) {
  if (attempt === 1) {
    return { waitUntil: "networkidle2" as const, timeout: 60000 };
  }
  if (attempt === 2) {
    return { waitUntil: ["load" as const, "networkidle2" as const], timeout: 60000 };
  }
  return { waitUntil: "load" as const, timeout: 60000 };
}

export type ScrapingResult =
  | {
      success: true;
      rateCup: number;
      previousRate: number | null;
      updated: boolean;
      executionId: string;
      details: string;
    }
  | {
      success: false;
      rateCup: number | null;
      previousRate: number | null;
      error: string;
      executionId: string;
      details: string;
    };

class CloudflareConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareConfigError";
  }
}

class ScrapingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapingError";
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateExecutionId(): string {
  return `er-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function coerceNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[,$]/g, "");
    const num = Number(cleaned);
    if (!isNaN(num)) return num;
  }
  return NaN;
}

function validateRate(value: unknown): number {
  const num = coerceNumber(value);
  if (isNaN(num) || !Number.isFinite(num)) {
    throw new ValidationError(
      `Valor no numérico o finito: ${JSON.stringify(value)}`
    );
  }
  if (num <= 0) {
    throw new ValidationError(`Valor no positivo: ${num}`);
  }
  if (num < USD_RATE_MIN || num > USD_RATE_MAX) {
    throw new ValidationError(
      `Valor fuera de rango (${USD_RATE_MIN}–${USD_RATE_MAX}): ${num}`
    );
  }
  return Math.round(num);
}

function getCloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() || "";
  if (!accountId || !apiToken) {
    throw new CloudflareConfigError(
      "Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN"
    );
  }
  return { accountId, apiToken };
}

function findNumericValue(obj: unknown, depth: number): number | null {
  if (depth > 3 || obj == null || typeof obj !== "object") return null;
  for (const val of Object.values(obj as Record<string, unknown>)) {
    const num = coerceNumber(val);
    if (!isNaN(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
      return num;
    }
    if (typeof val === "object") {
      const found = findNumericValue(val, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

const RATE_PATTERNS = [
  /1\s*USD[^0-9]*?(\d{3,4})/i,
  /\$1\s*USD[^0-9]*?(\d{3,4})/i,
  /USD\s*\$?\s*(\d{3,4})/i,
  /TASA\s*(?:DE\s*)?CAMBIO[^0-9]*?(\d{3,4})/i,
  /(\d{3,4})\s*CUP\s*\/?\s*(?:1\s*)?USD/i,
  /CUP\s*[×xX*]\s*(\d{3,4})/i,
];

function extractRateFromHtml(html: string): number | null {
  for (const re of RATE_PATTERNS) {
    const match = html.match(re);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
        return Math.round(num);
      }
    }
  }
  return null;
}

async function fetchRateFromBrowserRun(
  executionId: string,
  attempt: number
): Promise<{ usdRateCup: number }> {
  console.log(`[${executionId}] Consultando Browser Run (intento #${attempt})…`);
  const { accountId, apiToken } = getCloudflareConfig();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`;

  const body = {
    url: TARGET_URL,
    gotoOptions: getGotoOptions(attempt),
    actionTimeout: 30000,
    bestAttempt: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ScrapingError(
      `Browser Run respondió HTTP ${res.status}. Body: ${text.slice(0, 500)}`
    );
  }

  const data = (await res.json()) as {
    success: boolean;
    result?: string;
    errors?: { code: number; message: string }[];
  };

  if (!data.success) {
    const errMsgs =
      data.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") ||
      "Error desconocido";
    throw new ScrapingError(`Cloudflare API error: ${errMsgs}`);
  }

  if (!data.result || typeof data.result !== "string") {
    throw new ScrapingError(
      "Respuesta sin HTML: " + JSON.stringify(data).slice(0, 500)
    );
  }

  const rate = extractRateFromHtml(data.result);
  if (rate !== null) {
    console.log(`  [${executionId}] Tasa extraída del HTML: ${rate}`);
    return { usdRateCup: rate };
  }

  const snippet = data.result
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  throw new ScrapingError(
    "No se encontró tasa en el HTML. Texto extraído: " + snippet
  );
}

async function getLastValidRate(storeId: string): Promise<number | null> {
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { usdRateCup: true },
    });
    return store?.usdRateCup ?? null;
  } catch (e) {
    console.error("[exchange-rate-scraper] Error leyendo último valor válido:", e);
    return null;
  }
}

async function persistRate(
  storeId: string,
  newRate: number,
  previousRate: number | null,
  executionId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.store.update({
      where: { id: storeId },
      data: {
        usdRateCup: newRate,
        exchangeRateMode: "AUTO",
        exchangeRateAutoUpdatedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        actorType: "DEVICE",
        actorId: SYSTEM_ACTOR_ID,
        action: "EXCHANGE_RATE_AUTO_UPDATE",
        entityType: "Store",
        entityId: storeId,
        before:
          previousRate !== null
            ? ({ usdRateCup: previousRate } as Prisma.InputJsonValue)
            : Prisma.DbNull,
        after: { usdRateCup: newRate } as Prisma.InputJsonValue,
        meta: {
          source: "eltoque.com",
          executionId,
          method: "cloudflare-browser-run-json",
        } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function scrapeAndUpdateUsdRate(
  storeId: string
): Promise<ScrapingResult> {
  const executionId = generateExecutionId();
  const startedAt = new Date().toISOString();

  console.log(`[${executionId}] Iniciando scraping…`);

  // Verificar modo: si es MANUAL, saltar el scraping
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { exchangeRateMode: true },
    });
    if (store?.exchangeRateMode === "MANUAL") {
      console.log(`[${executionId}] Modo MANUAL: se omite el scraping automático.`);
      return {
        success: true,
        rateCup: await getLastValidRate(storeId) ?? 250,
        previousRate: null,
        updated: false,
        executionId,
        details: `Modo MANUAL: scraping omitido. Iniciado: ${startedAt}`,
      };
    }
  } catch (e) {
    console.error(`[${executionId}] Error verificando modo:`, e);
  }

  let previousRate: number | null = null;
  let extractedRate: number | null = null;
  let lastError: string | null = null;

  previousRate = await getLastValidRate(storeId);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await fetchRateFromBrowserRun(executionId, attempt);
      extractedRate = result.usdRateCup;
      console.log(`[${executionId}] Intento #${attempt}: tasa = ${extractedRate}`);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      console.error(`[${executionId}] Intento #${attempt} falló: ${msg}`);
      if (attempt === MAX_RETRIES) break;
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  if (extractedRate === null) {
    return {
      success: false,
      rateCup: null,
      previousRate,
      error: lastError ?? "Error desconocido",
      executionId,
      details: `Fallo tras ${MAX_RETRIES} intentos. Iniciado: ${startedAt}`,
    };
  }

  if (previousRate === extractedRate) {
    return {
      success: true,
      rateCup: extractedRate,
      previousRate,
      updated: false,
      executionId,
      details: `Sin cambios (${previousRate}). Iniciado: ${startedAt}`,
    };
  }

  try {
    await persistRate(storeId, extractedRate, previousRate, executionId);
    return {
      success: true,
      rateCup: extractedRate,
      previousRate,
      updated: true,
      executionId,
      details: `${previousRate} → ${extractedRate}. Iniciado: ${startedAt}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      rateCup: extractedRate,
      previousRate,
      error: `Extracción OK pero persistencia falló: ${msg}`,
      executionId,
      details: `Valor: ${extractedRate}. Iniciado: ${startedAt}`,
    };
  }
}
