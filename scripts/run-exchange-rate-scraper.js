/**
 * Script autónomo para ejecutar el scraper de tasa USD/CUP desde GitHub Actions.
 *
 * Inicializa Prisma, carga las tiendas y ejecuta scrapeAndUpdateUsdRate
 * para cada una. No depende de Next.js ni de rutas API.
 */

// Cargar dotenv manualmente para entornos que no usan Next.js
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: ".env.local", override: true });
  dotenv.config({ path: ".env", override: false });
} catch {
  // dotenv no está disponible en producción, asumimos vars de entorno del sistema
}

const { PrismaClient } = require("@prisma/client");

const TARGET_URL = "https://eltoque.com";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const USD_RATE_MIN = 20;
const USD_RATE_MAX = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateExecutionId() {
  return `er-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class ScrapingError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ScrapingError";
  }
}

class ValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ValidationError";
  }
}

function validateRate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(
      `Valor no numérico o finito: ${JSON.stringify(value)}`
    );
  }
  if (value <= 0) {
    throw new ValidationError(`Valor no positivo: ${value}`);
  }
  if (value < USD_RATE_MIN || value > USD_RATE_MAX) {
    throw new ValidationError(
      `Valor fuera de rango (${USD_RATE_MIN}–${USD_RATE_MAX}): ${value}`
    );
  }
  return Math.round(value);
}

function getCloudflareConfig() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !apiToken) {
    throw new Error(
      "Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN en variables de entorno"
    );
  }
  return { accountId, apiToken };
}

async function fetchRateFromBrowserRun() {
  const { accountId, apiToken } = getCloudflareConfig();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/json`;

  const body = {
    url: TARGET_URL,
    prompt:
      "Extrae únicamente el valor actual de cambio del dólar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Busca el texto exacto donde aparece '1 USD' seguido de un valor numérico en CUP. " +
      "Ignora otras monedas como EUR, MLC, CAD, ZELLE, etc. " +
      "Devuelve solo el número entero de cuántos CUP cuesta 1 USD.",
    response_format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          usd_rate_cup: {
            type: "number",
            description:
              "Tasa de cambio USD a CUP en el mercado informal cubano",
          },
        },
        required: ["usd_rate_cup"],
      },
    },
    gotoOptions: { waitUntil: "networkidle0" },
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
      `Browser Run responded HTTP ${res.status}. Body: ${text.slice(0, 500)}`
    );
  }

  const data = await res.json();

  if (!data.success) {
    const errMsgs =
      data.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") ||
      "Unknown error";
    throw new ScrapingError(`Cloudflare API error: ${errMsgs}`);
  }

  if (data.result?.usd_rate_cup == null) {
    throw new ScrapingError(
      "Respuesta sin 'usd_rate_cup': " + JSON.stringify(data.result).slice(0, 200)
    );
  }

  return { usdRateCup: validateRate(data.result.usd_rate_cup) };
}

async function scrapeAndUpdateUsdRate(prisma, storeId) {
  const executionId = generateExecutionId();
  console.log(`[${executionId}] Scraping for store ${storeId}...`);

  let previousRate = null;
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { usdRateCup: true },
    });
    previousRate = store?.usdRateCup ?? null;
  } catch (e) {
    console.error(`[${executionId}] Failed to read previous rate:`, e.message);
  }

  let extractedRate = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchRateFromBrowserRun();
      extractedRate = result.usdRateCup;
      console.log(`[${executionId}] Attempt #${attempt}: extracted = ${extractedRate}`);
      break;
    } catch (err) {
      lastError = err.message;
      console.error(`[${executionId}] Attempt #${attempt} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) break;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  if (extractedRate === null) {
    console.error(
      `[${executionId}] All attempts failed. Keeping previous rate: ${previousRate}`
    );
    return { success: false, error: lastError, previousRate };
  }

  if (previousRate === extractedRate) {
    console.log(`[${executionId}] Rate unchanged at ${extractedRate}. Skipping update.`);
    return { success: true, rate: extractedRate, previousRate, updated: false };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: storeId },
        data: { usdRateCup: extractedRate },
      });
      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "DEVICE",
          actorId: "SYSTEM_GITHUB_ACTIONS",
          action: "EXCHANGE_RATE_AUTO_UPDATE",
          entityType: "Store",
          entityId: storeId,
          before: previousRate != null ? { usdRateCup: previousRate } : null,
          after: { usdRateCup: extractedRate },
          meta: {
            source: "eltoque.com",
            executionId,
            method: "cloudflare-browser-run-json",
          },
        },
      });
    });

    console.log(
      `[${executionId}] Updated: ${previousRate} → ${extractedRate}`
    );
    return { success: true, rate: extractedRate, previousRate, updated: true };
  } catch (err) {
    console.error(
      `[${executionId}] Failed to persist rate: ${err.message}`
    );
    return {
      success: false,
      rate: extractedRate,
      previousRate,
      error: `Persist failed: ${err.message}`,
    };
  }
}

async function main() {
  const executionId = generateExecutionId();
  console.log(`\n[${executionId}] === Exchange Rate Scraper Start ===`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const prisma = new PrismaClient();

  try {
    const stores = await prisma.store.findMany({
      select: { id: true, name: true },
    });

    if (stores.length === 0) {
      console.log("[${executionId}] No stores found. Exiting.");
      return;
    }

    console.log(`Found ${stores.length} store(s).`);

    const results = [];
    for (const store of stores) {
      console.log(`\n--- Store: ${store.name} (${store.id}) ---`);
      const result = await scrapeAndUpdateUsdRate(prisma, store.id);
      results.push({ storeId: store.id, storeName: store.name, ...result });
    }

    const ok = results.filter((r) => r.success === true).length;
    const fail = results.length - ok;
    console.log(`\n[${executionId]} === Summary ===`);
    console.log(`  Total: ${results.length}, OK: ${ok}, Failed: ${fail}`);

    results.forEach((r) => {
      console.log(
        `  ${r.storeName}: ${r.success ? "OK" : "FAIL"} | rate=${r.rate ?? "N/A"} | prev=${r.previousRate ?? "N/A"} | ${r.updated ? "UPDATED" : "unchanged"}${r.error ? " | error=" + r.error : ""}`
      );
    });

    if (fail > 0) {
      console.error(`\n[${executionId}] FAILED: ${fail} store(s) had errors.`);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
