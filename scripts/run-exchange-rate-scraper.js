/**
 * Script autonomo para ejecutar el scraper de tasa USD/CUP desde GitHub Actions.
 * Metodo principal: POST /browser-rendering/content para obtener HTML renderizado.
 * Fallback: POST /browser-rendering/json con AI solo si HTML no contiene la tasa.
 *
 * Basado en documentacion oficial de Cloudflare Browser Run:
 *   https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/
 *   https://developers.cloudflare.com/browser-run/quick-actions/json-endpoint/
 *   https://developers.cloudflare.com/browser-run/reference/timeouts/
 *   https://developers.cloudflare.com/api/resources/browser_rendering/
 *
 * El endpoint /content devuelve { meta: { status, title }, result: "HTML", success, errors }
 * El endpoint /json devuelve { result: { ... }, success, errors }
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
var RETRY_DELAYS = [10000, 20000, 40000]; // 10s, 20s, 40s backoff progresivo
var RATE_LIMIT_DELAY = 60000; // 60s si recibimos HTTP 429 (error 2001)
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

// ── Extraccion por parseo HTML (Cheerio) ───────────────────────────────────

/**
 * Busca la tasa USD/CUP en el HTML usando Cheerio.
 * Optimizado: solo busca en contenedores relevantes (div, span, p, td, li, strong, h1-h6, section, article)
 * en vez de iterar todos los elementos con $("*").
 */
function extractWithCheerio(html) {
  var $ = cheerio.load(html);
  var candidates = [];

  // Solo buscar en contenedores de texto relevantes
  var containerSelector = "div, span, p, td, li, strong, b, h1, h2, h3, h4, h5, h6, section, article, label, a";
  $(containerSelector).each(function () {
    var el = $(this);
    var text = el.text().trim();
    if (!text || text.length > 500) return; // saltar elementos vacios o muy grandes
    if (!/USD|d[oó]lar|CUP/i.test(text)) return;

    var nums = text.match(/\d{3,4}/g);
    if (nums) {
      for (var i = 0; i < nums.length; i++) {
        var n = Number(nums[i]);
        if (n >= USD_RATE_MIN && n <= USD_RATE_MAX) {
          candidates.push(n);
        }
      }
    }

    // Tambien revisar el texto del padre inmediato
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
  });

  if (candidates.length === 0) return null;

  // Tomar el valor mas frecuente
  var freq = {};
  var best = candidates[0];
  var bestFreq = 0;
  for (var k = 0; k < candidates.length; k++) {
    freq[candidates[k]] = (freq[candidates[k]] || 0) + 1;
  }
  for (var key in freq) {
    if (freq[key] > bestFreq) {
      bestFreq = freq[key];
      best = Number(key);
    }
  }
  return best;
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
 * Solo se llama si Cheerio y regex fallaron.
 * Usa POST /browser-rendering/json con prompt + response_format (JSON schema).
 * Segun docs oficiales:
 *   - response_format con schema es mas confiable que solo prompt
 *   - custom_ai permite modelos alternativos
 */
async function extractWithAI(cfg) {
  var endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cfg.accountId + "/browser-rendering/json";

  var body = {
    url: TARGET_URL,
    prompt:
      "Extrae el valor de cambio del dolar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Devuelve SOLAMENTE el numero entero de CUP que cuesta 1 USD.",
    response_format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          usd_rate_cup: { type: "number" }
        },
        required: ["usd_rate_cup"]
      }
    },
    gotoOptions: { waitUntil: "load", timeout: 60000 },
    actionTimeout: 60000,
    bestAttempt: true,
  };

  console.log("    [AI fallback] POST /browser-rendering/json con schema");

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
    // HTTP 422 del /json: la IA no puede procesar la pagina
    throw new ScrapingError("AI HTTP " + res.status + ": " + text.slice(0, 500));
  }

  var data = await res.json();
  if (!data.success || data.result == null) {
    throw new ScrapingError("AI fallo: success=false, result=" + JSON.stringify(data).slice(0, 500));
  }

  // El schema forza { usd_rate_cup: number }
  if (data.result.usd_rate_cup != null) {
    try {
      var validated = validateRate(data.result.usd_rate_cup);
      return { usdRateCup: validated };
    } catch (e) {
      console.log("    [AI] usd_rate_cup invalido: " + e.message);
    }
  }

  var resultStr = JSON.stringify(data.result);

  // Buscar cualquier numero en la respuesta como ultimo recurso
  var match = resultStr.match(/"(\d{2,4})"/) || resultStr.match(/(\d{2,4})/);
  if (match) {
    var num = Number(match[1]);
    if (Number.isFinite(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
      return { usdRateCup: Math.round(num) };
    }
  }

  throw new ScrapingError("AI respuesta sin tasa valida: " + resultStr.slice(0, 500));
}

