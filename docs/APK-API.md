# Tienda Luna — APIs para la aplicación tablet (APK)

Documento **centrado en el cliente POS / tablet**. Describe qué expone el backend hoy, **por qué** está organizado así, y **qué no existe** (o no está pensado para sesión `device`) para planificar la APK sin sorpresas.

Para arquitectura general (stack, env, BD), conviene leer también [`BACKEND-Y-APIS.md`](./BACKEND-Y-APIS.md). Este archivo prioriza **contratos HTTP**, **flujos de sincronización** y **vacíos de producto**.

---

## 1. Objetivo y alcance

### 1.1 Objetivo

La APK debe poder:

1. **Autenticarse** como un dispositivo de una tienda concreta (`storeId`).
2. **Obtener el catálogo** de productos (precios, stock, metadatos).
3. **Enviar operaciones offline** (ventas, ajustes de stock opcionales, alta/edición/baja de productos) en **lotes idempotentes** que el servidor valida y materializa en BD.

Todo el flujo POS “oficial” del código actual gira en torno a **unas pocas rutas** bajo `/api/*` con sesión de dispositivo (o cajero/admin si se reutiliza el mismo backend).

### 1.2 Alcance real del backend para `typ: "device"`

En el código, solo estas rutas comprueban sesión y permiten explícitamente **dispositivo** donde aplica:

| Ruta | Rol |
|------|-----|
| `GET /api/session/me` | Cualquier sesión válida (incluye `device`) |
| `GET /api/products` | `device` **o** usuario `ADMIN` / `CASHIER` |
| `POST /api/sync/batch` | `canSync`: `device` **o** `ADMIN` / `CASHIER` |
| `GET /api/exchange-rate` | `canSync`: `device` **o** `ADMIN` / `CASHIER` |

**Cualquier otra ruta** (`/api/admin/*`, `GET /api/events`, `POST /api/sales/validate`, `GET /api/stats/overview`, mutaciones REST de productos con CSRF admin, etc.) está pensada para **panel web** o **usuarios admin**, no para el flujo mínimo de la APK. Usarlas desde la tablet implicaría otra política de seguridad (cookies, CSRF, 2FA) y **no** está soportado como contrato de “app de caja”.

**Alternativa (no típica en APK de terminal fijo)**: un usuario **`CASHIER`** autenticado vía `POST /api/auth/login` (JWT `typ: "user"` + cookie `tl_session` y/o Bearer) también tiene `canSync` y podría llamar a `POST /api/sync/batch` y `GET /api/products`. Eso mezcla **caducidad corta** (sesión usuario ~8 h), **2FA** si está habilitado para ese usuario, y **CSRF** en rutas admin si se intentara usar el panel desde el mismo cliente; por eso el diseño recomendado para la tablet sigue siendo **token de dispositivo**.

---

## 2. Por qué el modelo es “eventos + batch”

### 2.1 Argumento de diseño

- La caja puede **perder red**; los eventos se acumulan localmente.
- El servidor **no confía** ciegamente en importes: en ventas completadas recalcula **PVP desde el catálogo** según método de pago (ver `unitPriceCupCentsForSale` en `lib/pricing.ts` y `lib/event-processor.ts`).
- Cada evento lleva `id` (UUID) y `timestamp`; el servidor **deduplica** por `(storeId, clientEventId)` y aplica reglas anti-fraude (duplicados, picos, marcas de tiempo absurdas).
- Así se unifica **venta**, **stock** y **cambios de catálogo** en un solo pipeline transaccional (`processBatch` → `lib/event-processor.ts`).

### 2.2 Consecuencia para la APK

La APK debe implementar un **cola de eventos** persistente local, enviar lotes a `POST /api/sync/batch` y reconciliar el resultado (`processed[]`) con su cola (no reenviar eventos ya aceptados con el mismo `id`).

---

## 3. Autenticación

### 3.1 Cabecera obligatoria en la APK

```http
Authorization: Bearer <token>
```

### 3.2 Qué es `<token>` (orden real de resolución)

Implementación: `getSessionFromRequest` / `verifyBearer` en `lib/auth.ts`.

