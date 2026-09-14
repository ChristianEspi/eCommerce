# Execution log — hardening multi-commerce v2 (segunda noche)

Rama `feature/demo-commerce-hardening-v2` (desde `feature/demo-commerce-hardening-v1` @ `ec52bab`). Sin
push, sin PR, sin despliegue.

> **Nota de medición.** `npm run test` ejecuta `vitest run` sin `include`, así que incluye
> `supabase/tests`: «Unit» es la suite completa y «DB» el subconjunto `npm run test:db`.

## N00
Status: PASS_WITH_KNOWN_ISSUE
Commit: `6b30dad`
Files: `docs/demo-hardening-v2/BASELINE.md`, `docs/demo-hardening-v2/EXECUTION_LOG.md`
Tests: 196 archivos · 3 796 · 3 790 ✓ · 6 ✗ (los mismos 6 de H00/H14, verificados por nombre y causa)
Typecheck: PASS
Lint: PASS
DB: 82 archivos · 2 185 ✓
E2E: pila local reconstruida · ejecución 1: 43/44 · ejecución 2: 44/44
Bundle: PASS (portada 400,3/405)
Notes: el fallo E2E de la ejecución 1 es un defecto previo real (caché de `my_checkout_profile` tras la
primera compra); se corrige en N06. Secret scan PASS. Build 1 691 módulos.

