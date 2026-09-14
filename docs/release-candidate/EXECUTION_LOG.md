# Execution log — Release Candidate (tercera noche)

Rama `feature/demo-commerce-release-candidate` (desde `feature/demo-commerce-hardening-v2` @ `4c1b511`). Sin push,
sin PR, sin despliegue, sin escrituras en DEV/QAS.

## R00
Status: PASS · Commit: `affc7e1` · Detalle: [`BASELINE.md`](BASELINE.md)
Unit 3 922/3 922 · DB 2 252/2 252 · build 1 700 módulos · bundle 402,3/386,2/404,6/360,7 · secrets PASS ·
E2E 56/56 (config local en el puerto 5199: el 5173 lo usa otro proyecto) · audit 4 moderadas.

## R01
Status: PASS
Files: `supabase/functions/_shared/checkout/dbPorts.ts` (`validateDelivery` llama a `delivery_options_for_slug` con
`caller`), `src/features/storefront/commerce/accounts.ts` (cambiar de cuenta invalida `['storefront','delivery']`),
`supabase/tests/delivery-buyer-pricing.test.ts` (nuevo), `commerce-context-bar.test.tsx` (+1).
Diseño: sin parámetro nuevo, sin `business_account_id`, firma de `delivery_options_for_slug` intacta (ya concedida a
`anon`/`authenticated`). `caller` es el cliente anónimo para el invitado y el del JWT con sesión, así que
`ebim.pricing_actor` resuelve la cuenta efectiva igual que en `create_order`. Las operaciones privilegiadas siguen con
`service`.
Tests: `delivery-buyer-pricing.test.ts` 8 — invitado y consumidor envío gratis (precio público); comercio y empresa
pagan envío (umbral con su precio) = `shipping_total` del pedido; multi-cuenta A paga / B gratis en cotización y
pedido; la RPC va por `caller`; argumentos solo tienda/dirección/items; firma intacta.
**RED/GREEN**: con el código anterior fallan 4 de 8 (comercio, empresa y multi-cuenta cotizaban `0.00` frente a
`15.00` cobrados; la llamada iba por `service`). Con el arreglo 8/8. La invalidación de entrega al cambiar de cuenta
también falla sin la línea nueva (1 de 12) y pasa con ella.
Regresión: checkout-orchestrator, checkout-buyer-link, fulfillment, effective-business-account, purchase-order,
targeted-promotions y storefront completo: 51 archivos · 800 ✓. Lint PASS.
E2E: comercio-escritorio + comercio-móvil 32/32 con la función `checkout` sincronizada en la pila local.
Impacto corregido: el total que el checkout autorizaba en pasarela, el tope por persona y el umbral de aprobación
incluían un envío distinto del que cobraba `create_order` para Trade/Enterprise.
Commit: `99adc5b`

## R02
Status: PASS
Files: `scripts/gen-db-types.mjs` (opción `DB_TYPES_DB_URL`, solo hosts locales; sin ella sigue `--linked`),
`src/shared/lib/database.types.ts` (regenerado), `src/shared/lib/db-schema.ts` (`satisfies FunctionName` en las
constantes de H14 y N01–N06).
Generación: `DB_TYPES_DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres npm run db:types` contra la pila
local con las 156 migraciones hasta `20260913160000`. **Nunca contra DEV/QAS** (el script de siempre usa `--linked`;
por eso se añadió la opción local y un `DB_TYPES_DB_URL` remoto se rechaza).
Diff revisado: +204/−15. Añadidos: tablas `order_buyers`, `buyer_account_selections`, `consumer_addresses`;
`orders.purchase_order_number` (Row/Insert/Update); `public_stores.default_country`; RPC `my_consumer_orders`,
`my_consumer_order_detail`, `my_checkout_profile`, `checkout_link_order_buyer`, `my_commerce_context`,
`my_store_business_accounts`, `select_store_business_account`, `my_effective_business_account_for_slug`,
`my_consumer_addresses`, `save_my_consumer_address`, `delete_my_consumer_address`,
`set_default_my_consumer_address`. Las 15 líneas «quitadas» no son objetos: 10 son formato del generador y 5 el bloque
`__InternalSupabase.PostgrestVersion`, que el modo `--db-url` no emite (ningún `createClient<Database>` lo usa).
El archivo anterior era de `8fe8cd1` (antes de H14).
Tests: `npm run test` 206 archivos · 3 931 ✓ · `npm run test:db` 88 · 2 260 ✓ (incluye `delivery-buyer-pricing`).
Typecheck: PASS · Lint: PASS
Commit: `6c9eb87`

## R03
Status: PASS
Files: `.nvmrc` (`24`), `.npmrc` (`engine-strict=true`), `docs/release-candidate/RUNTIME.md`.
Mínima ≥ 22.12 (sin cambios), recomendada 24, usada 24.20.0. `npm ci` en copia aislada: Node 20 → EBADENGINE;
Node 24 y 25 → 414 paquetes. Amplify: no se modificó (su build spec vive en la consola); fijar Node 24 queda en el
checklist de despliegue.
Commit: `4bcb401`

