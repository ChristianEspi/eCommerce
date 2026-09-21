# Ingesta de catálogo por API (propuesta)

**Estado:** contrato acordado, **sin implementar**. La ruta todavía no está en `API_ROUTES`: la API real
genera su OpenAPI de esa tabla y nunca anuncia una ruta que no responde. Mientras tanto, el contrato se
prueba contra un servidor simulado.

| Archivo | Qué es |
|---|---|
| [catalog-ingest.openapi.yaml](catalog-ingest.openapi.yaml) | Contrato OpenAPI 3.1 (fuente de verdad de esta propuesta) |
| [examples/](examples/) | Lotes de ejemplo: MiQuímica simple con GTIN, Biel con variantes, lote que se rechaza |
| [scripts/integrations/bruno/](../../scripts/integrations/bruno/) | Colección Bruno (entornos `mock` y `qas`) |

## 1. Estándares elegidos

| Tema | Estándar | Por qué |
|---|---|---|
| Transporte y contrato | REST + JSON + **OpenAPI 3.1** sobre la API de socio `/v1` | Ya existe: token, scopes, idempotencia, errores y `x-correlation-id`. Cualquier ERP o iPaaS lo consume |
| Autenticación | OAuth 2.0 `client_credentials` | La misma credencial de socio; scope nuevo `catalog.write` |
| Identificación del artículo | `sku` (clave) + **GS1 GTIN** 8/12/13/14 (opcional, dígito de control verificado) | El SKU es la clave interna de la sociedad; el GTIN es el código de barras universal |
| Nombres de campo | **schema.org `Product`** (`name`, `description`, `gtin`, `sku`, `brand`) | Vocabulario conocido; el mismo que usa la vitrina en su JSON-LD |
| Moneda | **ISO 4217** (`PEN`, `USD`) | Tiene que coincidir con la moneda de la tienda |
| Importes | Cadena decimal `"111.29"` | Un `float` pierde céntimos; una cadena no |

No se eligió GS1 GDSN, BMEcat ni EDI PRICAT: exigen un *data pool* o un intermediario que los clientes
de la suite no tienen. El contrato sí usa sus identificadores (GTIN), así que un conector a esos formatos
solo tiene que traducir campos.

## 2. Reglas del lote

- **El tenant lo pone la credencial.** El cuerpo nunca lleva `organization_id`, `company_id` ni `store_id`
  (un campo desconocido → 400). Las tiendas se nombran por slug y se resuelven **dentro de la sociedad del
  token**: la tienda de otra sociedad no existe para el integrador.
- **Upsert por `sku`** en el Product Master de la sociedad. Si el SKU existe, se actualiza; si no, se crea.
- **Omitido = no tocar; `null` = vaciar.** Una actualización que solo trae `stock` no borra el nombre.
- **Publicaciones por tienda.** `publications[]` configura dirección, categoría (de esa tienda), estado y
  precio. Una tienda que no aparece no se toca; para despublicar se usa `status: "archived"`.
- **Precios de variante por tienda** en `variants[].prices[]` (los overrides de `store_price_overrides`).
  Sin precio propio, la variante hereda el de la publicación.
- **Todo o nada.** Si una fila falla, no se escribe ninguna: 422 con el informe fila por fila
  (`code`, `field` como ruta JSON, `message`).
- **`dry_run=true`** devuelve el mismo informe sin escribir. Es el primer paso de cualquier carga nueva.
- **`Idempotency-Key` obligatoria.** Misma clave y mismo cuerpo → la misma respuesta; con otro cuerpo → 409.
- **Límites:** 500 productos y 5 MB por lote, 50 variantes y 20 tiendas por producto. Más de eso, en varios
  lotes.
- **Stock:** `stock` es la existencia de catálogo. Si la sociedad trabaja con almacenes se ignora: la
  existencia entra por inventario (una API aparte, fuera de este alcance).

## 3. Cómo se implementa (cuando se apruebe)

1. `contract.ts` y `src/domain/api.ts`: scope `catalog.write`; códigos `LOTE_RECHAZADO` y
   `LOTE_DEMASIADO_GRANDE`.
2. Migración nueva: `public.api_catalog_upsert(p_payload jsonb, p_dry_run boolean)`, `SECURITY INVOKER`,
   con el tenant de `ebim.org_id()` / `ebim.active_company()`. Reutiliza el motor de importación
   (`import_catalog_*`) y los comandos del Product Master (`publish_product`,
   `update_product_publication`). Se añade `catalog.write` a `ebim.api_scope_catalog()`.
3. `routes.ts`: la ruta con `requiresIdempotencyKey: true`. Así entra en el `openapi.json` generado.
4. Tests:
   - PGlite: aislamiento entre sociedades, todo o nada, `dry_run` sin escritura, GTIN inválido,
     categoría de otra tienda, moneda distinta.
   - Gateway: scope y cabecera de idempotencia.
5. Siguiente fase: lotes asíncronos (`202` + `GET /v1/catalog/jobs/{id}`) y webhook
   `catalog.import.completed` para cargas de miles de productos.

## 4. Cómo probarlo

**Hoy, contra el servidor simulado:**

```bash
npx @stoplight/prism-cli mock docs/integrations/catalog-ingest.openapi.yaml -p 4010
cd scripts/integrations/bruno
npx @usebruno/cli run "01 Token.bru" "05 Lote - simulacion.bru" "06 Lote - aplicar.bru" "07 Lote - rechazado.bru" --env mock
```

Prism valida cada petición contra el contrato y responde con sus ejemplos. `Prefer: code=422` fuerza el
ejemplo de rechazo. En la app de escritorio de Bruno se abre la carpeta `scripts/integrations/bruno`.

**Contra QAS (lo que ya existe: token, `openapi.json`, productos, stock):** en Bruno, entorno `qas`,
cargar `clientId` y `clientSecret` como secretos. Son de una credencial creada en el backoffice
(Integraciones → API) y **nunca se commitean**. Luego ejecutar 01–04. En CLI:
`--env qas --env-var clientId=... --env-var clientSecret=...`.

**Validar el contrato:** `npx @redocly/cli lint docs/integrations/catalog-ingest.openapi.yaml`.

**Cuando esté implementado:**

- Schemathesis (`schemathesis run <url>/v1/openapi.json`) genera casos límite contra la ruta real.
- k6 para carga: 500 productos por lote con varios integradores simultáneos.
- webhook.site para el webhook de la fase asíncrona.
