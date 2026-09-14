# R00 — Línea base del Release Candidate (tercera noche)

Medido el 2026-09-13 en esta máquina (macOS, Darwin 25.6), **antes de cambiar código**. Todas las cifras salen de
ejecuciones de esta sesión (instalación limpia con `npm ci`); ninguna se copió del informe N12.

## Punto de partida

| Dato | Valor |
|---|---|
| Rama de trabajo | `feature/demo-commerce-release-candidate`, creada desde `feature/demo-commerce-hardening-v2` |
| Commit base | `4c1b511` — docs: informe final de la segunda noche del hardening multi-commerce (también en `origin/feature/demo-commerce-hardening-v2`) |
| Última migración | `20260913160000_consumer_addresses.sql` |
| Node / npm | v24.20.0 / 11.19.0 |
| `package-lock.json` SHA-256 | `78a8dd13afccec3b5250b266572ed461d5ddbcf65f931309d155bf59328e1700` |
| Archivos sucios al empezar | `docs/quality/` sin seguimiento (previo; no se toca) |
| Procesos sobre `node_modules` antes de `npm ci` | ninguno de este repo. El puerto 5173 lo ocupa el Vite de OTRO proyecto (`apt-supervisor`); no se tocó y los E2E se corren en el 5199 (ver abajo) |
| `.env` | no existe |

## Gates (en serie, `dist/` borrado antes)

| Comando | Resultado | Cifras |
|---|---|---|
| `npm ci` | PASS | 414 paquetes añadidos, 415 auditados. Avisos: `whatwg-encoding` y `eslint@9` deprecados; npm 11 informa scripts de instalación no aprobados (`esbuild`, `fsevents`) — el build funciona con el binario opcional |
| `npm run typecheck` | **PASS** | limpio |
| `npm run lint` | **PASS** | 0 problemas |
| `npm run test` | **PASS** | 205 archivos · **3 922 ✓ · 0 ✗** · 0 errores no controlados (60,7 s) |
| `npm run test:db` | **PASS** | 87 archivos · **2 252 ✓** (25,5 s) |
| `npm run build` | **PASS** | 1 700 módulos |
| `npm run bundle:report` | **PASS** | portada 402,3/405 · ficha 386,2/400 · checkout 404,6/430 · panel 360,7/430 |
| `npm run scan:secrets` | **PASS** | sin hallazgos |
| `npm audit` | 4 moderadas, 0 altas, 0 críticas | `react-router-dom` (directa) → `react-router`; `vitest` (directa) → `@vitest/mocker`. Las dos correcciones ofrecidas son majors. Detalle en R04 |

## E2E (pila local desechable)

Pila `ecommerce-hardening-local` (Postgres 17.6, Supabase CLI 2.116, puertos 553xx) con las 156 migraciones hasta
`20260913160000`, fixtures repuestas con `scripts/e2e-local-fixtures.mjs`. Como el 5173 está ocupado por otro proyecto
y `playwright.config.ts` reutiliza el servidor existente, se usó una config fuera del repo que importa la del repo y
solo cambia el servidor de desarrollo al puerto 5199 (`reuseExistingServer: false`). Mismos proyectos, mismos tests.

| Proyecto | Resultado |
|---|---|
| escritorio | 12/12 |
| movil | 12/12 |
| comercio-escritorio | 16/16 |
| comercio-movil | 16/16 |
| **Total** | **56/56** (2,0 min) |

Ningún E2E contra DEV/QAS.

## Gap conocido que abre R01

En la Edge Function `checkout`, `validateDelivery()` llama a `delivery_options_for_slug` con `service_role`: el
subtotal que evalúa el umbral de envío gratis sale a precio público para Trade/Enterprise, mientras `create_order`
cobra con el precio comercial. La vitrina ya llama a la misma RPC con la sesión.

## Qué NO se hizo en R00

Ni código, ni migraciones, ni configuración. Solo este documento.
