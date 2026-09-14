# eCommerce by EBIM — certificación del Release Candidate

Rama `feature/demo-commerce-release-candidate` (desde `feature/demo-commerce-hardening-v2` @ `4c1b511`) ·
2026-09-13 · **sin push, sin PR, sin despliegue, sin escrituras en DEV/QAS**. Código certificado en `23228c5`; este
documento va en el commit siguiente. Fase a fase: [`EXECUTION_LOG.md`](EXECUTION_LOG.md).

## Veredicto

**`RC_GO_WITH_EXTERNAL_GAPS`**

El código de la rama es desplegable con confianza: todos los gates en verde desde un árbol limpio (unit, DB, build,
presupuesto, secretos, E2E en pila local), sin tests omitidos, sin regresiones y con el único gap de producto
conocido al empezar (entrega B2B: preview ≠ pedido) corregido y probado RED/GREEN. Lo que falta está **fuera del
repositorio** y se lista abajo como gap externo, no como defecto: despliegue en QAS, configuración de Auth y del
alojamiento, usuarios de demo y las verificaciones de solo lectura contra QAS.

No se alcanzó ninguna condición de parada: aislamiento de tenant intacto, precio coherente, preview de entrega =
pedido, checkout y creación de pedidos verdes, migraciones reproducibles, 0 vulnerabilidades HIGH/CRITICAL.

## Consumer (B2C)

