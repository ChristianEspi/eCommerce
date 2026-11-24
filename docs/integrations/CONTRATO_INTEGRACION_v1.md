# Contrato de integración eCommerce ↔ ERP · v1

**Estado:** vigente desde 2026-11-24 · **Dueño:** eCommerce by EBIM · **Contrato máquina:** `GET {base}/v1/openapi.json`

Este documento es **el estándar** con el que cualquier ERP (SAP, Odoo, Siesa, Dynamics, Comerza, uno hecho en casa)
se conecta a eCommerce. No hay integraciones «a medida» en el producto: un ERP que cumple este contrato se conecta
**sin tocar código de eCommerce**. Lo específico de cada ERP vive en su lado (o en un middleware), nunca aquí.

> El OpenAPI se **genera** desde la tabla de rutas que despacha las peticiones (`supabase/functions/_shared/api/routes.ts`):
> no puede describir una ruta que no existe. Ante una duda entre este documento y el OpenAPI, manda el OpenAPI.

---

## 1. Principios

1. **Un solo modelo de datos, dos modos de transporte.** Los mismos esquemas viajan en los dos sentidos:
   - **Push** — el ERP llama a la API de eCommerce (`/v1/...`).
   - **Pull** — eCommerce consulta la API del ERP en intervalos (*fuentes de lectura*). Para el ERP que no puede
     llamar hacia fuera, o que prefiere publicar y que lo consulten.
   - **Eventos** — eCommerce avisa al ERP por **webhooks firmados** (pedido creado, pagado, etc.).
2. **Sistema de registro explícito por dato.** Cada dato tiene un dueño y solo el dueño lo escribe (§3).
3. **Identificadores de negocio, no internos.** El ERP habla en **SKU**, **código de cliente**, **número de pedido**,
   **código de almacén** y **código de lista**. Nunca necesita un uuid de eCommerce.
4. **El tenant no viaja en el cuerpo.** La credencial pertenece a una sociedad; todo lo que hace queda dentro de ella.
   Un `organization_id`/`company_id` en el cuerpo es un error (`PETICION_INVALIDA`), no un selector.
5. **Escrituras idempotentes y lotes todo-o-nada**, con simulación (`dry_run`) e informe fila por fila.
6. **Versionado en la ruta** (`/v1`). Lo que se agrega es compatible; lo que rompe va a `/v2` con convivencia.

---

## 2. Conexión

| Concepto | Valor |
|---|---|
| URL base | `https://<proyecto>.supabase.co/functions/v1/api` (QAS: `ehxlxbhtlmfgneiagdcj`) |
| Autenticación | OAuth 2.0 `client_credentials` → `POST /v1/oauth/token` → `Authorization: Bearer <token>` |
| Credencial | Se crea en **Integraciones › API** del backoffice (rol owner/admin, addon `ecommerce.integrations.enterprise`). El secreto se muestra una sola vez. |
| Permisos | Por **scope** (§4). Una credencial solo hace lo que sus scopes conceden. |
| Límite | Cupo por credencial y minuto (`x-ratelimit-limit` / `x-ratelimit-remaining`; al pasarse, `429`). |
| Rastreo | Toda respuesta trae `x-correlation-id` y `x-request-id`. Envía tu propio `x-correlation-id` para seguir un hilo. |
| Tienda | Parámetro `store` (slug). Opcional si la sociedad tiene una sola tienda. |

---

## 3. Matriz de cobertura

**Dueño** = sistema de registro. «ERP» significa que eCommerce no edita ese dato cuando la integración está activa.

| Dato | Dueño típico | ERP → eCommerce (push) | eCommerce lee del ERP (pull) | eCommerce → ERP |
|---|---|---|---|---|
| Productos / variantes / publicación por tienda | ERP | `POST /v1/catalog/products:batch` | — | `GET /v1/products` |
| Stock por almacén | ERP (almacenes con origen ERP) | `POST /v1/stock:batch` | Fuente de lectura *stock* | `GET /v1/stock/{sku}` |
| Precios por lista | ERP | `POST /v1/price-lists/{code}/items:batch` | Fuente de lectura *precios* | — |
| Precio base por tienda | ERP o tienda | `catalog/products:batch` (`publications[].price`) | — | `GET /v1/products` |
| Clientes | ERP | `POST /v1/customers:batch` | — | `GET /v1/customers` |
| Pedidos (alta) | eCommerce (vitrina) o ERP (venta asistida) | `POST /v1/orders` | — | `GET /v1/orders`, webhooks `order.*` |
| Estado / pago / entrega del pedido | ERP tras recibir el pedido | `POST /v1/orders/{number}/status` | — | webhooks `order.*_changed` |
| Referencias del ERP (n.º de pedido, factura, guía) | ERP | `external_refs` en `.../status` | — | `GET /v1/orders/{number}` |
| Kits (composición) | ERP o tienda | Excel del backoffice (API: fase siguiente) | — | — |

