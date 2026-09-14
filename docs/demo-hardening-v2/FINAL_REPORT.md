# Hardening multi-commerce v2 — informe final (segunda noche)

Rama `feature/demo-commerce-hardening-v2` (desde `feature/demo-commerce-hardening-v1` @ `ec52bab`) · 2026-09-13 ·
**sin push, sin PR, sin despliegue**. Fase a fase: [`EXECUTION_LOG.md`](EXECUTION_LOG.md). Línea base:
[`BASELINE.md`](BASELINE.md).

## Executive Status

**`GO_WITH_GAPS`**

El código cumple los 17 criterios de GO (tabla abajo), verificado en Postgres real (PGlite) y de punta a punta en
una pila Supabase local con la Edge Function `checkout` real: **56/56 E2E** en escritorio y móvil, **3 922/3 922**
unit (sin los 6 fallos de entorno que arrastraba H14) y **2 252/2 252** DB. No es `GO` limpio por lo que no está en
el código:

1. **Nada desplegado.** Cuatro migraciones nuevas y la función `checkout` (más `create-order`/`api`, que empaquetan
   código compartido tocado) tienen que llegar a QAS, en el orden de abajo. Las pantallas nuevas degradan sin romper
   si la base aún no las tiene (libreta y selector), pero la OC obligatoria, las promociones dirigidas en el carrito y
   la cuenta efectiva del checkout **solo existen tras migrar y desplegar**.
2. **Supabase Auth de QAS** tiene que admitir `https://<host>/**` en *Redirect URLs*: el enlace de confirmación de
   alta y el de recuperación con `returnTo` vuelven a rutas de la tienda. Sin eso, Auth manda a la *Site URL*.
3. **Preflight contra DEV/QAS no ejecutado** (esta máquina no tiene `.env`). Contra la pila local: B2C, TRADE,
   ENTERPRISE, MULTI, PROMOS y migraciones OK; FAIL solo por los umbrales de catálogo del seed local (8 productos).
4. **Usuarios de demo** (consumidor, comercio, empresa y, si se enseña el selector, uno con dos cuentas) no existen en
   DEV; el preflight dice qué falta.

| # | Criterio de GO | Estado | Evidencia |
|---|---|---|---|
| 1 | 0 regresiones nuevas | ✅ | Unit 3 790 ✓/6 ✗ → 3 922 ✓/0 ✗; DB 2 185 → 2 252 ✓; E2E 44 → 56 ✓. Tests existentes modificados: ver «Tests» |
| 2 | Multi-account coherente end-to-end | ✅ | `effective-business-account.test.ts` 23 (pipeline real); E2E multi-cuenta |
| 3 | Cuenta seleccionada = pricing = barra = checkout = pedido | ✅ | Casos 2–6 en Postgres; E2E: barra = B, ficha/carrito = precio de B, `unit_price` cobrado = precio de B, portal con B |
| 4 | Checkout body sin identidad B2B | ✅ | `commerce-audience-guard` 7; `purchase-order` «el cuerpo sigue rechazando…»; E2E sin claves prohibidas |
| 5 | Consumer signup funciona | ✅ | `store-register.test.tsx` 9; E2E alta escritorio y móvil |
| 6 | Consumer vuelve a la tienda tras auth | ✅ | `store-aware-auth.test.tsx` 12 (login, recuperación, clave nueva); E2E salir → /account → Entrar → /account |
| 7 | Guest B2C intacto | ✅ | E2E invitado; `checkout-ui` 56; guest sin peticiones de overlay ni promos dirigidas |
| 8 | Registered B2C aislado por user+store | ✅ | `consumer-account` (H02) + `consumer-addresses` 17 |
| 9 | Trade/Enterprise ven precio comercial en catálogo sin N+1 | ✅ | `catalog-prices.test.tsx` 8 (N tarjetas = 1 cotización); E2E lotes < nº de tarjetas |
| 10 | Targeted promotions preview = order | ✅ | `targeted-promotions.test.ts` 8 (fallan 4 sin la migración); E2E dirigido |
| 11 | PO requerida exigida server-side | ✅ | `create_order` → `ORDEN_COMPRA_REQUERIDA`; `purchase-order` 13; E2E 422 por llamada directa |
| 12 | Address book consumer aislada | ✅ | `consumer-addresses` 17 (usuario, tienda, tenant, sin GRANT) |
| 13 | 4 themes siguen verdes | ✅ | `theme-*`/`multi-industry` unit; E2E `theme-engine` 8/8 |
| 14 | Unit/DB/build verdes | ✅ | 3 922/3 922 · 2 252/2 252 · build PASS 1 700 módulos |
| 15 | E2E críticos verdes en pila local | ✅ | 56/56 |
| 16 | Security scan verde | ✅ | `scan:secrets` sin hallazgos |
| 17 | Sin deploy/push accidental | ✅ | `git log`: 12 commits locales sobre `ec52bab`; `origin` sigue en v1; nada desplegado |

