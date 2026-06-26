/**
 * Script autonomo para ejecutar el scraper de tasa USD/CUP desde GitHub Actions.
 * Inicializa Prisma, carga las tiendas y ejecuta scrapeAndUpdateUsdRate
 * para cada una. No depende de Next.js ni de rutas API.
 *
 * Estrategia de extraccion:
 *   1. Obtener HTML renderizado via /content de Browser Run.
 *   2. Parsear con Cheerio (busca elementos con "USD" + numero cercano).
 *   3. Fallback: regex sobre el HTML.
 *   4. Fallback: AI via /json (solo si los pasos anteriores fallan).
 *
 * Backoff progresivo: 5s, 15s, 30s. HTTP 429: 60s y reintenta.
 *
 * ADVERTENCIA: Este script EVITA template literals con ${} para prevenir
 * errores de parsing en Node.js v20. Usa solo concatenacion de strings.
 */

try {
  var dotenv = require("dotenv");
  dotenv.config({ path: ".env.local", override: true });
  dotenv.config({ path: ".env", override: false });
} catch (_) {}

var { PrismaClient } = require("@prisma/client");
var cheerio = require("cheerio");

// ── Configuracion ──────────────────────────────────────────────────────────

var TARGET_URL = "https://eltoque.com";
var MAX_RETRIES = 3;
var RETRY_DELAYS = [5000, 15000, 30000]; // ms entre reintentos
var RATE_LIMIT_DELAY = 60000; // 60s si recibimos HTTP 429
var USD_RATE_MIN = 20;
var USD_RATE_MAX = 5000;
var DEBUG = process.env.DEBUG_SCRAPER === "true";

// ── Utilidades ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function generateExecutionId() {
  return "er-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function ScrapingError(msg) { this.name = "ScrapingError"; this.message = msg; }
ScrapingError.prototype = Object.create(Error.prototype);

function RateLimitError(msg) { this.name = "RateLimitError"; this.message = msg; }
RateLimitError.prototype = Object.create(Error.prototype);

function ValidationError(msg) { this.name = "ValidationError"; this.message = msg; }
ValidationError.prototype = Object.create(Error.prototype);

function coerceNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    var cleaned = value.trim().replace(/[,$]/g, "");
    var num = Number(cleaned);
    if (!isNaN(num)) return num;
  }
  return NaN;
}

function validateRate(value) {
  var num = coerceNumber(value);
  if (isNaN(num) || !Number.isFinite(num)) {
    throw new ValidationError("Valor no numerico o finito: " + JSON.stringify(value));
  }
  if (num <= 0) {
    throw new ValidationError("Valor no positivo: " + num);
  }
  if (num < USD_RATE_MIN || num > USD_RATE_MAX) {
    throw new ValidationError("Valor fuera de rango (" + USD_RATE_MIN + "-" + USD_RATE_MAX + "): " + num);
  }
  return Math.round(num);
}

function getCloudflareConfig() {
  var accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  var apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !apiToken) {
    throw new Error("Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN en variables de entorno");
  }
  return { accountId: accountId, apiToken: apiToken };
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(html) {
  var m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "(sin titulo)";
}

// ── Extraccion por parseo HTML (Cheerio) ───────────────────────────────────

/**
 * Busca la tasa USD/CUP en el HTML usando Cheerio.
 * Recorre elementos que contengan "USD" y busca un numero valido
 * en el mismo elemento, elementos hermanos o el padre cercano.
 */
function extractWithCheerio(html) {
  var $ = cheerio.load(html);

  // Seleccionar elementos que contienen "USD" en su texto
  var candidates = [];
  $("*").each(function () {
    var el = $(this);
    var text = el.text().trim();
    if (/USD/i.test(text)) {
      // Extraer todos los numeros del texto del elemento
      var nums = text.match(/\d{3,4}/g);
      if (nums) {
        for (var i = 0; i < nums.length; i++) {
          var n = Number(nums[i]);
          if (n >= USD_RATE_MIN && n <= USD_RATE_MAX) {
            candidates.push(n);
          }
        }
      }
      // Tambien revisar el textContent completo del padre (para captar "1 USD = 325")
      var parentText = el.parent().text().trim();
      var parentNums = parentText.match(/\d{3,4}/g);
      if (parentNums) {
        for (var j = 0; j < parentNums.length; j++) {
          var pn = Number(parentNums[j]);
          if (pn >= USD_RATE_MIN && pn <= USD_RATE_MAX) {
            candidates.push(pn);
          }
        }
      }
    }
  });

  if (candidates.length > 0) {
    // Tomar el valor mas frecuente (el que mas aparece)
    var freq = {};
    for (var k = 0; k < candidates.length; k++) {
      freq[candidates[k]] = (freq[candidates[k]] || 0) + 1;
    }
    var best = candidates[0];
    var bestFreq = 0;
    for (var key in freq) {
      if (freq[key] > bestFreq) {
        bestFreq = freq[key];
        best = Number(key);
      }
    }
    return best;
  }

  return null;
}

