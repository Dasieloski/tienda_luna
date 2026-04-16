## Auditoría integral · Tienda Luna POS

Este documento resume mejoras potenciales en todo el proyecto: diseño, UX, accesibilidad, arquitectura backend, rendimiento y nuevas funcionalidades (incluyendo el control diario de ventas de la hoja en papel).

---

## 1. UX / Diseño visual

- **Consistencia de moneda y textos**
  - Asegurar que todas las pantallas muestran importes en el mismo formato `CUP · USD` usando `lib/money.ts` (incluido todo el admin y, si en el futuro hay ticket al cliente, también ahí).
  - Revisar textos y tildes en la landing y el admin para tener un tono uniforme y sin faltas (ej. “Categorías”, “Cómo funciona”, “Sincronización”, etc.).

- **Jerarquía visual en admin**
  - En algunos dashboards (ej. `/admin`, `/admin/alertas`) hay muchas cards y secciones con el mismo peso visual.
  - Propuesta:
    - Dejar 1–2 KPIs primarios “grandes” arriba y degradar el resto a tamaño mediano.
    - Agrupar cards en bloques lógicos: “Ventas”, “Inventario”, “Riesgos” en el dashboard principal.

- **Economía: resaltar lo realmente importante**
  - En `/admin/economia` hoy se ve toda la info en el mismo nivel.
  - Propuesta:
    - Bloque principal: “Total en caja” (CUP + equivalente en USD) y número de ventas del día.
    - Bloque secundario: desglose por método (efectivo, transferencia, USD).
    - Bloque de detalle: tabla por método exacto (útil para auditoría).

- **Landing**
  - El diseño es sólido, pero:
    - Podría añadir un CTA secundario orientado a “Ver ejemplo de dashboard” que lleve a screenshots estáticos.
    - Añadir microcopys que hablen explícitamente de pagos en CUP y USD, ya que es clave de negocio.

---

## 2. Responsive y navegación

- **Sidebar admin (hecho parcialmente, posibles mejoras)**
  - Ya existe un modo drawer móvil con overlay.
  - Posibles mejoras:
    - Guardar el estado de colapsado también en `prefers-reduced-motion` (desactivar transiciones para personas sensibles).
    - Añadir un cierre claro dentro del drawer (icono “X” junto al logo) además del toque en el overlay.

- **Header / topbar**
  - En móviles muy pequeños aún puede quedar algo denso.
  - Ajustes sugeridos:
    - Ocultar el botón de “Ajustes” dejando solo el icono en XS.
    - Reducir contador de notificaciones a un simple punto rojo cuando haya >9.

- **Tablas grandes (Historial, Inventario, Ventas en vivo)**
  - Se añadió vista tipo “cards” en móvil para `DataTable`, pero:
    - Revisar que los labels de cada campo no sean demasiado largos (abreviar “Vendido por” → “Cajero”, etc.).
    - Para el historial, permitir esconder/mostrar el panel lateral de detalle en móvil (por ejemplo, con una flecha o botón “Ver detalle” que abre un drawer).

- **Landing en tablets**
  - Revisión específica en resoluciones 768px–1024px:
    - Asegurar que el hero no quede con demasiado espacio vacío a la derecha en orientación horizontal.
    - Ajustar grids de categorías y pilares para que no salgan filas con 1 sola card (mejor 2–2–2).

---

## 3. Accesibilidad

- **Roles y labels**
  - Verificar que botones icónicos (campana, usuario, menú) tengan `aria-label` o texto sr-only consistente.
  - En tablas con scroll horizontal (`Economía`, tablas grandes), añadir `aria-describedby` que explique que la tabla es desplazable.

- **Contraste**
  - Paleta warm (crema/amarillo) es agradable, pero algunos textos en `muted` sobre `canvas-subtle` podrían estar en límite de contraste WCAG.
  - Recomendación: subir ligeramente la oscuridad de `--tl-muted` o usar `text-tl-ink-secondary` en componentes críticos (inputs, filtros).

- **Navegación por teclado**
  - El admin ya tiene algunos `focus-visible` personalizados, pero:
    - Confirmar que todas las acciones clave son alcanzables solo con teclado (incluyendo abrir/cerrar sidebar móvil).
    - Añadir atajos accesibles documentados (por ejemplo, `Ctrl+B` ya colapsa sidebar; documentarlo en una sección de ayuda).

---

## 4. Backend / modelo de datos

- **Moneda y métodos de pago**
  - Hoy `Sale` tiene un único `totalCents` y no distingue explícitamente entre CUP y USD.
  - Ya usamos `paymentMethod` en los eventos para inferir CUP/transferencias/USD en el endpoint de economía.
  - Mejoras recomendadas:
    - Añadir a `Sale` campos opcionales como:
      - `totalCupCents`, `totalUsdCents`.
      - `paymentMethod` normalizado (enum controlado en servidor).
    - Mantener compatibilidad con el modelo actual calculando esos campos durante el procesamiento de eventos.

- **Control diario de ventas (basado en la hoja en papel)**
  - La plantilla física tiene:
    - Fecha grande.
    - Listado de productos con columnas:
      - Precio USD / CUP.
      - Montos pagados por método: CUP efectivo, transferencia, USD.
      - Subtotal y “OK”.
  - Propuesta de modelo:
    - Tabla lógica “DailyReport” (puede ser vista materializada o endpoint que agregue datos sobre `Sale` y `SaleLine`).
    - Para cada día y producto:
      - `priceCupCents`, `priceUsdCents` (precio público actual ese día).
      - `qty` vendida.
      - `amountCashCupCents`, `amountTransferCupCents`, `amountUsdCents`.
      - `ok` (booleano o estado de conciliación).

