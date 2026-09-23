# Storefront V2 + Design Workspace V2 — estado de ejecución

Ejecución del pack `EBIM_ECOMMERCE_STOREFRONT_V2` (P00–P14) en este repositorio.

- **Inicio:** 2026-09-23 (hora local de la máquina del operador)
- **Rama de trabajo:** `feat/storefront-v2-design-workspace` (creada desde `dev`)
- **HEAD inicial (P00):** `cd7a82d1715dd346169572d99749434969119835`
- **PUSH:** NO · **DEPLOY:** NO · **MIGRACIONES REMOTAS:** NO

## Trabajo ajeno protegido

El árbol de trabajo NO estaba limpio al empezar. Se conserva tal cual y no entra en ningún commit
de estas fases:

- 11 borrados sin preparar bajo `claude-overnight/logs/` (`20260827-*.log`).
- Dos entradas sin seguimiento: `EBIM_ECOMMERCE_STOREFRONT_V2/` y `EBIM_ECOMMERCE_STOREFRONT_V2.zip`
  (el propio pack).

Cada commit de fase nombra sus rutas explícitamente; no se usa `git add -A`, `git reset`,
`git clean` ni `git checkout --`.

## Lineamientos EBIM: accesibilidad real en esta máquina

`CLAUDE.md` apunta a `<unidad>:\.shortcut-targets-by-id\18Epk…\EBIM-Plataforma\`. En esta máquina
las unidades montadas son `C:`, `E:` y `G:`; `G:\.shortcut-targets-by-id` está vacío y no existe
`G:\Mi unidad\EBIM-Plataforma.lnk` (se verificó el acceso directo, no solo la ruta). **Los ficheros
fuente del contrato no son legibles ahora mismo.**

No es un bloqueo de esta ejecución, y la razón es concreta:

- `COMMON_RULES.md` condiciona la lectura a que estén accesibles;
- el repositorio conserva la transcripción verificada en `docs/EBIM_GUIDELINES_TRACE.md`
  (`GUIDELINES_STATUS: VERIFIED`, contrato v1.15, lectura directa 2026-08-27) y en `CLAUDE.md`;
- este pack **no modifica** contratos de identidad, claims, jerarquía ni Platform Context API, que
  son los cambios que el contrato declara *breaking* y que exigirían propuesta al buzón.

Consecuencia operativa: no se pudo revisar `coordinacion\BANDEJA.md` ni `coordinacion\pendientes\`
en esta sesión. Queda registrado como pendiente real para el operador.

## Desvío declarado frente a `docs/VISUAL_REDESIGN_PLAN.md`

Ese plan (§2) prohibía tocar `supabase/` porque describía una corrida **solo visual**. El pack
Storefront V2 ordena expresamente crear migraciones nuevas (P01 value propositions, P02 logos de
marca, P03 media de categorías, P08 best-sellers). Manda la orden del operador para esta ejecución;
las reglas que no se negocian —migración nueva e inmutabilidad de las aplicadas, RLS default deny,
tenant del JWT, grants por columna— se conservan íntegras.

---

# P00 — Baseline y auditoría previa

## Entorno

| Elemento | Valor |
|---|---|
| Node | v24.20.0 |
| npm | 11.19.0 |
| `node_modules` | ausente al empezar; instalado con `npm ci` (422 paquetes) |
| Supabase CLI | **no instalado** |
| Docker | **no disponible** |

`npm ci` avisa de que el `postinstall` de `esbuild@0.25.12` no está aprobado (`allowScripts`); el
build de Vite funciona igualmente, así que no se fuerza nada.

## Gates de baseline (sobre HEAD `cd7a82d`, sin tocar código)

| Comando | Resultado |
|---|---|
| `npm run typecheck` | **PASS** (`tsc --noEmit`, exit 0) |
| `npm run lint` | **PASS** (`eslint .`, exit 0) |
| `npm run test` | **PASS** — 281 ficheros, 5495 tests, 231 s |
| `npm run build` | **PASS** (`vite build`, 9.8 s) |

Sin fallos preexistentes. Dos avisos que ya venían y no son de esta ejecución:

- trozos por encima de 400 kB (`RichTextEditor`, `index`);
- `VITE_SUPABASE_URL no definida: no se genera _headers ni la CSP` — es lo esperado en local sin
  `.env`, no un fallo del build.

Los tests de base **sí corren en local**: `supabase/tests/*` usa PGlite (Postgres 18 en WASM) y
aplica las migraciones reales, así que las fases con migración pueden validarse sin tocar nada
remoto. Lo que NO se puede hacer aquí es `npm run db:types`: exige el CLI de Supabase con proyecto
enlazado o una base local por URL, y ninguna de las dos existe en esta máquina.

## Fotografía del punto de partida (verificada con búsqueda, no de memoria)

### 1. Copy farmacéutico en defaults globales — CONFIRMADO

`src/shared/i18n/messages.es.ts` / `messages.en.ts`, claves de suite que ve **cualquier** tienda:

| Clave | ES | EN |
|---|---|---|
| `store.brands.eyebrow` | «Laboratorios del catalogo» | «Catalogue labs» |
| `store.services.advice` | «Atención farmacéutica» | «Pharmacist support» |
| `store.trust.subtitle` | «Distribuidor autorizado: cada lote llega con registro sanitario y trazabilidad.» | equivalente |

Además, claims no verificables presentados como hechos universales:
`store.trust.original` («Productos originales») y `store.services.pickup` («Retiro en tienda»,
matizado solo con «Si el comercio lo ofrece»).

`StoreServicesStrip` tiene los cuatro servicios **cableados** en una constante `SERVICIOS`: no hay
ninguna configuración por tienda. `BrandRow` y `BrandTrustStrip` consumen esas claves directamente.

También hay vocabulario de rubro en comentarios de producción (`BrandRow.tsx`, `BrandTrustStrip.tsx`,
`ProductCard.tsx`, `StoreCategoryNav.tsx`, `StoreFeaturedHero.tsx`, `CheckoutSummary.tsx`,
`SectionRegistry.tsx`): no llega a la pantalla, pero contradice el principio multi-industria y se
limpia en P01.

### 2. `brands.logo_url` — EXISTE EN BASE, SE PIERDE ENTERO EN EL FRONTEND

- `public.brands.logo_url text` con `brands_logo_len check (… between 4 and 1024)`
  (`20260827170000_pim_catalog.sql`).
- `grant select (id, code, name, logo_url, is_active) on public.brands to anon` — ya concedido.
- `brands_select_public` (anon) exige `is_active` y que algún producto publicado de tienda activa
  la use.
- **Dónde se pierde:** `src/features/catalog/pim/types.ts` → `brandSchema` no declara `logo_url`;
  `pim/api.ts` → `CATALOG_ENTRY_SELECT = 'id, code, name, description, is_active'`; el formulario de
  `CatalogEntrySection.tsx` solo tiene nombre, código y activo. En la vitrina, las marcas llegan por
  las **facetas** de `catalog_search_for_slug` (`search.ts` → `facetCountSchema`: `code`, `name`,
  `count`) y ahí no hay logo. Buscar `logo_url` en `src/` no da ni un consumidor de marca.
- **Riesgo declarado para P02:** `brands` es de la SOCIEDAD (no lleva `store_id`), pero el bucket
  `store-assets` autoriza por ruta `{organization_id}/{store_id}/…` (`ebim.can_write_store_object`).
  No se puede reutilizar a ciegas: hace falta una ruta y una autorización company-scoped propias.
- `product_families` comparte `brandSchema` y pantalla con `brands`. Separar el tipo es requisito de
  P02 para que las familias no hereden campos de marca.

### 3. Media de categorías — NO EXISTE

`public.categories` (`20260827090300_catalog.sql`): `id, organization_id, company_id, store_id,
parent_id, slug, name, position, is_active, created_at, updated_at`. Ninguna columna de imagen.
`public.public_categories` expone `category_id, store_id, parent_id, slug, name, position`.
`CategoryDoorItem` es `{ category_id, name, slug }` y `CategoryDoor` compone con `tintFor(name)` +
icono derivado del nombre, con una marca de agua del mismo icono. Requiere migración nueva en P03.

### 4. `heroVariant` y `categoryVariant` — HUÉRFANOS, CONFIRMADO

Barrido de las siete claves del contrato sobre `src/` (excluyendo tests):

| Clave | Consumidor real | Veredicto |
|---|---|---|
| `headerVariant` | `themeCssVars` (alto de barra) + `data-store-header` + CSS | efecto real |
| `heroVariant` | solo `presets.ts`, `schema.ts`, `normalize.ts`, `types.ts` y el selector del editor | **sin efecto** |
| `productCardVariant` | `data-store-cards` + CSS (medidas de tarjeta) | efecto real, solo métrico |
| `categoryVariant` | solo contrato + editor | **sin efecto** |
| `contentWidth` | `StorefrontLayout` (×2) y `StoreFooter` | efecto real |
| `imageRatio` | `--sf-image-ratio` → `ProductMedia` | efecto real |
| `sectionSpacing` | `--sf-section-gap`, `--sf-main-pad`, `data-store-spacing` | efecto real |

Qué hace hoy la portada en su lugar: `SectionRegistry.hero` elige `StoreFeaturedHero` si hay
productos rebajados y cae a `StoreHero` si no — **sin mirar `heroVariant`**. Las categorías de la
portada pintan siempre `CategoryDoorGrid` (azulejos); las píldoras (`CategoryBar`) existen pero solo
en la vista de catálogo, y nunca se eligen por tema. Es decir: `premium` no usa `statement` y
`catalog` no usa `pills`, aunque sus presets lo declaren.

### 5. `best-sellers` — CLAIM FALSO, CONFIRMADO

`StoreHomePage.tsx:264`: `masVendido: tomar(products, 12)`, donde `products` es la primera página del
**catálogo ordenado por relevancia** (`sort: relevance`). No hay ni una consulta de pedidos ni
agregado de ventas. La sección se rotula con `store.row.featured` = «Lo más vendido»,
`store.row.featuredEyebrow` = «Lo que mas sale» y `store.row.featuredSubtitle` = «Los productos que
mas repiten nuestros clientes.» Tres afirmaciones sobre ventas sostenidas por relevancia de búsqueda.

Segundo caso: `store.row.newSubtitle` = «Lo ultimo que ha entrado al almacen esta semana.» La fuente
real es orden `recent` sobre `published_at` del catálogo publicado — publicación en tienda, no
entrada a almacén, y sin garantía de «esta semana». `store.content.campaignWall` y
`store.row.weekDeals` dicen «Ofertas de la semana» sin que la vigencia real sea semanal.

### 6. Preview desktop/tablet/mobile — NO SIMULA NADA

`StorefrontPreview.tsx`: `MARCOS` = desktop 1280 / tablet 768 / mobile 390, aplicados como
`style={{ width: ancho }}` sobre un `Box`. Las media queries de MUI y de `storefront.css` siguen
leyendo el **viewport real del navegador**, así que en un monitor de escritorio el marco «mobile»
es un recorte de 390 px del layout de escritorio.

Peor aún, el preview consume a mano las variables `-md`: `var(--sf-main-pad-md)`,
`var(--sf-section-gap-md)`, `var(--sf-hero-min-md)`, `var(--sf-hero-title-md)`,
`repeat(var(--sf-grid-lg, 4), …)`, `var(--sf-card-pad-md)`. Son los valores de escritorio **por
construcción**: el marco mobile nunca puede enseñar los de móvil.

Y el contenido son rectángulos de `var(--sf-media-bg)` (`PreviewCard`, `PreviewSection`): de ahí la
sensación de «skeleton cargando» que P13 tiene que arreglar. El canvas es `overflowX: auto` sin
centrado, lo que en ultrawide deja el gris a la derecha que describe P10.

### 7. Pantalla «Diseño de tienda» — formulario largo, preview al final

`StorefrontDesignSection.tsx` (277 líneas) apila en una columna: 4 tarjetas de tema (texto, sin
mini-preview), rejilla de los 7 selectores sin agrupar ni colapsar, `HomeLayoutEditor` (13 filas con
switch, tope y flechas) y, al final, `StorefrontPreview`. No hay dos columnas, ni preview sticky, ni
modo Enfoque/Comparar, ni contador visible de personalizaciones junto al preview (el `pisados` existe
pero solo habilita el botón «Restablecer»).

### 8. Secciones declaradas sin componente

`SectionRegistry`: `business-info` y `newsletter` devuelven `null`.
`HomeLayoutEditor.SIN_IMPLEMENTAR` contiene las dos y las muestra desactivadas.
`business-info` es implementable con datos que ya existen (P09); `newsletter` no, porque no hay
backend de suscripción ni consentimiento.

### 9. Filas y huecos con poco contenido

`ProductRow` → `LoopingRow` con `itemWidth={168}`, y `ProductGrid` con
`repeat(var(--sf-grid-lg,4), minmax(0,1fr))` + `gridAutoRows: 1fr`. Con 1–3 productos la fila
mantiene el ancho completo y deja el resto vacío. `CategoryDoorGrid` ya adapta
(`PUERTAS_A_LO_ANCHO = 4`: rejilla hasta 4, carrusel a partir de 5); es el patrón a generalizar en P06.

### 10. Tests que fijan contratos a respetar

- `storefront-a11y-seo.test.tsx`, `storefront-content.test.tsx`: **exactamente un `h1`** en la portada.
- `theme/multi-industry.test.tsx`: ya existe y recorre 4 rubros × 4 temas con datos, no ramas.
- `theme/presets-behaviour.test.ts`, `theme/theme-parity.test.tsx`, `theme/theme-hardening.test.tsx`,
  `components/hero-theme.test.tsx`, `admin/settings/storefront-design.test.tsx`,
  `admin/settings/settings-theme.test.ts`, `ProductCard.theme.test.tsx`, `layout-theme.test.tsx`.
- `src/architecture.test.ts`: sin uuid literal en producción, sin nombres de cliente/proveedor,
  sin `dangerouslySetInnerHTML`, y toda carpeta de `features/` en una frontera declarada.
- `supabase/tests/schema-invariants.test.ts`: RLS activada y forzada en toda tabla, sin policy
  permisiva para `PUBLIC`, `organization_id`+`company_id` en toda tabla de negocio, y **cada
  migración que crea tabla activa RLS en el mismo archivo**.
- `supabase/tests/public-rpc-gates.test.ts`: toda constante de RPC de `db-schema.ts` tiene función
  en `public`.

## Resultado

Fotografía completa y verificable del punto de partida; ningún cambio de UI, contrato ni migración
en esta fase; ningún cambio ajeno perdido.

`PHASE_RESULT: PASS`