1. **JWT HS256** (`JWT_SECRET` en servidor, ≥ 16 caracteres en producción).  
   Claims relevantes (`lib/jwt.ts`):

   - `typ`: `"device"` o `"user"`.
   - `storeId`: UUID de la tienda.
   - `sub`: para dispositivo, el **`deviceId`** (mismo id que fila `Device.id` en BD, si aplica).

   JWT de dispositivo: `signDeviceSession` — vigencia **365 días** (larga vida pensada para terminal fijo).

2. **Token “plano” legacy** (compatibilidad): si el Bearer **no** verifica como JWT, el servidor recorre `Device` y hace `bcrypt.compare(token, tokenHash)`.  
   **Advertencia**: con muchos dispositivos es **O(n)** por petición; en producción se recomienda **solo JWT de dispositivo**.

### 3.3 Cookie `tl_session`

El login web (`POST /api/auth/login`) puede fijar cookie `httpOnly`. La APK normalmente **no** la usa si ya envía `Authorization: Bearer`.

### 3.4 Reglas que la APK no puede incumplir

- **`POST /api/sync/batch`**: el JSON incluye `storeId` y `deviceId`. Deben coincidir con la sesión:
  - `storeId` === `session.storeId` (`STORE_MISMATCH` si no).
  - Si `session.typ === "device"`, entonces `deviceId` === `session.sub` (`DEVICE_MISMATCH` si no).

---

## 4. APIs operativas para la APK

### 4.1 `GET /api/session/me`

**Archivo**: `app/api/session/me/route.ts`

| Aspecto | Detalle |
|---------|---------|
| **Método** | `GET` |
| **Auth** | Bearer o cookie |
| **200 (device)** | `{ typ: "device", storeId, deviceId, isLocalStorePlaceholder }` |
| **401** | Sin sesión |

**Uso recomendado**: tras configurar el token, llamar una vez para **persistir `storeId` y `deviceId`** en la APK sin hardcodear.

---

### 4.2 `GET /api/products`

**Archivo**: `app/api/products/route.ts` · Catálogo vía `lib/catalog-products.ts`

| Aspecto | Detalle |
|---------|---------|
| **Método** | `GET` |
| **Auth** | Sesión `device` o usuario `ADMIN`/`CASHIER` |
| **200** | `{ products: Product[] }` (orden por nombre) |

**Comportamiento para dispositivo**:

- Se cargan productos de la tienda con `includeInactive: true` (el servidor incluye también filas **inactivas** para que el panel/dispositivo las vea).
- **No** se incluyen borrados lógicos salvo flujo admin con query especial (`includeDeleted`) — la APK **no** califica para ese query.

**Regla de negocio en cliente (recomendada)**:

- Para **venta en mostrador**, filtrar en la APK: `active === true` y, si el modelo expone `deletedAt`, `deletedAt == null`.

**Importante**: el alta/edición/baja “desde POS” **no** es `POST/PATCH` de esta ruta para la sesión device (el `POST` aquí exige `requireAdmin`). El camino POS es **`POST /api/sync/batch`** con eventos `PRODUCT_*` (§5.4).

---

### 4.3 `POST /api/sync/batch`

**Archivo**: `app/api/sync/batch/route.ts` · Procesamiento `services/sync-service.ts` → `lib/event-processor.ts`

| Aspecto | Detalle |
|---------|---------|
| **Método** | `POST` |
| **Content-Type** | `application/json` |
| **Auth** | Sesión con `canSync` (`device` o `ADMIN`/`CASHIER`) |

#### Cuerpo (esquema Zod)

```json
{
  "deviceId": "string (min 1)",
  "storeId": "string (min 1)",
  "lastSyncTimestamp": 1730000000000,
  "events": [
    {
      "id": "uuid-v4",
      "type": "SALE_COMPLETED",
      "timestamp": 1730000000123,
      "payload": {}
    }
  ]
}
```

- **`events[].id`**: debe ser **UUID** válido (identificador único del evento en el cliente = `clientEventId` en servidor).
- **`timestamp`**: entero (normalmente **ms desde epoch**). El servidor lo usa para ordenar el lote y para heurísticas de fraude.
- **`lastSyncTimestamp`**: opcional; hoy el servidor lo **devuelve tal cual** en la respuesta (marca de agua útil para la APK si la rellena con su propio reloj de última sync bien definido).

#### Respuesta 200 OK