## Baseline delta (N00 → N12, cifras reales)

| Gate | N00 | N12 | Δ |
|---|---|---|---|
| `typecheck` | PASS | PASS | = |
| `lint` | PASS (0) | PASS (0) | = |
| `test` (suite completa) | 196 archivos · 3 796 · **3 790 ✓ · 6 ✗** · 4 errores | 205 archivos · **3 922 ✓ · 0 ✗** · 0 errores | +132 ✓, −6 ✗ |
| `test:db` | 82 · 2 185 ✓ | 87 · **2 252 ✓** | +5 archivos, +67 ✓ |
| `build` | PASS (1 691 módulos) | PASS (1 700) | = |
| `bundle:report` | portada 400,3 · ficha 384,2 · checkout 401,9 · panel 359,9 | 402,3 · 386,2 · 404,6 · 360,7 | techos **sin cambios** (405/400/430/430) |
| `scan:secrets` | PASS | PASS | = |
| E2E (pila local) | 43/44 base vacía · 44/44 repetido | **56/56** | +12 escenarios; el fallo de N00 era un defecto real, corregido en N06 |

## Multi-account

- **Persistencia**: `buyer_account_selections` (usuario + organización + sociedad → cuenta), una fila por persona y
  sociedad vendedora. RLS activada y forzada, sin GRANT para `anon`/`authenticated`; FK con tenant hacia
  `business_accounts`. No guarda precio, lista, segmento ni cliente, y no hay nada en `localStorage`.
- **Validación**: solo se escribe por `select_store_business_account(slug, account_id)`, que exige usuario del JWT,
  vínculo `active`, cuenta y cliente activos, y la misma organización/sociedad que la tienda del slug. Todo lo demás
  —otra sociedad, otra persona, uuid inventado, vínculo revocado— responde `CUENTA_NO_DISPONIBLE` sin tocar nada.
- **Una sola regla**: `ebim.effective_business_account(usuario, org, sociedad)` = la elegida si sigue siendo válida;
  si no, la activa más antigua (compatibilidad total con H14). La preguntan `ebim.pricing_actor` (todo precio público),
  `my_commerce_context` (barra), `my_store_business_accounts` (selector), `my_effective_business_account_for_slug`
  (checkout: sustituye a `rows[0]` de `my_business_accounts()`) y `promotion_quote_for_slug` (N04). `create_order`
  recibe esa cuenta del borde y la revalida contra la tienda.
- **UI**: con 2+ cuentas, «Comprando para · EMPRESA ▼» en la barra; al elegir se invalidan contexto y todas las
  cotizaciones (`['pricing']`: ficha, carrito, checkout, catálogo), el carrito no se toca y se avisa si cambió algún
  precio a la vista. El portal marca la efectiva. Con una cuenta, nada nuevo.
- **E2E**: seleccionar B → barra B → ficha y carrito con el precio de B → pedido cobrado a precio de B → portal con la
  fila de B; catálogo con precio comercial de B y vuelta a A.

## B2C Consumer

- **Signup**: `/s/:storeSlug/register`, dentro de la tienda. Correo normalizado, contraseña ≥ 8, `user_metadata` solo
  nombre y teléfono; `emailRedirectTo` a una ruta interna de ESA tienda. No crea tenant, membresía ni cuenta de
  empresa (probado en base y por E2E con lectura de servicio en local).
- **Login return**: `from` por estado de navegación o `?from=`, siempre por el guard de rutas internas
  (`//evil.com`, `/\evil.com`, esquemas: ignorados). Desde la vitrina vuelve a la vitrina y la acción secundaria es
  «¿Primera vez en la tienda? Crea tu cuenta»; el backoffice sigue en `/app` y onboarding.
- **Password recovery return**: `/nueva-clave?returnTo=<ruta interna>`; tras fijar la clave vuelve a la cuenta de la
  tienda; sin `returnTo` (o externo), `/app`.
- **Account / orders**: los de H02–H03; la primera compra de una cuenta nueva aparece al momento en «Mi cuenta» (antes
  la caché de 60 s decía «Todavía no hay direcciones»).
- **Address book**: `consumer_addresses` por usuario + tienda, CRUD + predeterminada por cuatro RPC sin usuario;
  «Usadas en tus pedidos» con «Guardar en mi libreta»; el checkout propone libreta primero y luego historial sin
  duplicar. Comprar no guarda nada solo.

## Trade / Reseller

- **Catálogo**: el mismo. **Overlay de precio comercial**: rejilla, filas y banda de ofertas piden UNA cotización
  por colección (`price_quote_for_slug`, qty 1, sin variantes, ≤ 100) solo si el servidor dice que hay condiciones
  comerciales; «Tu precio comercial» con el público tachado cuando mejora. Invitado: cero peticiones; consumidor:
  ninguna cotización extra.