## N01
Status: PASS
Commit: `41451ec`
Files: migración `20260913130000_effective_business_account.sql`; `_shared/checkout/{dbPorts,pipeline,ports}.ts`;
`storefront/commerce/{accounts.ts,CommerceContextBar.tsx}`; `StoreAccountPage.tsx`; i18n; `db-schema.ts`;
`scripts/e2e-local-fixtures.mjs` (usuario MULTI con dos cuentas); `e2e/commerce/multi-account.e2e.ts`.
Tests: `effective-business-account.test.ts` 23/23 (los 10 casos pedidos + superficie; checkout = `runCheckout`
con `createDbPorts` sobre PGlite); `commerce-context-bar.test.tsx` 11/11 (+4). Unit storefront/customers/pricing/shared:
781 · 780 ✓ · 1 ✗ (= baseline #6).
Typecheck: PASS
Lint: PASS
DB: 83 archivos · 2 208 ✓ (N00: 2 185)
E2E: multi-cuenta + trade + enterprise, escritorio y móvil: 6/6 en pila local
Bundle: PASS · portada 400,5/405 (+0,2: claves ES del selector y reparto de chunks). Se midió chunk a chunk contra
`6b30dad`; `ListItemIcon`/`ListItemText` salían a un chunk ansioso nuevo (+0,5) y se sustituyeron por `Box`.
Notes: `commerce-audience-guard` intacto (el cuerpo sigue rechazando `business_account_id`, `customer_id`,
`segment_id`, `price_list_id`, `audience`). `my_commerce_context` conserva exactamente su forma de respuesta.

## N02
Status: PASS
Commit: `65fe4f1`
Files: `StoreRegisterPage.tsx` (ruta `/s/:storeSlug/register`), `auth/{authApi,returnTo,passwordPolicy}.ts`,
`LoginPage`/`ForgotPasswordPage`/`ResetPasswordPage` store-aware, `StoreAccountPage` (Entrar + Crear cuenta con
vuelta), i18n; test helpers `supabaseMock` (`signUp`, `resetPasswordForEmail` espiables) y `render` (`liveSession`).
Tests: `returnTo.test.ts` 12, `store-register.test.tsx` 9, `store-aware-auth.test.tsx` 12,
`consumer-signup.test.ts` 4 (Postgres real: sin triggers en `auth.users`, alta sin tenant/membresía/cuenta/cliente),
`routes.test.tsx` (inventario de rutas: +`/register`, documentado en el test).
Typecheck: PASS
Lint: PASS
DB: `consumer-signup` 4/4 · `security-baseline` + `schema-invariants` verdes
E2E: `signup.e2e.ts` escritorio y móvil 2/2 (registro → tienda → Mi cuenta; salir → /account → Entrar → /account;
por servicio en local: sin `tenant_members` ni `business_account_users`, metadatos solo nombre y teléfono)
Bundle: PASS · portada 400,9/405 (+0,4: claves ES del registro)
Notes: el redirect de confirmación (`emailRedirectTo`) y el de recuperación (`/nueva-clave?returnTo=`) exigen que
Supabase Auth de QAS admita `https://<host>/**` en Redirect URLs (anotado en el plan de despliegue). Primera pasada
E2E tras añadir iconos nuevos: Vite re-optimiza dependencias a mitad de sesión («Invalid hook call»); se repite y pasa
(artefacto del servidor de desarrollo, se aborda en N08/N09).

## N03
Status: PASS
Commit: `f75d441`
Files: `storefront/commerce/{catalogPrices.ts,catalogQuote.ts,keys.ts,context.ts}`; `ProductCard`, `ProductGrid`,
`ProductRow`, `OffersFeaturedBand`; i18n (2 claves); `e2e/commerce/multi-account.e2e.ts` (+1 escenario).
Tests: `catalog-prices.test.tsx` 8 (invitado 0 peticiones; consumidor solo el contexto compartido con la barra y 0
cotizaciones; N tarjetas = 1 cotización sin variantes ni identidad; menor → etiqueta, igual → nada; empresa
«Precio convenio»; fallo → precio público; carrito recibe el producto tal cual; cambio A/B recotiza). Storefront +
pricing: 688 · 687 ✓ · 1 ✗ (= baseline #6).
Typecheck: PASS
Lint: PASS
DB: sin cambios de esquema (reutiliza `price_quote_for_slug`, lote ≤ 100)
E2E: multi-cuenta 4/4 (escritorio y móvil): tarjeta con «Tu precio comercial» al elegir B, cotizaciones en lote
(< nº de tarjetas, ninguna de una línea por tarjeta) y vuelta a A quita el precio de B.
Bundle: PASS · portada 401,8/405. Primera versión 402,5 (hook + contexto con zod-free en la ruta); se partió en
`catalogPrices.ts` (ansioso, ~0,6 kB) y `catalogQuote.ts` (import dinámico solo con sesión) → +0,9 kB netos.
Notes: `my_commerce_context` deja de validarse con zod (validación manual equivalente) para no arrastrar zod a la
portada; misma clave de caché que la barra, así que la rejilla no añade peticiones de contexto.

## N04
Status: PASS
Commit: `9fedd17`
Files: migración `20260913140000_promotion_quote_buyer_identity.sql` (recrea `promotion_quote_for_slug` con la
misma firma); `scripts/e2e-local-fixtures.mjs` (campaña dirigida a la cuenta Boreal);
`e2e/commerce/targeted-promotion.e2e.ts`; `support.ts` (tipos del pedido).
Tests: `targeted-promotions.test.ts` 8/8 — preview (`promotion_quote_for_slug` con la sesión) = pedido
(`runCheckout` + `createDbPorts`) para `all`, `segment`, `customer`, `business_account`; usuario equivocado, invitado
y consumidor sin descuento dirigido; la cuenta elegida en N01 cambia la campaña. **Sin la migración fallan 4 de 8**
(segment, customer, business_account y A/B): el test prueba el arreglo. Regresión: `promotions-checkout`,
`promotions`, `security-baseline` (techo de sondeo de cupones), `pricing-checkout`, `checkout-orchestrator`,
`public-rpc-gates`: 239/239. El descuento en el carrito ya lo cubre `cart-quote.test.tsx` («Descuento» desde la
cotización del servidor).
Typecheck: PASS
Lint: PASS
DB: verde en los archivos tocados y los de promociones/seguridad
E2E: promoción dirigida escritorio y móvil 2/2 (Andina sin «Descuento»; Boreal lo ve antes de confirmar; el pedido
cobra el mismo `discount_total` y el mismo total sin envío) + multi-cuenta 4/4
Bundle: sin cambios de frontend
Notes: la cotización no conoce el correo del checkout; los topes por cliente contados por correo siguen
decidiéndose al crear el pedido (comportamiento previo, documentado en la migración). `create_order` y los
cerrojos no se tocan.

## N05
Status: PASS
Commit: `e791100`
Files: migración `20260913150000_purchase_order_number.sql` (`orders.purchase_order_number` con CHECK e inmutable;
`create_order` y `checkout_place_order` recreadas con `p_purchase_order_number`; `purchase_order_number` en la lista
negra de líneas; `my_business_order_detail` la devuelve); borde: `request.ts` (campo permitido, validado, en el
resumen de idempotencia), `orders.ts` (prohibido en líneas), `pipeline.ts` (aviso temprano antes de cobrar),
`errors.ts` (422), `dbPorts.ts`, `checkout/index.ts` (respuesta); vitrina: campo obligatorio en el paso de pago solo
si la cuenta lo exige, confirmación, portal B2B; backoffice: `OrderDrawer`.
Tests: `purchase-order.test.ts` 13 (sin OC → `ORDEN_COMPRA_REQUERIDA` antes de cobrar y sin pedido; OC en blanco =
ninguna; `create_order` directo también la exige; con OC se guarda normalizada y vuelve en la respuesta y en el
portal; >60/controles → `ORDEN_COMPRA_INVALIDA` en borde y base; inmutable; cuenta sin exigencia, consumidor e invitado
intactos; OC en línea → `CAMPO_NO_PERMITIDO`; misma clave + otra OC → `IDEMPOTENCIA_EN_CONFLICTO`; cuerpo sigue
rechazando identidad comercial; 422). `checkout-orchestrator` +2 (se detiene antes de `authorizePayment`/`placeOrder`;
la OC llega a la transacción). `checkout-ui` +3, `OrdersPage` +1, `portal-orders` +1.
Tests modificados: `checkout-orchestrator` «lo que responde llega a la transacción» manda ahora una OC (su cuenta
simulada tiene `purchaseOrderRequired: true`, que desde N05 exige OC; la aserción no cambia).
`checkout-order` «una tasa caducada no se aplica»: **flake de reloj previo** — fallaba 3/3 aislado también en
`65fe4f1` (N02) porque alta y cierre de la tasa caían en el mismo instante (`valid_to = valid_from`, CHECK
`tax_rates_period`). La tasa ahora empieza ayer; la aserción (`tax_total = 5.00`) no cambia.
Typecheck: PASS
Lint: PASS
DB: 86 archivos · 2 235 ✓
Unit (src): 1 648 · 1 642 ✓ · 6 ✗ (= los 6 de baseline)
E2E: enterprise 4/4 (con OC obligatoria: sin OC la pantalla no deja confirmar y lo dice; con OC pedido, confirmación y
portal la enseñan; llamada directa al checkout sin OC → 422 `ORDEN_COMPRA_REQUERIDA`) + multi-cuenta y trade 6/6.
El E2E encontró un defecto real antes de commitear: el borde respondía 500 para `ORDEN_COMPRA_REQUERIDA` (código sin
status); corregido a 422.
Bundle: PASS · portada 402,0/405 · checkout 404,0/430
Notes: el fixture local pone `purchase_order_required = true` en la cuenta E2E-CORP (escenario enterprise con OC).

## N06
Status: PASS
Commit: `fce704e`
Files: migración `20260913160000_consumer_addresses.sql` (`consumer_addresses` por usuario + tienda, RLS forzada sin
GRANT de cliente, una predeterminada por índice único parcial, máx. 20; `my_consumer_addresses`,
`save_my_consumer_address`, `delete_my_consumer_address`, `set_default_my_consumer_address`);
`consumer.ts` (API + `mergeAddresses`), `useCheckoutPrefill.ts` (libreta primero, historial sin duplicar),
`ConsumerAddressesSection.tsx` (agregar/editar/eliminar con confirmación/predeterminada; «Usadas en tus pedidos» con
«Guardar en mi libreta»), `StoreCheckoutPage.tsx` (chips con nombre; invalidación de perfil, pedidos y libreta tras
el pedido), i18n; `e2e/commerce/signup.e2e.ts` (+1 escenario, +1 comprobación), `support.ts` (elegir dirección).
Tests: `consumer-addresses.test.ts` 17 (CRUD propio, marca única, aislamiento por usuario, por tienda del mismo tenant
y por tenant, claves ajenas → `CAMPO_NO_PERMITIDO`, validación, tope, `anon` sin EXECUTE, tabla sin acceso directo,
firmas sin usuario). `consumer-account.test.tsx` 16 (+7 de libreta); los 2 de H04 declaran ahora la libreta: uno
simula base SIN libreta (sigue enseñando las de pedidos con «Última»), otro libreta vacía. `checkout-ui` +1 (libreta
primero con nombre, historial deduplicado, se elige, comprar no guarda).
Typecheck: PASS
Lint: PASS
DB: 87 archivos · 2 252 ✓
E2E: consumer + signup escritorio y móvil 8/8: registro → libreta «Casa» → checkout eligiendo «Casa · …» → pedido →
Mis pedidos → libreta intacta sin duplicado. **Defecto de N00 corregido y probado** con cuenta recién creada: primera
compra → «Mis direcciones» la enseña al momento (el checkout invalida `checkoutProfileKey`).
Bundle: PASS · portada 402,3/405 (+0,3, claves ES). Se evitaron dos chunks ansiosos nuevos medidos contra `e791100`
(`AddRounded` y `useMediaQuery` partidos por Rollup): sin icono en «Agregar» y diálogo a pantalla completa por CSS.
Notes: guardar desde el checkout NO se implementó (opcional); se guarda desde «Mis direcciones», incluida la acción
«Guardar en mi libreta» sobre una dirección ya usada.

## N07
Status: PASS
Commit: `6df57d2`
Files: `StorefrontLayout.tsx` (el asistente no flota en `/checkout`; `bottom` con `env(safe-area-inset-bottom)`;
holgura bajo el pie en xs), `BackToTop.tsx` (safe-area), `checkout-ui.test.tsx` (+1).
Revisión (script de Playwright fuera del repo, 390×844, pila local): se midió qué elementos quedan bajo el botón del
asistente. Al final del scroll, ninguno; pero **en el checkout tapaba «Siguiente» (paso 1) y el campo de orden de
compra (paso 3)** — defecto real, corregido quitando el botón en esa ruta. En portal y catálogo solo cubre filas de
paso mientras se desplaza (propio de un botón flotante; al final del scroll todo queda libre).
Revisado sin cambios necesarios: selector multi-cuenta con nombre largo (menú a dos líneas, botón recortado con
`title`), tarjeta con precio comercial + tachado + etiqueta en 2 columnas, OC en móvil (ancho completo), libreta
(diálogo a pantalla completa), registro. Desbordamiento horizontal medido: 0 px en registro, portada, catálogo y portal.
Tests: `checkout-ui` 56/56, `storefront-ui` + `layout-theme` verdes.
Typecheck: PASS · Lint: PASS
E2E: `theme-engine` + `responsive` (escritorio, móvil, comercio-*) 20/20 → los 4 temas siguen verdes.
Bundle: portada 402,3/405 (sin cambio).

## N08
Status: PASS
Commit: `ffbc4f7`
Files: `src/test/jsdom-environment.ts` (entorno de Vitest = jsdom + puente de `AbortSignal`), `vite.config.ts`
(`test.environment` apunta a él), `src/app/auth-flow.test.tsx` y `src/features/storefront/landing.test.tsx`
(`vi.mock('@/shared/lib/env')` con `isSupabaseConfigured: true`), `package.json` (`engines.node >= 22.12`).
Causa raíz (reproducida en Node 24.20): el `Request` global es el de undici y exige un `AbortSignal` de Node; el
entorno jsdom de Vitest pone el `AbortController` de jsdom; `createMemoryRouter` construye un `Request` con esa señal
en cada navegación → `RequestInit: Expected signal ... to be an instance of AbortSignal`. No era React Router ni el
producto: es la frontera jsdom/undici. Fix solo de entorno de pruebas: se guardan las clases de Node antes de montar
jsdom y `Request` convierte una señal ajena en una de Node que se aborta con ella (misma cancelación, mismo motivo).
Ninguna dependencia actualizada y ningún cambio de runtime.
Los 2 de configuración: `default-store.ts` solo consulta si `isSupabaseConfigured`; sin `.env` era `false`. Las
pruebas usan un backend falso, así que se fija la bandera por mock (sin secretos, sin red, sin `.env`).
Tests: `npm run test` = **205 archivos · 3 922 ✓ · 0 ✗ · 0 errores no controlados** (N00: 3 790 ✓ / 6 ✗ / 4 errores).
Sin `skip`, sin aserciones rebajadas. Verificado además en Node 25.9 y Node 20.20 (los 3 archivos afectados 19/19).
Typecheck: PASS · Lint: PASS
Notes: `engines` declara Node ≥ 22.12 (LTS vigentes 22 y 24; Node 20 está fuera de soporte desde 2026-04 y no se fija).

## N09
Status: PASS
Commit: sin cambios de código propios (cada escenario se commiteó con su fase: N01 `41451ec`, N02 `65fe4f1`,
N03 `f75d441`, N04 `9fedd17`, N05 `e791100`, N06 `fce704e`); este registro va con N10.
Files: `e2e/commerce/{multi-account,signup,targeted-promotion}.e2e.ts` (nuevos), `enterprise.e2e.ts` (OC),
`support.ts`, `scripts/e2e-local-fixtures.mjs` (usuario MULTI, campaña dirigida, E2E-CORP con OC).
E2E (pila local, fixtures repuestas, `npx playwright test` completo): **56/56** — escritorio 12 · móvil 12 ·
comercio-escritorio 16 · comercio-móvil 16 (H14: 44).
Cobertura pedida: multi-cuenta (selector → barra = B → ficha = B → carrito = B → pedido cobrado a B → portal con B);
alta de consumidor (tienda → crear cuenta → Mi cuenta → libreta → checkout con su dirección → pedido → Mis pedidos);
precio comercial en catálogo (lotes, sin N+1 observable, A/B actualiza); promoción dirigida (carrito la enseña, pedido
cobra el mismo descuento); OC (sin OC la pantalla no deja y lo dice; con OC pedido + confirmación + portal; llamada
directa sin OC → 422). Escritorio y móvil en todos. **Nada contra DEV/QAS.**
Notes: la promoción dirigida en E2E es de audiencia `business_account`; `segment` y `customer` se prueban en
Postgres (`targeted-promotions.test.ts`). Al añadir imports nuevos con un servidor de desarrollo ya arrancado, Vite
re-optimiza dependencias y la primera pasada puede dar «Invalid hook call»; en un arranque limpio no ocurre.

## N10
Status: PASS
Commit: `71e95fc`
Files: `scripts/demo-preflight.mjs` (ampliado, no sustituido).
Nuevas comprobaciones: migraciones N01–N06 (8 funciones, 2 tablas, `orders.purchase_order_number`,
`promotion_quote_for_slug` con cuenta efectiva); cuenta EFECTIVA de TRADE/ENTERPRISE (varias cuentas ya no es
fallo: informa cuántas, cuál y si la elección guardada es válida); OC obligatoria contra
`DEMO_ENTERPRISE_REQUIRES_PO`; grupo MULTI (`DEMO_MULTI_EMAIL`: 2+ cuentas, efectiva, sin elección inválida);
grupo PROMOS (`DEMO_TARGETED_PROMO_CODE`: activa, vigente, audiencia dirigida). Siguen: tema, categorías,
entrega/pago, país, stock, addon `pricing.lists`. Veredicto `DEMO_PREFLIGHT_V2 = PASS|FAIL`; correos enmascarados,
sin contraseñas.
Ejecución contra la pila local con los cinco usuarios de fixture: STORE (migraciones, tema, addon), B2C, TRADE,
ENTERPRISE (OC exigida = guion), MULTI y PROMOS **OK**; **FAIL** por los 6 umbrales de catálogo (8 productos en el seed
local frente a mínimos pensados para DEV), igual que en H13 → veredicto correcto para esta pila. Contra DEV/QAS: no
ejecutado (sin `.env`).

## N11
Status: PASS
Commit: `9a4cdb7`
Files: `docs/performance-budget.md` §2.2 (mediciones por fase, techos sin cambios).
Gates: typecheck PASS · lint PASS · build PASS · `bundle:report` PASS (portada 402,3/405 · ficha 386,2/400 ·
checkout 404,6/430 · panel 360,7/430) · `scan:secrets` PASS (sin hallazgos; 1 066 archivos versionados + `dist/`).
Arquitectura y seguridad re-ejecutadas: `architecture` 18, `audience` 10, `commerce-audience-guard` 7,
`security-baseline` 55 (superficie `anon` cerrada intacta), `schema-invariants` 17 (RLS activada y forzada en
`buyer_account_selections` y `consumer_addresses`, tenant NOT NULL e indexado, migraciones reproducibles),
`rls-tenant-isolation` 35, `public-rpc-gates` 3 → 256/256 junto con las suites de N01–N06.
Confirmaciones explícitas (con su evidencia):
- **Sin `service_role` en el navegador**: `scan:secrets` limpio; en `src` solo aparece en comentarios y en el guard
  `assertNoServiceKey` (excepción nominal), que es la única mención en `dist/`.
- **El selector no permite cross-tenant**: `select_store_business_account` valida vínculo, cuenta, cliente y
  sociedad de la tienda; cuenta de otra sociedad / de otra persona / uuid inventado → `CUENTA_NO_DISPONIBLE` sin tocar
  la preferencia (`effective-business-account` casos 7, 8 y extra); la FK con tenant impide apuntar a otra sociedad
  incluso con `service_role`.
- **El alta de consumidor no crea tenant**: sin triggers en `auth.users`, conteos de tenants/membresías/cuentas/
  clientes idénticos tras el alta (`consumer-signup`); E2E comprueba 0 `tenant_members` y 0 `business_account_users`.
- **Libreta aislada**: por usuario, por tienda del mismo tenant y por tenant; sin GRANT de tabla (`consumer-addresses`).
- **El checkout sigue rechazando identidad comercial**: `business_account_id`, `customer_id`, `segment_id`,
  `price_list_id`, `audience` → `CAMPO_NO_PERMITIDO` (`commerce-audience-guard`, `purchase-order`); la OC es una
  referencia y está prohibida dentro de las líneas.
- **Precio y promociones salen del servidor**: el overlay del catálogo, el carrito y el pedido usan
  `price_quote_for_slug` / `promotion_quote_for_slug` / `create_order`, sin parámetro de identidad
  (`pricing-checkout`, `targeted-promotions`: preview = pedido); el E2E verifica cuerpos sin claves de dinero ni
  identidad.

## N12
Status: PASS
Commit: este commit (`docs: informe final…`)
Files: `docs/demo-hardening-v2/FINAL_REPORT.md`, este log.
Tests: `npm run test` 205 archivos · 3 922 ✓ · 0 ✗ · 0 errores (en serie, `dist/` borrado antes)
Typecheck: PASS
Lint: PASS
DB: 87 archivos · 2 252 ✓
E2E: 56/56 (escritorio 12 · móvil 12 · comercio-escritorio 16 · comercio-móvil 16), pila local, fixtures repuestas,
servidor de desarrollo arrancado por Playwright
Bundle: PASS · 402,3/405 · 386,2/400 · 404,6/430 · 360,7/430 · build 1 700 módulos · `scan:secrets` PASS
Notes: `git diff --check` limpio; `git status` solo con `docs/quality/` sin seguimiento (previo, no tocado);
12 commits locales sobre `ec52bab`, nada empujado ni desplegado. Veredicto: `GO_WITH_GAPS` (despliegue, redirect URLs
de Auth, preflight contra QAS y usuarios de demo).