```json
{
  "ok": true,
  "lastSyncTimestamp": null,
  "processed": [
    {
      "clientEventId": "mismo que events[].id",
      "type": "SALE_COMPLETED",
      "status": "ACCEPTED",
      "serverEventId": "cuid/uuid del Event",
      "isFraud": false,
      "fraudReason": "opcional",
      "correctionNote": "opcional",
      "skipped": true
    }
  ]
}
```

- **`skipped: true`**: el evento ya existía (idempotencia); la APK debe marcarlo como sincronizado y **no** duplicar lógica local.
- **`status`**: valores Prisma `EventStatus` (`ACCEPTED`, `REJECTED`, `CORRECTED`, …).
- **`correctionNote`**: motivo legible de rechazo o corrección (útil para UI de diagnóstico).

#### Errores HTTP

| Código | `error` | Causa |
|--------|---------|--------|
| 401 | `UNAUTHORIZED` | Sin sesión o sesión sin permiso de sync |
| 400 | `INVALID_BODY` | JSON inválido o validación Zod |
| 403 | `STORE_MISMATCH` | `storeId` del body ≠ tienda de la sesión |
| 403 | `DEVICE_MISMATCH` | Sesión `device` y `deviceId` del body ≠ `sub` |
| 404 | `STORE_NOT_FOUND` | Tienda inexistente |
| 500 | `SYNC_ERROR` | Error interno al procesar |

---

### 4.4 `GET /api/exchange-rate`

**Archivo**: `app/api/exchange-rate/route.ts`

| Aspecto | Detalle |
|---------|---------|
| **Método** | `GET` |
| **Auth** | Sesión con `canSync` (`device` o `ADMIN`/`CASHIER`) |
| **200** | `{ usdRateCup: number, meta: { dbAvailable: boolean } }` |
| **401** | `UNAUTHORIZED` |

**Uso recomendado en la APK**:

- Al iniciar turno y antes de vender en USD, refrescar `usdRateCup`.
- Si quieres que el server use exactamente la misma tasa que el tablet usó para convertir el pago USD, envía `payments[].usdRateCup`. Si no, el server usará la tasa de la tienda.

---

## 5. Catálogo de eventos (dominio offline)

Tipos canónicos: `types/events.ts` (`DOMAIN_EVENT_TYPES`).  
Comportamiento detallado: `lib/event-processor.ts`.

### 5.1 Venta recomendada (flujo feliz)

Orden lógico en un mismo batch (o varios batches ordenados en el tiempo):

| # | `type` | `payload` mínimo | Efecto resumido |
|---|--------|-------------------|-----------------|
| 1 | `SALE_CREATED` | `{ "saleId": "<id-local-venta>" }` | Crea borrador de venta en memoria servidor asociado a `saleId`. |
| 2 | `PRODUCT_ADDED_TO_CART` (N veces) | `{ "saleId", "productId", "quantity" }` opc. `sku` | Añade líneas al borrador. **Resolución de producto**: si `productId` no existe en catálogo, el servidor intenta `sku` o tratar `productId` como SKU (`lib/event-processor.ts`). |
| 3 | `SALE_COMPLETED` | `{ "saleId", "paymentMethod?": "..." }` | Cierra venta: calcula PVP desde catálogo, descuenta stock, crea `Sale`/`SaleLine` con snapshot de coste, movimientos de inventario. |

**Notas**:

- El **total** y líneas monetarias los fija el **servidor** a partir del catálogo al procesar `SALE_COMPLETED` (no fiarse solo del UI local para auditoría).
- Si hay **falta de stock parcial**, el evento puede quedar en estado corregido y generarse lógica adicional (`SALE_PARTIALLY_FULFILLED`, etc.) — revisar `status` y `correctionNote` en `processed[]`.

### 5.1.1 Venta v2 (recomendada): pagos mixtos, USD y fiado

Nuevo tipo: **`SALE_COMPLETED_V2`**. Es el cierre recomendado para registrar **pagos reales** (mixto, USD, abonos), manteniendo el mismo flujo de carrito.

**Payload**:

```json
{
  "saleId": "<id-local-venta>",
  "payments": [
    {
      "method": "cash",
      "currency": "CUP",
      "amountCupCents": 50000,
      "paidAt": 1730000000123
    }
  ],
  "priceList": "CUP"
}
```

**Ejemplo Pago Mixto (850 CUP = 500 efectivo + 350 transferencia)**:

