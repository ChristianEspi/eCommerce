# Plan de migración — N tiendas por sociedad y producto maestro con publicación por tienda

Decisiones: [`docs/adr/018-stores-product-master-company-scope.md`](adr/018-stores-product-master-company-scope.md).
Este documento dice **qué se toca, en qué orden y cómo se prueba**. Se actualiza al cerrar cada fase
(§11 lleva el estado real).

---

## 1. Línea base (fase 01, 2026-09-16)

| | |
|---|---|
| Rama | `dev` |
| HEAD | `712ad8e` (feat(vitrina): elegir variante con botones por eje…) |
| Árbol | limpio salvo `_EBIM_PROMPTS/` y `docs/PROMPT_CLAUDE_OPUS_5_CIERRE_ECOMMERCE.md`, sin seguimiento y ajenos a este trabajo |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test` (unit + UI + PGlite, incluye `supabase/tests`) | **238 archivos, 4 451 pruebas, 0 fallos** (514 s) |
| `npm run test:db` | subconjunto de `npm run test` (`supabase/tests`); incluido arriba |
| Migraciones | 180 (`…20260916120000_storefront_variant_options.sql` la última) |

Los tests de base usan PGlite (Postgres en WASM): no requieren Docker ni Supabase local. Una pasada
completa bajo carga puede dar fallos de tiempo en suites PGlite que pasan aisladas; la línea base de
arriba no los tuvo.

## 2. Mapa de tiendas (estado actual)

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| Quién escribe `stores` | INSERT/UPDATE owner/admin (`stores_write_admin`, `stores_update_admin`), DELETE owner (`stores_delete_owner`); SELECT miembro (`can_access`); anon ve activas | `20260827090200_stores.sql:97-115` |
| Grants | `authenticated` tiene la tabla entera; `anon` (id, slug, name, status, currency, domain) | `stores.sql:86-91` |
| Organización/sociedad | Hoy las declara quien inserta; la policy exige rol en ESA pareja. **Nada impide mover una tienda de sociedad por UPDATE** si se es admin de las dos | `stores.sql:101-107` |
| `store_settings` | Solo `bootstrap_tenant` la crea; `saveStoreSettings` inserta si falta. Insert/update owner/admin; campos premium exigen `content.white_label`; UPDATE por columnas | `20260827090700_server_operations.sql:83`, `20260828140200_white_label.sql:133-167,316-323`, `src/features/admin/settings/api.ts:277-283` |
| Canal por defecto | Trigger `stores_default_channel` → `ebim.ensure_default_channel()` (b2c, público, por defecto) | `20260827130000_channels.sql:205-222` |
| Otros triggers | `stores_set_updated_at`, `stores_audit` | `stores.sql:37`, `20260828160300_audit_log.sql:435` |
| Tienda utilizable | `stores` + `store_settings` + canal por defecto; `status='active'` para la vitrina; almacenes, zonas y medios de pago son opcionales | `20260828100100_cart_operations.sql:41,76`, `20260901190000_checkout_requires_account.sql:112` |
| Slug / dominio | slug `^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$` único global; dominio `^[a-z0-9.-]{4,253}$` único; moneda FK `currencies` | `stores.sql:22-33`, `20260827091600_currencies_and_taxes.sql:132-136` |
| Dominio propio | `stores.domain` + verificación en `store_settings.custom_domain_*`; `store_domain_claim` exige `content.white_label` | `white_label.sql:247-298` |
| TenantProvider | `fetchWorkspace` lee `stores` (sin filtro de estado); clave `['workspace', orgId]`; selección: override → preferencia (`localStorage` por sociedad) → primera por nombre | `src/features/tenant/workspace.ts:43-67,113-191`, `TenantProvider.tsx:38-101`, `store-preference.ts` |
| Refresco | Solo `OnboardingPage` y `useSaveStoreSettings` invalidan `['workspace']` | `OnboardingPage.tsx:99`, `useStoreSettings.ts:43-50` |
| Switchers | `StoreSwitcher` (menú con >1), `CompanySwitcher` (>1 sociedad) | `src/features/admin/StoreSwitcher.tsx:35-163` |
| Rutas | `/app/*` con `gated(capability)`; sin gating por rol en rutas; la navegación filtra por `permission` | `src/app/routes.tsx:190-273`, `src/features/admin/navigation.tsx:34-305` |
| Permiso | `store.manage` = owner/admin | `src/shared/lib/roles.ts:45-63` |
| Crear la segunda tienda | **No existe**: `bootstrap_tenant` falla con `TENANT_YA_EXISTE` | `server_operations.sql:62` |
| Límite de tiendas | **No existe** en migraciones, código ni entitlements. Integración futura con el hub, no número local | — |

## 3. Grafo de dependencias de `products`

Clases: **M** maestro · **P** publicación `(store_id, product_id)` · **T** instantánea transaccional ·
**R** modelo de lectura (vista/RPC que recompone maestro + publicación) · **L** fallback legacy.
Columna *Fase*: dónde se migra. Las rutas `file:line` son la ÚLTIMA definición.

### 3.1 La tabla `products`

| Objeto | Usa | Clase | Fase |
|---|---|---|---|
| `sku`, `name`, `description`, `custom_fields`, `kind`, `brand_id`, `family_id`, `tax_category_id`, `shipping_weight` | identidad | M | se quedan |
| `store_id` | tienda | P → «tienda de origen» nullable | 03 |
| `slug`, `category_id`, `status`, `published_at` | publicación | P → `store_products` | 03 (fachada), 05 (contracción) |
| `price`, `compare_at_price`, `currency` | precio de catálogo | P → `store_products` | 03 (fachada), 05 |
| `stock`, `in_stock` (generada) | stock de catálogo sin almacenes | L (maestro) | se quedan |
| `search_vector` (generada: name A, **slug B**, description C) | índice | R | 03: se redefine sin slug |
| `products_store_key unique (id, store_id)` | destino de 15 FKs | P | 05: se retira tras mover las FKs |
| `products_tenant_key unique (id, org, company)` | tenant | M | destino nuevo de FKs de maestro |
| `products_kind_key unique (id, kind)` | FKs de kind (variantes, kits) | M | se queda |
| `products_sku_key (store_id, lower(sku))` | unicidad | M → por sociedad | 03 |
| `products_slug_key (store_id, lower(slug))` | unicidad | P → `store_products` | 03 |
| `products_category_fk (category_id, store_id)` | categoría | P | 03 (a la publicación) |
| `products_store_fk`, `products_currency_fk` | tienda / moneda | P | 03 (se relajan a nullable) |
| checks `price_positive`, `compare_positive`, `currency_fmt`, `slug_format`, `published_needs_date` | publicación | P | 03 (a la publicación; en `products` admiten NULL) |
| índices `store_status`, `published`, `available`, `kind (store_id, kind)`, `category` | publicación | P | 03/05 |
| trigger `products_sku_unique_across_variants` → `ebim.assert_sku_unique_in_store` | SKU por tienda | M → por sociedad | 03 |
| policies `products_*_catalog`, `products_select_member` | org/company + rol | M | se quedan |
| policy `products_select_public` (anon) | `status`, `published_at`, `store_id` | P | 03: «publicado en alguna tienda activa» |
| grants anon por columna (`store_id`, `slug`, `price`, …) | lectura pública | P | 03 |

### 3.2 Claves ajenas hacia `products` / `product_variants`

| Tabla | Constraint | Hoy | Destino | Clase | Fase |
|---|---|---|---|---|---|
| product_images | `product_images_product_fk` | (product_id, store_id) cascade | (product_id, org, company) | M | 03 |
| product_variants | `product_variants_product_fk` | (product_id, store_id) | (product_id, org, company) | M | 03 |
| product_variants | `product_variants_kind_fk` | (product_id, product_kind) | sin cambio | M | — |
| variant_attribute_values | `variant_attribute_values_variant_fk` | (variant_id, store_id) → variants | (variant_id, org, company) | M | 03 |
| product_attribute_values | `…_product_fk` | (product_id, store_id) | (product_id, org, company) | M | 03 |
| product_uoms | `product_uoms_product_fk` | (product_id, store_id) | (product_id, org, company) | M | 03 |
| bundle_items | `bundle_items_bundle_fk`, `…_component_fk` | (x, store_id) | (x, org, company) | M | 03 |
| bundle_items | `bundle_items_variant_fk` | (component_variant_id, store_id) | (component_variant_id, component_product_id) → variants (id, product_id) | M | 03 |
| bundle_items | `…_bundle_kind_fk`, `…_component_kind_fk` | (x, kind) | sin cambio | M | — |
| product_relations | `…_product_fk`, `…_related_fk` | (x, store_id) | (x, org, company) | M (se filtra por publicación al leer) | 03 |
| product_channels | `product_channels_product_fk` | (product_id, store_id) | → `store_products (product_id, store_id)` | P | 05 |
| price_list_items | `price_list_items_product_fk` | (product_id, store_id) | → `store_products` | P | 05 |
| price_list_items | `…_variant_fk`, `…_uom_fk` | (variant_id, product_id), (product_id, uom_id) | sin cambio | M | — |
| cart_items | `cart_items_product_fk` | (product_id, store_id) | → `store_products` | P | 05 |
| cart_items | `cart_items_variant_fk` | (variant_id, store_id) | (variant_id, product_id) → variants | M | 05 |
| promotion_scopes | `promotion_scopes_product_fk` | (product_id, store_id) | → `store_products` | P | 05 |
| content_block_items | `content_block_items_product_fk` | (product_id, store_id) | → `store_products` | P | 05 |
| product_favorites | `product_favorites_product_fk` | (product_id, store_id) | → `store_products` | P | 05 |
| inventory_levels | `inventory_levels_product_fk` | (product_id, store_id) | (product_id, org, company) | M | 05 |
| order_items | `order_items_product_fk` | (product_id, store_id) set null | (product_id, org, company) set null | T | 05 |
| order_items | `order_items_variant_fk` | (variant_id, store_id) set null | (variant_id, org, company) set null | T | 05 |
| product_reviews | `product_reviews_product_fk` | (product_id, store_id) cascade | (product_id, org, company) cascade; alta valida publicación | T | 05 |
| quote_items, assortment_items, order_template_items, order_suggestion_items, demand_forecasts | `…_product_fk` | (product_id) | (product_id, org, company) donde la tabla lleva tenant; si no, sin cambio | M | 05 |
| analytics_events, inventory_movements, inventory_reservation_items, price_change_events, `order_items.components_snapshot` | sin FK | uuid suelto | sin cambio | T | — |

### 3.3 Vistas

| Vista | Usa | Clase | Fase |
|---|---|---|---|
| `public_products` (`20260827200300:172`) | store_id, category_id, slug, precio, status, published_at | R | 03 |
| `public_product_variants` (`20260916120000:75`) | `p.store_id = v.store_id`, `coalesce(up.unit_price, v.price, p.price)` | R | 03 |
| `ebim.public_unit_prices` (`20260827180100:383`) | store, status, currency | R | 03 |
| `admin_products` (`20260910190000:23`) | todo, incl. publicación | R → maestro | 03 (+ `admin_store_products`) |
| `inventory_alerts` (`20260827200200:662`) | sku/name; rama «sin mapear» con status/store | R | 05 |
| `public_product_images` (`20260827091200:145`), `public_categories` | store_id por RLS | R | 03 (imágenes), sin cambio (categorías) |

### 3.4 Funciones

| Función | Última definición | Usa | Clase | Fase |
|---|---|---|---|---|
| `ebim.assert_sku_unique_in_store` | 20260827170000:618 | SKU por tienda | M | 03 |
| `ebim.product_is_available` | 20260827200300:51 | store, status | P | 03 |
| `ebim.bundle_is_available` | 20260827200300:110 | store, kind, status | P | 03 |
| `ebim.variant_public_options` | 20260916120000:24 | store, status | P | 03 |
| `public.availability_for_slug` | 20260827200300:284 | store, status | P | 05 |
| `ebim.resolve_prices` / `resolve_price` | 20260827180100:173/319 | `p.store_id`, `coalesce(v.price, p.price)`, `pu.price`, currency | P + L | 05 |
| `ebim.build_quote` | 20260908130000:102 | store, status (público), channels, kind, tax | P | 05 |
| `public.price_quote` / `price_quote_for_slug` | 20260827190200:69 / 180100:860 | vía build_quote | P | 05 (sin cambio de firma) |
| `ebim.evaluate_promotions` | 20260901150000:132 | `pr.store_id`, `pr.category_id`, `pr.brand_id` | P (categoría), M (marca) | 05 |
| `ebim.cart_payload` | 20260901200000:27 | slug, name, kind | R | 05 |
| `public.cart_replace_lines` | 20260828100100:535 | store, status, channels, currency, kind | P | 05 |
| `public.create_order` | 20260913150000:69 | store+status FOR UPDATE, channels, currency, kind, variants, uoms, precio, stock, tax, kits | P + T | 05 |
| `ebim.atp` / `expand_stock_lines` / `hold_stock` / `consume_stock` | 20260827200100:189/111/670/984 | `p.store_id` para kind; stock de catálogo | M + L | 05 |
| `ebim.ensure_level` | 20260827200200:74 | escribe `store_id = product.store_id` | M | 05 |
| `public.seed_inventory_from_catalog` / `inventory_availability` | 20260827200200:524/589 | store, stock | L | 05 |
| `public.return_inspect` | 20260828150500:446 | expand_stock_lines(store) + ensure_level | M | 05 |
| `ebim.basket_weight` / `select_warehouse` / `plan_fulfillment` / `fulfillment_*` | 20260828150200:108/562, 150300:172, 20260914180300:132/178 | peso, levels.product_id | M | 05 (solo lo que pase por expand_stock_lines) |
| `ebim.search_catalog` | 20260902240000:20 | store, slug, category, status, search_vector | R | 05 |
| `public.catalog_suggest_for_slug` | 20260828140300:702 | public_products | R | sin cambio (vía vista) |
| `ebim.content_block_items_json` | 20260903120000:20 | public_products / variants | R | sin cambio (vía vistas) |
| `public.toggle_product_favorite` / `my_product_favorites` | 20260831120000:96/160 | store, status | P | 05 |
| `ebim.review_product` / `submit_product_review` / `product_reviews_for_slug` | 20260914141000:184/233/453 | `products%rowtype`, store, status | P | 05 |
| `public.product_relations_for_slug` | 20260914140000:51 | store, status, channels | P | 05 |
| `public.resolve_order_lines_for_slug` | 20260914120000:54 | SKU por tienda, status, channels, currency, surtido | P (SKU → maestro) | 05 |
| `ebim.order_schedule_line_issue` / `save_my_order_schedule` / `ebim.order_template_view` | 20260914192000:32/206, 20260914130000:426 | store, status, slug | P | 05 |
| `ebim.suggest_order_v2` | 20260914151000:112 | store, status, surtido, channels | P | 05 |
| `public.my_order_suggestions` / `my_quotes` | 20260912130000:52, 20260914101000:208 | name | M | sin cambio |
| `public.request_quote` / `accept_quote` | 20260914101000:598/297 | store, status; copia a price_list_items | P | 05 |
| `public.api_order_create` / `api_products_list` / `api_stock_read` | 20260828170400:260/374/433 | SKU por tienda, store, status, precio crudo | P | 05 |
| `public.track_events_for_slug` | 20260830100200:253 | `p.store_id`, `pv.store_id` | P | 05 |
| `public.dashboard_kpis` | 20260830160000:24 | conteo por store/status | R | 05 |
| `public.category_deletion_usage` | 20260827091100:193 | `p.category_id` | P | 05 |
| `public.product_deletion_usage` | 20260827170300:19 | pedidos, imágenes, variantes, kits | M | 04 (+ publicaciones) |
| `public.import_catalog_products` | 20260916100000:773 | escribe maestro + publicación | M + P | 04 |
| `public.channel_catalog_summary` | 20260914150000:200 | product_channels | P | sin cambio |

### 3.5 Policies con `store_id` de producto

`products_select_public`, `product_images_select_public`, `product_variants_select_public`,
`brands_select_public` (todas vía `p.store_id`/`p.status`) → fase 03, reescritas contra la
publicación. `product_channels_select_public` y `ebim_objects_select_public_product` (Storage, vía
RLS de `product_images`) → heredan el cambio. Las policies de miembro y de escritura del PIM ya son
por org/company y no cambian.

### 3.6 Edge Functions y frontend

| Consumidor | Qué asume | Fase |
|---|---|---|
| `supabase/functions/catalog-product` | crea/edita producto CON tienda, slug, precio, stock, estado | 04 |
| `supabase/functions/catalog-copy` | lee `admin_products` (id, sku, name, brand_name, category_name) | 04 (vista maestro conserva esas columnas) |
| `supabase/functions/storefront-seo` | `public_products` slug/published_at por tienda | sin cambio (vista) |
| `supabase/functions/shopping-assistant` | `catalog_search_for_slug` | sin cambio (vía search_catalog) |
| `supabase/functions/api` (+ `_shared/api/routes.ts`) | SKU + tienda | 05 (SQL) |
| `checkout`, `create-order` | todo en SQL por `product_id` + slug de tienda | 05 (SQL) |
| `src/features/catalog/*` (types, api/products, images, useProducts, ProductsPage, ProductDrawer, pim/*, import/*) | producto = fila de tienda | 04 |
| `src/features/inventory/api.ts`, `pricing/api.ts`, `promotions/api.ts`, `trade/api.ts`, `search/searchApi.ts`, `planning/api.ts` | `products.eq('store_id')` | 05 |
| `src/features/storefront/*` | lee vistas públicas con `store_id` | sin cambio de forma (las vistas conservan columnas) |

## 4. Auditoría de SKU legacy

- Consulta portable, solo lectura: `scripts/audit/product-sku-conflicts.sql`. Agrupa por
  `organization_id + company_id + lower(btrim(sku))` sobre productos **y** variantes (comparten
  espacio de nombres), y marca divergencias de nombre, tipo, marca y familia.
- **DEV (2026-09-16):** 780 productos y 839 variantes en 4 tiendas → **0 conflictos**.
- **Seed local (`supabase/seed.sql`):** SKU distintos por construcción.
- **Comportamiento con conflictos reales (QAS/PRD):**
  1. no se fusiona, renombra ni borra nada;
  2. las filas en conflicto se marcan `products.legacy_sku_conflict = true` (y la variante equivalente);
  3. el índice único por sociedad es **parcial** (`where not legacy_sku_conflict`), así que la
     migración no falla;
  4. el trigger de unicidad rechaza cualquier fila NUEVA o SKU editado que coincida con otra de la
     sociedad, incluidas las marcadas: los conflictos no crecen;
  5. resolverlos es manual (renombrar un SKU desmarca la fila); el certificado lista cuántas quedan.

## 5. Orden de migraciones

| # | Migración (timestamp posterior a HEAD) | Fase | Contenido |
|---|---|---|---|
| 1 | `20260917100000_store_management.sql` | 02 | `create_store`, `update_store`, `set_store_status`; inmutabilidad de org/company en `stores`; códigos de error estables |
| 2 | `20260917110000_product_master_expand.sql` | 03 | `store_products`, `store_price_overrides` (RLS + FKs + índices); relleno 1:1; SKU por sociedad con marca de conflicto; fachada de escritura legacy; FKs PIM a maestro; `products.store_id` nullable; `search_vector` sin slug; imágenes con ruta de cualquier tienda de la sociedad |
| 3 | `20260917120000_product_master_read_models.sql` | 03 | `public_products`, `public_product_variants`, `ebim.public_unit_prices`, `admin_products` (maestro), `admin_store_products`, disponibilidad, opciones de variante, policies anon |
| 4 | `20260917130000_product_master_commands.sql` | 04 | comandos de maestro y publicación (`save_product_master`, `publish_product`, `update_store_product`, `unpublish_product`), usos de borrado, importación |
| 5 | `20260917140000_…` a `20260917180000_…` | 05 | consumidores por dominio: precios, carrito/pedido, inventario, promociones/CMS/favoritos/reseñas/relaciones, búsqueda, pedido rápido/programados/sugeridos/cotizaciones, API, analítica |
| 6 | `20260917190000_product_master_contract.sql` | 05 | FKs de tienda a publicación; retirada de `products_store_key`, claves por tienda de variantes, índices por tienda; comentarios |

Cada archivo es nuevo; ninguna migración aplicada se edita.

## 6. Estrategia de relleno

1. `insert into store_products (…) select … from products where store_id is not null on conflict
   (store_id, product_id) do nothing` — idempotente, conserva `products.id`, una publicación por
   producto en su tienda actual, con slug, categoría, estado, fecha, precio, tachado y moneda.
2. `store_price_overrides` desde `product_variants.price/compare_at_price` y `product_uoms.price` no
   nulos, en la tienda de la fila.
3. Verificación dentro de la misma migración (falla si no cuadra): conteo de productos con tienda =
   conteo de publicaciones rellenadas; cero productos legacy sin publicación; cero publicaciones cuya
   tienda sea de otra sociedad que el producto.
4. Después del relleno la fachada deja las columnas legacy en `NULL`.

## 7. Compatibilidad durante el despliegue

- **Escrituras legacy** (`insert/update products` con `store_id`, `slug`, `price`, `status`…; precio
  en variante o presentación) siguen funcionando: los triggers de fachada las trasladan a la
  publicación/precio propio de la tienda de origen y dejan la columna en `NULL`. Cubre la Edge Function
  `catalog-product` desplegada, las pantallas actuales y las fixtures de las pruebas.
- **Lecturas legacy** de esas columnas devuelven `NULL`: un consumidor olvidado falla en pruebas en vez
  de mostrar un dato viejo.
- **Vistas públicas** conservan nombre y columnas (`store_id`, `product_id`, `slug`, `price`, …): la
  vitrina, `storefront-seo` y el CMS no cambian.
- **`admin_products`** conserva `id, sku, name, brand_name, category_name` para `catalog-copy`.

## 8. Estrategias por área

- **Storage/imágenes**: la fila es del maestro; el objeto no se mueve. El CHECK de ruta pasa de
  «`{org}/{store_id de la fila}/…`» a «`{org}/{store}/…` con store de la misma sociedad» (trigger de
  validación, porque un CHECK no consulta tablas). Subidas nuevas usan la tienda activa como carpeta.
  La autorización de escritura en Storage (`ebim.can_write_store_object`) ya valida por la tienda de
  la ruta y no cambia. Lectura anónima: producto publicado en alguna tienda activa.
- **PIM (variantes, atributos, presentaciones, kits, relaciones)**: del maestro. `store_id` queda
  nullable como «tienda de origen», sin semántica; SKU de variante y código de barras únicos por
  sociedad. Precio propio de variante/presentación → `store_price_overrides`.
- **Vitrina**: vistas recompuestas maestro + publicación; ruta `/s/:storeSlug/product/:slug` resuelve
  por `store_products.slug` de ESA tienda.
- **Backoffice**: `/app/products` lista maestros de la sociedad (una fila por producto) con resumen de
  publicaciones; el editor separa «Datos del producto» y «Tiendas». Categorías siguen por tienda.
- **Precios**: `resolve_prices` lee el precio base de la publicación y los precios propios de
  `store_price_overrides`; listas, escalas, segmentos, clientes y promociones intactos.
- **Inventario**: disponibilidad por `serving_warehouses(store)`; `inventory_levels.store_id` deja de
  filtrar. Stock de catálogo en el maestro.
- **Pedidos**: el alta valida publicación vendible; el renglón referencia el maestro y conserva su
  instantánea.

## 9. Criterio de contracción (retirada física)

| Pieza legacy | Se retira cuando | Estado |
|---|---|---|
| `products_store_key`, claves `(id, store_id)` de variantes | todas las FKs apuntan a maestro o publicación | fase 05 |
| Índices por tienda en `products`/`product_variants` | ningún lector filtra por `products.store_id` | fase 05 |
| Columnas legacy de publicación en `products` y precios en variantes/presentaciones | ningún escritor las usa (Edge Functions, frontend, fixtures, `seed.sql`, scripts) | ver §11 |
| `store_id` de origen en tablas PIM | ídem | ver §11 |

## 10. Pruebas que deben quedar verdes

- Toda la suite existente (`npm run test`), sin borrar ni debilitar ninguna.
- Nuevas de base: alta de tienda (permisos, org/company del JWT, colisiones, `store_settings` 1:1,
  canal por defecto, sin tenant nuevo); maestro + publicación (mismo producto en dos tiendas, no en
  tienda de otra sociedad, cambio de maestro visible en ambas, despublicar A no toca B, categorías no
  se cruzan, vista pública solo publicado, IDs conservados, relleno, RLS, SKU con conflicto marcado);
  consumidores cruzados (precio distinto por tienda sin duplicar, pedido de A no acepta publicación
  solo de B, despublicar no rompe historia).
- Nuevas de frontend: módulo de tiendas; listado de maestros; pestaña de tiendas del editor.
- Gates: `typecheck`, `lint`, `test`, `test:db`, `build`, `bundle:report`, `scan:secrets`,
  `check:edge`.

### Riesgos

| Nivel | Riesgo | Mitigación |
|---|---|---|
| P0 | Un consumidor sigue leyendo columnas legacy y la vitrina muestra vacío | la fachada las deja en NULL: falla en pruebas; grafo §3 revisado contra `pg_proc` al cerrar la fase 05 |
| P0 | Fuga cross-tenant por publicar maestro de otra sociedad | FKs compuestas con org/company en `store_products` + prueba |
| P0 | Relleno incompleto deja productos invisibles | verificación de conteos dentro de la migración (aborta) |
| P1 | Precio en moneda equivocada al compartir maestro | precio y precios propios por tienda; prueba con dos monedas |
| P1 | Stock duplicado o disponibilidad falsa en la tienda B | disponibilidad por almacenes que sirven a la tienda; prueba |
| P1 | Conflictos de SKU en QAS/PRD | índice parcial + marca + trigger; auditoría previa |
| P2 | Deuda de fachada legacy | criterio de retirada §9 |
| P2 | Rendimiento de vistas con un JOIN más | índices `(store_id, status, published_at)` y `(product_id)` en publicación; `bundle:report` y pruebas de búsqueda |

## 11. Estado por fase

| Fase | Estado |
|---|---|
| 01 — auditoría, ADR y plan | hecha (este documento) |
| 02 — tiendas autoservicio | hecha: `20260917100000_store_management.sql`, `/app/stores` |
| 03 — maestro + publicación (base) | hecha: `20260917110000_product_master_expand.sql` y `20260917120000_product_master_read_models.sql` (ver §12) |
| 04 — backoffice de maestro | hecha: `20260917130000_product_master_commands.sql`, `20260917140000_product_master_import.sql`, `/app/products` (ver §13) |
| 05 — consumidores y contracción | pendiente |
| 06 — certificación | pendiente |

## 12. Implementado en la fase 03 (2026-09-17)

**Expand + migrate — `20260917110000_product_master_expand.sql`**

- `store_products` (publicación): slug único por tienda, categoría con FK `(category_id, store_id)`,
  estado, fecha, precio de catálogo y moneda; FKs compuestas con organización y sociedad hacia tienda
  y maestro; `unique (product_id, store_id)` como destino de las FKs de la fase 05; RLS forzada con
  policies de miembro/catálogo y lectura anónima de lo publicado en tienda activa.
- `store_price_overrides`: precio propio de variante o de presentación por tienda.
- Relleno idempotente 1:1 desde `products` y desde `product_variants.price`/`product_uoms.price`,
  con verificación que aborta la migración si no cuadra (conteos, productos sin publicación,
  publicaciones cruzadas entre sociedades).
- `products.store_id`, `slug` y `price` pasan a nullable; el `store_id` de las tablas PIM también, y
  cada una gana su FK contra el maestro `(product_id, organization_id, company_id)`.
- Imágenes: el CHECK de ruta pasa a trigger (`{org}/{tienda de la sociedad}/…`); ningún objeto se
  mueve.
- SKU único por sociedad entre productos y variantes: `legacy_sku_conflict`, índices parciales y
  trigger que rechaza duplicados nuevos y desmarca al renombrar.
- **Transición:** triggers de sincronía de la tienda de ORIGEN en los dos sentidos (publicación ↔
  columnas legacy; precio propio ↔ precio de variante/presentación), con `pg_trigger_depth()` contra
  el eco. Se retiran en la contracción (fase 05).

**Modelos de lectura — `20260917120000_product_master_read_models.sql`**

- `ebim.atp` y `ebim.expand_stock_lines` reconocen el producto por la sociedad de la tienda, no por
  su tienda de origen.
- `ebim.store_product_is_available` y `ebim.store_bundle_is_available`, con la tienda explícita.
- `ebim.variant_public_options`: ejes del maestro si está publicado en alguna tienda activa.
- `ebim.product_is_public` y policies anónimas de `products`, `product_images`, `product_variants` y
  `brands` contra la publicación.
- `ebim.public_unit_prices` por tienda; `public_products` y `public_product_variants` recompuestas
  sobre la publicación con las MISMAS columnas.
- `admin_store_products`: una fila por publicación para el backoffice. `admin_products` conserva su
  forma hasta la fase 04.

**Compatibilidad restante:** las ~40 funciones de comercio siguen leyendo las columnas legacy de la
tienda de origen, válidas gracias a la sincronía. `ebim.product_is_available` y
`ebim.bundle_is_available` con la firma antigua siguen existiendo, sin llamantes en las vistas; se
retiran en la fase 05. Las FKs `(product_id, store_id)` siguen apuntando a `products` hasta la fase 05.

**Pruebas:** `supabase/tests/product-master.test.ts` (17) siembra datos con la forma legacy ANTES de
aplicar la migración (`createTestDatabase({ before })` + `applyMigrations`). Suite de base completa:
104 archivos, 2 618 pruebas, 0 fallos.

## 13. Implementado en la fase 04 (2026-09-17)

**Comandos — `20260917130000_product_master_commands.sql`** (todo `SECURITY INVOKER`, tenant de
`ebim.org_id()` + `ebim.active_company()`, ningún parámetro de organización o sociedad)

- `admin_product_masters`: un maestro por fila de la sociedad ACTIVA con `publication_count`,
  `published_count`, `published_store_names`, `store_ids`, `category_ids` y `publication_state`
  agregado. Sin precio.
- `product_store_publications(product)`: todas las tiendas de la sociedad y la publicación en cada una.
- `publish_product` / `update_product_publication` / `unpublish_product`: guardas
  `ebim.assert_catalog_editor` (owner/admin/catalog, no operador), `ebim.catalog_master` y
  `ebim.catalog_store` (sociedad activa), categoría de ESA tienda, moneda de la tienda, códigos
  `SLUG_DUPLICADO`, `PUBLICACION_DUPLICADA`, `CATEGORIA_FUERA_DE_TIENDA`, `PUBLICACION_NO_ENCONTRADA`.
- `delete_product_master`: niega `PRODUCTO_PUBLICADO`, `PRODUCTO_CON_HISTORIA`, `PRODUCTO_EN_KIT`.
  `product_deletion_usage` suma `publications`.
- **Transición:** `ebim.adopt_origin_store` — un maestro creado sin tienda adopta como origen la
  primera tienda donde se publica (y re-ancla su PIM), para que los lectores de comercio aún no
  migrados lo encuentren. `ebim.anchor_pim_origin_store` — el `store_id` de variantes, ficha,
  presentaciones, kits, relaciones e imágenes lo fija la base (tienda de origen o NULL), no la tienda
  activa del cliente; así el PIM se edita desde cualquier tienda sin chocar con las FKs legacy.

**Importación — `20260917140000_product_master_import.sql`:** el SKU se busca en la sociedad; en una
tienda que no es la de origen, el maestro recibe nombre/descripción/marca/familia/stock y la
publicación de ESA tienda recibe slug/categoría/estado/precio (se crea si falta); el precio de variante
va a `store_price_overrides` de esa tienda. En la tienda de origen se comporta como antes.

**Edge Function `catalog-product`:** alta sin `store_id` = solo maestro (rechaza campos de
publicación); con `store_id` = maestro + publicación inicial, como antes.

**Backoffice:** `/app/products` lista maestros (tiendas activas y cuáles, estado agregado, sin precio);
el cajón separa «General» (maestro, con publicación inicial opcional en la tienda activa solo al dar
de alta) de «Tiendas» (`StorePublicationsPanel`: una tarjeta por tienda con dirección, categoría de esa
tienda, estado, precio y enlace a la vitrina). Variantes/presentaciones avisan que su precio propio es
el de la tienda de origen. `CategoriesPage` sigue siendo de la tienda activa.

**Pruebas:** `supabase/tests/product-master-commands.test.ts` (27); `ProductsPage.test.tsx` (38,
reescrito para maestros y publicaciones), `pim-ui.test.tsx`, `catalog.test.ts`.
