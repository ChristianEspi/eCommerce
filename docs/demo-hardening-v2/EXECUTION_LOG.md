# Execution log — hardening multi-commerce v2 (segunda noche)

Rama `feature/demo-commerce-hardening-v2` (desde `feature/demo-commerce-hardening-v1` @ `ec52bab`). Sin
push, sin PR, sin despliegue.

> **Nota de medición.** `npm run test` ejecuta `vitest run` sin `include`, así que incluye
> `supabase/tests`: «Unit» es la suite completa y «DB» el subconjunto `npm run test:db`.

## N00
Status: PASS_WITH_KNOWN_ISSUE
Commit: (este commit; ver `git log -- docs/demo-hardening-v2/BASELINE.md`)
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
Commit: (ver `git log --grep "registro publico de consumidor"`)
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
Commit: (ver `git log --grep "precio comercial en la rejilla"`)
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
Commit: (ver `git log --grep "promociones dirigidas"`)
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
Commit: (ver `git log --grep "orden de compra obligatoria"`)
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
Commit: (ver `git log --grep "libreta de direcciones"`)
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
Commit: (ver `git log --grep "asistente flotante"`)
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