| Capacidad | Estado | Evidencia |
|---|---|---|
| Guest | ✅ | E2E invitado hasta confirmación (escritorio y móvil); `delivery-buyer-pricing`: el invitado cotiza y paga entrega a precio público |
| Registro | ✅ | `/s/:slug/register`; `store-register` 9, `consumer-signup` 4 (sin tenant/membresía/cuenta); E2E alta |
| Vuelta tras auth | ✅ | `store-aware-auth` 12 (login, recuperación, clave nueva; `//`, `/\`, `https:` rechazados); E2E salir → /account → Entrar → /account |
| Cuenta | ✅ | «Mi cuenta» con pedidos, favoritos, datos, direcciones y avisos; QA visual en 4 temas × 3 viewports |
| Pedidos | ✅ | `consumer-account` (aislamiento por usuario/tienda/tenant); E2E «Mis pedidos» |
| Direcciones | ✅ | `consumer-addresses` 17; E2E libreta → checkout → pedido |

## Trade / Reseller

| Capacidad | Estado | Evidencia |
|---|---|---|
| Contexto | ✅ | Barra «Cuenta comercial · Condiciones comerciales activas»; `commerce-context` + QA visual (audiencia `trade` en 36 páginas de portada) |
| Precio en catálogo | ✅ | `catalog-prices` 8 (una cotización por colección, invitado 0); E2E precio comercial en tarjeta sin N+1 |
| Promociones | ✅ | `targeted-promotions` 8 (preview = pedido); E2E campaña dirigida |
| Entrega | ✅ **(R01)** | Umbral de envío gratis con el precio Trade; cotizado = cobrado |
| Checkout / pedido | ✅ | E2E trade: cobrado < público, cuerpo sin dinero ni identidad |

## Enterprise B2B

| Capacidad | Estado | Evidencia |
|---|---|---|
| Selección de cuenta | ✅ | `effective-business-account` 23 (pipeline real); selector «Comprando para»; E2E multi-cuenta; cross-tenant y cuenta ajena → `CUENTA_NO_DISPONIBLE` |
| Precio | ✅ | Cuenta efectiva única para precio, barra, checkout y pedido |
| Promoción | ✅ | Audiencias `segment`/`customer`/`business_account` = pedido; cambiar A/B cambia la campaña |
| Entrega | ✅ **(R01)** | Umbral con el precio de la cuenta efectiva; multi-cuenta A paga / B gratis, igual en cotización y pedido |
| Orden de compra | ✅ | `purchase-order` 13; 422 `ORDEN_COMPRA_REQUERIDA` antes de cobrar; E2E con y sin OC; QA visual del campo en 36 checkouts |
| Checkout | ✅ | E2E enterprise hasta confirmación |
| Portal | ✅ | E2E hasta «Mis pedidos» con la OC en el detalle; pestañas alcanzables en 390 |

## Theme Engine

Universal, Retail, Premium y Catalog: `theme-*`/`multi-industry` en unit; E2E `theme-engine` 8/8; QA visual
**792/792** comprobaciones en 4 temas × 3 audiencias × 3 viewports (tema aplicado, sin desbordamiento, cabecera, pie,
categorías, tarjetas, barra, selector, precio comercial, carrito, checkout, OC, portal, consola limpia). Sin cambios de
diseño.

## Tests (cifras reales)

| Gate | R00 (base) | R10 (final) |
|---|---|---|
| `npm run typecheck` | PASS | PASS |
| `npm run lint` | PASS | PASS |
| `npm run test` | 205 archivos · 3 922 ✓ · 0 ✗ | **207 archivos · 3 940 ✓ · 0 ✗** |
| `npm run test:db` | 87 · 2 252 ✓ | **88 · 2 260 ✓** |
| `npm run build` | PASS · 1 700 módulos | PASS · 1 700 módulos |
| `npm run bundle:report` | 402,3 · 386,2 · 404,6 · 360,7 | **402,3 · 386,2 · 404,6 · 360,7** |
| `npm run scan:secrets` | PASS | PASS |
| E2E `npx playwright test` (pila local) | 56/56 | **56/56** (escritorio 12 · móvil 12 · comercio-escritorio 16 · comercio-móvil 16) |
| QA visual | — | 792/792 |
| `git diff --check` | — | limpio |

Sin `skip`, `only` ni `todo` en `src`, `supabase/tests`, `e2e` ni `scripts`. Nuevos: `delivery-buyer-pricing` (8),
`qas-smoke` (9), `commerce-context-bar` (+1). Ningún test existente modificado en el RC.

E2E: pila Supabase local desechable (Postgres 17.6, 156 migraciones). El puerto 5173 lo ocupaba otro proyecto de la
máquina; la suite se ejecutó sin cambios con una config fuera del repo que solo mueve el servidor de desarrollo al
5199.

## Security

| Tema | Estado | Evidencia |
|---|---|---|
| RLS / FORCE RLS | ✅ | `schema-invariants` (todas las tablas de `public` con RLS activada y forzada, policy, tenant NOT NULL e indexado) |
| Aislamiento de tenant | ✅ | `rls-tenant-isolation`, `security-baseline` (superficie `anon` cerrada, FKs con tenant); aislamiento propio de cada objeto nuevo |
| Selección de cuenta | ✅ | Solo cuentas propias, activas y de la sociedad de la tienda; FK con tenant en `buyer_account_selections` |
| Identidad y dinero | ✅ | El checkout rechaza `business_account_id`, `customer_id`, `segment_id`, `price_list_id`, `audience`, importes (`commerce-audience-guard`, E2E); R01 no añade parámetros (firma de `delivery_options_for_slug` intacta, asertada) |
| Redirecciones | ✅ | Toda vuelta pasa por `isInternalPath`/`safeHref` con tests de `/\evil.com`; ver DEPENDENCY_AUDIT |
| Secretos | ✅ | `scan:secrets` PASS; `service_role` solo en Edge Functions; `db:types` local rechaza URLs remotas |
| `npm audit` | ⚠️ aceptado | 4 moderadas (React Router 6 y Vitest 3), sin PATCH/MINOR; no explotables en este SPA (evidencia en [`DEPENDENCY_AUDIT.md`](DEPENDENCY_AUDIT.md)); 0 HIGH/CRITICAL |

## Performance

Techos intactos; análisis y opciones descartadas en [`PERFORMANCE.md`](PERFORMANCE.md). Portada 402,3/405 (margen
0,7 %), ficha 386,2/400, checkout 404,6/430, panel 360,7/430.

## Deployment

Manifiesto exacto en [`DEPLOYMENT_MANIFEST.md`](DEPLOYMENT_MANIFEST.md): 7 migraciones en orden con SHA-256; Edge
Functions `checkout` **REQUIRED**, `create-order` **RECOMMENDED**, `api` y `update-order-status` **UNCHANGED**;
frontend después; Auth Redirect URLs; reescritura de SPA de Amplify; Node 24 ([`RUNTIME.md`](RUNTIME.md));
roll-forward sin rollback destructivo. `package-lock.json` sin cambios (`78a8dd13…0e1700`).

Herramientas de verificación posterior, de solo lectura: `npm run smoke:qas` (`QAS_READ_ONLY_SMOKE`) y
`node scripts/demo-preflight.mjs` (`DEMO_PREFLIGHT_RC`).

## External gaps (no son defectos del código)

| Gap | Estado | Cómo se cierra |
|---|---|---|
| QAS no desplegado | Pendiente | Manifiesto §0–§3 |
| Auth Redirect URLs no configuradas | Pendiente, no verificable desde el repo | Manifiesto §4; el preflight lo marca `INFO` |
| Reescritura de SPA en Amplify no verificada | Pendiente (vista rota en QAS antes) | Manifiesto §5 → `QAS_BASE_URL=… npm run smoke:qas` = PASS |
| Node 24 en el build de Amplify | Pendiente en consola | `RUNTIME.md` |
| Usuarios de demo no creados | Pendiente | Manifiesto §6 → `DEMO_PREFLIGHT_RC = PASS` |
| Preflight contra QAS no ejecutado | `NOT_RUN` (sin credenciales en esta máquina) | Tras desplegar |
| Smoke contra QAS no ejecutado | `NOT_RUN` (sin `QAS_BASE_URL`) | Tras desplegar |
| Proveedores externos sin secretos (pasarelas, correo transaccional) | Según `docs/STATE.md` | Operador |
| `db:types` contra QAS para confirmar paridad | Pendiente, solo lectura | Manifiesto §1 |

## Fuera de este RC (por alcance, no son gaps)

Employee Commerce, true channel resolver, quinto tema, WYSIWYG, PDF de OC, alta self-service de Trade, migración a
React Router 7 / Vitest 4, dieta de i18n de la portada.
