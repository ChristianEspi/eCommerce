# Storefront V3 · Commerce Design System — estado de ejecución

Ejecución del pack `EBIM_ECOMMERCE_STOREFRONT_V3` (P00–P14) sobre este repositorio, que ya contiene
Storefront V2 completo.

- **Inicio:** 2026-09-23 (hora local del operador)
- **Rama de trabajo:** `feat/storefront-v3-commerce-design-system` (creada desde el HEAD con V2)
- **HEAD inicial (P00):** `b4dc01e8db8ec0608bb6cab546b2c150ff9a1161`
- **PUSH:** NO · **DEPLOY:** NO · **MIGRACIONES REMOTAS:** NO

---

# P00 · Línea base, rama y evidencia inicial

**Commit:** `<pendiente>` · **Ciclos correctivos:** 0 de 3

## Estado del workspace, y qué se protege

`git status --short --branch` al empezar:

```
## feat/storefront-v2-design-workspace...origin/feat/storefront-v2-design-workspace
 D claude-overnight/logs/20260827-*.log          (11 borrados sin preparar)
?? EBIM_ECOMMERCE_STOREFRONT_V2/  · V2.zip      (el pack anterior)
?? EBIM_ECOMMERCE_STOREFRONT_V3/  · V3.zip      (este pack)
```

**Nada de eso entra en ningún commit de estas fases.** Los once borrados bajo
`claude-overnight/logs/` son cambios ajenos que ya estaban antes de V2 y se conservan tal cual; los
dos packs se quedan sin seguimiento. Cada commit de fase nombra sus rutas explícitamente: no se usa
`git add -A`, ni `git reset`, ni `git clean`, ni `git checkout --`.

La rama V2 (`feat/storefront-v2-design-workspace`) ya tiene upstream y el operador la desplegó en
QAS, así que V3 parte de su HEAD sin tocarla.

## Lineamientos EBIM: qué se pudo leer

`CLAUDE.md` apunta a `<unidad>:\.shortcut-targets-by-id\18Epk…\EBIM-Plataforma\`. Se resolvió como
manda el propio fichero —no solo la ruta, también el acceso directo—:

- unidades montadas: `C:`, `E:`, `G:`;
- `G:\.shortcut-targets-by-id` existe y está **vacío**;
- en `G:\Mi unidad` **no hay** `EBIM-Plataforma.lnk` ni nada que coincida.

**Los ficheros fuente del contrato no son legibles en esta máquina**, igual que en V2. Se trabaja
contra `docs/EBIM_GUIDELINES_TRACE.md` (transcripción verificada, contrato v1.15, lectura directa
2026-08-27) y contra `CLAUDE.md`.

No es un bloqueo de esta ejecución: V3 toca **presentación y configuración** —tema, composición,
contenido del comercio—, y no claims, jerarquía ni Platform Context API, que son los cambios que el
contrato declara *breaking* y que exigirían propuesta al buzón antes de codificar.

Consecuencia operativa: tampoco hay `coordinacion/BANDEJA.md` ni `coordinacion/pendientes/` —ni en
Drive ni en el repo—, así que **no se pudo atender el buzón**. Queda como pendiente real para el
operador, igual que al cerrar V2.

## Supuestos V3 verificados contra el código

El pack da por hecho el estado que dejó V2. Comprobado en código, no en documentación:

| Supuesto de `P00` | Resultado | Dónde |
|---|---|---|
| `StoreValueProps` sin copy por industria | **confirmado** — el contenido sale de `resolveValueProps`; las únicas menciones de rubro son comentarios que explican la retirada | `components/StoreValueProps.tsx`, `valueProps.ts` |
| `brands.logo_url` llega al storefront | **confirmado** — `BRAND_SELECT` lo pide y `assetRef` lo filtra | `storefront/api.ts:144` |
| Categorías soportan imagen | **confirmado** — `image_url` en el esquema público | `storefront/types.ts:183` |
| `heroVariant` y `categoryVariant` con consumidor real | **confirmado** — los lee el registro de secciones para elegir composición | `home/SectionRegistry.tsx` |
| Best Sellers con ranking real o «Recomendados» | **confirmado** — `masVendidoEsReal` decide el título | `home/SectionRegistry.tsx` |
| Design Workspace con Focus/Compare | **confirmado** | `settings/StorefrontPreview.tsx` |
| `ProductRow` adapta 1–3 / 4–6 / 7+ | **confirmado** — `POCOS = 3`, `TOPE_REJILLA = 6` | `components/ProductRow.tsx:52-112` |

Ninguno refutado. V3 arranca sobre lo que el pack supone.

## Gates baseline

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 300 ficheros, 5925 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — los cuatro recorridos dentro del techo |
| `npm run scan:secrets` | **PASS** — sin hallazgos |
| `npm run test:db` | **PASS** — 136 ficheros, 3595 tests contra Postgres real (PGlite) |
| Playwright | **NOT_RUN** — ver abajo |

### Bundle baseline (gzip, hasta el primer pintado)

| Recorrido | entrada | ruta | total | techo |
|---|---|---|---|---|
| vitrina · portada | 275,9 | 122,9 | **398,8** | 405 |
| vitrina · ficha de producto | 275,9 | 101,3 | **377,1** | 400 |
| vitrina · checkout | 275,9 | 121,9 | **397,8** | 430 |
| backoffice · panel | 275,9 | 147,0 | **422,8** | 430 |

Es la referencia contra la que se mide V3: el trabajo no puede empeorarla.

### Playwright: por qué NOT_RUN

Hay `.env.local` con las claves publicables, así que el servidor de desarrollo **sí** podría
levantar —esto cambió respecto a V2—. Lo que falta son los **navegadores**: el CLI está instalado
(1.63.0) pero `AppData/Local/ms-playwright` está vacío, así que no hay con qué abrir una página.

Se marca `NOT_RUN`, nunca PASS. Se reintentará en P13, que es la fase donde la paridad visual lo
hace valioso.

## Defectos ajenos observados y NO corregidos aquí

- La colisión de versiones de migración que se cerró al final de V2 (`20260923100000` y
  `20260923110000` estaban ocupadas en remoto por migraciones que no existen en ninguna rama de este
  repositorio) sigue siendo un riesgo **de fuera**: si esas dos llegan algún día al repo desde otra
  rama, habrá dos ficheros distintos con la misma versión.
- Las cuatro migraciones de V2 **no están aplicadas en QAS**. Mientras no se apliquen, «Diseño de
  tienda» seguirá avisando de base pendiente — y hace bien: no puede ofrecer controles que no
  guardan. Es un pendiente del operador, no de estas fases.

`PHASE_RESULT: PASS`