- **Pricing**: motor intacto; la cuenta sale de la regla única.
- **Promotions**: las dirigidas a segmento, cliente o cuenta se ven en el carrito y se cobran igual en el pedido.
- **Checkout**: el común; sin OC salvo que la cuenta la exija.

## Enterprise

- **Selector multi-cuenta**: el de arriba, con nombres largos recortados en el botón y enteros en el menú.
- **Convenio**: «Precio convenio» en la tarjeta y «Precio convenio activo» en la barra, ambos del servidor.
- **PO**: `orders.purchase_order_number` (1–60, sin controles, inmutable). Si la cuenta la exige, el paso de pago la
  pide, el pipeline se detiene ANTES de cobrar (`422 ORDEN_COMPRA_REQUERIDA`) y `create_order` la vuelve a exigir con
  la fila de la cuenta delante. Entra en el hash de idempotencia (misma clave + otra OC = conflicto) y está prohibida
  dentro de las líneas. Se ve en la confirmación, el detalle del portal y la ficha del pedido del backoffice.
- **Portal**: intacto + cuenta efectiva marcada + OC en el detalle.

## Tests

| Suite | Resultado |
|---|---|
| `npm run test` | 205 archivos · 3 922 ✓ · 0 ✗ · 0 errores no controlados |
| `npm run test:db` | 87 archivos · 2 252 ✓ |
| `npm run build` | PASS, 1 700 módulos |
| `npm run bundle:report` | PASS — 402,3/405 · 386,2/400 · 404,6/430 · 360,7/430 |
| `npm run scan:secrets` | PASS |
| E2E `npx playwright test` (pila local) | 56/56 — escritorio 12 · móvil 12 · comercio-escritorio 16 · comercio-móvil 16 |
| Preflight V2 (pila local) | B2C/TRADE/ENTERPRISE/MULTI/PROMOS/migraciones OK · FAIL por umbrales de catálogo del seed local |

Suites nuevas: `effective-business-account` (23), `consumer-signup` (4), `targeted-promotions` (8),
`purchase-order` (13), `consumer-addresses` (17), `returnTo` (12), `store-register` (9), `store-aware-auth` (12),
`catalog-prices` (8); ampliadas: `commerce-context-bar` (+4), `checkout-ui` (+5), `checkout-orchestrator` (+2),
`consumer-account` (+7), `OrdersPage` (+1), `portal-orders` (+1).

Tests existentes modificados y por qué no es rebajarlos:

- `routes.test.tsx`: el inventario de rutas de la vitrina incluye `/register` (ruta nueva, documentada en el test).
- `checkout-orchestrator` «lo que responde llega a la transacción»: su cuenta simulada tiene
  `purchaseOrderRequired: true`; desde N05 eso exige OC, así que el input manda una. La aserción no cambia.
- `checkout-order` «una tasa caducada no se aplica»: **flake de reloj previo** (fallaba igual en `65fe4f1`): alta y
  cierre de la tasa en el mismo instante violaban `tax_rates_period`. La tasa empieza ayer; misma aserción.
- `consumer-account` «Mis direcciones» (H04): los dos casos declaran ahora el estado de la libreta (no desplegada /
  vacía); siguen exigiendo lo mismo, incluida la marca «Última».
- `auth-flow` y `landing`: fijan `isSupabaseConfigured` por mock (backend falso, sin `.env`); el `AbortSignal` se
  arregló en el entorno de pruebas (`src/test/jsdom-environment.ts`), sin tocar runtime ni saltar tests.

## Remaining gaps

| Gap | Estado | Nota |
|---|---|---|
| Self-service application de Trade/Reseller | Pendiente | Las cuentas B2B las crea el comercio (backoffice / `crear-usuario-b2b.mjs`) |
| True channel resolver B2C/B2B/Internal | Pendiente | `CommerceAudience` sigue siendo presentación; el precio lo decide la cuenta efectiva |
| Employee Commerce | Fuera de alcance | Nada lo bloquea: un empleado sin cuenta de empresa es consumidor |
| Upload PDF de OC | Pendiente | N05 implementa el número; no hay superficie de Storage nueva |
| WYSIWYG real | Pendiente | Sin cambios en Diseño de tienda |
| Integraciones externas | No configuradas | Pasarelas, correo transaccional y Auth de QAS según `docs/STATE.md`; redirect URLs de Auth pendientes (arriba) |
| Guardar dirección desde el checkout | No hecho (opcional) | Se guarda desde «Mis direcciones», incluida una ya usada |
| Topes de promoción por cliente contados por correo | Previo | La cotización no conoce el correo del checkout; los decide `create_order` |
| `delivery_options_for_slug` en el borde | Previo | Se cotiza con `service_role` (precio de catálogo para el umbral de envío gratis en la PREVISUALIZACIÓN); `create_order` recalcula con el precio real |
| Techos de bundle | Decisión del operador | Portada 402,3/405 (0,7 % de margen); ver `performance-budget.md` §2.2 |
| Tipos generados | Pendiente | `npm run db:types` tras migrar; las constantes RPC nuevas no llevan `satisfies` |
| Buzón EBIM | Revisado (lectura) | Sin mensajes nuevos `to: ecommerce`/`to: all` desde 2026-08-20; no se escribió en la carpeta compartida |

