# eCommerce by EBIM — certificación del cierre del plan B2C + B2B

Rama `dev` · base del plan `5e3da4e` · **código certificado en `c5066af`** · 2026-09-14 · sin push, sin PR, sin
despliegue, sin escrituras en DEV/QAS. Plan: `docs/PROMPT_CLAUDE_OPUS_5_CIERRE_ECOMMERCE.md`. Trazabilidad por ítem:
[`../PROGRESO_CIERRE.md`](../PROGRESO_CIERRE.md). Qué cambia para cada público:
[`RELEASE_NOTES.md`](RELEASE_NOTES.md). Cómo desplegar: [`DEPLOYMENT_MANIFEST.md`](DEPLOYMENT_MANIFEST.md). La
certificación del RC anterior (2026-09-13) está en el historial, commit `0395ca3`.

## Dictamen

**GO CONDICIONADO**

El código y el núcleo están en verde desde un árbol limpio: typecheck, lint, 4 380 pruebas unitarias y de base,
tipos del borde con Deno, build, presupuesto de bundle, secretos, migraciones **desde cero en Postgres 17.6** y
**64/64 E2E** en navegador sobre una pila Supabase local. No hay P0 abierto ni P1 bloqueante, ningún bypass de
tenant, rol o capacidad conocido, y el checkout es coherente (cobra el precio del servidor, rechaza crédito
bloqueado, exige OC, no cobra con un conector simulado sin permiso).

Lo que falta no se puede validar desde esta máquina y se enumera abajo como **condición**: despliegue y paridad en
QAS (Postgres 15), proveedores reales (pasarela, transportista, facturador, correo), una decisión legal y cuatro
pasos de operación. Hasta cumplirlas, el dictamen no es GO.

Durante la certificación se encontraron y corrigieron **seis defectos reales**, cada uno con prueba que falla sin la
corrección: conector simulado que cobraba en cualquier entorno, cobro incompleto que dejaba el pedido pagado, avisos
tardíos con reintento infinito, envío abierto sin pasar la regla de cobro, `cart_open` concurrente con 409 y presupuesto
de bundle excedido. Más dos del borde que encontró `check:edge` y el `secret_ref` de webhooks que encontró la revisión
D2.

## Gates (ejecutados sobre `c5066af`, Node 22.12.0 / npm 10.9.0, Windows)

| Gate | Resultado | Evidencia |
|---|---|---|
| `npm run typecheck` | **PASS** | exit 0 |
| `npm run lint` | **PASS** | exit 0 |
| `npm test` (`vitest run`, incluye `supabase/tests`) | **PASS** · 233 archivos · **4 380 ✓ · 0 ✗ · 0 omitidos** | sin `skip`/`only`/`todo` (`git grep`) |
| `npm run test:db` | **PASS** (incluido arriba) | PGlite, todas las migraciones |
| `npm run check:edge` (nuevo) | **PASS** · 67 archivos | `deno check` 2.9.6; probado en ROJO con un error plantado |
| `npm run build` | **PASS** | aviso de chunk >400 kB (editor de texto rico, backoffice) sin cambios de política |
| `npm run bundle:report` | **PASS** | portada 399,6/405 · ficha 384,6/400 · checkout 401,9/430 · backoffice 370,8/430 (kB gzip) |
| `npm run scan:secrets` | **PASS** | 1 175 versionados + 249 de `dist/`, sin hallazgos |
| `npm audit` | ⚠️ **aceptado** | 4 moderadas (Vitest 3, React Router 6), 0 high/critical; arreglo = salto mayor. Mismo recuento que el RC (`DEPENDENCY_AUDIT.md`) |
| `npm ci` | ❌ **NO en Node 22.12** | `engine-strict` + `eslint-visitor-keys@5` exige ≥ 22.13. Condición C8 |
| Migraciones desde cero, Postgres 17.6 | **PASS** · 175 migraciones | `supabase migration up` sobre pila limpia; ver nota 1 |
| pg_cron real | **PASS** | `ecommerce-order-schedules`, `ecommerce-cart-recovery`, `ecommerce-notifications-dispatch` creados; los dos trabajos nuevos ejecutan |
| E2E Playwright (pila local) | **PASS** · **64/64** | escritorio 12 · móvil 12 · comercio-escritorio 20 · comercio-móvil 20; 0 flaky en la pasada final; ver nota 2 |
| Concurrencia real (`cart_open`) | **PASS** | 3×20 y 1×50 llamadas simultáneas: 0 errores, 1 carrito (antes del arreglo: 9–19 de 20 fallaban) |