**Fuera de alcance v1** (se anuncia antes de construir): emisión de comprobante electrónico desde la API, direcciones y
contactos del cliente por API, lotes asíncronos con `202 + job`, kits por API.

---

## 4. Scopes

| Scope | Permite |
|---|---|
| `order.read` | Listar pedidos y leer uno por número |
| `order.create` | Crear pedidos |
| `order.update` | Cambiar estado, pago y entrega de un pedido; guardar referencias del ERP |
| `product.read` | Leer el catálogo publicado en una tienda |
| `stock.read` | Disponibilidad de un SKU (la misma que ve la vitrina) |
| `stock.write` | Fijar el saldo por almacén (solo almacenes con origen ERP) |
| `customer.read` | Listar clientes |
| `customer.write` | Crear/actualizar clientes por código |
| `catalog.write` | Crear/actualizar productos por lote |
| `price.write` | Cargar precios de una lista |

Recomendación: **una credencial por integración** y solo con los scopes que usa. Si el ERP solo empuja stock, su
credencial es `stock.write` y nada más.

---

## 5. Reglas comunes

### 5.1 Idempotencia
Toda escritura exige la cabecera `Idempotency-Key` (8 a 200 caracteres `A-Z a-z 0-9 _ . : -`). La misma clave con el mismo cuerpo devuelve
**la primera respuesta** (cabecera `idempotent-replay: true`); con otro cuerpo, `409 IDEMPOTENCIA_CONFLICTO`. Usa una
clave estable por operación lógica (por ejemplo `stock-ALM01-20261124T1000`), no una aleatoria por reintento.

### 5.2 Lotes
`customers:batch`, `stock:batch`, `price-lists/{code}/items:batch` y `catalog/products:batch`:

- **Todo o nada.** Si una fila falla, no se escribe ninguna: la respuesta es `422` con el informe.
- `?dry_run=true` valida y devuelve el informe sin escribir (`200`).
- Informe: `{ dry_run, applied, total, created?, updated?, unchanged?, errors, rows: [{ row, key, status, reason?, field?, message? }] }`.
  `reason` es un código estable (`SKU_NO_ENCONTRADO`, `ALMACEN_NO_ERP`, `VALOR_INVALIDO`…): ramifica por él, no por el texto.
- Topes: 1000 clientes, 2000 saldos o precios por lote.

### 5.3 Paginación y lectura incremental
- Listados con `limit` (1–200) y `cursor` = `next_cursor` de la respuesta anterior; termina cuando `next_cursor` es `null`.
- `updated_since` (ISO 8601) devuelve solo lo modificado desde esa marca. **Guarda el `server_time` de la respuesta**
  y úsalo como `updated_since` en la próxima sincronía (no tu reloj: evita huecos por desfase).
- Disponible en `GET /v1/orders`, `GET /v1/products`, `GET /v1/customers`.

### 5.4 Formatos
- Importes en **cadena decimal** (`"111.29"`); en escritura también se acepta número. Moneda ISO 4217 de la tienda/lista.
- Fechas ISO 8601 en UTC.
- Stock: **saldo absoluto** (`on_hand`), nunca un delta. Un reintento no duplica.
- Campos desconocidos se **rechazan** (`CAMPO_NO_PERMITIDO`): un error tipográfico no se pierde en silencio.

### 5.5 Errores
Cuerpo: `{ "error": { "code", "message", "status", "correlation_id", "request_id" } }`.

