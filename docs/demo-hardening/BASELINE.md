# H00 — Línea base del hardening multi-commerce

Medido el 2026-09-13, **antes de tocar código**, sobre esta máquina (macOS, Darwin 25.6).
Todas las cifras salen de ejecuciones de esta sesión; ninguna se copió de informes anteriores.

## Punto de partida

| Dato | Valor |
|---|---|
| Rama de trabajo | `feature/demo-commerce-hardening-v1`, creada desde `dev` |
| Commit base | `1bcf74f` — docs(estado): notificaciones construidas y lo que queda bloqueado por el operador |
| Última migración | `supabase/migrations/20260912130000_sugeridos_del_comprador.sql` (149 archivos) |
| Node / npm | v24.20.0 / 11.19.0 (también hay v20.20.2 instalado vía nvm) |
| Archivos sucios al empezar | `docs/quality/` sin seguimiento (3 archivos de problemas de VS Code). **No es de esta ejecución y no se toca ni se commitea.** |
| `.env` | **No existe** en esta copia del repo (solo `.env.example`). Ver «Entorno». |

## Gates

| Comando | Resultado | Cifras |
|---|---|---|
| `npm ci` | PASS | 414 paquetes; `npm audit`: 4 moderadas |
| `npm run typecheck` | **PASS** | limpio (7 s) |
| `npm run lint` | **PASS** | 0 problemas |
| `npm run test` | **FAIL — KNOWN_BASELINE_FAILURE** | 187 archivos (185 ✓, 2 ✗) · **3 692 tests: 3 686 ✓, 6 ✗** · 4 errores no controlados |
| `npm run build` | **PASS** | 1 680 módulos, 2,3 s |
| `npm run test:db` | **PASS** | **77 archivos · 2 131 tests · 0 fallos** (PGlite) |
| E2E (`npx playwright test`) | **NO EJECUTABLE** | sin `.env` no hay backend al que apuntar la vitrina |
| `node scripts/demo-preflight.mjs` | **NO EJECUTABLE** | lee `.env` (`VITE_SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN`) |

## KNOWN_BASELINE_FAILURE — los 6 tests de `npm run test`

Los seis son **de entorno, no de producto**. Se aislaron y se reprodujeron uno a uno:

| # | Test | Causa | Prueba de la causa |
|---|---|---|---|
| 1 | `src/app/auth-flow.test.tsx` › sin sesión, /app manda al login | Node 24: `undici` rechaza el `AbortSignal` de jsdom que usa `createMemoryRouter` al navegar (`TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal`) | Pasa con Node 20.20.2 |
| 2 | `auth-flow.test.tsx` › un usuario sin espacio entra, es llevado al alta y termina en el panel | igual que #1 | Pasa con Node 20 |
| 3 | `auth-flow.test.tsx` › un comprador acaba en el panel de SU tienda, no en el cartel | igual que #1 | Pasa con Node 20 |
| 4 | `auth-flow.test.tsx` › cerrar sesión devuelve al login | igual que #1 | Pasa con Node 20 |
| 5 | `auth-flow.test.tsx` › sin vínculo de compra no se adivina: se deja el cartel y una puerta | `isSupabaseConfigured` es `false` sin `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`, y `useDefaultStoreSlug` no consulta | Pasa con esas dos variables con valor ficticio |
| 6 | `src/features/storefront/landing.test.tsx` › con UNA tienda activa, ofrece verla por su nombre | igual que #5 | Pasa con esas dos variables con valor ficticio |

Comprobación cruzada: con **Node 20 + las dos variables ficticias**, los dos archivos dan **12/12 PASS**.
Los 4 errores no controlados son el mismo `AbortSignal` de #1–#4.

Consecuencia para el resto de fases: el delta de regresión se mide contra **estos 6 exactos**. Un
fallo nuevo, o uno de estos seis con otro motivo, es regresión.

## Entorno

- **Sin `.env`.** Esta copia del repositorio no tiene credenciales del proyecto de DEV/QAS
  (`ehxlxbhtlmfgneiagdcj`). Por eso no se pueden correr ni los E2E contra datos reales ni el
  preflight tal cual. No se inventan ni se buscan credenciales fuera del repositorio.
- **Sí hay Docker y Supabase CLI 2.116.** Hay otras dos pilas locales levantadas por otros
  proyectos (`lumi-growth` en 54321/54322 y `ebim-control-plane` en 5442x); no se tocan. Una pila
  local propia, con puertos distintos, es la vía para E2E reales sin tocar DEV (se evalúa en H09).
- **Playwright 1.63** con Chromium instalado.

## Qué NO se hizo en H00

- No se modificó código, migraciones, tests ni configuración.
- No se ejecutó ningún seed ni se tocó ninguna base remota.