// ── Extraccion por regex (fallback 1) ──────────────────────────────────────

var RATE_PATTERNS = [
  /1\s*USD[^0-9]*?(\d{3,4})/i,
  /\$1\s*USD[^0-9]*?(\d{3,4})/i,
  /USD\s*\$?\s*(\d{3,4})/i,
  /1\s*D[Oo]lar[^0-9]*?(\d{3,4})/i,
  /TASA\s*(?:DE\s*)?CAMBIO[^0-9]*?(\d{3,4})/i,
  /(\d{3,4})\s*CUP\s*\/?\s*(?:1\s*)?USD/i,
  /CUP\s*[×xX*]\s*(\d{3,4})/i,
];

function extractWithRegex(html) {
  for (var i = 0; i < RATE_PATTERNS.length; i++) {
    var match = html.match(RATE_PATTERNS[i]);
    if (match) {
      var num = Number(match[1]);
      if (Number.isFinite(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
        return Math.round(num);
      }
    }
  }
  return null;
}

// ── Extraccion por IA (fallback 2) ─────────────────────────────────────────

/**
 * Solo se llama si el parseo HTML fallo.
 * Usa el endpoint /json con prompt para que la IA extraiga la tasa.
 */
async function extractWithAI(cfg, attempt) {
  var endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cfg.accountId + "/browser-rendering/json";
  var body = {
    url: TARGET_URL,
    prompt:
      "Extrae el valor actual de cambio del dolar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Devuelve SOLAMENTE el numero entero de CUP que cuesta 1 USD. " +
      "Ejemplo: 325",
    gotoOptions: { waitUntil: "load", timeout: 60000 },
    actionTimeout: 30000,
    bestAttempt: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  console.log("    [AI fallback] POST /browser-rendering/json");
  var res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    var text = await res.text().catch(function () { return ""; });
    throw new ScrapingError("AI HTTP " + res.status + ": " + text.slice(0, 300));
  }

  var data = await res.json();
  if (!data.success || data.result == null) {
    throw new ScrapingError("AI fallo: " + JSON.stringify(data).slice(0, 300));
  }

  var resultStr = JSON.stringify(data.result);

  // Buscar numeros en la respuesta
  var aiKeys = ["usd_rate_cup", "response", "rate", "cup", "valor", "precio", "usd", "exchange_rate"];
  for (var i = 0; i < aiKeys.length; i++) {
    if (data.result[aiKeys[i]] != null) {
      try {
        return { usdRateCup: validateRate(data.result[aiKeys[i]]) };
      } catch (_) {}
    }
  }

  // Regex sobre la respuesta serializada
  var match = resultStr.match(/"(\d{2,4})"/) || resultStr.match(/(\d{2,4})/);
  if (match) {
    var num = Number(match[1]);
    if (Number.isFinite(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
      return { usdRateCup: Math.round(num) };
    }
  }

  throw new ScrapingError("AI respuesta sin tasa: " + resultStr.slice(0, 300));
}

// ── Llamada principal a Browser Run ────────────────────────────────────────

/**
 * Etapas:
 *   1. Navegacion (goto): configurada via gotoOptions.
 *   2. Renderizado + extraccion HTML: endpoint /content.
 *   3. Validacion del contenido recibido.
 *   4. Parseo: Cheerio -> Regex -> AI.
 */
async function fetchRateFromBrowserRun(attempt) {
  var cfg = getCloudflareConfig();

  // --- Etapa 1-2: Navegacion y obtencion de HTML ---
  console.log("  [etapa 1/4] Navegando a " + TARGET_URL + " (intento " + attempt + ")...");
  var endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cfg.accountId + "/browser-rendering/content";

  var waitOpts;
  if (attempt === 1) waitOpts = { waitUntil: "networkidle2", timeout: 60000 };
  else if (attempt === 2) waitOpts = { waitUntil: ["load", "networkidle2"], timeout: 60000 };
  else waitOpts = { waitUntil: "load", timeout: 60000 };

  var body = {
    url: TARGET_URL,
    gotoOptions: waitOpts,
    actionTimeout: 30000,
    bestAttempt: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  var res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // --- Etapa 3: Validacion de la respuesta ---
  if (res.status === 429) {
    throw new RateLimitError("Rate limit exceeded (HTTP 429)");
  }

  if (!res.ok) {
    var errBody = await res.text().catch(function () { return ""; });
    throw new ScrapingError("Browser Run HTTP " + res.status + ": " + errBody.slice(0, 500));
  }

  console.log("  [etapa 2/4] HTTP 200 OK. Procesando respuesta...");

  var data = await res.json();

  if (!data.success) {
    var errMsgs = "Unknown error";
    if (data.errors && data.errors.length > 0) {
      errMsgs = data.errors.map(function (e) { return "[" + e.code + "] " + e.message; }).join(", ");
    }
    throw new ScrapingError("Cloudflare API error: " + errMsgs);
  }

  var html = data.result;
  if (html == null || typeof html !== "string" || html.length < 50) {
    console.log("  [ERROR] HTML vacio o demasiado corto (" + (html ? html.length : 0) + " chars)");
    if (html) console.log("  [DEBUG] HTML recibido: " + html.slice(0, 1000));
    throw new ScrapingError("HTML vacio o invalido");
  }

  // --- Diagnostico (si DEBUG=true) ---
  var title = extractTitle(html);
  var visible = stripHtml(html);

  console.log("  [diagnostico] document.title: " + title);
  console.log("  [diagnostico] HTML length: " + html.length + " chars");
  console.log("  [diagnostico] Texto visible length: " + visible.length + " chars");

  if (DEBUG) {
    console.log("  [DEBUG] === INICIO HTML (5000 chars) ===");
    console.log(html.slice(0, 5000));
    console.log("  [DEBUG] === FIN HTML ===");
    console.log("  [DEBUG] === INICIO TEXTO VISIBLE (3000 chars) ===");
    console.log(visible.slice(0, 3000));
    console.log("  [DEBUG] === FIN TEXTO VISIBLE ===");
  }

  // Detectar pagina de error/captcha/bloqueo
  var errorIndicators = ["captcha", "please complete the security check", "cf-browser-verification", "just a moment", "error 1020", "access denied", "attention required"];
  var htmlLower = html.toLowerCase();
  for (var e = 0; e < errorIndicators.length; e++) {
    if (htmlLower.indexOf(errorIndicators[e]) !== -1) {
      console.log("  [ERROR] Posible bloqueo detectado: '" + errorIndicators[e] + "' en el HTML");
      throw new ScrapingError("Pagina bloqueada por Cloudflare/seguridad");
    }
  }

  console.log("  [etapa 3/4] Parseando HTML para extraer tasa...");

  // --- Etapa 4a: Parseo con Cheerio ---
  var rate = extractWithCheerio(html);
  if (rate !== null) {
    console.log("  [ok] Tasa extraida por Cheerio: " + rate + " CUP/USD");
    return { usdRateCup: rate };
  }
  console.log("  [fallback] Cheerio no encontro tasa. Probando regex...");

  // --- Etapa 4b: Fallback regex ---
  rate = extractWithRegex(html);
  if (rate !== null) {
    console.log("  [ok] Tasa extraida por regex: " + rate + " CUP/USD");
    return { usdRateCup: rate };
  }
  console.log("  [fallback] Regex no encontro tasa. Probando AI...");

  // --- Etapa 4c: Fallback AI ---
  try {
    var aiResult = await extractWithAI(cfg, attempt);
    console.log("  [ok] Tasa extraida por AI: " + aiResult.usdRateCup + " CUP/USD");
    return aiResult;
  } catch (aiErr) {
    console.log("  [fallback] AI tambien fallo: " + (aiErr.message || aiErr));
  }

  // Si llegamos aqui, ningun metodo funciono
  throw new ScrapingError(
    "No se pudo extraer la tasa. Titulo: '" + title + "'. HTML: " + html.slice(0, 200)
  );
}

// ── Logica de reintentos con backoff progresivo ────────────────────────────

async function scrapeAndUpdateUsdRate(prisma, storeId) {
  var executionId = generateExecutionId();
  console.log("[" + executionId + "] Scraping for store " + storeId + "...");

  var previousRate = null;
  var storeMode = null;
  try {
    var store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { usdRateCup: true, exchangeRateMode: true },
    });
    previousRate = store && store.usdRateCup != null ? store.usdRateCup : null;
    storeMode = store ? store.exchangeRateMode : null;
  } catch (e) {
    console.error("[" + executionId + "] Error leyendo BD: " + e.message);
  }

  if (storeMode === "MANUAL") {
    console.log("[" + executionId + "] Modo MANUAL: scraping omitido.");
    return { success: true, rate: previousRate, previousRate: previousRate, updated: false };
  }

  var extractedRate = null;
  var lastError = null;

  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      var result = await fetchRateFromBrowserRun(attempt);
      extractedRate = result.usdRateCup;
      console.log("[" + executionId + "] Intento #" + attempt + " exitoso: " + extractedRate + " CUP/USD");
      break;
    } catch (err) {
      lastError = err.message;

      // Rate limiting: esperar 60s y NO contar como intento
      if (err instanceof RateLimitError || err.name === "RateLimitError") {
        console.error("[" + executionId + "] Rate limit (429). Esperando 60s y reintentando...");
        await sleep(RATE_LIMIT_DELAY);
        attempt--; // No consume un intento
        continue;
      }

      console.error("[" + executionId + "] Intento #" + attempt + " fallo: " + err.message);
      if (attempt === MAX_RETRIES) break;

      var delay = RETRY_DELAYS[attempt - 1] || 15000;
      console.log("[" + executionId + "] Esperando " + delay + "ms antes del siguiente intento...");
      await sleep(delay);
    }
  }

  if (extractedRate === null) {
    console.error("[" + executionId + "] Todos los intentos fallaron. Manteniendo tasa anterior: " + previousRate);
    return { success: false, error: lastError, previousRate: previousRate };
  }

  if (previousRate === extractedRate) {
    console.log("[" + executionId + "] Tasa sin cambios (" + extractedRate + "). Sin actualizar BD.");
    return { success: true, rate: extractedRate, previousRate: previousRate, updated: false };
  }

  try {
    await prisma.$transaction(async function (tx) {
      await tx.store.update({
        where: { id: storeId },
        data: {
          usdRateCup: extractedRate,
          exchangeRateMode: "AUTO",
          exchangeRateAutoUpdatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          storeId: storeId,
          actorType: "DEVICE",
          actorId: "SYSTEM_GITHUB_ACTIONS",
          action: "EXCHANGE_RATE_AUTO_UPDATE",
          entityType: "Store",
          entityId: storeId,
          before: previousRate != null ? { usdRateCup: previousRate } : null,
          after: { usdRateCup: extractedRate },
          meta: {
            source: "eltoque.com",
            executionId: executionId,
            method: "cloudflare-browser-run-content",
          },
        },
      });
    });

    console.log("[" + executionId + "] BD actualizada: " + previousRate + " -> " + extractedRate);
    return { success: true, rate: extractedRate, previousRate: previousRate, updated: true };
  } catch (err) {
    console.error("[" + executionId + "] Error persistiendo: " + err.message);
    return {
      success: false,
      rate: extractedRate,
      previousRate: previousRate,
      error: "Persist fallo: " + err.message,
    };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  var eid = generateExecutionId();
  console.log("");
  console.log("[" + eid + "] === Exchange Rate Scraper Start ===");
  console.log("Timestamp: " + new Date().toISOString());
  console.log("Mode: " + (DEBUG ? "DEBUG (con HTML dump)" : "NORMAL"));

  var prisma = new PrismaClient();

  try {
    var stores = await prisma.store.findMany({
      select: { id: true, name: true },
    });

    if (stores.length === 0) {
      console.log("[" + eid + "] No stores found. Exiting.");
      return;
    }

    console.log("Found " + stores.length + " store(s).");

    var results = [];
    for (var i = 0; i < stores.length; i++) {
      var store = stores[i];
      console.log("");
      console.log("--- Store: " + store.name + " (" + store.id + ") ---");
      var result = await scrapeAndUpdateUsdRate(prisma, store.id);
      results.push({ storeId: store.id, storeName: store.name, ...result });
    }

    var ok = 0;
    for (var j = 0; j < results.length; j++) {
      if (results[j].success === true) ok++;
    }
    var fail = results.length - ok;

    console.log("");
    console.log("[" + eid + "] === Summary ===");
    console.log("  Total: " + results.length + ", OK: " + ok + ", Failed: " + fail);

    for (var k = 0; k < results.length; k++) {
      var r = results[k];
      var line = "  " + r.storeName + ": " + (r.success ? "OK" : "FAIL");
      line = line + " | rate=" + (r.rate != null ? r.rate : "N/A");
      line = line + " | prev=" + (r.previousRate != null ? r.previousRate : "N/A");
      line = line + " | " + (r.updated ? "UPDATED" : "unchanged");
      if (r.error) {
        line = line + " | error=" + r.error;
      }
      console.log(line);
    }

    if (fail > 0) {
      console.error("");
      console.error("[" + eid + "] FAILED: " + fail + " store(s) had errors.");
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(function (err) {
  console.error("Unhandled error:", err);
  process.exit(1);
});
