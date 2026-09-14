# Deployment manifest — eCommerce Release Candidate

> **Nada de esto está desplegado.** Es la lista exacta, en orden, de lo que hay que llevar a QAS. Ningún paso se
> ejecutó contra DEV/QAS/PRD desde esta rama.

## Base

| Dato | Valor |
|---|---|
| Rama | `feature/demo-commerce-release-candidate` |
| Contiene | `feature/demo-commerce-hardening-v1` (H00–H14) + `feature/demo-commerce-hardening-v2` (N00–N12) + R00–R11 |
| Base de `dev` | `1bcf74f` (merge-base con `dev`) |
| Commit certificado | código en `23228c5` (ver `FINAL_CERTIFICATION.md`) |
| Node | mínimo ≥ 22.12 (`engines`), recomendado 24 (`.nvmrc`), usado 24.20.0 / npm 11.19.0 |
| `package-lock.json` SHA-256 | `78a8dd13afccec3b5250b266572ed461d5ddbcf65f931309d155bf59328e1700` (sin cambios de dependencias en el RC) |

## 0 · Antes de empezar

- [ ] Fusionar la rama en `dev` por PR revisado (no hecho desde aquí).
- [ ] Confirmar que QAS tiene aplicadas las migraciones hasta `20260912130000_sugeridos_del_comprador.sql` (la última
  de `dev` @ `1bcf74f`). `scripts/aplicar-migracion.mjs` no lleva tabla de control: comprobarlo por objetos (p. ej.
  existencia de lo que crea `20260912130000`) o con el preflight.
- [ ] Ventana sin tráfico de compra: la migración 6 recrea `create_order` y `checkout_place_order`.

## 1 · Migraciones requeridas (en este orden, una a una)

`node scripts/aplicar-migracion.mjs supabase/migrations/<archivo>` — cada una debe terminar sin error antes de la
siguiente.

| # | Archivo | SHA-256 | Qué cambia |
|---|---|---|---|
| 1 | `20260913100000_consumer_account.sql` | `e4bde910fc124515e16abe27585c8abc45fc85b53cd9e2c3bffa9635c59f87e2` | `order_buyers`, `checkout_link_order_buyer` (service_role), `my_consumer_orders`, `my_consumer_order_detail`, `my_checkout_profile` |
| 2 | `20260913110000_commerce_context.sql` | `9841e036fd46ff64b465271058b0fe3ae4f52edef6064023bc14f746c716800d` | `my_commerce_context` |
| 3 | `20260913120000_store_default_country.sql` | `713e6a14586202f272ce528d5ed05acfea159226b7827b6c056a1d732c0089ea` | `ebim.store_default_country`; **recrea la vista `public_stores`** con `default_country` |
| 4 | `20260913130000_effective_business_account.sql` | `8f877211a8b6cd7d6a7d95dc02c2542f66141c9cfe93aa8af2595c1dabab6bf3` | `buyer_account_selections`, `ebim.effective_business_account`; `ebim.pricing_actor` y `my_commerce_context` sobre ella; `my_store_business_accounts`, `select_store_business_account`, `my_effective_business_account_for_slug` |
| 5 | `20260913140000_promotion_quote_buyer_identity.sql` | `1907c3869faa727eb97ecf8a81776c8d42af3f77b31169eb3c60cdd3af119330` | `promotion_quote_for_slug` con identidad del servidor (misma firma) |
| 6 | `20260913150000_purchase_order_number.sql` | `778632a26efae6317637760decf70b7aa46e76d7a4d7c71b0715c8db4efd896b` | `orders.purchase_order_number` + CHECK + trigger de inmutabilidad; **drop + create** de `create_order` y `checkout_place_order` (+1 parámetro); `my_business_order_detail` |
| 7 | `20260913160000_consumer_addresses.sql` | `ac96a7e4eed5bf70200c8fc1b895c668a99ddf4bf434af31c55790bcb13fe55c` | `consumer_addresses` + 4 RPC |

Verificación de integridad antes de aplicar: `shasum -a 256 supabase/migrations/2026091310*.sql supabase/migrations/2026091311*.sql …`
debe coincidir con la tabla. Reproducibilidad: las 156 migraciones se aplican en limpio en PGlite
(`schema-invariants`: «dos bases vírgenes dan el mismo esquema») y en Postgres 17 local; **DEV/QAS usan Postgres 15**:
diferencia declarada, sin sintaxis específica de 16/17 en estas siete.

Después: `npm run db:types` contra QAS **solo en lectura** y comparar con `src/shared/lib/database.types.ts`
(generado en R02 desde la pila local); cualquier diferencia de objetos indica una migración sin aplicar.

## 2 · Edge Functions (después de las migraciones)

Cambios en `supabase/functions` desde `dev` (`1bcf74f`): `checkout/index.ts`, `_shared/checkout/{dbPorts,errors,
pipeline,ports,request}.ts`, `_shared/orders.ts`. Clasificación por cierre de imports de cada `index.ts`:

