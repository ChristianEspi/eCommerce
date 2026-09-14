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
