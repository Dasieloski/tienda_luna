/**
 * Servicio de scraping de tasa de cambio USD/CUP desde eltoque.com
 * usando Cloudflare Browser Run (Quick Actions JSON endpoint).
 *
 * Arquitectura:
 * - Se apoya en la API /json de Browser Run que utiliza IA para extraer
 *   datos estructurados sin depender de selectores CSS frágiles.
 * - El schema JSON guía a la IA a extraer únicamente el valor USD.
 * - Se implementa retry con backoff exponencial, validación numérica y logging
 *   detallado a través de Prisma AuditLog para trazabilidad completa.
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Configuración del servicio
// ─────────────────────────────────────────────────────────────────────────────

/** URL objetivo donde se publica la tasa de cambio */
const TARGET_URL = "https://eltoque.com";

/** Umbral máximo de reintentos antes de declarar fallo */
const MAX_RETRIES = 3;

/** Backoff base en ms (se duplica en cada reintento) */
const RETRY_BASE_MS = 1500;

/** Rangos razonables de validación para detectar valores anómalos */
const USD_RATE_MIN = 20;   // 1 USD no vale menos de 20 CUP
const USD_RATE_MAX = 5000; // 1 USD no vale más de 5000 CUP

/** Clave para identificar al actor del sistema automatizado en audit logs */
const SYSTEM_ACTOR_ID = "SYSTEM_BROWSER_RUN";
/**
 * Configuración del endpoint de Cloudflare Browser Run.
 * Se recarga de variables de entorno para permitir despliegues
 * multi-cuenta sin cambio de código.
 */
function getCloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() || "";

  if (!accountId || !apiToken) {
    throw new CloudflareConfigError(
      "Faltan variables de entorno CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN. " +
        "Configúralas en .env o .env.local antes de ejecutar el scraper."
    );
  }

  return { accountId, apiToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos y errores personalizados
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateExecutionId(): string {
  return `er-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación del valor extraído
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida que el valor extraído sea numérico, finito y caiga dentro de rangos
 * razonables para la tasa USD/CUP en el mercado informal cubano.
 * Retorna el valor redondeado a entero (céntimos de CUP por 1 USD).
 */
function validateRate(value: unknown): number {
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
      `Valor fuera de rango razonable (${USD_RATE_MIN}–${USD_RATE_MAX}): ${value}`
    );
  }

  // Redondeamos a entero (la app usa céntimos de CUP)
  return Math.round(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Browser Run – Extracción JSON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Llamada a la API /json de Cloudflare Browser Run.
 * Usa el endpoint AI-powered para extraer datos estructurados sin
 * necesidad de selectores CSS frágiles.
 *
 * @returns Objeto con la tasa USD/CUP
 */
async function fetchRateFromBrowserRun(executionId: string): Promise<{ usdRateCup: number }> {
  console.log(`[${executionId}] Consultando Cloudflare Browser Run para ${TARGET_URL}…`);
  const { accountId, apiToken } = getCloudflareConfig();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/json`;

  // Definimos un JSON schema estricto para que la IA extraiga solo lo que necesitamos.
  // Esto hace la extracción más resiliente ante cambios en el DOM de eltoque.com.
  const body = {
    url: TARGET_URL,
    prompt:
      "Extrae únicamente el valor actual de cambio del dólar estadounidense (USD) " +
      "en el mercado informal de Cuba publicado en eltoque.com. " +
      "Busca el texto exacto donde aparece '1 USD' o 'USD' seguido de un valor numérico en CUP. " +
      "Ignora otras monedas como EUR, MLC, CAD, ZELLE, etc. " +
      "Devuelve solo el número entero correspondiente a cuántos CUP cuesta 1 USD.",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "exchange_rate",
        strict: true,
        schema: {
          type: "object",
          properties: {
            usd_rate_cup: {
              type: "number",
              description:
                "Valor numérico de la tasa de cambio USD a CUP en el mercado informal cubano (cuántos CUP cuesta 1 USD). Solo el número, sin símbolos.",
            },
          },
          required: ["usd_rate_cup"],
        },
      },
    },
    gotoOptions: {
      // Espera a que la red esté completamente inactiva (JavaScript heavy)
      waitUntil: "networkidle0",
    },
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
      `Cloudflare Browser Run respondió HTTP ${res.status} (${res.statusText}). Body: ${text.slice(0, 500)}`
    );
  }

  const data = (await res.json()) as {
    success: boolean;
    result?: { usd_rate_cup?: number };
    errors?: { code: number; message: string }[];
  };

  if (!data.success) {
    const errMsgs =
      data.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") || "Error desconocido";
    throw new ScrapingError(`Cloudflare API error: ${errMsgs}`);
  }

  if (data.result?.usd_rate_cup == null) {
    throw new ScrapingError(
      "La respuesta de Browser Run no contiene 'usd_rate_cup'. Respuesta: " +
      JSON.stringify(data.result).slice(0, 200)
    );
  }

  return { usdRateCup: validateRate(data.result.usd_rate_cup) };
}