```json
{
  "id": "<uuid>",
  "type": "SALE_COMPLETED_V2",
  "timestamp": 1730000000999,
  "payload": {
    "saleId": "S-123",
    "payments": [
      { "method": "cash", "currency": "CUP", "amountCupCents": 50000 },
      { "method": "transfer", "currency": "CUP", "amountCupCents": 35000 }
    ],
    "priceList": "CUP"
  }
}
```

**Ejemplo Venta en USD (pago USD en efectivo)**:

```json
{
  "type": "SALE_COMPLETED_V2",
  "timestamp": 1730000000999,
  "payload": {
    "saleId": "S-124",
    "payments": [
      { "method": "usd_cash", "currency": "USD", "amountUsdCents": 500, "usdRateCup": 520 }
    ],
    "priceList": "USD"
  }
}
```

**Ejemplo Fiado (pago parcial al cerrar)**:

```json
{
  "type": "SALE_COMPLETED_V2",
  "timestamp": 1730000000999,
  "payload": {
    "saleId": "S-125",
    "payments": [
      { "method": "cash", "currency": "CUP", "amountCupCents": 20000 }
    ]
  }
}
```

Si la suma de pagos es menor que el total, la venta queda con `paymentStatus=PARTIAL` y `balanceCents>0`. Si no hay pagos, queda `CREDIT_OPEN`.

### 5.1.2 Abonos / pagos posteriores (fiado)

Nuevo tipo: **`SALE_PAYMENT_APPLIED`**.

```json
{
  "saleId": "S-125",
  "payments": [
    { "method": "transfer", "currency": "CUP", "amountCupCents": 35000, "paidAt": 1730100000000 }
  ]
}
```

Regla importante: el “esperado” del cuadre del día se calcula por la fecha `paidAt` del pago (no por el día de la venta original).

### 5.1.3 Devoluciones parciales

Nuevo tipo: **`SALE_RETURNED`**.

```json
{
  "saleId": "S-123",
  "lines": [
    { "productId": "<productId>", "quantity": 1 }
  ],
  "reason": "Cliente devolvió",
  "returnedAt": 1730200000000
}
```

Efectos: incrementa stock (movimiento `SALE_RETURNED`), reduce líneas de la venta y ajusta `Sale.totalCents`.

Si intentas devolver más de lo vendido: `REJECTED` con `RETURN_EXCEEDS_SOLD`.

### 5.1.4 Edición de una venta ya realizada

Nuevo tipo: **`SALE_EDITED`** (replace de líneas).

```json
{
  "saleId": "S-123",
  "lines": [
    { "productId": "<productIdA>", "quantity": 1 },
    { "productId": "<productIdB>", "quantity": 2 }
  ],
  "note": "Ajuste por error de cantidad"
}
```

Efectos: ajusta stock por delta (movimiento `SALE_EDITED`), recalcula `Sale.totalCents`/`balanceCents` y registra auditoría.

Si el edit requiere más stock del disponible: `REJECTED` con `NEGATIVE_STOCK`.

### 5.1.5 Descuento por producto / precio negociado

En `PRODUCT_ADDED_TO_CART` se puede enviar `unitPriceCupCentsOverride` para fijar el precio final unitario en CUP céntimos.

```json
{
  "type": "PRODUCT_ADDED_TO_CART",
  "timestamp": 1730000000500,
  "payload": {
    "saleId": "S-123",
    "productId": "<productId>",
    "quantity": 2,
    "unitPriceCupCentsOverride": 4500
  }
}
```

### 5.2 `SALE_CANCELLED`

`payload`: `{ "saleId" }` — descarta el borrador si existía.

### 5.3 `STOCK_DECREASED`

`payload`: `{ "productId", "quantity", "reason?", "saleId?" }`

| `saleId` en payload | Comportamiento |
|---------------------|----------------|
| **Presente** | **Solo auditoría**: **no** descuenta stock en este evento (el stock de la venta lo baja `SALE_COMPLETED`). |
| **Ausente** | Descuento real de stock con validación de no negativo + movimiento de inventario. |

**Implicación para la APK**: no mezclar “bajar stock manualmente” con `saleId` ligado a venta si la intención es que el stock lo cierre `SALE_COMPLETED`.

### 5.4 Catálogo desde tablet (`PRODUCT_*`)

Mismo endpoint `POST /api/sync/batch`:

| `type` | Payload (resumen) | Notas |
|--------|-------------------|--------|
| `PRODUCT_CREATED` | `sku`, `name`, `priceCents`, opcionales `priceUsdCents`, `unitsPerBox`, `wholesaleCupCents`, `supplierName` / `supplierId`, `stockQty`, `lowStockAt`, `costCents` | Si `sku` vacío, el servidor puede asignar SKU automático. SKU duplicado → rechazo con nota tipo `DUPLICATE_SKU`. |
| `PRODUCT_UPDATED` | `productId` + campos opcionales a cambiar | Validaciones por campo (`INVALID_*`, `UNKNOWN_PRODUCT`). |
| `PRODUCT_DELETED` | `productId` | Baja **lógica** (p. ej. desactivar), no rompe referencias históricas de ventas. |

---

## 6. Buenas prácticas de implementación en la APK

1. **Idempotencia**: nunca reutilizar el mismo `events[].id` (UUID) para otro significado; si el servidor devuelve `skipped: true`, dar el evento por sincronizado.
2. **Orden**: dentro de un batch, el servidor **ordena** por `timestamp` ascendente; la APK debe enviar timestamps **coherentes** con el orden real de la operación.
3. **Reloj**: desfases grandes pueden marcar eventos como fraude; conviene NTP o avisar al usuario si el reloj del tablet es incorrecto.
4. **Tamaño de lote**: acotar número de eventos por request para no timeouts (p. ej. 50–200 según red); reintentar con backoff si `5xx` o red caída.
5. **Catálogo**: refrescar `GET /api/products` al abrir turno y tras sync masivo si el servidor pudo aplicar `PRODUCT_*` desde otro dispositivo.
6. **`deviceId`/`storeId`**: obtenerlos de `GET /api/session/me` y validarlos antes de enviar batches.

---

## 7. Lo que falta o no está expuesto para `device` (brechas y recomendaciones)

Esta sección lista **necesidades típicas de una APK** que **hoy no tienen** un endpoint dedicado para sesión `device`, o que están solo en admin.

| Necesidad | Estado actual | Recomendación |
|-----------|----------------|----------------|
| **Tipo de cambio CUP/USD** en tiempo real para ticket | `GET /api/admin/exchange-rate` es ruta **admin** | Exponer `GET /api/exchange-rate` (o similar) con auth `device`/`CASHIER` y rate limit, o embebido en respuesta de `session/me` / catálogo. |
| **Validar líneas de venta** antes de offline | `POST /api/sales/validate` exige **admin** | Duplicar validación ligera en cliente + confiar en `SALE_COMPLETED` servidor, **o** abrir versión `device`/`CASHIER` de validate con mismas reglas que `validateSaleLines`. |
| **Listar eventos / cola servidor** para depuración | `GET /api/events` solo **admin** | Opcional: endpoint de solo lectura para `device` con paginación y scope por `deviceId`. |
| **Registro / rotación de dispositivo** desde la APK | No hay `POST /api/devices/register` en este repo; `Device` + token se asume **provisionado** (panel, script o BD) | Añadir flujo seguro (código de emparejamiento, JWT de un solo uso, etc.) documentado. |
| **Logout / revocación** de token de dispositivo | No hay endpoint explícito de revocación JWT | Rotar `JWT_SECRET` invalida todo (pesado); o tabla de `deviceTokenVersion` / denylist. |
| **Health / versión mínima de API** | No hay `GET /api/health` público | Útil para la APK (compatibilidad de esquema de eventos). |
| **Subida de imágenes de producto** | No cubierto en eventos estándar | Storage + URL en `PRODUCT_UPDATED` si se añade campo. |

---

## 8. Referencia rápida de archivos

| Tema | Archivo |
|------|---------|
| Resolución Bearer / cookie | `lib/auth.ts` |
| JWT sign/verify | `lib/jwt.ts` |
| Esquema cuerpo batch | `app/api/sync/batch/route.ts` |
| Tipos y payloads TypeScript | `types/events.ts` |
| Lógica de negocio / ventas / stock / productos | `lib/event-processor.ts` |
| Catálogo | `lib/catalog-products.ts`, `app/api/products/route.ts` |
| Sesión actual | `app/api/session/me/route.ts` |
| Middleware solo `/admin` | `middleware.ts` |

---

## 9. Changelog de este documento

- **2026-04-27**: Creación del documento APK-centric con contratos de `session/me`, `products` y `sync/batch`, catálogo de eventos, prácticas y brechas.