## QAS deployment plan

**No desplegado.** En este orden:

1. [ ] Revisar y fusionar `feature/demo-commerce-hardening-v1` y luego `feature/demo-commerce-hardening-v2` en `dev`
   (v2 contiene v1; nada empujado).
2. [ ] Si QAS aún no tiene H14: `20260913100000_consumer_account.sql`, `20260913110000_commerce_context.sql`,
   `20260913120000_store_default_country.sql` (ver `docs/demo-hardening/FINAL_REPORT.md`).
3. [ ] Migraciones de la segunda noche, **en orden** (`node scripts/aplicar-migracion.mjs <archivo>`):
   1. `20260913130000_effective_business_account.sql` — tabla de selección, regla única, `pricing_actor` y
      `my_commerce_context` sobre ella, tres RPC del selector.
   2. `20260913140000_promotion_quote_buyer_identity.sql` — `promotion_quote_for_slug` con identidad del servidor.
   3. `20260913150000_purchase_order_number.sql` — columna + CHECK + inmutabilidad; **recrea** `create_order` y
      `checkout_place_order` (firma +1 parámetro) y `my_business_order_detail`.
   4. `20260913160000_consumer_addresses.sql` — libreta y sus cuatro RPC.
4. [ ] Edge Functions, **después** de las migraciones:
   - `checkout` (**obligatoria**: cuenta efectiva, OC, 422);
   - `create-order` y `api` (recomendado: empaquetan `_shared/orders.ts` / `_shared/checkout/request.ts`, que
     cambiaron; su comportamiento solo gana la OC prohibida en líneas);
   - `update-order-status` empaqueta `_shared/orders.ts` sin cambio de comportamiento: redeploy opcional.
5. [ ] Frontend (build de `dev`): después de 3–4. El backoffice lee `orders.purchase_order_number` y fallaría contra
   una base sin la columna.
6. [ ] Supabase Auth de QAS → *Redirect URLs*: añadir `https://<host-de-la-vitrina>/**`.
7. [ ] `npm run db:types` y commitear el diff.
8. [ ] Verificar `ecommerce.pricing.lists` y `ecommerce.promotions` activos para la sociedad de demo.
9. [ ] Usuarios de demo: consumidor (sin empresa), comercio (cuenta sin controles con lista vigente), empresa
   (control corporativo + lista vigente; `purchase_order_required` según guion) y, si se enseña el selector, uno con
   dos cuentas de la misma sociedad.
10. [ ] `DEMO_CONSUMER_EMAIL=… DEMO_TRADE_EMAIL=… DEMO_ENTERPRISE_EMAIL=… [DEMO_MULTI_EMAIL=…]
    [DEMO_ENTERPRISE_REQUIRES_PO=true|false] [DEMO_TARGETED_PROMO_CODE=…] node scripts/demo-preflight.mjs miquimica`
    → **`DEMO_PREFLIGHT_V2 = PASS`**.
11. [ ] Smoke manual en QAS: invitado igual que antes; registro → Mi cuenta; empresa con OC; selector si aplica.
12. [ ] E2E sin crear datos contra QAS: `npx playwright test --project=escritorio --project=movil`. Los proyectos
    `comercio-*` crean pedidos y usuarios: solo en pila local o entorno desechable.

## E2E en pila local (cómo se reprodujo)

Igual que H14 (`docs/demo-hardening/FINAL_REPORT.md`): copia de `supabase/` fuera del repo con `project_id
ecommerce-hardening-local` y puertos 553xx, Postgres 17 cacheado (DEV usa 15), migraciones aplicadas una a una con
`ON_ERROR_STOP` (única sentencia omitida en la copia: `alter table storage.objects enable row level security`),
`seed.sql` + `demo-data.sql`, funciones Edge servidas por el edge-runtime local. `scripts/e2e-local-fixtures.mjs`
necesita ahora también `E2E_MULTI_EMAIL` / `E2E_MULTI_PASSWORD` y deja: consumidor, comercio, empresa con OC,
multi-cuenta (Andina + Boreal con convenio de cliente) y la campaña dirigida `e2e-multi-boreal`. Se niega a correr
fuera de localhost.
