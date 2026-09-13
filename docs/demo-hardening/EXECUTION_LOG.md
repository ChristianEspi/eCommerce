# Execution log — hardening multi-commerce

Rama `feature/demo-commerce-hardening-v1` (desde `dev` @ `1bcf74f`). Sin push, sin PR, sin despliegue.

> **Nota de medición.** `npm run test` ejecuta `vitest run` sin `include`, así que **incluye** los
> archivos de `supabase/tests`. Las cifras de «unit» son la suite completa; «DB» es el subconjunto
> `npm run test:db`. Los 6 fallos conocidos son los de `BASELINE.md` (Node 24 + `AbortSignal` de
> jsdom, y la falta de `.env`).

## H00

Status: PASS_WITH_KNOWN_BASELINE_ISSUE

Commit: `794652d`

Changes: `docs/demo-hardening/BASELINE.md`.

Tests: 187 archivos · 3 692 tests · 3 686 ✓ · 6 ✗ (KNOWN_BASELINE_FAILURE).

Typecheck: PASS · Lint: PASS · DB: 77 archivos · 2 131 ✓ · Build: PASS

E2E: no ejecutable (sin `.env`).

Notes: los 6 fallos se reprodujeron aislados y pasan con Node 20 + variables `VITE_*` ficticias.

## H01

Status: PASS

Commit: `8264971`

Changes:
- `docs/demo-hardening/COMMERCIAL_CONTEXT_AUDIT.md` — ruta real del precio y hallazgos A1–A6.
- `src/features/storefront/commerce/audience.ts` — `CommerceAudience` presentacional.
- Guardas: `audience.test.ts` (10) y `supabase/tests/commerce-audience-guard.test.ts` (7).

Tests: 35/35 en los archivos tocados (+ `architecture.test.ts`).

Typecheck: PASS · Lint: PASS · DB: guardia nueva verde · E2E: n/a

Notes: la guardia de cuerpo del checkout cazó un fixture mío mal formado (`line1`) y un test que podía
pasar por la razón equivocada; se corrigieron exigiendo el código `CAMPO_NO_PERMITIDO`.

## H02

Status: PASS

Commits: `1cde051` (servidor) · `54d28c3` (pantallas, compartido con H03)

Changes:
- Migración `20260913100000_consumer_account.sql`: `order_buyers` + `checkout_link_order_buyer`
  (solo `service_role`) + `my_consumer_orders`, `my_consumer_order_detail`, `my_checkout_profile`.
- `_shared/checkout/dbPorts.ts`: vínculo post-pedido con el usuario verificado, best-effort.
- `/account` sin cuenta de empresa activa → `ConsumerAccount` (Hola, Mis pedidos, Mis favoritos,
  Mis datos, Mis direcciones, Avisos). Portal B2B intacto.

Tests: `consumer-account.test.ts` (20, Postgres real), `checkout-buyer-link.test.ts` (6),
`consumer-account.test.tsx` (9), `customers-ui.test.tsx` reescrito para el estado «sin vínculo»
(ahora exige la cuenta de consumidor y la ausencia de pestañas B2B).

Typecheck: PASS · Lint: PASS · DB: 79 archivos · 2 158 ✓ · E2E: n/a

Notes: un `test:db` falló a mitad por un número de pedido repetido entre tiendas en MI helper (el
número es único por tienda) y por el trigger de inmutabilidad de `orders`; se corrigió el test.

## H03

Status: PASS

Commit: `54d28c3`

Changes: `MyOrdersSection`/`MyOrderDrawer` con `source="consumer"`, entrega y dirección en el detalle;
«Volver a comprar» con `cart/addLinesToCart.ts` (compartido con los sugeridos): relee el catálogo de
hoy y el carrito recotiza; el precio histórico no viaja.

Tests: incluidos en `consumer-account.test.tsx`; `my-suggestions.test.tsx` sigue verde tras extraer
el helper.

Typecheck: PASS · Lint: PASS · DB: — · E2E: n/a

## H04

Status: PASS

Commit: `8942b8d`

Changes: `useCheckoutPrefill` + chips de direcciones guardadas en el paso de entrega. Solo rellena
campos vacíos; la dirección se ELIGE. Invitado sin cambios. Mis datos edita nombre y teléfono en
`user_metadata` (nada lo usa para autorizar).

Tests: 4 nuevos en `checkout-ui.test.tsx` (47/47).

Typecheck: PASS · Lint: PASS · DB: — · E2E: n/a

Notes: no hay libreta de direcciones editable del consumidor (el único modelo es el de clientes B2B,
administrado por el comercio). Follow-up documentado.

## H05

Status: PASS

Commit: `10b1005` (compartido con H06)

Changes: migración `20260913110000_commerce_context.sql` (`my_commerce_context`), barra
`CommerceContextBar` (trade: «Cuenta comercial · … · Condiciones comerciales activas»), corrección A3
del chip «Precio especial» (solo listas de segmento/cliente).

Tests: `commerce-context.test.ts` (12, Postgres real, incluye que nombra la misma cuenta que
`ebim.pricing_actor`), `commerce-context-bar.test.tsx` (7), `cart-quote.test.tsx` (+2; el fixture del
«acuerdo» pasa de ámbito `store` a `segment`, que es lo que es un acuerdo, y se añade el caso `store`
que NO debe anunciarse).

Typecheck: PASS · Lint: PASS · DB: 81 archivos · 2 176 ✓ · Build: PASS

Unit (suite completa): 194 archivos · 3 769 tests · 3 763 ✓ · 6 ✗ = los 6 de baseline.

E2E: n/a

Notes: una ejecución intermedia dio 11 archivos rojos porque escribí la migración mientras la suite
corría (primera versión con `INTO` de tres registros, inválido en PL/pgSQL). Corregida y re-medida
entera: no queda nada de eso.

## H06

Status: PASS

Commit: `10b1005`

Changes: enterprise en la misma barra («Comprando para · … · Precio convenio activo» solo si el
servidor informa lista vigente). Portal, crédito, pedidos, sugeridos y avisos sin tocar.

Tests/Typecheck/Lint/DB: ver H05.

Notes: **multi-cuenta**: no se construye selector. La barra y el precio usan la cuenta más antigua de
la sociedad; el checkout sigue tomando `rows[0]` de `my_business_accounts()` (hallazgo A1). Para la
demo: una cuenta activa por usuario.
