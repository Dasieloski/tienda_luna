# Tienda Luna — Documentación del backend, base de datos y APIs

Documento de referencia para quien desarrolla la app móvil (APK), integraciones o el panel. Describe el comportamiento **real** del código en este repositorio (Next.js App Router, rutas `app/api/*`, Prisma, PostgreSQL).

---

## 1. Resumen ejecutivo

| Concepto | Detalle |
|----------|---------|
| **Stack** | Next.js 16 (API Routes), Prisma ORM, PostgreSQL |
| **Multi‑tienda** | Casi todo el dominio está acotado por `storeId` (tienda). |
| **Patrón POS** | La caja envía **eventos** en lotes a `POST /api/sync/batch`; el servidor valida, audita en `Event`, actualiza stock y proyecta ventas en `Sale` / `SaleLine`. |
| **Autenticación** | Cabecera `Authorization: Bearer <token>` y/o cookie `tl_session` (solo flujo web admin). JWT HS256 (`jose`), claims en §3. |
| **Importante para APK** | `GET /api/products` admite **JWT de dispositivo** (`typ: device`, misma tienda) o usuario ADMIN/CAJERO. Alta/edición/baja de productos desde la tablet va en **`POST /api/sync/batch`** con eventos `PRODUCT_*` (sin panel admin). |

---