// ──────────────────────────────────────────────────────────────────────────────
// Actualización en BD con fallback al último valor válido
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recupera el último valor válido de usdRateCup para una tienda.
 * Devuelve null si no hay ningún registro (teóricamente imposible
 * porque Store.usdRateCup tiene default, pero lo mantenemos defensivo).
 */
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

/**
 * Persiste la nueva tasa en Store.usdRateCup y genera un registro de auditoría.
 * Se ejecuta dentro de una transacción para garantizar consistencia.
 */
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
        before: previousRate !== null ? ({ usdRateCup: previousRate } as Prisma.InputJsonValue) : Prisma.DbNull,
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

// ─────────────────────────────────────────────────────────────────────────────
// API Pública del servicio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta el scraping de la tasa USD/CUP desde eltoque.com con reintentos
 * y persistencia en la base de datos.
 *
 * @param storeId Identificador de la tienda cuyo Store.usdRateCup se actualizará.
 * @returns Resultado detallado de la operación.
 */
export async function scrapeAndUpdateUsdRate(storeId: string): Promise<ScrapingResult> {
  const executionId = generateExecutionId();
  const startedAt = new Date().toISOString();

  console.log(`[${executionId}] Iniciando scraping de tasa USD/CUP desde ${TARGET_URL} …`);

  let previousRate: number | null = null;
  let extractedRate: number | null = null;
  let lastError: string | null = null;

  // 1) Recuperar el último valor válido (para fallback y comparación)
  previousRate = await getLastValidRate(storeId);

  // 2) Intentar extracción con reintentos exponenciales
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await fetchRateFromBrowserRun(executionId);
      extractedRate = result.usdRateCup;
      console.log(`[${executionId}] Intento #${attempt}: tasa extraída = ${extractedRate} CUP/USD`);
      break; // Éxito, salimos del bucle de reintentos
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      console.error(`[${executionId}] Intento #${attempt} fallido: ${msg}`);

      if (attempt === MAX_RETRIES) {
        break;
      }

      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      console.log(`[${executionId}] Esperando ${delay}ms antes del siguiente intento…`);
      await sleep(delay);
    }
  }

  // 3) Si la extracción falló tras todos los reintentos, preservar el último valor válido
  if (extractedRate === null) {
    const errorMsg =
      lastError ?? "Error desconocido durante el scraping de la tasa de cambio";
    console.error(`[${executionId}] Todos los intentos fallaron. Último valor válido: ${previousRate ?? "N/A"}`);

    return {
      success: false,
      rateCup: null,
      previousRate,
      error: errorMsg,
      executionId,
      details: `Fallo tras ${MAX_RETRIES} intentos. Se conserva el último valor válido (${previousRate ?? "N/A"}). Iniciado: ${startedAt}`,
    };
  }

  // 4) Si la tasa no ha cambiado, no desperdiciamos una transacción
  if (previousRate === extractedRate) {
    console.log(`[${executionId}] La tasa no ha cambiado (${previousRate} CUP/USD). No se actualiza la BD.`);
    return {
      success: true,
      rateCup: extractedRate,
      previousRate,
      updated: false,
      executionId,
      details: `Tasa sin cambios. Iniciado: ${startedAt}`,
    };
  }

  // 5) Persistir la nueva tasa en la base de datos
  try {
    await persistRate(storeId, extractedRate, previousRate, executionId);
    console.log(`[${executionId}] Tasa actualizada: ${previousRate} → ${extractedRate} CUP/USD`);

    return {
      success: true,
      rateCup: extractedRate,
      previousRate,
      updated: true,
      executionId,
      details: `Actualizado de ${previousRate} a ${extractedRate}. Iniciado: ${startedAt}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${executionId}] Error persistiendo la tasa en BD: ${msg}`);

    return {
      success: false,
      rateCup: extractedRate,
      previousRate,
      error: `Extracción exitosa pero fallo al persistir: ${msg}`,
      executionId,
      details: `Valor extraído: ${extractedRate}. Iniciado: ${startedAt}`,
    };
  }
}