// ── Llamada principal a Browser Run ────────────────────────────────────────

/**
 * Flujo segun documentacion oficial:
 *
 * 1. POST /browser-rendering/content con:
 *    - url: TARGET_URL
 *    - gotoOptions: { waitUntil: "networkidle2", timeout: 60000 }
 *    - setJavaScriptEnabled: true
 *    - rejectResourceTypes: ["image", "stylesheet", "font", "media"]
 *    - cacheTTL: 0 (desactivar cache entre reintentos)
 *    - actionTimeout: 60000
 *    - bestAttempt: true
 *    - viewport: { width: 1920, height: 1080 }
 *
 * 2. La respuesta contiene:
 *    - meta.status: HTTP status de la pagina destino
 *    - meta.title: document.title
 *    - result: HTML renderizado completo
 *
 * 3. Extraccion:
 *    a) Cheerio: buscar "USD" + numero en contenedores
 *    b) Regex: patrones de tasa en HTML plano
 *    c) AI: POST /browser-rendering/json con schema (solo como ultimo recurso)
 */
async function fetchRateFromBrowserRun(attempt) {
  var cfg = getCloudflareConfig();

  console.log("  [etapa 1/4] POST /browser-rendering/content a " + TARGET_URL + " (intento " + attempt + ")...");

  var endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cfg.accountId + "/browser-rendering/content";

  // Estrategia waitUntil progresiva:
  //   Intento 1: networkidle2 (espera que termine JS)
  //   Intento 2: load (menos estricto)
  //   Intento 3: domcontentloaded (el mas rapido, por si la pagina bloquea)
  var waitUntil;
  if (attempt === 1) waitUntil = "networkidle2";
  else if (attempt === 2) waitUntil = "load";
  else waitUntil = "domcontentloaded";

  var body = {
    url: TARGET_URL,
    cacheTTL: 0, // Desactivar cache entre reintentos
    gotoOptions: {
      waitUntil: waitUntil,
      timeout: 60000,
    },
    setJavaScriptEnabled: true,
    rejectResourceTypes: ["image", "stylesheet", "font", "media"],
    actionTimeout: 60000,
    bestAttempt: true,
    viewport: { width: 1920, height: 1080 },
  };

  console.log("  [config] waitUntil=" + waitUntil + ", actionTimeout=60000, cacheTTL=0");

  if (DEBUG) {
    console.log("  [DEBUG] Request body: " + JSON.stringify(body, null, 2));
  }

  var res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // --- Manejo de errores HTTP ---
  if (res.status === 429) {
    throw new RateLimitError("Rate limit exceeded (HTTP 429)");
  }

  if (res.status === 422) {
    // 422 en /content puede indicar timeout de accion o pagina no disponible
    var errBody422 = await res.text().catch(function () { return ""; });
    console.log("  [WARN] HTTP 422 en /content. Body: " + errBody422.slice(0, 500));
    throw new ScrapingError("Browser Run HTTP 422: " + errBody422.slice(0, 300));
  }

  if (!res.ok) {
    var errBody = await res.text().catch(function () { return ""; });
    throw new ScrapingError("Browser Run HTTP " + res.status + ": " + errBody.slice(0, 500));
  }

  console.log("  [etapa 2/4] HTTP 200 OK. Leyendo respuesta JSON...");

  var data = await res.json();

  // --- Validacion de la respuesta ---
  if (!data.success) {
    var errMsgs = "Unknown error";
    if (data.errors && data.errors.length > 0) {
      errMsgs = data.errors.map(function (e) { return "[" + e.code + "] " + e.message; }).join(", ");
    }
    throw new ScrapingError("Cloudflare API error: " + errMsgs);
  }

  // Usar meta de la respuesta oficial (disponible en /content)
  var metaStatus = data.meta && data.meta.status != null ? data.meta.status : "N/A";
  var metaTitle = data.meta && data.meta.title ? data.meta.title : "(sin meta.title)";

  var html = data.result;
  var htmlLen = html ? html.length : 0;

  console.log("  [diagnostico] meta.status: " + metaStatus);
  console.log("  [diagnostico] meta.title: " + metaTitle);
  console.log("  [diagnostico] HTML length: " + htmlLen + " chars");

  // Mostrar status HTTP de la pagina destino
  if (metaStatus !== 200 && metaStatus !== "N/A") {
    console.log("  [WARN] La pagina destino respondio HTTP " + metaStatus + " (posible error/bloqueo)");
  }

  if (!html || typeof html !== "string" || htmlLen < 100) {
    console.log("  [ERROR] HTML vacio o demasiado corto (" + htmlLen + " chars)");
    if (html) console.log("  [DEBUG] HTML recibido: " + html.slice(0, 2000));
    throw new ScrapingError("HTML vacio o invalido");
  }

  // Diagnosticar el contenido (SIEMPRE loguear esto, no solo en DEBUG)
  var visible = stripHtml(html);
  console.log("  [diagnostico] Texto visible length: " + visible.length + " chars");
  // Log de los primeros 500 chars del texto visible para inspeccion
  console.log("  [diagnostico] Inicio texto visible: " + visible.slice(0, 500));

  if (DEBUG) {
    console.log("  [DEBUG] === INICIO HTML (5000 chars) ===");
    console.log(html.slice(0, 5000));
    console.log("  [DEBUG] === FIN HTML ===");
    console.log("  [DEBUG] === INICIO TEXTO VISIBLE (3000 chars) ===");
    console.log(visible.slice(0, 3000));
    console.log("  [DEBUG] === FIN TEXTO VISIBLE ===");
  }

  // Detectar bloqueo/captcha en el HTML
  var errorIndicators = [
    "captcha", "please complete the security check", "cf-browser-verification",
    "just a moment", "error 1020", "access denied", "attention required",
    "checking your browser", "verifying you are human", "challenge-platform",
  ];
  var htmlLower = html.toLowerCase();
  for (var e = 0; e < errorIndicators.length; e++) {
    if (htmlLower.indexOf(errorIndicators[e]) !== -1) {
      console.log("  [ERROR] Posible bloqueo detectado: '" + errorIndicators[e] + "' en el HTML");
      console.log("  [diagnostico] meta.title: " + metaTitle + ", meta.status: " + metaStatus);
      throw new ScrapingError("Pagina bloqueada por Cloudflare/seguridad");
    }
  }

  console.log("  [etapa 3/4] Parseando HTML para extraer tasa...");

  // --- Etapa 4a: Parseo con Cheerio (primario) ---
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
    var aiResult = await extractWithAI(cfg);
    console.log("  [ok] Tasa extraida por AI: " + aiResult.usdRateCup + " CUP/USD");
    return aiResult;
  } catch (aiErr) {
    console.log("  [fallback] AI tambien fallo: " + (aiErr.message || aiErr));
  }

  // Si llegamos aqui, ningun metodo funciono
  throw new ScrapingError(
    "No se pudo extraer la tasa. meta.title='" + metaTitle + "', meta.status=" + metaStatus +
    ". Inicio HTML: " + html.slice(0, 500)
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

      // Rate limiting HTTP 429: esperar 60s y NO consumir intento
      if (err instanceof RateLimitError || err.name === "RateLimitError") {
        console.error("[" + executionId + "] Rate limit (429). Esperando 60s y reintentando...");
        await sleep(RATE_LIMIT_DELAY);
        attempt--;
        continue;
      }

      console.error("[" + executionId + "] Intento #" + attempt + " fallo: " + err.message);
      if (attempt === MAX_RETRIES) break;

      var delay = RETRY_DELAYS[attempt - 1] || 10000;
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
