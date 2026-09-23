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

---

# P01 — Contenido multi-industria y propuestas de valor

**HEAD inicial:** `397e638` · **Commit de la fase:** ver tabla final · **Migración nueva:**
`supabase/migrations/20260923100000_storefront_value_props.sql`

## El problema, dicho exacto

La franja bajo la portada tenía sus cuatro servicios **cableados** en
`StoreServicesStrip.tsx`, y dos de ellos eran afirmaciones que el código no puede sostener:

- «Atención farmacéutica» — un hecho de la **plantilla** del comercio;
- «Retiro en tienda» — un hecho de su **local**.

Cualquier tienda las anunciaba. Además `store.brands.eyebrow` decía «Laboratorios del catalogo»,
`store.trust.subtitle` afirmaba distribución autorizada con registro sanitario y trazabilidad, y
`store.trust.original` colgaba una pastilla fija con «Productos originales» en todas las tiendas.

## La solución: tres capas, y la tercera no existe

1. **PLATAFORMA** — lo que el código puede afirmar de cualquier tienda porque lo hace él: el
   checkout tiene un paso de entrega donde se elige el método, y el cobro se procesa en el servidor.
   Son dos, más «atención al cliente» **solo si la tienda dio correo o teléfono** (anunciar
   «escríbenos» sin canal es mandar a alguien a una puerta cerrada). Viven en i18n; no ocupan fila.
2. **COMERCIO** — `store_settings.value_props`: hasta cuatro entradas con icono de lista cerrada,
   título (1–40) y apoyo opcional (1–90). Una botica escribe «Atención farmacéutica» y sale **solo
   en su tienda**; una zapatería escribe «Cambio de talla» y también.
3. **RUBRO** — no existe. No hay campo «a qué te dedicas» y no se añade: en cuanto existiera,
   alguien ramificaría por él.

Configurar **sustituye**, no completa: si se rellenara la lista del comercio con las de plataforma
hasta llegar a cuatro, quien quiso enseñar una cosa vería tres que no escribió.

Y «no configuró nada» (lista vacía) es distinto de «lo configuró y lo apagó»: en el segundo caso la
franja desaparece, porque apagar es una decisión suya y devolverle las de plataforma encima sería
ignorarla.

## Base de datos

Migración **nueva** `20260923100000_storefront_value_props.sql`:

- `ebim.value_prop_is_valid(jsonb)` — una entrada: claves ⊆ {`iconKey`,`title`,`body`,`enabled`},
  icono de los doce nombrados, título 1–40 con contenido tras recortar, apoyo opcional 1–90,
  `enabled` booleano, y **sin caracteres de control** (`!~ '[[:cntrl:]]'`: un salto de línea en un
  título parte la franja y vacía de sentido el tope de 40).
- `ebim.value_props_are_valid(jsonb)` — la lista: array de 0 a 4, todas válidas, **sin icono
  repetido**. Las dos con `coalesce(..., false)` envolviendo, porque un CHECK que se evalúa a NULL
  **pasa**.
- `store_settings.value_props jsonb not null default '[]'` + CHECK.
- `grant select (value_props) to anon, authenticated` y `grant update (value_props) to
  authenticated`. Nombrar la columna es obligatorio: el GRANT de tabla se retiró en la migración de
  white-label y una columna nueva no lo hereda.
- `public_stores` recreada (DROP + CREATE en migración nueva, nunca editando la aplicada) con
  `value_props` y `coalesce(..., '[]')` por el LEFT JOIN. `security_invoker = on` y filtro de tienda
  activa intactos. No entra ni una columna interna.

**No es premium.** No lo gatea `content.white_label` y hay dos pruebas que lo fijan: la tienda de
prueba no tiene el addon y aun así escribe su franja, y retirar entitlements no borra lo escrito.

## Texto libre: por qué no es un agujero

Lo único libre es el TEXTO, y el texto se pinta como texto (React escapa). Lo que decide
presentación —el icono— es lista cerrada. No hay ni un `like '%<script%'` en la migración: un filtro
solo detiene lo que alguien previó, y aquí no hay sitio donde ese marcado pudiera ejecutarse. La
prueba de base intenta meter `html`, `onClick`, `imageUrl`, `href` y `css` como claves: las cinco se
rechazan por no estar nombradas.

## Frontend