## 2. Variables de entorno relevantes

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` | Conexión Prisma a PostgreSQL (p. ej. pooler Supabase `:6543` con `?pgbouncer=true`). |
| `DIRECT_URL` | Conexión directa para migraciones / `db push` (p. ej. `:5432`). |
| `JWT_SECRET` | Secreto HS256; **≥ 16 caracteres** en producción. En desarrollo hay fallback interno (no usar en prod). |
| `STATIC_ADMIN_EMAIL` / `STATIC_ADMIN_PASSWORD` | Opcional; sustituyen credenciales del login admin estático. |
| `STATIC_ADMIN_STORE_ID` | Si está definido, el JWT del admin usa este `storeId` (debe ser un `Store.id` real en BD). |
| `STATIC_ADMIN_SKIP_DB` | Si es `1`, el login admin usa `storeId` placeholder sin consultar BD. |

---

## 3. Autenticación y sesión

### 3.1 Resolución de sesión (`getSessionFromRequest`)

Orden:

1. **`Authorization: Bearer <token>`**  
   - Primero se intenta **verificar como JWT** (`verifySessionToken`).  
   - Si falla, se recorren **todos** los `Device` de la BD y se compara el token en plano con `tokenHash` (**bcrypt**). Esto es costoso en grandes tablas; en producción conviene usar solo JWT de dispositivo.

2. **Cookie `tl_session`** (mismo valor JWT que devuelve el login admin).

### 3.2 Claims del JWT (`SessionClaims`)

```ts
type SessionClaims = {
  sub: string;       // userId o deviceId
  storeId: string;   // tienda
  role?: "ADMIN" | "CASHIER";  // solo si typ === "user"
  typ: "user" | "device";
};
```

- **Usuario admin (panel):** `typ: "user"`, `role: "ADMIN"`, `sub` fijo `static-admin` en login estático.  
- **Dispositivo:** `typ: "device"`, `sub` = id del registro `Device`, sin `role`.

### 3.3 Duración

- Usuario (signUserSession): **8 h**.  
- Dispositivo (signDeviceSession): **365 d**.

### 3.4 Middleware Next.js (`middleware.ts`)

- Rutas bajo `/admin/*` **excepto** `/admin/login`: exigen cookie `tl_session` con JWT válido y `typ === "user"` y `role === "ADMIN"`.  
- Las rutas `/api/*` **no** pasan por este middleware; la autorización es **por ruta** dentro de cada `route.ts`.

### 3.5 Login web actual (`POST /api/auth/login`)

Implementación **solo admin estático** (`matchesStaticAdmin`); **no** valida `User` de Prisma aunque el seed cree filas en `User`. Para APK no aplica salvo que embebas un flujo web.

---

## 4. Modelo de datos (Prisma / PostgreSQL)

Convenciones: claves `cuid()`, timestamps en modelos que los tienen, importes monetarios como **enteros en céntimos**: CUP en `priceCents` / `wholesaleCupCents`, USD de catálogo en `priceUsdCents` (centavos de dólar, p. ej. `199` = US$1,99).

### 4.1 Enums

```prisma
enum UserRole { ADMIN, CASHIER }

enum EventStatus { ACCEPTED, REJECTED, CORRECTED }
```

### 4.2 `Store`

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | String @id | |
| `name` | String | |
| `slug` | String @unique | |
| `dashboardLayout` | Json? | Preferencias panel; se actualiza vía API PATCH |
| `createdAt`, `updatedAt` | DateTime | |

Relaciones: `users`, `devices`, `products`, `customers`, `events`, `sales`.

### 4.3 `User`

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | String @id | |
| `email` | String @unique | |
| `passwordHash` | String | bcrypt (seed); **no usado** por `/api/auth/login` actual |
| `role` | UserRole | |
| `storeId` | String → Store | |

### 4.4 `Device` (terminal POS)

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | String @id | Es el **`deviceId`** que envía la APK en el batch |
| `storeId` | String | |
| `label` | String | |
| `tokenHash` | String @unique | bcrypt del token en plano (fallback auth) |
| `lastSeenAt` | DateTime? | |
| `createdAt` | DateTime | |

### 4.5 `Product`

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | String @id | Referenciado en líneas de venta y eventos |
| `storeId` | String | |
| `sku` | String | Único por tienda: `@@unique([storeId, sku])` |
| `name` | String | |
| `priceCents` | Int | PVP al público en **CUP** (céntimos); base para ventas en CUP y totales en céntimos CUP |
| `priceUsdCents` | Int | PVP al público en **USD** (centavos de dólar); usado al cerrar venta si el payload indica pago en USD |
| `unitsPerBox` | Int | Unidades por caja (referencia de empaque / compra) |
| `wholesaleCupCents` | Int? | Precio mayorista sugerido en CUP (céntimos); referencia en panel |
| `costCents` | Int? | Coste interno opcional (céntimos CUP) |
| `supplierName` | String? | Nombre proveedor |
| `stockQty` | Int | Stock actual |
| `lowStockAt` | Int | Umbral alerta |
| `active` | Boolean | Solo `active: true` en catálogo GET |
| `createdAt`, `updatedAt` | DateTime | |

### 4.6 `Customer`

| Campo | Tipo |
|-------|------|
| `id`, `storeId`, `name?`, `phone?`, `email?`, `externalId?`, `createdAt` | |

Índices: `[storeId]`, `[storeId, phone]`.

### 4.7 `Event` (libro mayor / idempotencia)

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | String @id | id servidor |
| `clientEventId` | String | UUID enviado por el cliente; **único por tienda** |
| `type` | String | Ver tipos de dominio §6 |
| `payload` | Json | Cuerpo libre validado en procesador |
| `payloadHash` | String | Integridad / fraude |
| `storeId`, `deviceId` | String | |
| `clientTimestamp` | BigInt | ms del cliente |
| `serverTimestamp` | DateTime | default now() |
| `status` | EventStatus | |
| `isFraud` | Boolean | |
| `fraudReason`, `correctionNote` | String? | |
| `relatedClientSaleId` | String? | p. ej. `saleId` del cliente |

Índices compuestos relevantes: `[storeId, serverTimestamp]`, `[storeId, deviceId]`, `[storeId, type]`, unicidad `[storeId, clientEventId]`.

### 4.8 `Sale` (proyección de venta aceptada)

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | String @id | |
| `storeId`, `deviceId` | String | |
| `clientSaleId` | String? | id venta en cliente |
| `customerId` | String? | |
| `totalCents` | Int | Calculado en servidor |
| `status` | String | p. ej. `COMPLETED`, `PARTIAL` |
| `completedAt` | DateTime | |
| `lines` | SaleLine[] | |

### 4.9 `SaleLine`

| Campo | Tipo |
|-------|------|
| `id`, `saleId`, `productId`, `quantity`, `unitPriceCents`, `subtotalCents` | |

---

## 5. Contrato de sincronización para la APK

### 5.1 Endpoint

`POST /api/sync/batch`  
**Auth:** `canSync(session)` → `typ === "device"` **o** usuario `ADMIN` / `CASHIER`.

**Reglas extra:**

- `session.storeId` debe coincidir con el `storeId` del cuerpo (`STORE_MISMATCH` → 403).  
- Si la sesión es de **dispositivo**, `session.sub` debe ser igual a `deviceId` del cuerpo (`DEVICE_MISMATCH` → 403).

### 5.2 Cuerpo JSON (validación Zod)

```json
{
  "deviceId": "string (Device.id)",
  "storeId": "string (Store.id)",
  "lastSyncTimestamp": 1234567890,
  "events": [
    {
      "id": "uuid v4",
      "type": "string",
      "timestamp": 1730000000000,
      "payload": { "cualquier": "clave", "anidada": true }
    }
  ]
}
```

- `events[].id` → se guarda como `clientEventId` (debe ser **UUID**).  
- `payload` → objeto con strings como claves (compatible con `z.record`).

### 5.3 Respuesta 200

```json
{
  "ok": true,
  "lastSyncTimestamp": null,
  "processed": [
    {
      "clientEventId": "uuid",
      "type": "SALE_COMPLETED",
      "status": "ACCEPTED | REJECTED | CORRECTED",
      "serverEventId": "cuid",
      "isFraud": false,
      "fraudReason": "opcional",
      "correctionNote": "opcional",
      "skipped": true
    }
  ]
}
```

- `skipped: true` si el evento ya existía (idempotencia por `storeId` + `clientEventId`).

### 5.4 Errores HTTP

| Código | `error` | Causa |
|--------|---------|--------|
| 401 | `UNAUTHORIZED` | Sin sesión o sin permiso sync |
| 400 | `INVALID_BODY` | JSON o esquema inválido (`details` con flatten Zod) |
| 403 | `STORE_MISMATCH` | `storeId` ≠ tienda de la sesión |
| 403 | `DEVICE_MISMATCH` | dispositivo intenta otro `deviceId` |
| 404 | `STORE_NOT_FOUND` | `storeId` no existe |
| 500 | `SYNC_ERROR` | Error interno |

---

## 6. Tipos de evento de dominio (cliente → servidor)

Definidos en `types/events.ts`. El servidor **solo procesa explícitamente** un subconjunto en `lib/event-processor.ts`; el resto cae en `UNKNOWN_EVENT_TYPE` → `REJECTED`.

### 6.1 Constante `DOMAIN_EVENT_TYPES`

`SALE_CREATED`, `PRODUCT_ADDED_TO_CART`, `STOCK_DECREASED`, `SALE_CANCELLED`, `SALE_COMPLETED`, `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_DELETED`, y de servidor/auditoría: `SALE_REJECTED`, `SALE_PARTIALLY_FULFILLED`, `STOCK_ADJUSTED_SERVER`.

### 6.2 Payloads esperados (app offline)

| Tipo | Payload mínimo |
|------|----------------|
| `SALE_CREATED` | `saleId` (string); opcional `customerId` |
| `PRODUCT_ADDED_TO_CART` | `saleId`, `productId`, `quantity` (>0); opcional `unitPriceCents` (el servidor **usa precio de catálogo** al completar) |
| `STOCK_DECREASED` | `productId`, `quantity` (>0); opcional `saleId` — si viene `saleId`, **no** descuenta stock (solo auditoría) |
| `SALE_CANCELLED` | `saleId` |
| `SALE_COMPLETED` | `saleId`; opcional `paymentMethod` (texto libre; el servidor detecta USD vs CUP para fijar precio unitario) |
| `PRODUCT_CREATED` | `sku`, `name`, `priceCents` (int ≥ 0); opcionales: `priceUsdCents`, `unitsPerBox` (≥ 1), `wholesaleCupCents` (int ≥ 0 o `null`), `supplierName`, `stockQty`, `lowStockAt` |
| `PRODUCT_UPDATED` | `productId` + cualquier subconjunto de campos a cambiar (mismos nombres que el modelo; `active` boolean) |
| `PRODUCT_DELETED` | `productId` — baja **lógica** (`active = false`); el producto deja de salir en `GET /api/products` |

Los tres `PRODUCT_*` se procesan en la **misma transacción** que el resto del batch: tras sync, el dashboard admin ve el catálogo actualizado en BD.

### 6.3 Flujo lógico recomendado en la misma caja

1. `SALE_CREATED`  
2. N × `PRODUCT_ADDED_TO_CART` (mismo `saleId`)  
3. `SALE_COMPLETED` (mismo `saleId`)

El procesador mantiene un **borrador en memoria** (`pendingSales`) **solo dentro del mismo batch** y en orden por `timestamp`. Si partes la venta en varios batches, el servidor puede responder `EMPTY_OR_UNKNOWN_SALE` en `SALE_COMPLETED` si el borrador no está presente en ese lote.

**Recomendación APK:** incluir en un **mismo POST** todos los eventos de una venta (o reenviar el historial necesario en un diseño futuro).

### 6.4 Comportamiento de stock y venta

- En `SALE_COMPLETED`, el servidor recalcula cantidades cumplidas con el **stock vivo** en transacción (`fulfillableQuantity`).  
- Precio unitario (en **céntimos CUP** por línea, coherente con `Sale.totalCents`): se toma del catálogo según `paymentMethod` del payload de `SALE_COMPLETED` (`lib/pricing.ts` → `unitPriceCupCentsForSale`): si el método parece **USD** (`usd`, `dolar`, `cash_usd`, etc.), se usa `priceUsdCents` convertido a CUP con la tasa `NEXT_PUBLIC_USD_RATE_CUP`; si no hay USD en catálogo (`priceUsdCents === 0`), se usa `priceCents`. En pagos **no USD**, siempre `priceCents`. El cliente **no** fija el precio unitario servido.  
- Si hay falta de stock: estado del evento puede ser `CORRECTED`, `Sale.status` `PARTIAL`, y se puede generar evento adicional `SALE_PARTIALLY_FULFILLED`.  
- Si no hay nada servible: `SALE_REJECTED` + evento servidor `SALE_REJECTED`.  
- `STOCK_DECREASED` sin `saleId` descuenta stock en BD; con `saleId` no toca stock.

### 6.5 Fraude / duplicados (resumen)

- Duplicado en el mismo batch, duplicado por `(deviceId, clientTimestamp, payloadHash)` en BD, timestamps fuera de rango, picos de ventas (`checkSalesSpike`), stock negativo, etc. Pueden marcar `isFraud` y `REJECTED`. Detalle en `lib/fraud.ts` y `lib/event-processor.ts`.

---

## 7. Catálogo de rutas HTTP

Base URL de ejemplo: `https://<tu-dominio>` (sin path prefix global).

### 7.1 `POST /api/auth/login`

| | |
|--|--|
| **Auth** | Ninguna |
| **Body** | `{ "email": "string", "password": "string" }` |
| **200** | `{ token, role: "ADMIN", storeId, userId, mode: "static_admin" }` + Set-Cookie `tl_session` |
| **401** | `INVALID_CREDENTIALS` |
| **400** | `INVALID_BODY` |

### 7.2 `POST /api/sync/batch`

Ver §5.

### 7.3 `GET /api/products`

| | |
|--|--|
| **Auth** | JWT **dispositivo** (`typ: device`, tienda del token) **o** usuario con `role` **ADMIN** o **CASHIER** |
| **200** | `{ products: Product[] }` — solo `active: true`, orden por `name` |
| **401/403** | `UNAUTHORIZED` / `FORBIDDEN` |

**POST /api/products** — solo **ADMIN** (panel web). Cuerpo JSON:

```json
{
  "sku": "string",
  "name": "string",
  "priceCents": 0,
  "priceUsdCents": 0,
  "unitsPerBox": 1,
  "wholesaleCupCents": null,
  "costCents": 0,
  "supplierName": "string | null",
  "stockQty": 0,
  "lowStockAt": 5
}
```

- `priceCents`: PVP CUP (céntimos). Obligatorio ≥ 0.  
- `priceUsdCents`: PVP USD (centavos de dólar). Default `0` (solo lista en CUP para la columna USD derivada por tasa).  
- `unitsPerBox`: entero ≥ 1 (default `1`).  
- `wholesaleCupCents`: opcional, céntimos CUP o `null`.  
- `costCents`: opcional (compatibilidad); no es obligatorio en el panel de inventario.

Respuestas: **200** `{ product }`, **400** `INVALID_BODY`, **403** `FORBIDDEN`, **409** `DUPLICATE_SKU_OR_DB`.

La **tablet** (token de dispositivo) no usa esta ruta: envía **`PRODUCT_CREATED`** / **`PRODUCT_UPDATED`** / **`PRODUCT_DELETED`** en **`POST /api/sync/batch`** (§6.2); al aceptarse, el inventario del admin lee la misma BD.

### 7.3.1 `PATCH /api/products/[id]`

| | |
|--|--|
| **Auth** | Solo **ADMIN** |
| **Body** | Cualquier subconjunto de campos actualizables (al menos uno): `sku`, `name`, `priceCents`, `priceUsdCents`, `unitsPerBox`, `wholesaleCupCents`, `costCents`, `supplierName`, `stockQty`, `lowStockAt`, `active` |
| **200** | `{ product }` |
| **400** | `INVALID_BODY` (cuerpo vacío o inválido) |
| **403** | `FORBIDDEN` |
| **404** | `NOT_FOUND` (producto no pertenece a la tienda de la sesión) |
| **409** | `DUPLICATE_SKU_OR_DB` (p. ej. SKU duplicado) |

### 7.4 `POST /api/sales/validate`

| | |
|--|--|
| **Auth** | Solo **ADMIN** |
| **Body** | `{ "lines": [ { "productId": "string", "quantity": number > 0 } ] }` |
| **200** | Resultado de `validateSaleLines` (ver abajo) |

**Respuesta (`validation-service`):**

```json
{
  "valid": true,
  "shortages": [],
  "suggestedLines": [
    { "productId": "", "quantity": 0, "unitPriceCents": 0 }
  ],
  "totalCents": 0
}
```

- Si falta stock: `valid: false`, `shortages[]` con `solicitado`, `disponible`, `faltante`.  
- `suggestedLines` solo incluye líneas con cantidad > 0 ajustada al stock.

### 7.5 `GET /api/stats/overview`

| | |
|--|--|
| **Auth** | Solo **ADMIN** |
| **200** | Objeto grande de analíticas (estructura §8) + opcional `meta.dbAvailable`, `meta.hint`, `meta.message` |

### 7.6 `GET /api/events`

| | |
|--|--|
| **Auth** | Solo **ADMIN** |
| **Query** | `limit` (1–200, default 50), `cursor` (id para paginación) |
| **200** | `{ events[], nextCursor, meta }` |

Cada evento incluye: `id`, `clientEventId`, `type`, `payload`, `deviceId`, `clientTimestamp` (**string**), `serverTimestamp`, `status`, `isFraud`, `fraudReason`, `correctionNote`, `relatedClientSaleId`.

Si `storeId === LOCAL_ADMIN_STORE_ID`, `events: []` y meta indicando BD local.

### 7.7 `GET /api/admin/sales/recent`

| | |
|--|--|
| **Auth** | Solo **ADMIN** |
| **Query** | `limit` (1–80, default 35) |
| **200** | `{ sales: [ { id, deviceId, totalCents, status, completedAt ISO, lines: [...] } ], meta }` |

### 7.8 `PATCH /api/admin/dashboard-layout`

| | |
|--|--|
| **Auth** | Solo **ADMIN** |
| **Body** | `{ "layout": { "cualquier": "json" } }` |
| **200** | `{ ok: true }` — persiste en `Store.dashboardLayout` |

---

## 8. Formato de `GET /api/stats/overview`

Siempre incluye `generatedAt` (ISO). Con BD sana, `meta: { dbAvailable: true }`. Si `storeId` es el placeholder local o falla la lectura, arrays vacíos y `meta` explicativo.

### 8.1 `level1`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `ventasHoy` | number | Count ventas desde inicio día (TZ servidor) |
| `ingresosHoyCents` | number | Suma `totalCents` hoy |
| `ventasMes` | number | Count mes calendario |
| `ingresosMesCents` | number | Suma mes |
| `ingresosTotalesCents` | number | Histórico tienda |
| `ticketMedioHoyCents` | number | Media hoy (0 si 0 ventas) |
| `ticketMedioMesCents` | number | Media mes |
| `horaPicoHoy` | `{ hora: number \| null, ventas, ingresosCents }` | Pico por count ventas hoy |
| `productosTop` | array | Top por unidades vendidas (histórico agregado) |
| `stockActual` | array | Productos activos con stock y umbral |
| `eventosFraudulentos` | number | Count `Event.isFraud` |

### 8.2 `level2`

| Campo | Notas |
|-------|--------|
| `rotacionInventario30d` | Heurística |
| `margenAprox30d` | Ingresos − COGS aprox. 30d |
| `clientesFrecuentes` | Agrupado por `customerId` |
| `ventasPorHoraHoy` | **24 entradas** `hora` 0–23 (ceros si no hay datos) |
| `rendimientoDispositivoMes` | Por `deviceId` |

### 8.3 `level3`

`cohortesClientesNuevos`, `ltvTop`, `alertasStock`, `anomalias`, `demandaHeuristica30d`, `dashboardLayout` (Json de tienda).

---

## 9. CORS y app nativa

Las rutas API **no** definen en este repo cabeceras CORS globales. Desde una APK nativa normalmente llamas al mismo host sin CORS; desde **WebView** u otro origen puede hacer falta configurar CORS en `next.config` o un proxy.

---

## 10. Checklist para el equipo APK

1. Obtener **`storeId`** y **`deviceId`** (registro `Device`) y un **JWT de dispositivo** (el seed imprime uno con `JWT_SECRET` cargado).  
2. Enviar lotes a **`POST /api/sync/batch`** con `Authorization: Bearer <jwt_dispositivo>`.  
3. Usar **UUID** en `events[].id` y mantener **orden temporal** coherente.  
4. Agrupar en un mismo batch (o diseño acordado) los eventos de una venta para que `SALE_COMPLETED` encuentre el borrador.  
5. **Catálogo:** `GET /api/products` con **Bearer** del JWT de dispositivo; cambios de producto desde la caja en **`POST /api/sync/batch`** (`PRODUCT_CREATED` / `PRODUCT_UPDATED` / `PRODUCT_DELETED`).  
6. Importes en API: **céntimos CUP** (`priceCents`, totales de venta) y **centavos USD** de catálogo (`priceUsdCents`); en formularios del panel se muestran importes humanos con coma decimal.  
7. Tras cambios de esquema Prisma en el servidor, alinear versión de cliente generado y migraciones.

---

## 11. Referencias de código

| Tema | Ruta |
|------|------|
| Esquema BD | `prisma/schema.prisma` |
| Sesión / Bearer | `lib/auth.ts`, `lib/jwt.ts` |
| Sync batch | `app/api/sync/batch/route.ts`, `services/sync-service.ts` |
| Motor eventos | `lib/event-processor.ts` |
| Precio venta CUP/USD | `lib/pricing.ts` |
| Tipos evento cliente | `types/events.ts` |
| Validación líneas venta | `services/validation-service.ts` |
| Analíticas | `services/analytics-service.ts` |
| Admin estático | `lib/static-admin-auth.ts` |
| Middleware web | `middleware.ts` |

---

*Última actualización alineada con el código del repositorio Tienda Luna (incluye eventos `PRODUCT_CREATED` / `PRODUCT_UPDATED` / `PRODUCT_DELETED` en sync, `GET /api/products` para JWT de dispositivo, y campos de catálogo ya documentados en `Product`).*