**Nota 1 — pila local.** La pila usa una copia de `supabase/config.toml` fuera del repo (puertos 553xx, Postgres
17): los 5432x los ocupa otra aplicación de la máquina. La migración `20260827090600_storage_buckets.sql` (aplicada
hace semanas en DEV/QAS) falla en las imágenes locales actuales porque `storage.objects` pertenece a
`supabase_storage_admin` y `postgres` no hereda ese rol; se concedió `grant supabase_storage_admin to postgres`
**solo en la pila local**, imitando el entorno gestionado, y después se aplicaron las 175 en orden. No se editó
ninguna migración.

**Nota 2 — E2E.** Configuración de Playwright fuera del repo que solo mueve el servidor de desarrollo a 5199 (el 5173
lo ocupa otro proceso y la config del repo lo reutilizaría). Edge Functions servidas con
`EBIM_PAYMENTS_ALLOW_SIMULATION=true` (la tienda demo cobra con `sandbox`). En una pasada anterior falló una vez
`signup` con «Invalid hook call» por la reoptimización de dependencias del servidor de desarrollo en frío; repetido 3
veces después: 6/6. Se registra como inestabilidad de entorno (D-09).

## Cobertura del plan

| # | Ítem | Estado | Evidencia principal |
|---|---|---|---|
| 1 | Credit block | ✅ 100 % | trigger en `orders` + etapa 2 del pipeline; `credit-block` 11; **E2E** 403 `CREDITO_BLOQUEADO` |
| 2 | Approval portal B2B | ✅ 100 % | `approval-inbox` 13 + UI 12; decisión idempotente. E2E: no (ver D-01) |
| 3 | Quote → order | ✅ 100 % | acuerdo de precio + carrito, trigger diferido; `quote-to-order` 20 (checkout real) + UI 9; **E2E** solicitud |
| 4 | Scheduled orders | ✅ 100 % | trabajo con skip locked, reintentos y `dead`; `scheduled-orders` 20 (checkout real) + UI 14; **E2E** programar/pausar/eliminar; pg_cron real |
| 5 | Quick order | ✅ 100 % | resolver SKU sin precio; 28 + 22 + 10; **E2E** |
| 6 | Bulk CSV | ✅ 100 % | mismo resolver; reimportar no duplica |
| 6b | Reorder B2B | ✅ 100 % | `storeId` + ids en el detalle |
| 7 | Channels admin | ✅ 100 % | `channels-admin` 17 + UI 12 |
| 8 | Abandoned cart | ✅ código · ⏸ encendido | 46 + 9 + 8; apagado por defecto. Condición C5 |
| 9 | Product relations | ✅ 100 % | 17 + 11 |
| 10 | Reviews | ✅ 100 % | 38 + 19; moderación con `audit_log` |
| 11 | Suggested v2 | ✅ 100 % | 17 + 4; respaldo v1 |
| 12 | `invoice.issue` | ✅ productor · ⏸ consumidor | `invoice-issue` 26; sin facturador queda observable. Condición C3 |
| 13 | Capability guards | ✅ 100 % | `capability-guards` 26; `SIN_CANDADO_DE_SERVIDOR` vacío. Condición C6 |
| 14 | `check:edge` | ✅ 100 % | gate verde y probado en rojo |
| 15 | E2E y certificación | ✅ este documento | gates de arriba |
| D2 | Pagos / fulfillment | ✅ corregido lo local · ⏸ proveedores | ver D-04…D-07. Condición C2 |

## Seguridad

| Tema | Estado | Evidencia |
|---|---|---|
| RLS forzada y tenant | ✅ | `schema-invariants`, `rls-tenant-isolation`; aislamiento propio en cada tabla nueva (`order_schedule_runs`, `product_reviews`, `cart_recovery_*`, `invoice_issue_requests`) |
| Superficie anónima | ✅ 23 funciones clasificadas | `security-baseline` 55 |
| Capacidades en servidor | ✅ | bypass directo rechazado sin la capacidad, con rol válido (`capability-guards`) |
| Identidad y dinero desde el navegador | ✅ | ninguna RPC nueva acepta tenant, cuenta, cliente ni precio; E2E revisa el cuerpo del checkout |
| Oráculos de ids | ✅ | «ajeno» e «inexistente» responden igual en cotizaciones, programados, aprobaciones, canales y reseñas |
| Secretos | ✅ | `scan:secrets`; `secret_ref` de webhooks encerrado por sociedad; `service_role` solo en el borde |
| Pagos | ✅ local | simulacro solo con permiso; cobro incompleto no paga; HMAC tiempo constante (revisión D2) |

## Matriz de defectos abiertos

