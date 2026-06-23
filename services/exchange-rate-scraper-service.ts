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

async function fetchRateFromBrowserRun(
  executionId: string,
  attempt: number
): Promise<{ usdRateCup: number }> {
  console.log(`[${executionId}] Consultando Browser Run (intento #${attempt})…`);
  const { accountId, apiToken } = getCloudflareConfig();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/json`;

  const body = {
    url: TARGET_URL,
    prompt:
      "Extrae el valor actual de cambio del dólar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Busca donde dice '1 USD' seguido de un número en CUP. " +
      "Ignora EUR, MLC, CAD, ZELLE y otras monedas. " +
      "Devuelve SOLAMENTE un objeto JSON válido con una única propiedad: " +
      "'usd_rate_cup' cuyo valor sea el número entero de cuántos CUP cuesta 1 USD. " +
      "No incluyas markdown, explicaciones, ni texto adicional. " +
      'Ejemplo: {"usd_rate_cup": 325}',
    response_format: {
      type: "json_object",
    },
    gotoOptions: getGotoOptions(attempt),
    actionTimeout: 30000,
    bestAttempt: true,
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

  const resBody = (await res.json()) as {
    success: boolean;
    result?: Record<string, unknown>;
    errors?: { code: number; message: string }[];
  };

  if (!resBody.success) {
    const errMsgs =
      resBody.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") ||
      "Error desconocido";
    throw new ScrapingError(`Cloudflare API error: ${errMsgs}`);
  }

  if (!resBody.result) {
    throw new ScrapingError(
      "Respuesta vacía: " + JSON.stringify(resBody).slice(0, 300)
    );
  }

  // 1) buscar usd_rate_cup directamente
  if (resBody.result.usd_rate_cup != null) {
    return { usdRateCup: validateRate(resBody.result.usd_rate_cup) };
  }

  // 2) buscar en claves comunes alternativas
  const possibleKeys = [
    "response", "rate", "cup", "valor", "precio", "usd", "exchange_rate",
  ];
  for (const key of possibleKeys) {
    const val = (resBody.result as Record<string, unknown>)[key];
    if (val != null) {
      try {
        return { usdRateCup: validateRate(val) };
      } catch {
        // continue
      }
    }
  }

  // 3) búsqueda profunda en todo el objeto resultado
  const found = findNumericValue(resBody.result, 0);
  if (found !== null) {
    console.log(`  [${executionId}] fallback: valor por búsqueda profunda = ${found}`);
    return { usdRateCup: Math.round(found) };
  }

  throw new ScrapingError(
    "Respuesta sin tasa reconocible. Resultado: " +
      JSON.stringify(resBody.result).slice(0, 500)
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
      data: { usdRateCup: newRate },
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
