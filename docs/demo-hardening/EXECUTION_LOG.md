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

## H07

Status: PASS

Commits: `3083925` (sección) · `7de29e0` (presupuesto de rendimiento)

Changes:
- `categories` deja de devolver `null`: familias raíz reales del tenant como puertas al catálogo
  filtrado, reutilizando `CategoryDoorGrid` del bloque CMS. Misma consulta que la cabecera.
- Apagada por defecto en los cuatro temas (compatibilidad); el editor de Diseño ya permite encenderla.
- Tests en tabla de ocho rubros × cuatro temas, sin ramas por industria.
- **Presupuesto de bundle**: la portada ya medía 399,5/400 kB en baseline. La barra de contexto
  (H05) la llevó a 400,9. Se aplicó el orden de `performance-budget.md`: barra diferida y solo con
  sesión (400,4), copy recortado (400,3), sección diferida (sin ganancia, revertido) y, por último,
  techo 400 → 405 documentado en §2.1 con la tabla de mediciones.

Tests: `HomeComposer.test.tsx` (+2), `multi-industry.test.tsx` (+8), `storefront-design.test.tsx` (+1).

Typecheck: PASS · Lint: PASS · Build: PASS · bundle:report: PASS (405) · E2E: validado en H12 (390/1024/1440)

Notes: ampliar el diccionario de iconos por rubro (calzado, tecnología, ferretería…) costaba ~1,5 kB
en la cabecera; no se hizo. Las familias sin coincidencia usan el icono genérico. Follow-up.

## H08

Status: PASS

Commit: `0e99c94`

Changes: migración `20260913120000_store_default_country.sql` — `ebim.store_default_country` (país
de las zonas de entrega activas si todas coinciden; solo tiendas activas) y `public_stores` recreada
con `default_country` al final. El checkout lo usa como valor inicial. Sin columna nueva ni cambios
en Configuración; con base sin migrar o valor raro, nada cambia.

Auditoría del checkout para los tres públicos: **un solo checkout**. Consumidor y comercio siguen el
pipeline de siempre; la empresa añade aprobación/tope en la etapa 8 cuando su cuenta lo exige
(existente). Entrega, recojo, pago, cotización, stock, promociones e idempotencia: sin cambios de
código en H08; cubiertos por `checkout-ui.test.tsx`, `checkout-orchestrator.test.ts`,
`checkout-pipeline.test.ts` y los E2E de H09–H11. Hallazgos A1 (cuenta en multi-cuenta) y A2
(promociones dirigidas) siguen abiertos y documentados.

Tests: `store-default-country.test.ts` (9, Postgres real) · `checkout-ui.test.tsx` (+4).

Typecheck: PASS · Lint: PASS · DB: verde (incluye `storefront-theme`, `security-baseline`) · Unit: 3 787 ✓ / 6 conocidos

## H09

Status: PASS

Commit: `abfa5ef`

Changes: proyectos Playwright `comercio-escritorio` (1440) y `comercio-movil` (Pixel 5);
`e2e/commerce/consumer.e2e.ts` (invitado hasta confirmación; registrado hasta Mis pedidos, detalle y
Mis direcciones); `scripts/e2e-local-fixtures.mjs` (solo localhost).

Entorno E2E: **pila Supabase local propia** (`project_id ecommerce-hardening-local`, puertos 553xx,
Postgres 17 cacheado; DEV usa 15). Migraciones aplicadas una a una por `psql`; una sentencia
histórica (`alter table storage.objects enable row level security`) se omitió **solo en la copia
local** porque en Storage reciente la tabla no es del rol `postgres`. Funciones Edge servidas por el
edge-runtime local (incluye el `checkout` con el vínculo de H02).

E2E: 4/4 escritorio a la primera ejecución verde tras dos correcciones del propio test (la tarjeta
del catálogo abre vista rápida; el panel del pedido tapaba la pestaña) y un hallazgo de entorno: sin
el entitlement `pricing.lists` las listas se ignoran en silencio (añadido al fixture y al preflight).

## H10

Status: PASS

Commit: `675be02`

Changes: `e2e/commerce/trade.e2e.ts`. Precio público anónimo pedido al servidor para la misma
cantidad y comparado con el cobrado; ningún importe fijo; cuerpo del checkout sin claves de dinero ni
de identidad.