## R04
Status: PASS
Files: `docs/release-candidate/DEPENDENCY_AUDIT.md`.
4 moderadas (2 advisories de fondo): React Router 6.30.6 (runtime; open redirect por `\` — no explotable: todas las
entradas externas pasan por `isInternalPath`/`safeHref`, con tests; SSR hydration — no aplicable, SPA sin SSR) y
Vitest 3.2.7 (dev-only, no aplicable a producción). Sin PATCH/MINOR disponibles (instaladas = últimas de su major);
no se tocaron dependencias ni se usó `--force`. 0 HIGH/CRITICAL.
Commit: `26d0c3c`

## R05
Status: PASS
Files: `scripts/qas-smoke.mjs` (nuevo, `npm run smoke:qas`), `scripts/qas-smoke.test.mjs` (9).
Solo GET al alojamiento; ni Supabase, ni login, ni checkout. Variables `QAS_BASE_URL`, `QAS_STORE_SLUG`,
`QAS_DEEP_LINK`; sin `QAS_BASE_URL` → `QAS_READ_ONLY_SMOKE = NOT_RUN` (código 0). Comprueba `/`, `/s/:slug`,
`/s/:slug/cart`, `/login` y el deep link configurado reciben el shell del SPA (un 404/403 se reporta como «el
alojamiento no reescribe las rutas del SPA»), recursos del build (JS/CSS con tipo correcto y no servidos como
`index.html`), favicon, ningún 5xx, y avisa si `index.html` se cachea. Rechaza `http` fuera de localhost.
Tests contra alojamientos simulados: sano → PASS y solo GET; sin rewrite → FAIL con motivo; recurso servido como HTML
→ FAIL; 502 → FAIL; caché → AVISO; http remoto → rechazado; el fuente no tiene métodos de escritura ni cliente de
Supabase. Prueba real contra `vite preview` del build en localhost: 16/16 OK → PASS.
Contra QAS: `NOT_RUN` (no hay `QAS_BASE_URL` en esta máquina).
Commit: `d1ee316`

## R06
Status: PASS
Files: `docs/release-candidate/DEPLOYMENT_MANIFEST.md`.
Base, Node y hash del lock; 7 migraciones en orden con SHA-256; Edge Functions clasificadas por cierre de imports de
cada `index.ts` contra los archivos cambiados desde `dev` (`1bcf74f`): `checkout` REQUIRED; `create-order`
RECOMMENDED (rechaza OC en líneas); `api` y `update-order-status` UNCHANGED (importan `_shared` cambiado sin cambio de
comportamiento); resto UNCHANGED. Frontend después de migraciones y functions (el backoffice lee
`orders.purchase_order_number`). Auth Redirect URLs y reescritura de SPA de Amplify documentadas como pendientes,
sin afirmar que estén configuradas. Roll-forward sin rollback destructivo. Búsqueda de sintaxis exclusiva de
Postgres ≥ 16 en las siete migraciones: ninguna (DEV/QAS usan 15).
Commit: `69bc48c`

## R07
Status: PASS
Files: `scripts/demo-preflight.mjs` (ampliado, veredicto `DEMO_PREFLIGHT_RC`).
Huecos detectados frente al contrato y cerrados: crédito cuando el guion lo enseña (`DEMO_ENTERPRISE_SHOWS_CREDIT`),
precios distintos por cuenta en MULTI cuando el guion depende de ello (`DEMO_MULTI_PRODUCT_SLUG`, con
`ebim.resolve_price` sobre el cliente/segmento de cada cuenta), y filas AUTH «NO VERIFICABLE» (Redirect URLs y
reescritura de SPA) que informan sin bloquear y remiten al manifiesto y a `npm run smoke:qas`. Ya cubría: tienda,
tema, catálogo, categorías, stock, entrega, pago, país, consumidor sin cuenta, trade/enterprise (cuenta efectiva,
vínculo, lista, producto demostrable, bloqueo), OC según guion, MULTI 2+ con selección válida, campaña dirigida.
Solo lecturas; correos enmascarados; ningún secreto.
Pila local con los cinco usuarios: todo el contrato OK (crédito 50 000 / 30 días; Andina 14,90 vs Boreal 8,20;
campaña `business_account`); FAIL solo por los 6 umbrales de catálogo del seed local → veredicto correcto.
Negativos comprobados: OC exigida con guion «no», mismo precio en las dos cuentas y campaña inexistente → FALTA.
Contra DEV/QAS: no ejecutado (sin `.env`).
Commit: `f2a5927`

## R08
Status: PASS
Files: `docs/release-candidate/VISUAL_QA.md`, `docs/release-candidate/visual/*.png` (6 capturas, 884 kB).
36 combinaciones (4 temas × 3 audiencias × 3 viewports), 5 páginas por combinación: **792/792 comprobaciones OK**
(desbordamiento, cabecera, pie, categorías, tarjetas, barra de contexto, selector, precio comercial, carrito,
checkout 1–3, OC, portal/cuenta, pestañas alcanzables, consola limpia). Tema de la tienda local restaurado al terminar.
Sin cambios de diseño (ningún defecto observado).
Commit: `349203f`

## R09
Status: PASS
Files: `docs/release-candidate/PERFORMANCE.md`.
`bundle:report`: 402,3/405 · 386,2/400 · 404,6/430 · 360,7/430 (idéntico a R00). Análisis por chunk y desglose de la
entrada por sourcemap. Probado importar capacidades sin el barril `@/domain` para sacar `zod` de la entrada: 402,8
(peor) → revertido. Sin cambios de código; techos intactos.
