/**
 * Script autonomo para ejecutar el scraper de tasa USD/CUP desde GitHub Actions.
 * Inicializa Prisma, carga las tiendas y ejecuta scrapeAndUpdateUsdRate
 * para cada una. No depende de Next.js ni de rutas API.
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

var TARGET_URL = "https://eltoque.com";
var MAX_RETRIES = 3;
var RETRY_BASE_MS = 1500;
var USD_RATE_MIN = 20;
var USD_RATE_MAX = 5000;

/**
 * Opciones de navegacion adaptativas por intento.
 * Intento 1: networkidle2 (permite hasta 2 conexiones).
 * Intento 2: combinacion load + networkidle2.
 * Intento 3: solo "load" (lo mas permisivo).
 */
function getGotoOptions(attempt) {
  if (attempt === 1) {
    return { waitUntil: "networkidle2", timeout: 60000 };
  }
  if (attempt === 2) {
    return { waitUntil: ["load", "networkidle2"], timeout: 60000 };
  }
  return { waitUntil: "load", timeout: 60000 };
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function generateExecutionId() {
  return "er-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function ScrapingError(msg) { this.name = "ScrapingError"; this.message = msg; }
ScrapingError.prototype = Object.create(Error.prototype);

function ValidationError(msg) { this.name = "ValidationError"; this.message = msg; }
ValidationError.prototype = Object.create(Error.prototype);

/**
 * Convierte un valor desconocido a numero.
 * Acepta number, string numerico, o null/undefined.
 */
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

/**
 * Busca un valor numerico dentro de un objeto recorriendo todas las claves.
 * Sirve como fallback cuando la IA no devuelve la estructura esperada,
 * pero aun asi coloco el valor en alguna propiedad del objeto.
 */
function findNumericValue(obj, depth) {
  if (depth > 3 || obj == null || typeof obj !== "object") return null;
  for (var key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    var val = obj[key];
    var num = coerceNumber(val);
    if (!isNaN(num) && num >= USD_RATE_MIN && num <= USD_RATE_MAX) {
      return num;
    }
    if (typeof val === "object") {
      var found = findNumericValue(val, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Llamada a la API /json de Cloudflare Browser Run.
 * Usa solo prompt (sin response_format) para evitar errores 422.
 */
async function fetchRateFromBrowserRun(attempt) {
  var cfg = getCloudflareConfig();
  var endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cfg.accountId + "/browser-rendering/json";

  /**
   * Browser Run inyecta response_format por defecto si no se provee,
   * causando error 422 en Workers AI. Sobreescribimos explicitamente
   * con json_object (no requiere schema) para evitar el error.
   */
  var body = {
    url: TARGET_URL,
    prompt:
      "Extrae el valor actual de cambio del dolar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Busca donde dice '1 USD' seguido de un numero en CUP. " +
      "Ignora EUR, MLC, CAD, ZELLE y otras monedas. " +
      "Devuelve SOLAMENTE un objeto JSON valido con una unica propiedad: " +
      "'usd_rate_cup' cuyo valor sea el numero entero de cuantos CUP cuesta 1 USD. " +
      "No incluyas markdown, explicaciones, ni texto adicional. " +
      "Ejemplo: {\"usd_rate_cup\": 325}",
    response_format: {
      type: "json_object",
    },
    gotoOptions: getGotoOptions(attempt),
    actionTimeout: 30000,
    bestAttempt: true,
  };

  console.log("  [debug] POST /browser-rendering/json (intento " + attempt + ")");
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
    console.log("  [debug] HTTP " + res.status + " respuesta completa: " + text.slice(0, 1000));
    throw new ScrapingError("Browser Run responded HTTP " + res.status + ".");
  }

  console.log("  [debug] HTTP 200 OK");

  var data = await res.json();

  if (!data.success) {
    var errMsgs = "Unknown error";
    if (data.errors && data.errors.length > 0) {
      errMsgs = data.errors.map(function (e) { return "[" + e.code + "] " + e.message; }).join(", ");
    }
    throw new ScrapingError("Cloudflare API error: " + errMsgs);
  }

  if (data.result == null) {
    throw new ScrapingError("Respuesta vacia: " + JSON.stringify(data).slice(0, 300));
  }

  // Intento 1: buscar usd_rate_cup directamente
  if (data.result.usd_rate_cup != null) {
    return { usdRateCup: validateRate(data.result.usd_rate_cup) };
  }

  // Intento 2: la IA podria ponerlo en "response" u otra clave comun
  var possibleKeys = ["response", "rate", "cup", "valor", "precio", "usd", "exchange_rate"];
  for (var i = 0; i < possibleKeys.length; i++) {
    var key = possibleKeys[i];
    if (data.result[key] != null) {
      try {
        return { usdRateCup: validateRate(data.result[key]) };
      } catch (_) {}
    }
  }

  // Intento 3: busqueda profunda en todo el objeto resultado
  var found = findNumericValue(data.result, 0);
  if (found !== null) {
    console.log("  [fallback] valor encontrado por busqueda profunda: " + found);
    return { usdRateCup: Math.round(found) };
  }

  throw new ScrapingError(
    "Respuesta sin tasa reconocible. Resultado: " + JSON.stringify(data.result).slice(0, 500)
  );
}

async function scrapeAndUpdateUsdRate(prisma, storeId) {
  var executionId = generateExecutionId();
  console.log("[" + executionId + "] Scraping for store " + storeId + "...");

  var previousRate = null;
  try {
    var store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { usdRateCup: true },
    });
    previousRate = store && store.usdRateCup != null ? store.usdRateCup : null;
  } catch (e) {
    console.error("[" + executionId + "] Failed to read previous rate: " + e.message);
  }

  var extractedRate = null;
  var lastError = null;

  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      var result = await fetchRateFromBrowserRun(attempt);
      extractedRate = result.usdRateCup;
      console.log("[" + executionId + "] Attempt #" + attempt + ": extracted = " + extractedRate);
      break;
    } catch (err) {
      lastError = err.message;
      console.error("[" + executionId + "] Attempt #" + attempt + " failed: " + err.message);
      if (attempt === MAX_RETRIES) break;
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }

  if (extractedRate === null) {
    console.error("[" + executionId + "] All attempts failed. Keeping previous rate: " + previousRate);
    return { success: false, error: lastError, previousRate: previousRate };
  }

  if (previousRate === extractedRate) {
    console.log("[" + executionId + "] Rate unchanged at " + extractedRate + ". Skipping update.");
    return { success: true, rate: extractedRate, previousRate: previousRate, updated: false };
  }

  try {
    await prisma.$transaction(async function (tx) {
      await tx.store.update({
        where: { id: storeId },
        data: { usdRateCup: extractedRate },
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
            method: "cloudflare-browser-run-json",
          },
        },
      });
    });

    console.log("[" + executionId + "] Updated: " + previousRate + " -> " + extractedRate);
    return { success: true, rate: extractedRate, previousRate: previousRate, updated: true };
  } catch (err) {
    console.error("[" + executionId + "] Failed to persist rate: " + err.message);
    return {
      success: false,
      rate: extractedRate,
      previousRate: previousRate,
      error: "Persist failed: " + err.message,
    };
  }
}

async function main() {
  var eid = generateExecutionId();
  console.log("");
  console.log("[" + eid + "] === Exchange Rate Scraper Start ===");
  console.log("Timestamp: " + new Date().toISOString());

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