- **Eventos / auditoría**
  - El event sourcing está bien pensado (`Event`, `Sale`, `SaleLine`).
  - Para el control diario:
    - Mantener siempre calculable desde los eventos y solo cachear/agregar en una tabla auxiliar para rendimiento si hiciera falta.

---

## 5. Rendimiento

- **Pool de conexiones Prisma**
  - Ya se cambió el cálculo de `analytics-service` a consultas secuenciales para no saturar `connection_limit=1`.
  - Adicionalmente:
    - Considerar `prisma.$transaction` solo cuando realmente se necesiten garantías fuertes.
    - Introducir niveles simples de caché para `/api/stats/overview` y `/api/admin/economy/summary` (por ejemplo, recomputar cada 30–60 segundos por tienda).

- **Queries agregadas pesadas**
  - Revisar índices en `Sale` y `Event` acorde a las agregaciones (`storeId`, `completedAt`, `deviceId`, `isFraud`).
  - Para el control diario (por fecha):
    - Asegurar índice compuesto `@@index([storeId, completedAt])` (ya existe) y usar rangos de fecha `[startOfDay, endOfDay]`.

- **Assets y frontend**
  - Lazy load de módulos pesados solo en admin:
    - Recharts (`DashboardCharts`) podría cargarse dinámicamente solo donde se usa (`next/dynamic`), para mejorar el TTFB de rutas administrativas.

---

## 6. API / endpoints

- **`/api/admin/economy/summary`**
  - Actualmente agrupa por `paymentMethod` en eventos `SALE_COMPLETED`.
  - Posibles mejoras:
    - Aceptar parámetros de fecha (`from`, `to`) para poder ver economía de otros días o rangos.
    - Devolver también desglose por producto básico (para alinear con el control diario).

- **`/api/stats/overview`**
  - Muy completo; sugerencias:
    - Añadir un flag en la respuesta indicando si los datos están cacheados y la hora de actualización.
    - Permitir pedir solo ciertos “niveles” (ej. `?level=1` para KPIs rápidos) y así aligerar el payload cuando se use en vistas simples.

---

## 7. Funcionalidades faltantes / mejora de flujo

- **Control diario de ventas (vista dinámica)**
  - Nueva pantalla sugerida: `/admin/control-diario` o integrada en `/admin/economia` con pestañas.
  - Características:
    - Selector de fecha (por defecto hoy).
    - Tabla parecida a la hoja:
      - Columnas: `Producto`, `Precio USD`, `Precio CUP`, `Vendidas`, `CUP efectivo`, `CUP transferencia`, `USD`, `Subtotal`, `OK`.
    - Botón “Marcar todo OK” o marcar fila a fila (p.ej. para cuando se reconcilia con el efectivo real en caja).
    - Botón “Exportar a PDF/Excel” que genere un documento prácticamente idéntico a la hoja física.

- **Filtros adicionales en historial**
  - Hoy se puede filtrar por texto y rango de fechas.
  - Sugerencias:
    - Filtro por método de pago (cuando se añada al modelo).
    - Filtro rápido por dispositivo (caja) con un dropdown.

- **Gestión de productos y precios por moneda**
  - Extender la gestión de inventario para permitir:
    - Precio base en CUP y precio de referencia en USD (o viceversa).
    - Mostrar ambos en el formulario de producto, y en los dashboards de ventas por producto.

---

## 8. Seguridad y roles

- **Roles actuales**
  - Ya existen `ADMIN` y `CASHIER`.
  - Para economía y control diario, convendría:
    - Restringir acceso a `/admin/economia` y futuras pantallas de conciliación solo a `ADMIN`.
    - Registrar en `Event` o en una tabla de auditoría quién marca un día como conciliado (`OK`).

- **Sesiones / autenticación**
  - Revisar expiración del JWT (`JWT_SECRET` en `.env`) y asegurar que en producción se usa un secreto fuerte y diferente.
  - Valorar añadir 2FA o, al menos, forzar cambio periódico de contraseña para roles sensibles.

---

## 9. Observabilidad y logging

- **Logs actuales**
  - Varias APIs ya hacen `console.error` cuando algo falla.
  - Sugerencias:
    - Centralizar logging en una utilidad (`lib/log.ts`) que pueda en el futuro mandarse a un servicio externo (Sentry, Logflare, etc.).
    - Capturar explícitamente errores de base de datos o de pool y mostrarlos en el admin de forma amable (ya se hace parcialmente en métricas).

---

## 10. Próximos pasos recomendados (prioridad)

1. **Funcionalidad de control diario dinámica**
   - Endpoint de agregación diaria + nueva pantalla en admin (tipo la hoja de la foto).
2. **Modelo robusto para moneda y métodos de pago**
   - Añadir campos por moneda en `Sale` y normalizar `paymentMethod`.
3. **Caché simple para overview y economía**
   - Reducir carga sobre la base de datos y mejorar tiempos de respuesta.
4. **Pulido de accesibilidad**
   - Revisar contraste, roles y navegación por teclado en unas pocas rutas críticas.
5. **Mejoras menores de responsive**
   - Ajustes finos en topbar, tables y landing en ciertos breakpoints.

Con estos cambios, el sistema cubriría mejor las necesidades del dueño (especialmente el control económico diario) y quedaría más sólido para crecer en funcionalidades y carga de datos.

