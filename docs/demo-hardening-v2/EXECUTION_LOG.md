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