E2E: verde en escritorio y móvil.

## H11

Status: PASS

Commit: `4ae291b`

Changes: `e2e/commerce/enterprise.e2e.ts` hasta «Mis pedidos» del portal B2B. Crédito, sugeridos y
avisos no se afirman (dependen del tiempo).

E2E: en móvil falló por un defecto REAL: las 6 pestañas centradas del portal desbordaban a 390 px y
«Mis pedidos» quedaba inalcanzable. Corregido en `SectionTabs` (commit `db4a25a`). Tras eso, verde.

Notes: repetir la suite agota existencia y el limitador de checkout (429). El fixture los repone por
las puertas de servidor (`sync_inventory_level`, `purge_checkout_attempts`).

## H12

Status: PASS

Commits: `db4a25a` · `c4abc62`

Changes:
- `SectionTabs` desplazable con márgenes automáticos (centradas si caben).
- «Mis pedidos» legible en 390 px (fecha bajo el número, total visible).
- A3 tenía un segundo sitio: el resumen del checkout anunciaba «Precio especial» al consumidor. Regla
  única `cart/agreement.ts` para carrito, panel y resumen.
- `e2e/commerce/responsive.e2e.ts`: sin desbordamiento, un `h1`, pestañas del final alcanzables y
  barra de contexto con teclado, a 1440/1024/390.

Revisión visual con capturas a 1440/1024/390 de: portada con barra de comercio y sección de familias,
cuenta del consumidor, detalle de pedido, checkout con direcciones guardadas y portal B2B.
Desbordamiento horizontal medido: 0 px en las 12 combinaciones.

Notes: el botón flotante del asistente tapa la última fila de una lista al llegar al final en móvil;
es previo y no se tocó (follow-up).

## H13

Status: PASS

Commit: `0b6e594`

Changes: `scripts/demo-preflight.mjs` ampliado (no sustituido): grupos STORE / B2C / TRADE /
ENTERPRISE, veredicto `DEMO_PREFLIGHT = PASS|FAIL`, transporte local por `docker exec`, correos
enmascarados.

Ejecución contra la pila local con los tres usuarios de fixture: B2C, TRADE y ENTERPRISE **todo OK**;
STORE FALLA en 6 umbrales de catálogo (el seed local tiene 8 productos; los mínimos están pensados
para DEV, con ~570) → `DEMO_PREFLIGHT = FAIL`, que es el veredicto correcto para esa pila.

Contra DEV: **no ejecutado** (sin `.env` en esta máquina).

## H14

Status: PASS_WITH_KNOWN_BASELINE_ISSUE

Commit: `a4bb946` (último de código; este log y el informe van después)

Gates (de cero, en serie, sin tocar archivos mientras corrían):

| Gate | H00 | H14 |
|---|---|---|
| typecheck | PASS | PASS |
| lint | PASS | PASS |
| test (incluye `supabase/tests`) | 187 archivos · 3 692 · 3 686 ✓ · 6 ✗ | 196 archivos · 3 796 · 3 790 ✓ · 6 ✗ (los mismos 6) |
| test:db | 77 · 2 131 ✓ | 82 · 2 185 ✓ |
| build | PASS (1 680 módulos) | PASS (1 691 módulos) |
| bundle:report | (no medido en H00) | PASS · portada 400,3/405 |
| scan:secrets | (no medido en H00) | PASS, sin hallazgos |
| E2E | no ejecutable (sin `.env`) | **44/44** en pila local (escritorio 12, móvil 12, comercio-escritorio 10, comercio-móvil 10) |

Los 6 fallos siguen pasando con Node 20 + `VITE_*` ficticias (12/12), igual que en H00.

E2E existentes: con el entitlement `pricing.lists` activo, 6 pruebas de `golden-path`/`theme-engine`
fallaban porque la primera tarjeta de la portada pasa a abrir la vista rápida. **Con el código de
baseline (`1bcf74f`) y los mismos datos fallan igual** (y dos más), así que no es regresión; se
corrigió la fragilidad de las pruebas sin cambiar lo que verifican (commit `a4bb946`).

`git diff --check`: limpio. `git status`: solo `docs/quality/` sin seguimiento (previo, no tocado).