| ID | Severidad | Defecto | Owner | Estado / salida |
|---|---|---|---|---|
| D-01 | P2 | Aprobación, conversión cotización→pedido, trabajo de programados y recuperación de carrito sin E2E de navegador (dependen de datos del vendedor o de un planificador) | QA / eCommerce | Cubiertos en base con el checkout real; añadir fixtures de aprobador y cotización enviada |
| D-02 | P2 (decisión) | Un `admin` de la cuenta puede aprobar su propio pedido | Negocio B2B | Política vigente fijada por test; decidir separación de funciones |
| D-03 | P2 | Techo de sondeo por TIENDA en pedido rápido (300/h) y en reseñas: un abusador puede frenar a otros compradores una hora | eCommerce | Pasar a techo por usuario |
| D-04 | P1 externo | La compensación de un cobro capturado intenta anular en vez de devolver; la devolución de Culqi es simulada | eCommerce + PSP | Requiere pasarela real (C2) |
| D-05 | P1 externo | `refunds.provider_reference` nunca se rellena y nadie consume `payment.refund` | eCommerce + PSP | Requiere pasarela real (C2) |
| D-06 | P2 | El lote de seguimiento del transportista aplica solo el último estado | eCommerce | Aplicar en orden; con transportista real (C2) |
| D-07 | P3 | El aviso de captura no compara moneda; ids de evento del transportista sandbox con `new Date()` | eCommerce | Hardening de adaptadores |
| D-08 | P3 | `scripts/demo-preflight.mjs` no conoce las 19 migraciones nuevas | eCommerce | Actualizar lista |
| D-09 | P3 | E2E `signup` inestable con el servidor de desarrollo en frío (reoptimización de Vite) | QA | Precalentar `optimizeDeps` o E2E contra `vite preview` |
| D-10 | P3 | Aviso de pedido programado solo en la app (sin plantilla de correo) | eCommerce | Plantilla `order_schedule.run_ready` |
| D-11 | P3 | `docs/STATE.md`, ADR 017 y `SAAS_GAPS.md` §2.1 aún describen los tres huecos de capacidad como abiertos | eCommerce | Actualizar docs |

## Condiciones del GO (externas o de operación)

| # | Condición | Cómo se cierra |
|---|---|---|
| C1 | QAS no desplegado; paridad en **Postgres 15** no probada (certificado en 17.6; revisión heurística sin sintaxis 16/17) | Manifiesto §0–§4 en QAS; `db:types` de solo lectura; E2E `escritorio`/`movil` contra QAS |
| C2 | Pasarela y transportista reales no disponibles | Adaptadores con credenciales; cerrar D-04…D-06 |
| C3 | Ningún adaptador consume `invoice.issue` | Contrato y credenciales del facturador |
| C4 | Correo transaccional (Graph/Vault) no verificado | Operador; `notifications-test` en QAS |
| C5 | Base legal de la recuperación de carritos sin confirmar | Responsable legal/negocio antes de encender el ajuste |
| C6 | Tenants ya sincronizados sin `payments`/`fulfillment`/`catalog.advanced` los perderían | Revisión de `tenant_platform_context` previa (manifiesto §0) |
| C7 | Secretos nuevos: `EBIM_PAYMENTS_ALLOW_SIMULATION` (solo DEV/QAS) y re-aprovisionar `EBIM_WH_<company>_<ref>` | Manifiesto §3 |
| C8 | `npm ci` exige Node ≥ 22.13 con el árbol actual | Build con Node 24 o actualizar `engines` |
| C9 | Heredadas del RC: Redirect URLs de Auth, reescritura de SPA en Amplify, usuarios de demo, smoke y preflight contra QAS | Manifiesto del RC `0395ca3` §4–§6 |

## Commits del cierre (desde `5e3da4e`)

`git log --oneline 5e3da4e..c5066af` (más este documento en el commit siguiente). Principales: `fe2e87a` crédito ·
`e54b4a8` `4f050c2` cotizaciones · `bae16bc` `707e044` aprobaciones · `1debe36` `0cc6cdd` `fcc5184` pedido rápido/CSV ·
`ae2f295` programados · `a9d52ad` canales · `36dff86` sugerido v2 · `633c8bb` `f7b83df` `0effee5` carritos
abandonados · `d76e294` `fd1c610` `2f93f98` `255f3c9` relaciones y reseñas · `36e0c72` `2d108fc` `16d34ff`
facturación y `secret_ref` · `7d51dc4` `5c95c07` candados · `ddc9423` `check:edge` · `7497baf` `e7da3ca` pagos ·
`4f490f5` presupuesto · `39f3d68` `cart_open` · `c5066af` E2E del cierre.

## Qué NO se verificó

Nada contra DEV/QAS/PRD; ningún proveedor real; Postgres 15 real; accesibilidad WCAG y QA visual no repetidos en
este cierre (el RC anterior los certificó sin cambios de diseño; las pantallas nuevas usan los componentes del
design system pero no pasaron la batería visual de 792 comprobaciones); rendimiento en navegador más allá del
presupuesto de bytes.
