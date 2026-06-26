import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import * as cheerio from "cheerio";

const TARGET_URL = "https://eltoque.com";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 30000];
const RATE_LIMIT_DELAY = 60000;
const USD_RATE_MIN = 20;
const USD_RATE_MAX = 5000;
const SYSTEM_ACTOR_ID = "SYSTEM_BROWSER_RUN";
const DEBUG = process.env.DEBUG_SCRAPER === "true";

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
    throw new Error(`Valor no numérico o finito: ${JSON.stringify(value)}`);
  }
  if (num <= 0) {
    throw new Error(`Valor no positivo: ${num}`);
  }
  if (num < USD_RATE_MIN || num > USD_RATE_MAX) {
    throw new Error(`Valor fuera de rango (${USD_RATE_MIN}–${USD_RATE_MAX}): ${num}`);
  }
  return Math.round(num);
}

function getCloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() || "";
  if (!accountId || !apiToken) {
    throw new Error("Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN");
  }
  return { accountId, apiToken };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "(sin título)";
}

function extractWithCheerio(html: string): number | null {
  const $ = cheerio.load(html);
  const candidates: number[] = [];

  $("*").each(function () {
    const el = $(this);
    const text = el.text().trim();
    if (/USD/i.test(text)) {
      const nums = text.match(/\d{3,4}/g);
      if (nums) {
        for (const n of nums) {
          const num = Number(n);
          if (num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
            candidates.push(num);
          }
        }
      }
      const parentText = el.parent().text().trim();
      const parentNums = parentText.match(/\d{3,4}/g);
      if (parentNums) {
        for (const pn of parentNums) {
          const num = Number(pn);
          if (num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
            candidates.push(num);
          }
        }
      }
    }
  });

  if (candidates.length === 0) return null;

  const freq: Record<number, number> = {};
  for (const c of candidates) {
    freq[c] = (freq[c] || 0) + 1;
  }
  let best = candidates[0];
  let bestFreq = 0;
  for (const key in freq) {
    if (freq[key] > bestFreq) {
      bestFreq = freq[key];
      best = Number(key);
    }
  }
  return best;
}

const RATE_PATTERNS = [
  /1\s*USD[^0-9]*?(\d{3,4})/i,
  /\$1\s*USD[^0-9]*?(\d{3,4})/i,
  /USD\s*\$?\s*(\d{3,4})/i,
  /1\s*D[Oo]lar[^0-9]*?(\d{3,4})/i,
  /TASA\s*(?:DE\s*)?CAMBIO[^0-9]*?(\d{3,4})/i,
  /(\d{3,4})\s*CUP\s*\/?\s*(?:1\s*)?USD/i,
  /CUP\s*[×xX*]\s*(\d{3,4})/i,
];