| Archivo | Qué cambia |
|---|---|
| `src/features/storefront/valueProps.ts` | **Nuevo.** Contrato: doce iconos, topes, `sanitizeValueProps` (lo que se guarda), `normalizeValueProps` (lo que se pinta), `PLATFORM_VALUE_PROPS` y `resolveValueProps`. Sin JSX y sin i18n cargado: recibe `t` como argumento, así que es puro y se prueba sin proveedor. |
| `src/features/storefront/components/StoreValueProps.tsx` | **Nuevo**, sustituye a `StoreServicesStrip.tsx` (borrado). Rejilla de 1–4 columnas según las entradas reales: con dos, cuatro columnas dejaban media franja vacía. |
| `home/SectionRegistry.tsx` | `services` pasa el `store`. El **identificador de sección se conserva**: cambiarlo rompería el `home_layout` ya guardado de cada tienda. |
| `components/BrandTrustStrip.tsx` | Fuera la pastilla «Productos originales» (afirmación sobre la cadena de suministro de otro). Copy neutral. |
| `components/BrandRow.tsx` | Copy y comentarios neutrales. |
| `admin/settings/ValuePropsSection.tsx` | **Nuevo.** Editor de hasta cuatro filas: icono, título, apoyo, visible, subir/bajar/quitar, «volver a las de la plataforma». Va en la pestaña **General** junto al contacto, no en Diseño: es contenido, no disposición. |
| `admin/SettingsPage.tsx` | Monta la sección nueva. |
| `admin/settings/types.ts` | `value_props` en `storeSettingsSchema` (cruda), `valuePropsField` (zod `strict`, ≤4, sin icono repetido) en `storeFormSchema`, y `sanitizeValueProps` en `toForm`. |
| `admin/settings/api.ts` | `value_props` entra en el grupo de columnas opcionales del sondeo de esquema y en el patch de guardado. |
| `storefront/types.ts` | `value_props: z.unknown()` — misma frontera que las tres del tema. |
| i18n ES/EN | 25 claves nuevas `store.valueProps.*` (título + 12 pares de sugerencia), 14 `settings.valueProps.*`. Retiradas las 9 `store.services.*` y `store.trust.original`. |

### Detalle que merece registro: el sondeo de esquema

`store_settings` se lee con lista explícita de columnas y PostgREST responde **400/42703** si una no
existe, tirando la pantalla de Configuración entera. Ya había un grupo de columnas opcionales para
las tres del tema; `value_props` entra en **ese mismo grupo** en vez de tener el suyo, y la razón
está escrita en el código: el 42703 dice que falta *una* columna, no cuál, y leerlo del texto del
error está prohibido en este repositorio (`architecture.test.ts`: ramificar por el mensaje del
servidor se rompe en cuanto cambia una palabra). Un grupo = una relectura. La consecuencia asumida:
mientras falte cualquiera de las cuatro columnas, Diseño y el editor de propuestas quedan apagados.
Es transitorio y apagar una pantalla que no puede guardar es mejor que perder lo que alguien escriba.

## Tests

| Archivo | Qué fija | Casos |
|---|---|---|
| `src/features/storefront/valueProps.test.ts` | **Nuevo.** El contrato. Incluye la prueba que da nombre a la fase: `PLATFORM_VALUE_PROPS` no contiene `pickup`, `expertise`, `certification`, `warranty`, `returns` ni `installments`. | 21 |
| `src/features/storefront/theme/multi-industry.test.tsx` | **Ampliado.** Franja sin vocabulario de rubro en los 4 escenarios; atención solo con contacto; claim especializado solo en la tienda que lo escribió; JSON basura no tumba la portada; franja apagada no deja caja vacía; el cierre ya no dice «Productos originales» ni «registro sanitario». | 47 (antes 33) |
| `src/features/admin/settings/value-props.test.tsx` | **Nuevo.** Editor con teclado: añadir, reordenar con botones, tope de 4, título vacío señalado en su fila, apoyo vacío se omite, el selector no ofrece iconos ya usados. | 16 |
| `supabase/tests/storefront-value-props.test.ts` | **Nuevo.** CHECK, GRANT por columna, aislamiento entre sociedades, lector sin escritura, `public_stores`, tienda sin fila de ajustes, `anon` sin UPDATE, no-premium. | 56 |
| `supabase/tests/storefront-theme.test.ts` | `value_props` entra en la lista «lo que el formulario envía se puede escribir» — la guarda del GRANT olvidado, que ya falló dos veces. | +1 |
| `supabase/tests/store-default-country.test.ts` | Inventario de columnas de `public_stores` actualizado con `value_props`. El test es una **puerta**: añadir una línea es la decisión explícita de publicar esa columna. | 9 |

### Búsqueda obligatoria de la fase

```
rg -n "Atención farmacéutica|Pharmacist support|Laboratorios del catálogo|Catalogue labs|registro sanitario|health registry|botica" src
```

Resultados: **ningún default global**. Lo que queda son (a) fixtures y nombres de tienda de prueba
(`botica-sur`, `hola@botica.pe`), (b) los tests que comprueban precisamente que ese texto NO aparece
salvo configurado, y (c) comentarios de `valueProps.ts` que explican la decisión. Se limpió además
vocabulario de rubro en comentarios de producción de `ProductCard`, `StoreCategoryNav`,
`StoreFeaturedHero`, `SectionRegistry`, `CheckoutSummary` y `portal.ts`.

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** (1 ciclo correctivo: `no-unused-vars` en un destructuring de descarte, resuelto reconstruyendo el objeto en vez de silenciarlo) |
| `npm run test` | **PASS** — 284 ficheros, 5599 tests |
| `npm run build` | **PASS** |
| DB (PGlite, migraciones reales) | **PASS** — 56 casos nuevos |

Ciclos correctivos usados: **2 de 3**.

1. `resolveValueProps` caía a las propuestas de plataforma cuando el comercio había apagado todas
   las suyas. Lo cazó una prueba propia. Causa raíz: se miraba la lista **normalizada** (solo
   encendidas) para decidir si la tienda tenía franja propia. Arreglado mirando la **saneada**.
2. Lint: destructuring con variable de descarte.

`PHASE_RESULT: PASS`