| Función | Importa código cambiado | Cambio de comportamiento | Clasificación |
|---|---|---|---|
| `checkout` | `index.ts`, `_shared/checkout/*`, `_shared/orders.ts` | cuenta efectiva (N01), OC + 422 (N05), entrega con precio del comprador (R01), vínculo del comprador (H02) | **REQUIRED** |
| `create-order` | `_shared/orders.ts` (`normalizeOrderItems`) | rechaza `purchase_order_number` dentro de una línea (`CAMPO_NO_PERMITIDO`) | **RECOMMENDED** |
| `api` | `_shared/checkout/request.ts` (solo `sha256Hex`) → arrastra `orders.ts`/`ports.ts` | ninguno (función usada sin cambios; los tipos no viajan) | **UNCHANGED** (redeploy opcional para igualar el bundle) |
| `update-order-status` | `_shared/orders.ts` (`canTransition`, `ORDER_STATUSES`) | ninguno | **UNCHANGED** (redeploy opcional) |
| resto (`auth-email-hook`, `bootstrap-tenant`, `catalog-copy`, `catalog-product`, `create-user`, `fulfillment-webhook`, `integration-worker`, `notifications-*`, `payments-webhook`, `platform-context`, `shopping-assistant`, `storefront-seo`) | no | ninguno | **UNCHANGED** |

`supabase/config.toml` sin cambios desde `dev` (`verify_jwt` intacto).

Orden: `checkout` justo después de la migración 7 (la función nueva llama a `my_effective_business_account_for_slug`
y a `checkout_place_order` con `p_purchase_order_number`: **no desplegarla antes de las migraciones 4 y 6**).

## 3 · Frontend (después de migraciones y functions)

- Build de la rama fusionada con Node 24 (ver `RUNTIME.md`; `.npmrc` `engine-strict=true` hace fallar `npm ci` con
  Node < 22.12).
- Variables públicas: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (sin ellas no se genera `_headers`/CSP).
- **No publicar el frontend antes de la migración 6**: la ficha de pedido del backoffice selecciona
  `orders.purchase_order_number` y fallaría contra una base sin la columna.

## 4 · Auth (Supabase, consola de QAS)

- [ ] *Authentication → URL Configuration → Redirect URLs*: añadir `https://<host-de-la-vitrina>/**`.
  Lo usan la confirmación del alta (`emailRedirectTo` → `/s/<slug>/…`) y la recuperación
  (`/nueva-clave?returnTo=…`). Sin la entrada, Auth redirige a la *Site URL* y se pierde la vuelta a la tienda.
- **No verificado ni configurado desde este repositorio.**

## 5 · Hosting (AWS Amplify, consola)

- [ ] **Reescritura de SPA** (*Rewrites and redirects*): toda ruta sin extensión de recurso → `/index.html` con
  **200 (Rewrite)**, p. ej. origen
  `</^[^.]+$|\.(?!(css|gif|ico|jpg|jpeg|js|json|map|png|svg|txt|webp|woff|woff2|ttf)$)([^.]+$)/>` → destino
  `/index.html`. Sin ella, recargar `/s/<slug>/…` da 404 (visto en QAS: `DEMO_WEDNESDAY_README.md`).
- [ ] Node 24 en el build (ver `RUNTIME.md`).
- `customHttp.yml` (en el repo) ya define `index.html` sin caché y `/assets/**` inmutable.
- **No verificado ni configurado desde este repositorio.** Verificación posterior, solo lectura:
  `QAS_BASE_URL=https://<host> QAS_STORE_SLUG=miquimica npm run smoke:qas` → `QAS_READ_ONLY_SMOKE = PASS`.

## 6 · Verificación posterior (solo lectura)

1. `npm run smoke:qas` con `QAS_BASE_URL` → PASS (rewrite, recursos, sin 5xx).
2. `DEMO_*_EMAIL=… node scripts/demo-preflight.mjs miquimica` → `DEMO_PREFLIGHT_RC = PASS` (usuarios de demo creados
   por el operador, fuera de este RC).
3. `npx playwright test --project=escritorio --project=movil` contra QAS (no crean datos). **Nunca** `comercio-*`
   contra QAS: crean usuarios y pedidos.

## 7 · Si algo falla: roll-forward, nunca rollback destructivo

- **Detener el despliegue** en el paso que falló. No publicar functions ni frontend si una migración no terminó.
- Una migración que falla dentro de un archivo: el endpoint de consultas ejecuta el archivo en una sola petición;
  comprobar por objetos si quedó aplicada parcialmente (tabla/función/columna de la fila de la tabla de arriba) antes
  de reintentar. Varias de estas migraciones **no son re-ejecutables tal cual** (`create table`, `add column`,
  `add constraint`): no repetir a ciegas.
- Corregir con una **migración nueva posterior** (forward) o un hotfix de la función; nunca editar una migración ya
  aplicada ni hacer `drop` de tablas con datos (`order_buyers`, `buyer_account_selections`, `consumer_addresses`,
  `orders.purchase_order_number`).
- Functions: redeploy de la versión anterior de `checkout` solo si las migraciones 4 y 6 NO se aplicaron (la función
  anterior llama a `checkout_place_order` sin `p_purchase_order_number`, que tras la migración 6 sigue resolviendo por
  valor por defecto; la anterior toma `rows[0]` de `my_business_accounts`, que sigue existiendo).
- Frontend: volver al build anterior es seguro mientras la base tenga la columna (el anterior no la lee).
- Registrar el incidente en `docs/STATE.md` y avisar por el buzón de coordinación si afecta a otra app de la suite.