| HTTP | `code` | Qué hacer |
|---|---|---|
| 400 | `PETICION_INVALIDA` | Corregir la petición. No reintentar igual. |
| 401 | `NO_AUTENTICADO` · `TOKEN_INVALIDO` · `TOKEN_EXPIRADO` · `CREDENCIAL_INVALIDA` | Pedir token nuevo / revisar credencial. |
| 403 | `SCOPE_INSUFICIENTE` | Falta un scope en la credencial. |
| 404 | `RECURSO_NO_ENCONTRADO` | Pedido, lista o tienda inexistente **en tu sociedad**. |
| 409 | `ESTADO_EN_CONFLICTO` | El estado actual no admite el cambio (p. ej. entregar un pedido cancelado). Consultar y decidir. |
| 409 | `IDEMPOTENCIA_CONFLICTO` · `IDEMPOTENCIA_EN_CURSO` | Clave reutilizada con otro cuerpo / la primera aún procesa. |
| 413 | `LOTE_DEMASIADO_GRANDE` | Partir el lote. |
| 422 | (informe de lote) | Ver `rows[].reason`. Nada se escribió. |
| 423 | `TENANT_SUSPENDED` | Cuenta suspendida: lectura sí, escritura no. |
| 429 | `LIMITE_DE_TASA` | Esperar y reintentar con backoff. |
| 5xx | `ERROR_INTERNO` | Reintentar con backoff y la **misma** `Idempotency-Key`. |

---

## 6. Recursos nuevos de v1 (2026-11-24)

### 6.1 `POST /v1/orders/{number}/status` · `order.update`

```json
{
  "status": "paid",
  "payment_status": "paid",
  "fulfillment_status": "in_progress",
  "reason": "Facturado en el ERP",
  "external_refs": [
    { "system": "sap", "type": "order",   "id": "4500012345" },
    { "system": "sap", "type": "invoice", "id": "F001-000123", "url": "https://erp.cliente/factura/123" }
  ]
}
```

- Todos los campos son opcionales, pero debe venir al menos un estado o una referencia.
- Valores: `status` ∈ `pending · paid · fulfilled · cancelled · refunded`; `payment_status` ∈ `pending · authorized · paid ·
  partially_refunded · refunded · failed · voided`; `fulfillment_status` ∈ `unfulfilled · in_progress · partially_fulfilled ·
  fulfilled · returned · cancelled`.
- Se aplican en orden **entrega → pago → estado**. Las reglas de transición son las mismas del backoffice.
- Un eje que ya está en el valor pedido **no es error**: vuelve en `changes.unchanged`. Así un reintento es inofensivo.
- La línea de tiempo del pedido registra el cambio con origen **`api`** y dispara los webhooks `order.*_changed`.
- `external_refs`: upsert por `(system, type)`; `system` y `type` en minúsculas `[a-z0-9_-]`. Máximo 10.
- Respuesta `200`: el pedido + `changes: { changed: [...], unchanged: [...], external_refs: n }`.

### 6.2 `POST /v1/customers:batch` · `customer.write`

```json
{ "system": "sap",
  "customers": [
    { "code": "C-0001", "kind": "company", "name": "Clínica San Pablo", "tax_id": "20100000001",
      "email": "compras@clinica.test", "phone": "+51999999999", "segment": "mayorista",
      "is_active": true, "external_id": "100045" } ] }
```

- Upsert por **`code`**. En el alta `kind` (`company`/`person`) y `name` son obligatorios.
- Campo omitido = no se toca (no borra). Mismas reglas que la importación por Excel del backoffice.
- `external_id` queda como el código del cliente en `system` (por defecto `erp`) y vuelve en `GET /v1/customers` como
  `external_ids: { "sap": "100045" }`.

### 6.3 `POST /v1/stock:batch` · `stock.write`

```json
{ "items": [ { "sku": "QS-514574", "warehouse": "ALM-LIMA", "on_hand": 181 } ] }
```

- `sku` de producto o de variante; `warehouse` = código del almacén (sin distinguir mayúsculas).
- Solo almacenes con **origen ERP** (Inventario › Almacenes). Un almacén que lleva la tienda devuelve `ALMACEN_NO_ERP`:
  la integración no pisa el stock que se gestiona a mano.
- Cada saldo distinto deja un movimiento de recuento en el kardex; uno igual informa `unchanged`.

### 6.4 `POST /v1/price-lists/{code}/items:batch` · `price.write`

```json
{ "items": [
    { "sku": "QS-514574", "price": "99.90", "compare_at_price": "111.29" },
    { "sku": "QS-514574", "price": "95.00", "min_quantity": 12 },
    { "sku": "QS-000001", "active": false } ] }
```

- La lista (de la tienda `store`) **debe existir**: se crea y se asigna a segmentos/canales en Precios. La API la llena.
- Upsert por `(sku, min_quantity)`; `active: false` quita ese precio. `currency`, si viene, debe ser la de la lista.

---

## 7. Eventos (webhooks)

Se configuran en **Integraciones › Webhooks**: URL `https`, eventos suscritos y secreto.

