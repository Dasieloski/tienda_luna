/**
 * Exchange Rate Scraper Service
 *
 * Metodo principal: POST /browser-rendering/content para obtener HTML renderizado.
 * Fallback: POST /browser-rendering/json con AI solo si HTML no contiene la tasa.
 *
 * Basado en documentacion oficial de Cloudflare Browser Run:
 *   /content endpoint: https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/
 *   /json endpoint:    https://developers.cloudflare.com/browser-run/quick-actions/json-endpoint/
 *   Timeouts:          https://developers.cloudflare.com/browser-run/reference/timeouts/
 *   API Reference:     https://developers.cloudflare.com/api/resources/browser_rendering/
 *
 * El endpoint /content devuelve:
 *   { meta: { status: number, title: string }, result: "HTML string", success, errors }
 *
 * Cache: default TTL es 5s. Usamos cacheTTL: 0 para desactivar.
 * Recursos: bloqueamos image/stylesheet/font/media para acelerar.
 * WaitUntil: networkidle2 (intento 1) -> load (intento 2) -> domcontentloaded (intento 3).
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import * as cheerio from "cheerio";

// ── Configuration ─────────────────────────────────────────────────────────

const TARGET_URL = "https://eltoque.com";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [10000, 20000, 40000];
const RATE_LIMIT_DELAY = 60000;
const USD_RATE_MIN = 20;
const USD_RATE_MAX = 5000;
const SYSTEM_ACTOR_ID = "SYSTEM_BROWSER_RUN";
const DEBUG = process.env.DEBUG_SCRAPER === "true";

// ── Utilities ──────────────────────────────────────────────────────────────

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

// ── HTML Parsing (Cheerio) ─────────────────────────────────────────────────

function extractWithCheerio(html: string): number | null {
  const $ = cheerio.load(html);
  const candidates: number[] = [];

  const containerSelector =
    "div, span, p, td, li, strong, b, h1, h2, h3, h4, h5, h6, section, article, label, a";

  $(containerSelector).each(function () {
    const el = $(this);
    const text = el.text().trim();
    if (!text || text.length > 500) return;
    if (!/USD|d[oó]lar|CUP/i.test(text)) return;

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
  });

  if (candidates.length === 0) return null;

  const freq: Record<number, number> = {};
  let best = candidates[0];
  let bestFreq = 0;
  for (const c of candidates) {
    freq[c] = (freq[c] || 0) + 1;
  }
  for (const key in freq) {
    if (freq[key] > bestFreq) {
      bestFreq = freq[key];
      best = Number(key);
    }
  }
  return best;
}

// ── Regex Extraction (fallback 1) ──────────────────────────────────────────

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

// ── AI Extraction (fallback 2) ─────────────────────────────────────────────

async function extractWithAI(cfg: { accountId: string; apiToken: string }): Promise<number> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/browser-rendering/json`;

  const body = {
    url: TARGET_URL,
    prompt:
      "Extrae el valor de cambio del dólar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Devuelve SOLAMENTE el número entero de CUP que cuesta 1 USD.",
    response_format: {
      type: "json_schema" as const,
      schema: {
        type: "object" as const,
        properties: {
          usd_rate_cup: { type: "number" as const },
        },
        required: ["usd_rate_cup" as const],
      },
    },
    gotoOptions: { waitUntil: "load" as const, timeout: 60000 },
    actionTimeout: 60000,
    bestAttempt: true,
  };

  console.log("    [AI fallback] POST /browser-rendering/json con schema");

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
    throw new Error(`AI HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    success: boolean;
    result?: Record<string, unknown>;
  };

  if (!data.success || data.result == null) {
    throw new Error(`AI falló: ${JSON.stringify(data).slice(0, 500)}`);
  }

  if (data.result.usd_rate_cup != null) {
    try {
      return validateRate(data.result.usd_rate_cup);
    } catch (e) {
      console.log(`    [AI] usd_rate_cup inválido: ${e instanceof Error ? e.message : String(e)}`);
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

  throw new Error(`AI respuesta sin tasa válida: ${resultStr.slice(0, 500)}`);
}

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Main Scraper ───────────────────────────────────────────────────────────

async function fetchRateFromBrowserRun(
  attempt: number
): Promise<{ usdRateCup: number }> {
  const { accountId, apiToken } = getCloudflareConfig();

  console.log(`  [etapa 1/4] POST /browser-rendering/content a ${TARGET_URL} (intento ${attempt})…`);

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`;

  const waitUntil = attempt === 1 ? "networkidle2" : attempt === 2 ? "load" : "domcontentloaded";

  const body = {
    url: TARGET_URL,
    cacheTTL: 0,
    gotoOptions: {
      waitUntil: waitUntil as "networkidle2" | "load" | "domcontentloaded",
      timeout: 60000,
    },
    setJavaScriptEnabled: true,
    rejectResourceTypes: ["image", "stylesheet", "font", "media"] as const,
    actionTimeout: 60000,
    bestAttempt: true,
    viewport: { width: 1920, height: 1080 },
  };

  console.log(`  [config] waitUntil=${waitUntil}, actionTimeout=60000, cacheTTL=0`);

  if (DEBUG) {
    console.log(`  [DEBUG] Request body: ${JSON.stringify(body, null, 2)}`);
  }

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

  if (res.status === 422) {
    const errBody = await res.text().catch(() => "");
    console.log(`  [WARN] HTTP 422 en /content. Body: ${errBody.slice(0, 500)}`);
    throw new Error(`Browser Run HTTP 422: ${errBody.slice(0, 300)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Browser Run HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  console.log("  [etapa 2/4] HTTP 200 OK. Leyendo respuesta JSON…");

  const data = (await res.json()) as {
    success: boolean;
    meta?: { status?: number; title?: string };
    result?: string;
    errors?: { code: number; message: string }[];
  };

  if (!data.success) {
    const errMsgs =
      data.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") || "Unknown error";
    throw new Error(`Cloudflare API error: ${errMsgs}`);
  }

  const metaStatus = data.meta?.status ?? "N/A";
  const metaTitle = data.meta?.title ?? "(sin meta.title)";

  const html = data.result;
  const htmlLen = html ? html.length : 0;

  console.log(`  [diagnóstico] meta.status: ${metaStatus}`);
  console.log(`  [diagnóstico] meta.title: ${metaTitle}`);
  console.log(`  [diagnóstico] HTML length: ${htmlLen} chars`);

  if (metaStatus !== 200 && metaStatus !== "N/A") {
    console.log(`  [WARN] La página destino respondió HTTP ${metaStatus} (posible error/bloqueo)`);
  }

  if (!html || typeof html !== "string" || htmlLen < 100) {
    console.log(`  [ERROR] HTML vacío o demasiado corto (${htmlLen} chars)`);
    if (html) console.log(`  [DEBUG] HTML recibido: ${html.slice(0, 2000)}`);
    throw new Error("HTML vacío o inválido");
  }

  const visible = stripHtml(html);
  console.log(`  [diagnóstico] Texto visible length: ${visible.length} chars`);
  console.log(`  [diagnóstico] Inicio texto visible: ${visible.slice(0, 500)}`);

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
    "checking your browser", "verifying you are human", "challenge-platform",
  ];
  const htmlLower = html.toLowerCase();
  for (const indicator of errorIndicators) {
    if (htmlLower.includes(indicator)) {
      console.log(`  [ERROR] Posible bloqueo: '${indicator}' en el HTML`);
      console.log(`  [diagnóstico] meta.title: ${metaTitle}, meta.status: ${metaStatus}`);
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
    `No se pudo extraer la tasa. meta.title='${metaTitle}', meta.status=${metaStatus}. Inicio HTML: ${html.slice(0, 500)}`
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

      const delay = RETRY_DELAYS[attempt - 1] || 10000;
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