function extractWithRegex(html: string): number | null {
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

async function extractWithAI(cfg: { accountId: string; apiToken: string }): Promise<number> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/browser-rendering/json`;
  const body = {
    url: TARGET_URL,
    prompt:
      "Extrae el valor actual de cambio del dólar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Devuelve SOLAMENTE el número entero de CUP que cuesta 1 USD. " +
      "Ejemplo: 325",
    gotoOptions: { waitUntil: "load" as const, timeout: 60000 },
    actionTimeout: 30000,
    bestAttempt: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  console.log("    [AI fallback] POST /browser-rendering/json");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { success: boolean; result?: Record<string, unknown> };
  if (!data.success || data.result == null) {
    throw new Error(`AI falló: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const aiKeys = ["usd_rate_cup", "response", "rate", "cup", "valor", "precio", "usd", "exchange_rate"];
  for (const key of aiKeys) {
    if (data.result[key] != null) {
      try {
        return validateRate(data.result[key]);
      } catch {
        // continue
      }
    }
  }

  const resultStr = JSON.stringify(data.result);
  const match = resultStr.match(/"(\d{2,4})"/) || resultStr.match(/(\d{2,4})/);
  if (match) {
    const num = Number(match[1]);
    if (Number.isFinite(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
      return Math.round(num);
    }
  }

  throw new Error(`AI respuesta sin tasa: ${resultStr.slice(0, 300)}`);
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

function getGotoOptions(attempt: number) {
  if (attempt === 1) {
    return { waitUntil: "networkidle2" as const, timeout: 60000 };
  }
  if (attempt === 2) {
    return { waitUntil: ["load" as const, "networkidle2" as const], timeout: 60000 };
  }
  return { waitUntil: "load" as const, timeout: 60000 };
}

async function fetchRateFromBrowserRun(
  attempt: number
): Promise<{ usdRateCup: number }> {
  console.log(`  [etapa 1/4] Navegando a ${TARGET_URL} (intento ${attempt})…`);
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

  if (res.status === 429) {
    throw new Error("RateLimit");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Browser Run HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  console.log("  [etapa 2/4] HTTP 200 OK. Procesando respuesta…");

  const data = (await res.json()) as {
    success: boolean;
    result?: string;
    errors?: { code: number; message: string }[];
  };

  if (!data.success) {
    const errMsgs =
      data.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") || "Error desconocido";
    throw new Error(`Cloudflare API error: ${errMsgs}`);
  }

  const html = data.result;
  if (html == null || typeof html !== "string" || html.length < 50) {
    console.log(`  [ERROR] HTML vacío o demasiado corto (${html ? html.length : 0} chars)`);
    if (html) console.log(`  [DEBUG] HTML recibido: ${html.slice(0, 1000)}`);
    throw new Error("HTML vacío o inválido");
  }

  const title = extractTitle(html);
  const visible = stripHtml(html);

  console.log(`  [diagnóstico] document.title: ${title}`);
  console.log(`  [diagnóstico] HTML length: ${html.length} chars`);
  console.log(`  [diagnóstico] Texto visible length: ${visible.length} chars`);

  if (DEBUG) {
    console.log("  [DEBUG] === INICIO HTML (5000 chars) ===");
    console.log(html.slice(0, 5000));
    console.log("  [DEBUG] === FIN HTML ===");
    console.log("  [DEBUG] === INICIO TEXTO VISIBLE (3000 chars) ===");
    console.log(visible.slice(0, 3000));
    console.log("  [DEBUG] === FIN TEXTO VISIBLE ===");
  }

  const errorIndicators = [
    "captcha", "please complete the security check", "cf-browser-verification",
    "just a moment", "error 1020", "access denied", "attention required",
  ];
  const htmlLower = html.toLowerCase();
  for (const indicator of errorIndicators) {
    if (htmlLower.includes(indicator)) {
      console.log(`  [ERROR] Posible bloqueo: '${indicator}' en el HTML`);
      throw new Error("Página bloqueada por Cloudflare/seguridad");
    }
  }

  console.log("  [etapa 3/4] Parseando HTML para extraer tasa…");

  let rate = extractWithCheerio(html);
  if (rate !== null) {
    console.log(`  [ok] Tasa extraída por Cheerio: ${rate} CUP/USD`);
    return { usdRateCup: rate };
  }
  console.log("  [fallback] Cheerio no encontró tasa. Probando regex…");

  rate = extractWithRegex(html);
  if (rate !== null) {
    console.log(`  [ok] Tasa extraída por regex: ${rate} CUP/USD`);
    return { usdRateCup: rate };
  }
  console.log("  [fallback] Regex no encontró tasa. Probando AI…");

  try {
    const aiRate = await extractWithAI({ accountId, apiToken });
    console.log(`  [ok] Tasa extraída por AI: ${aiRate} CUP/USD`);
    return { usdRateCup: aiRate };
  } catch (aiErr) {
    console.log(`  [fallback] AI también falló: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`);
  }

  throw new Error(
    `No se pudo extraer la tasa. Título: '${title}'. HTML: ${html.slice(0, 200)}`
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
          method: "cloudflare-browser-run-content",
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
  console.log(`  Modo: ${DEBUG ? "DEBUG (con HTML dump)" : "NORMAL"}`);

  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { exchangeRateMode: true },
    });
    if (store?.exchangeRateMode === "MANUAL") {
      console.log(`[${executionId}] Modo MANUAL: scraping omitido.`);
      return {
        success: true,
        rateCup: (await getLastValidRate(storeId)) ?? 250,
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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchRateFromBrowserRun(attempt);
      extractedRate = result.usdRateCup;
      console.log(`[${executionId}] Intento #${attempt} exitoso: ${extractedRate} CUP/USD`);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg === "RateLimit") {
        console.error(`[${executionId}] Rate limit (429). Esperando 60s y reintentando…`);
        await sleep(RATE_LIMIT_DELAY);
        attempt--;
        continue;
      }

      lastError = msg;
      console.error(`[${executionId}] Intento #${attempt} falló: ${msg}`);
      if (attempt === MAX_RETRIES) break;

      const delay = RETRY_DELAYS[attempt - 1] || 15000;
      console.log(`[${executionId}] Esperando ${delay}ms antes del siguiente intento…`);
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