- Cabeceras: `x-ebim-event-type`, `x-ebim-delivery-id`, `x-ebim-signature: t=<epoch>,v1=<hex>`.
- Firma: `HMAC-SHA256(secreto, "<t>.<cuerpo crudo>")`. Rechaza entregas con `t` de más de 5 minutos.
- Reintentos con backoff ante respuestas no-2xx; deduplica por `x-ebim-delivery-id`.
- Eventos: `order.created`, `order.status_changed`, `order.payment_status_changed`, `order.fulfillment_status_changed`,
  `order.approval_requested`, `order.approval_decided`, `payment.captured`, `payment.failed`, `fulfillment.created`,
  `fulfillment.state_changed`, `fulfillment.delivered`, `return.requested`, `return.approved`, `return.completed`,
  `quote.requested`, `quote.accepted`, `quote.converted` (comodines `order.*`, `payment.*`, …).

**Bucle de pedido recomendado:** `order.created` (webhook) → el ERP crea su pedido → `POST /v1/orders/{n}/status` con
`external_refs` → al facturar/despachar, otro `.../status` → eCommerce notifica al comprador.

---

## 8. Modo pull (fuentes de lectura)

Para el ERP que publica en vez de llamar. eCommerce consulta en intervalos:

```
GET {base_url_del_ERP}{ruta}?limit=N[&updated_since=ISO-8601][&cursor=X]
200 { "data": [ ... ], "next_cursor": "X" | null }
```

- Stock: `{ sku, warehouse, on_hand, updated_at }` · Precios: `{ sku, price, currency, min_quantity, compare_at_price, active, updated_at }`.
- **Mismos campos y mismas reglas que el push** (§6.3 y §6.4). Autenticación: API key, Bearer, Basic u OAuth 2.0.
- Se configura en Integraciones › Fuentes de lectura (detalle: `docs/propuestas/2026-11-12-canal-fuentes-de-lectura.md`).

---

## 9. Conformidad: cómo se certifica un ERP

Un conector se considera **conforme v1** cuando, en QAS y con una credencial con solo los scopes que usa:

1. Obtiene token y lee `GET /v1/openapi.json`.
2. Carga catálogo con `dry_run=true` y luego real; un lote con un error devuelve `422` y no escribe nada.
3. Empuja stock a un almacén ERP; repite el mismo envío con la misma `Idempotency-Key` y obtiene `idempotent-replay`.
4. Llena una lista de precios y la ve aplicada en la vitrina para un cliente del segmento.
5. Sincroniza clientes con `external_id` y los lee de vuelta con `external_ids`.
6. Recibe `order.created` verificando la firma, responde 2xx, y devuelve el ciclo con `.../status` + `external_refs`.
7. Sincroniza incrementalmente con `updated_since = server_time` anterior sin perder ni duplicar registros.
8. Maneja `409 ESTADO_EN_CONFLICTO`, `429` y `5xx` sin bucles infinitos.

Kit de prueba, **generado** desde la tabla de rutas con `npx vite-node scripts/integrations/generate-api-kit.ts`:

- Colección y entorno de Postman: `scripts/integrations/postman/`. Incluyen el token automático, la `Idempotency-Key` por envío y las pruebas de cada respuesta.
- Contrato `docs/integrations/openapi-v1.json` y su visor `docs/integrations/openapi-v1.html`, que se abre en el navegador sin servidor.

La colección Bruno de `scripts/integrations/bruno/` cubre los mismos pasos.

---

## 10. Versionado y cambios

- **Compatible (sin cambio de versión):** rutas nuevas, campos de respuesta nuevos, scopes nuevos, códigos de `reason` nuevos.
  Un cliente conforme **debe ignorar campos de respuesta desconocidos**.
- **Breaking (→ `/v2`):** quitar o renombrar campos/rutas, cambiar tipos o semántica. Se publica con 90 días de
  convivencia y se anuncia en el buzón de la suite.

## Historial

| Fecha | Cambio |
|---|---|
| 2026-11-24 | v1 consolidada: `orders/{number}/status`, `customers:batch`, `stock:batch`, `price-lists/{code}/items:batch`, `updated_since` + `server_time`, scopes `order.update` · `stock.write` · `customer.write` · `price.write`, código `ESTADO_EN_CONFLICTO`. `GET /v1/products` pasa a leer la publicación de la tienda. |
| 2026-09-21 | `catalog/products:batch` (ver `catalog-ingest.md`). |
| 2026-08-28 | API empresarial `/v1`: pedidos, productos, stock, clientes; webhooks firmados. |
