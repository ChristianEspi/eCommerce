# N00 — Línea base post-H14 (segunda noche)

Medido el 2026-09-13 en esta máquina (macOS, Darwin 25.6), **antes de cambiar código**. Todas las
cifras salen de ejecuciones de esta sesión; ninguna se copió de `docs/demo-hardening/`.

## Punto de partida

| Dato | Valor |
|---|---|
| Rama de trabajo | `feature/demo-commerce-hardening-v2`, creada desde el HEAD de `feature/demo-commerce-hardening-v1` |
| Commit base | `ec52bab` — docs: informe final del hardening multi-commerce |
| Última migración | `20260913120000_store_default_country.sql` (152 archivos) |
| Node / npm | v24.20.0 / 11.19.0 |
| Archivos sucios al empezar | `docs/quality/` sin seguimiento (previo a H00; no se toca ni se commitea) |
| `.env` | No existe (solo `.env.example`) |
| Buzón EBIM | `coordinacion/pendientes/` revisado en lectura: el mensaje más reciente es de 2026-08-20; nada nuevo `to: ecommerce` / `to: all` desde H14 |

## H00–H14 presente

| Pieza | Presente |
|---|---|
| `supabase/migrations/20260913100000_consumer_account.sql` | sí |
| `supabase/migrations/20260913110000_commerce_context.sql` | sí |
| `supabase/migrations/20260913120000_store_default_country.sql` | sí |
| `e2e/commerce/consumer.e2e.ts` | sí |
| `e2e/commerce/trade.e2e.ts` | sí |
| `e2e/commerce/enterprise.e2e.ts` | sí |
| (además) `e2e/commerce/responsive.e2e.ts`, `e2e/commerce/support.ts`, `scripts/e2e-local-fixtures.mjs` | sí |

## Gates (en serie, desde `npm ci`)

| Comando | Resultado | Cifras |
|---|---|---|
| `npm ci` | PASS | 414 paquetes |
| `npm run typecheck` | **PASS** | limpio |
| `npm run lint` | **PASS** | 0 problemas |
| `npm run test` | **FAIL — KNOWN_BASELINE_FAILURE** | 196 archivos (194 ✓, 2 ✗) · **3 796 tests: 3 790 ✓, 6 ✗** · 4 errores no controlados |
| `npm run test:db` | **PASS** | 82 archivos · **2 185 ✓** |
| `npm run build` | **PASS** | 1 691 módulos |
| `npm run bundle:report` | **PASS** | portada 400,3/405 · ficha 384,2/400 · checkout 401,9/430 · panel 359,9/430 |
| `npm run scan:secrets` | **PASS** | sin hallazgos (220 archivos de `dist/`, 1 040 versionados) |

`npm run test` incluye `supabase/tests` (no hay `include` en la configuración): «unit» es la suite
completa y «DB» su subconjunto.

### Los 6 fallos son los mismos de H00/H14

Comparados por nombre y por causa, no por número:

| # | Test | Causa observada hoy |
|---|---|---|
| 1 | `src/app/auth-flow.test.tsx` › sin sesión, /app manda al login | `TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal` (undici de Node 24 contra el `AbortSignal` de jsdom) |
| 2 | `auth-flow.test.tsx` › un usuario sin espacio entra, es llevado al alta y termina en el panel | igual que #1 |
| 3 | `auth-flow.test.tsx` › un comprador acaba en el panel de SU tienda, no en el cartel | igual que #1 |
| 4 | `auth-flow.test.tsx` › cerrar sesión devuelve al login | igual que #1 |
| 5 | `auth-flow.test.tsx` › sin vínculo de compra no se adivina: se deja el cartel y una puerta | sin `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` |
| 6 | `src/features/storefront/landing.test.tsx` › con UNA tienda activa, ofrece verla por su nombre | igual que #5 |

Los 4 errores no controlados son el mismo `AbortSignal` (4 apariciones en el log). Coinciden uno a uno con
`docs/demo-hardening/BASELINE.md`. Se atacan en N08.

## E2E (pila local desechable)

La pila de H09–H14 ya no existía en Docker; se reconstruyó con la receta de
`docs/demo-hardening/FINAL_REPORT.md` (copia de `supabase/` fuera del repo, `project_id
ecommerce-hardening-local`, puertos 553xx, Postgres 17 cacheado, 152 migraciones aplicadas una a una con
`ON_ERROR_STOP`, única sentencia omitida en la copia: `alter table storage.objects enable row level
security`; `seed.sql` + `demo-data.sql`; `scripts/e2e-local-fixtures.mjs`). Las otras dos pilas locales de
la máquina no se tocaron. **Ningún E2E se ejecutó contra DEV/QAS.**

| Proyecto | Ejecución 1 (base recién creada) | Ejecución 2 (tras reponer fixtures) |
|---|---|---|
| escritorio | 12/12 | 12/12 |
| movil | 12/12 | 12/12 |
| comercio-escritorio | **9/10** | 10/10 |
| comercio-movil | 10/10 | 10/10 |
| **Total** | **43/44** | **44/44** |

### El fallo de la ejecución 1 es un defecto real previo (no de entorno)

`[comercio-escritorio] e2e/commerce/consumer.e2e.ts:61` › B2C · consumidor registrado › entra, compra, y
encuentra el pedido en Mi cuenta → Mis pedidos:
`expect(getByText('Av. Arequipa 100').first()).toBeVisible()` falla en «Mis direcciones».

Con la base **vacía** el pedido aparece en «Mis pedidos», pero «Mis direcciones» dice «Todavía no hay
direcciones»: el checkout leyó `my_checkout_profile` (vacío, primera compra) y lo dejó en caché 60 s con
la clave `checkoutProfileKey`; nada lo invalida al confirmar el pedido y la pestaña reutiliza ese vacío.
En la segunda ejecución la dirección ya existía de la primera, y por eso pasa: en H14 la pila no estaba
vacía y lo tapaba. Se clasifica como **defecto previo conocido** y se corrige en N06 (libreta), que es
donde esa pantalla cambia.

## Qué NO se hizo en N00

- No se modificó código, migraciones, tests ni configuración.
- No se tocó ninguna base remota.
