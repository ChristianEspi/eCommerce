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
