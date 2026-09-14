# Auditoría de dependencias — Release Candidate (R04)

`npm audit --json` sobre `package-lock.json` (`78a8dd13…0e1700`, 415 paquetes), 2026-09-13.

**Resultado: 4 moderadas · 0 bajas · 0 altas · 0 críticas.** Son **dos advertencias de fondo** contadas cuatro veces
(cada una aparece en el paquete directo y en su dependencia). Ninguna tiene una corrección PATCH/MINOR compatible:
las versiones instaladas ya son las últimas de su major. **No se aplicó ninguna actualización** y no se ejecutó
`npm audit fix --force`.

| Paquete (instalado) | Directa / transitiva | Runtime / dev | Advisory | Rango afectado | Corrección disponible | Aplicable a este SPA |
|---|---|---|---|---|---|---|
| `react-router-dom` 6.30.6 | directa | **runtime** (bundle) | vía `react-router` | 6.0.0-alpha.0 – 7.17.0 | 7.18.3 — **major** | ver abajo: **no explotable** |
| `react-router` 6.30.6 | transitiva (de `react-router-dom`) | **runtime** | GHSA-wrjc-x8rr-h8h6 — open redirect por barra invertida en `<Link>`/`useNavigate` (CWE-601, bypass de CVE-2025-68470) | ≥ 6.0.0 < 7.18.0 | 7.18.x — **major** | **no explotable** (evidencia abajo) |
| `react-router` 6.30.6 | transitiva | **runtime** | GHSA-337j-9hxr-rhxg — inyección de constructor en `deserializeErrors()` durante la hidratación SSR (CWE-470, CVSS 6.1) | ≥ 6.4.0 < 7.18.0 | 7.18.x — **major** | **no aplicable**: la app no hace SSR ni hidratación |
| `vitest` 3.2.7 | directa | **dev-only** | vía `@vitest/mocker` | 2.1.0-beta.1 – 4.1.10 | 5.0.0 según npm (4.1.11 corrige) — **major** | **no aplicable** a producción |
| `@vitest/mocker` 3.2.7 | transitiva (de `vitest`) | **dev-only** | GHSA-82fw-gwwq-j7x9 — path traversal / lectura arbitraria vía redirect mock (CWE-22, CVSS 5.9) | ≥ 2.1.0 < 4.1.11 | con `vitest` 4.1.11+ — **major** | **no aplicable** a producción; riesgo local bajo |

Últimas versiones de cada major (npm registry): `react-router-dom@6` → **6.30.6** (instalada); `vitest@3` → **3.2.7**
(instalada). No hay nada que actualizar dentro de la major.

## Evidencia de «no explotable»

### React Router — open redirect por barra invertida (GHSA-wrjc-x8rr-h8h6)

El ataque necesita que un valor controlado por un tercero llegue a `<Link to>` / `navigate()` / `<Navigate to>` con
forma `/\evil.com`. En este código las únicas entradas de navegación que vienen de fuera de la app son:

| Sumidero | Origen del valor | Defensa |
|---|---|---|
| `LoginPage` → `<Navigate to={from}>` | `location.state.from` o `?from=` | `returnPathFrom()` → `isInternalPath()` rechaza cualquier `\`, `//`, esquema y control (`src/features/auth/returnTo.ts`, `src/domain/href.ts`) |
| `StoreRegisterPage` (vuelta tras el alta) | `?from=` | ídem + debe ser de ESA tienda |
| `ForgotPasswordPage` / `ResetPasswordPage` | `?returnTo=` | ídem (`returnPathOr`) |
| Enlaces del CMS (`ContentBlocks`, `SliderBlock`, `RichText`) | datos del tenant | `safeHref()` (misma lista blanca) + CHECK `ebim.is_safe_href` en la base |

Pruebas que lo fijan: `returnTo.test.ts` (`/\evil.com`, `//evil.com`, `https://…`, `javascript:`, tabulador → ignorados),
`store-aware-auth.test.tsx` («un from `%2F%5Cevil.com` no es un redirector: acaba en /app»), `store-register.test.tsx`
y `security-baseline.test.ts` (enlace con barra invertida rechazado por el CHECK). El resto de `navigate()`/`<Link>`
usan rutas construidas por el código con slugs de la tienda resuelta, no texto de la URL.

### React Router — hidratación SSR (GHSA-337j-9hxr-rhxg)

La vitrina y el backoffice son un SPA con `createBrowserRouter`; no hay `StaticRouter`, `renderToString`,
`hydrationData` ni `window.__staticRouterHydrationData` en `src/` (búsqueda vacía). El código vulnerable
(`deserializeErrors` de la hidratación) no se ejecuta.

### Vitest / @vitest/mocker (GHSA-82fw-gwwq-j7x9)

Solo `devDependencies`: no entra en `dist/` ni en el despliegue. Vitest corre en local/CI sobre los tests del propio
repositorio, sin modo navegador, sin `--ui` ni API expuesta (`vite.config.ts`, `package.json`). El vector requiere
procesar un mock malicioso dentro de la ejecución de tests: implica ya poder escribir tests en el repo.

## Decisión

- **Sin cambios de dependencias en este Release Candidate.** Las dos correcciones son majors (`react-router-dom` 7,
  `vitest` 4/5) con cambios de API; hacerlas para silenciar avisos no explotables contradice el alcance (correctness
  > features) y el contrato de no regresión.
- **Follow-up recomendado** (fuera del RC): migración planificada a React Router 7 (modo librería) y a Vitest 4,
  cada una en su propia fase con la suite completa y E2E.
- 0 vulnerabilidades HIGH/CRITICAL → no hay condición de parada.

## Otros avisos de `npm ci` (no son vulnerabilidades)

- `whatwg-encoding@3.1.1` deprecado (transitiva de jsdom, dev-only).
- `eslint@9.39.5` fuera de soporte (dev-only).
- npm 11 informa scripts de instalación no aprobados (`esbuild`, `fsevents`); el build usa el binario opcional de
  esbuild y pasa.
