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

---

# P02 — Logos de marca de punta a punta

**HEAD inicial:** `d5f437e` · **Migración nueva:**
`supabase/migrations/20260923110000_brand_logos.sql`

## Verificación del supuesto (obligatoria antes de tocar)

`public.brands.logo_url` existe desde `20260827170000` **y** `anon` ya tenía
`grant select (id, code, name, logo_url, is_active)`. Lo que faltaba no era la columna: era todo lo
demás. Confirmado línea por línea:

| Eslabón | Estado antes de P02 |
|---|---|
| `pim/types.ts` → `brandSchema` | sin `logo_url` |
| `pim/api.ts` → `CATALOG_ENTRY_SELECT` | `'id, code, name, description, is_active'` |
| `pim/api.ts` → `saveCatalogEntry` | escribía `code`, `name`, `is_active` |
| `CatalogEntrySection.tsx` | formulario de tres campos, sin subida |
| vitrina | marcas desde las **facetas** de la búsqueda: `code`, `name`, `count` |
| `grep logo_url src/` | ni un consumidor de marca |

## La decisión que gobierna esta fase: una marca NO es un asset de tienda

`store-assets` autoriza por ruta `{organization_id}/{store_id}/…`: `ebim.storage_store` saca el
segundo segmento y lo contrasta contra `public.stores`. Funciona para el logo de la tienda porque
el logo de una tienda es de esa tienda.

`public.brands` **no tiene `store_id`**, y es deliberado desde el PIM: «la misma marca se vende en
la tienda mayorista y en la minorista de la misma sociedad, y tenerla dos veces significa que un día
el logo se cambia en una y no en la otra».

Reutilizar la ruta de tienda habría exigido elegir UNA tienda como dueña del archivo: o el logo se
duplica —el problema que el PIM evitó— o cuelga de una tienda que mañana se cierra llevándose un
logo que la otra seguía usando. Así que la ruta es de la **sociedad**:

```
{organization_id}/company/{company_id}/brands/{uuid}.{ext}
```

El literal `company` del segundo segmento es lo que separa las dos familias de rutas en el mismo
bucket: con él, `ebim.storage_store` devuelve NULL y las policies de tienda no autorizan nada. Hay
dos pruebas de base que fijan exactamente eso en las dos direcciones.

## Base de datos (migración nueva)

1. **`ebim.is_brand_logo_ref(text, uuid, uuid)`** + constraint `brands_logo_ref`. Dos formas y
   ninguna más: `https://` externa (contrato §4.3) o ruta bajo el prefijo de la **propia** sociedad.
   Valida contra `organization_id`/`company_id` **de la fila**, nunca contra un argumento del
   cliente — hay una prueba que lo demuestra llamando a la función con el tenant equivocado.
   Rechaza además `http://`, `javascript:`, `data:`, travesía de directorios y —el caso más
   probable— una ruta con forma de asset de tienda.
2. **Storage company-scoped**: `storage_is_company_path`, `storage_company`,
   `can_write_company_object` y `company_object_visible`, más cinco policies nuevas sobre
   `storage.objects` (select/insert/update/delete de miembro con rol de catálogo, y select anónimo).
   Se **añaden** a las de tienda, no las sustituyen.
3. **`public.public_brands`** (`security_invoker = on`): marcas con producto publicado por tienda,
   con su logo, en una consulta. Sin `organization_id`, sin `company_id`, sin `description` y sin
   contadores —los contadores los dan las facetas, y dos fuentes para el mismo número discrepan—.

### El fallo que apareció al probar, y su precedente exacto

`company_object_visible` se escribió primero SIN `security definer`, y la prueba de lectura anónima
falló con `permission denied for table stores`. La causa: `anon` solo tiene
`grant select (id, slug, name, status, currency, domain)` sobre `public.stores`, y el cuerpo de una
función normal se ejecuta con los permisos de quien llama. Sin `definer`, la policy de Storage no
puede ni evaluarse y **el logo no se ve nunca**.

Es letra por letra el fallo que arregló `20260901100000_fix_public_store_asset_read.sql` para el
logo de la TIENDA —mismo síntoma («enseñaba las iniciales»), misma causa—. Se repitió la misma
solución en vez de inventar otra, con su obligación incluida: como la RLS de `stores` deja de
filtrar, **la condición de visibilidad va escrita en el cuerpo** (`status = 'active'`). Sin esa
línea, el logo de una marca de una sociedad con todas sus tiendas en borrador sería público; hay una
prueba que suspende la tienda y comprueba que el objeto desaparece para `anon`.

Lo que la función revela sigue siendo un booleano sobre una organización y una sociedad que quien
pregunta ya lleva escritas en la ruta.

## Separación marca / familia (requisito explícito de la fase)

`productFamilySchema` era `brandSchema`: el mismo tipo por comodidad, correcto mientras fueran
iguales. Con `logo_url`, esa comodidad ofrecía subir un logo a una clasificación interna y producía
un `insert` contra una columna que no existe. Ahora:

- **`productFamilySchema`** es la base (código, nombre, activo);
- **`brandSchema`** la extiende con `logo_url` (`catch(null)`: una fila con un valor que esta versión
  no sabe leer se lee como marca sin logo, no deja la tabla sin cargar);
- **`brandFormSchema`** extiende a `catalogEntryFormSchema`;
- **`saveBrand`** es su propia función y no `saveCatalogEntry` con un campo extra;
- **una sola pantalla** con la diferencia declarada en un sitio (`kind`), porque dos copias se
  separarían el día que una arregle un detalle de accesibilidad.

Hay pruebas de las dos mitades: la familia no ofrece el campo y al crearla el `insert` **no lleva**
`logo_url`; y `product_families` sigue sin columna de logo en la base.

## Frontend

| Archivo | Qué cambia |
|---|---|
| `catalog/api/brandLogos.ts` | **Nuevo.** `MAX_BRAND_LOGO_BYTES` (2 MB), `validateBrandLogo`, `buildBrandLogoPath`, `uploadBrandLogo`, `signedBrandLogoUrls`. Sin SVG: es un documento que puede llevar `<script>` y no hay sanitizador aprobado. La extensión sale del MIME, no del nombre. |
| `catalog/pim/BrandLogoField.tsx` | **Nuevo.** El hueco ES el botón (misma anatomía que el branding de tienda). `contain` y hueco cuadrado: un logo no se recorta. Mientras no hay logo se ve el monograma, no un rectángulo gris. |
| `catalog/pim/BrandMonogram.tsx` | **Nuevo.** Iniciales sobre el acento de suite. |
| `catalog/pim/CatalogEntrySection.tsx` | Reescrito: columna de logo en la tabla (una sola petición de firmas para la página visible), cajón propio de marca, cajón de familia sin logo, y `sugerirCodigo` extraído —la misma regla que los dos CHECK, escrita una vez—. |
| `catalog/pim/hooks.ts` | `useBrandLogoUrls` (un lote, no una firma por fila) y `useUploadBrandLogo` (no invalida: lo que cambia el estado es guardar). |
| `shared/lib/initials.ts` | **Nuevo.** `initials` sale de la vitrina a `shared`: el backoffice enseña las mismas marcas, y dos cálculos harían que «Laboratorios San Miguel» fuera «LS» arriba y «LM» abajo. `storefront/branding.ts` la reexporta. |
| `storefront/components/BrandLogo.tsx` | **Nuevo.** Logo real o monograma, `contain`, tamaño fijo, `onError` al monograma. `<img>` nativo y no `Box component="img"`: MUI se queda `width`/`height` como atajos de estilo y no llegan al DOM — y son justo los que evitan que la fila se mueva al cargar. |
| `BrandRow` / `BrandTrustStrip` | Usan `BrandLogo`. `BrandOption` gana `logoUrl` (ya firmado: firmar por tarjeta serían tantas peticiones como marcas). |
| `storefront/api.ts` + `hooks.ts` + `types.ts` | `fetchPublicBrands` / `usePublicBrands` / `publicBrandSchema`. `logo_url` pasa por `assetRef`, el mismo filtro que el logo de la tienda. |
| `StoreHomePage.tsx` | Cruza facetas (nombre, cuenta, orden por tamaño) con `public_brands` (logo) por `code`. Firma el lote entero con `useSignedStoreAssets`. |
| `db-schema.ts` | `PUBLIC_BRANDS_VIEW`, sin `satisfies` hasta regenerar tipos. |
| i18n ES/EN | 7 claves `pim.brands.logo.*`. |

### Degradación si la migración va por detrás

`fetchPublicBrands` devuelve `[]` ante cualquier error en vez de propagar: una base sin la vista deja
la portada **con las marcas de siempre, sin logos**, no sin marcas. Es el mismo criterio que
`fetchPublicVariants` con la migración de ejes.

## Tests

| Archivo | Casos |
|---|---|
| `supabase/tests/brand-logos.test.ts` | **Nuevo**, 38. Referencia del logo (12 rechazos nombrados), Storage de sociedad en las dos direcciones, lector sin escritura, `anon` sin insert, visibilidad por tienda activa, `public_brands` (borrador, programado, marca apagada, tienda suspendida, columnas exactas, `security_invoker`), aislamiento cruzado en ambos sentidos y `product_families` sin columna de logo. |
| `src/features/catalog/pim/brand-logos.test.tsx` | **Nuevo**, 18. Monograma sin logo, imagen firmada con `contain` + `lazy`, **una sola firma para tres logos** (la guarda del N+1), ruta de sociedad sin `store_id`, dos subidas nunca al mismo objeto, validador (SVG, HTML, 4 formatos, 0 bytes, límite exacto), subida antes de guardar, quitar sin borrar el objeto, y la familia sin campo ni `logo_url` en el `insert`. |
| `src/features/storefront/components/brand-logo.test.tsx` | **Nuevo**, 9. Logo real, monograma, `onError` → monograma, `alt=""` (el nombre lo lleva el enlace), `width`/`height` en el DOM, eyebrow sin vocabulario de rubro, enlaces al catálogo filtrado y el cierre sin claims. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 287 ficheros, 5664 tests |
| `npm run build` | **PASS** |
| DB (PGlite, migraciones reales) | **PASS** — 38 casos nuevos |

Ciclos correctivos usados: **3 de 3**, y los tres por causa raíz, no por síntoma.

1. **`company_object_visible` sin `security definer`.** Diagnóstico completo arriba. Lo delató una
   prueba de lectura anónima, y buscar el precedente (`20260901100000`) dio la solución exacta.
2. **Sesión de prueba sin claims de tenant.** El test del PIM usaba un objeto de sesión a mano, así
   que `can('catalog.write')` era falso y la pantalla se pintaba en modo lectura: siete casos
   fallaban por la misma causa. Se cambió a `makeSession()` + `effective_capabilities`, que es lo
   que ya hacía `pim-ui.test.tsx`.
3. **Dos fallos del utillaje, no del código.** (a) `width`/`height` sobre `Box component="img"` no
   llegan al DOM porque MUI los interpreta como atajos de estilo — se cambió a `<img>` nativo, que
   además es lo que de verdad evita el salto de layout; (b) el script de parcheo usaba
   `String.replace` con reemplazo de tipo cadena, y un `$` seguido de comilla en el texto activó la
   referencia `$'` de JavaScript duplicando medio fichero de prueba. El script ahora pasa el
   reemplazo como función; el fichero se reescribió.

`PHASE_RESULT: PASS`

---

# P03 — Fotografía opcional en las categorías

**HEAD inicial:** `77cf3cd` · **Migración nueva:**
`supabase/migrations/20260923120000_category_media.sql`

## Verificación del supuesto

`public.categories` no tenía ninguna columna de imagen y `public_categories` exponía
`category_id, store_id, parent_id, slug, name, position`. `CategoryDoorItem` era
`{ category_id, name, slug }` y la puerta se componía con `tintFor(name)` + icono derivado del
nombre. Confirmado antes de tocar nada.

## La regla que gobierna la fase

**La ausencia de imagen NO invalida la categoría.** Todo lo anterior sigue funcionando igual: sin
`image_url` la puerta se pinta con su tinte y su icono, que es lo que hacía —y lo correcto para un
catálogo de envases o de repuestos, donde la foto de la categoría no añade nada y mantenerla es
trabajo que nadie hará—. Nadie tiene que subir nada.

Con foto, la puerta **es** la foto: a sangre, `cover`, con degradado vertical que garantiza el
contraste del texto encima. Es lo que pide una tienda visual. Ninguno de los dos caminos mira el
rubro: lo que decide es si esa categoría tiene foto, y eso lo decide quien vende.

## Base de datos

- `ebim.is_category_image_ref(text, uuid, uuid)` + `categories_image_ref`: `https://` externa o ruta
  `{organization_id}/{store_id}/categories/…` de la **propia tienda**, validada contra las columnas
  de la fila. Rechaza `http://`, `javascript:`, `data:`, travesía de directorios, la carpeta
  `branding/` y el prefijo de otra tienda.
- `categories_image_len` (4..1024) y `categories_image_alt_len` (1..160 tras recortar, sin
  caracteres de control: un salto de línea en un alt lo lee un lector como frase partida y vacía de
  sentido el tope).
- `grant select (image_url, image_alt) on public.categories to anon`. Nada más: `categories` ya daba
  GRANT de tabla a `authenticated`, así que la escritura la sigue decidiendo
  `categories_update_catalog`.

### Una categoría SÍ es de una tienda (al contrario que una marca)

`public.categories` tiene `store_id` y su FK compuesta obliga a que la madre sea de la misma tienda.
Así que la ruta usa el prefijo de siempre y la autoriza `ebim.can_write_store_object`, que ya
existía: **esta fase no añade ni una policy de Storage**. Lo único nuevo es la carpeta
`categories/`, que el CHECK exige para que se pueda mirar el bucket y distinguir una foto de
categoría del logo de la tienda.

### El error que la ampliación de la vista casi introdujo

`public_categories` se escribió primero como `drop view` + `create view … where is_active`, copiando
su forma ORIGINAL. Aplica, la vista existe… y deshace en silencio la corrección de
`20260901130000`: desde entonces la vista es un **CTE recursivo** que solo enseña las categorías con
todo su camino activo, porque «una hija activa de una madre desactivada seguía saliendo en la
vitrina, y además como si fuera raíz».

Lo cazó `supabase/tests/category-tree.test.ts` al primer intento. Corregido a `create or replace`
sobre el cuerpo recursivo con las dos columnas **al final** —la única forma en que Postgres admite
reemplazar una vista existente, y además conserva los GRANT—. Queda además una prueba nueva en
`category-media.test.ts` que fija la herencia junto a la foto, porque es ahí donde se va a volver a
tocar.

## Frontend

| Archivo | Qué cambia |
|---|---|
| `catalog/api/categoryMedia.ts` | **Nuevo.** `MAX_CATEGORY_IMAGE_BYTES` (2 MB), validador, `buildCategoryImagePath`, subida y firma en lote. Sin SVG. |
| `catalog/CategoryImageField.tsx` | **Nuevo.** Hueco apaisado 16/9 —la proporción de la puerta real— con `cover`: se ve el recorte antes de guardar. El alt aparece **con** la foto y se va con ella. Sin foto se ve el icono real de la categoría, no un rectángulo gris. |
| `catalog/CategoryDrawer.tsx` | Monta el campo después del nombre (el icono de respaldo se deriva del nombre). |
| `catalog/api/categories.ts` | Sondeo de esquema propio (`categoryMediaReady`): las dos columnas se piden aparte y hay a dónde caer, porque PostgREST tumba la consulta entera con `42703` y la pantalla de categorías no puede morir por una foto opcional. El alt vacío se guarda **NULL**. |
| `catalog/types.ts` | `categorySchema` + `image_url`/`image_alt` (`catch(null)`), `categoryFormSchema` + los dos campos, `categoryToForm`. |
| `catalog/useCategories.ts` | `useCategoryImageUrls` (un lote) y `useUploadCategoryImage`. |
| `storefront/components/CategoryDoors.tsx` | **Nuevo.** `CategoryDoorGrid` y `CategoryDoor` salen de `ContentBlocks.tsx` (1376 líneas) a su propio archivo: las usan el CMS, la portada y —desde P13— la vista previa, y ninguna necesita el resolvedor de bloques. `ContentBlocks` las reexporta. `data-category-door="photo" \| "tint"` hace la diferencia verificable. |
| `storefront/components/ContentBlocks.tsx` | Prop `categoryMedia` opcional; el bloque `category_collection` cruza sus items por `category_id`. **Cero peticiones nuevas y sin tocar la función SQL del CMS**: la vitrina ya tiene las categorías cargadas (`usePublicCategories`, la misma consulta que la barra de familias). |
| `storefront/api.ts` | `fetchPublicCategories` pide la foto y cae a la lista base si la columna no existe — una vitrina contra una base sin la migración no puede quedarse sin categorías por una foto opcional. |
| `storefront/types.ts` | `publicCategorySchema` + `image_url` por `assetRef` (el mismo filtro que el logo de la tienda) e `image_alt`. |
| `StoreHomePage.tsx` | Firma **todas** las fotos de la tienda en un lote y construye `categoryMedia` por id: sirve a la sección `categories` y a los bloques del CMS a la vez. |
| `shared/ui/categoryIcon.tsx` | **Nuevo** (movido desde la vitrina, que lo reexporta). Ver abajo. |
| i18n ES/EN | 11 claves `catalog.categories.image.*` + `catalog.error.imageAlt`. |

### La tabla de iconos era de farmacia, y eso se arregló

Al mover el resolvedor a `shared` quedó a la vista: tenía **14 entradas y 10 eran de farmacia**
(`medicamento`, `dermo`, `cardio`, `oftalm`…). No es una condición por rubro —nadie pregunta a qué se
dedica el comercio— pero el efecto se notaba: una botica tenía icono para cada familia y una
zapatería no tenía ninguno, así que sus puertas se veían todas iguales.

Ahora son 27 entradas que cubren calzado y moda, hogar, alimentación, ferretería, tecnología,
deporte, juguetes, mascotas, papelería, automoción y belleza, **además** de las de salud, que siguen
siendo tan legítimas como el resto: quitarlas sería el mismo error del revés. El orden importa y está
documentado (lo específico antes que lo genérico; «cuidado» y «limpieza» al final porque caben en
medio catálogo).

## Un fallo preexistente que apareció en este tramo, y su causa

A las 19:13 hora local, `supabase/tests/ai-credit-payments-fulfillment-facts.test.ts` empezó a
fallar con `expected 5 to be 4` en `days_late`. **No es de esta fase**: esa prueba toca
`fulfillments` y `ai_fulfillment_facts`, y este pack no las roza. Es un fallo de RELOJ:

- el fixture sembraba `promised_to` con `current_date` — la fecha de la **sesión**;
- `ebim.ai_fulfillment_facts` calcula con `(now() at time zone 'utc')::date`.

En una máquina a UTC-5 las dos fechas coinciden media jornada y discrepan la otra: pasadas las 19:00
locales, el fixture sembraba «prometida hace 4 días» y la función leía 5. La suite fallaba sola por
la hora del día.

Arreglado en la causa —**el fixture ahora mide con el mismo reloj que la función**— y solo en esa
siembra. El primer intento cambió las cinco siembras del archivo a UTC y rompió las de cobranza:
`ai_collections_facts` y las de pagos sí calculan con `current_date`, así que las suyas se quedan
como estaban, con la razón anotada en el código.

**Hallazgo para el operador, sin tocar:** dos funciones hermanas usan bases de fecha distintas
(`ai_fulfillment_facts` en UTC, `ai_collections_facts` en fecha de sesión). Es una inconsistencia
real del producto; unificarla cambia qué documentos cuentan como vencidos y no se decide en este
pack.

## Tests

| Archivo | Casos |
|---|---|
| `supabase/tests/category-media.test.ts` | **Nuevo**, 35. Sin foto todo sigue igual (incluido un `insert` que no menciona las columnas), referencia (9 rechazos nombrados, entre ellos la carpeta `branding/`), alt (vacío, espacios, desbordado, saltos de línea), aislamiento, lector sin escritura, `anon` sin UPDATE, columnas exactas de la vista, `security_invoker`, tienda suspendida, **herencia del árbol con foto**, y Storage con la carpeta nueva. |
| `src/features/catalog/category-media.test.tsx` | **Nuevo**, 17. Ruta de tienda en `categories/`, extensión del MIME, validador completo, `categoryToForm`, cajón sin foto (sin campo de alt), con foto (`cover` + alt), subida, alt NULL vs recortado, tope de 160, quitar la foto suelta el alt, y guardar sin tocar la foto. |
| `src/features/storefront/components/category-doors.test.tsx` | **Nuevo**, 10. `data-category-door` photo/tint, `cover` + `lazy`, alt ausente → decorativa (`alt=""` + `aria-hidden`), alt presente, alt de espacios, **foto rota → vuelve al tinte**, mezcla de puertas y umbral de la rejilla. |
| `src/features/storefront/theme/multi-industry.test.tsx` | **Ampliado** a 53. La foto llega a la portada en los **cuatro temas**, las dos puertas siguen enlazando a su familia, y una tienda sin ninguna foto se ve igual que antes de P03. |
| `supabase/tests/category-tree.test.ts` | Sin cambios — y es el que cazó el error de la vista. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** (0 avisos) |
| `npm run test` | **PASS** — 290 ficheros, 5732 tests |
| `npm run build` | **PASS** |
| DB (PGlite, migraciones reales) | **PASS** — 35 casos nuevos |

Ciclos correctivos usados: **3 de 3**, todos por causa raíz.

1. **La vista recreada perdía la herencia del árbol.** Cazado por `category-tree.test.ts`.
   Corregido a `create or replace` sobre el cuerpo recursivo.
2. **El reloj del fixture de entregas.** Diagnóstico arriba; el primer arreglo fue demasiado amplio
   y se acotó a la única siembra que lo necesitaba.
3. **Dos fallos de utillaje.** Un `import` colado entre imports al insertar una constante, y un
   literal de expresión regular que perdió sus barras invertidas al pasar por un heredoc del shell
   (`/^https:\/\//i` quedó como `/^https:///i`, error de sintaxis). Los dos corregidos en el sitio y
   verificados con una búsqueda de `https:///` en todo `src/`.

`PHASE_RESULT: PASS`

---

# P04 — Cierre real del Theme Engine

**HEAD inicial:** `878232b` · **Sin migración:** esta fase no toca la base. El contrato ya estaba en
`store_settings` desde `20260910220000`; lo que faltaba era que la vitrina lo leyera.

## Auditoría de consumidores (verificada, no supuesta)

| Clave | Consumidor ANTES de P04 | Veredicto |
|---|---|---|
| `headerVariant` | `themeCssVars` (alto de barra) + `data-store-header` + CSS | efecto real |
| `heroVariant` | presets, schema, normalize, types y el `<select>` del editor | **HUÉRFANO** |
| `productCardVariant` | `data-store-cards` + 7 variables de CSS | efecto real |
| `categoryVariant` | contrato + editor | **HUÉRFANO** |
| `contentWidth` | `StorefrontLayout` (×2) y `StoreFooter` | efecto real |
| `imageRatio` | `--sf-image-ratio` → `ProductMedia` | efecto real |
| `sectionSpacing` | `--sf-section-gap`, `--sf-main-pad`, `data-store-spacing` | efecto real |

Dos casillas del formulario no cambiaban nada: se podía elegir `statement` y la portada seguía
pintando la de producto; se podía elegir `pills` y las familias seguían saliendo como azulejos.
**`premium` declaraba `statement` desde P01 y nunca lo usó. `catalog` declaraba `pills` igual.**

## Por qué estos dos no se podían resolver con CSS

Los otros cinco son MEDIDAS: un alto, un ancho, una proporción, un aire. Viajan como variable o como
atributo y la hoja de estilos hace el resto — que es lo que evita cuatro copias del storefront.

`heroVariant` y `categoryVariant` no son medidas: eligen **árboles de React distintos**. Una portada
de producto tiene carrusel, precio, tachado y botón de comprar; una editorial tiene una imagen a
sangre, un lema y dos enlaces. No hay `--variable` que convierta una en otra. Por eso lo que hacía
falta era que el **registro de secciones** —quien decide qué se pinta— recibiera el tema.

## Lo que se hizo

### 1. El tema llega al registro

`HomeSectionData` gana `theme: ResolvedStoreTheme` (resuelto, no crudo: preset + lo pisado + defaults
ya aplicados) y `hayOfertas: boolean` (lo que la página ya sabía por su banda de ofertas — no se
vuelve a consultar).

### 2. `heroVariant`, con dos composiciones de verdad

- **`product`** → `StoreFeaturedHero`, con `data-hero-variant="product"`.
- **`statement`** → `StoreHero`, con `data-hero-variant="statement"`, **ascendido de reserva a
  portada elegible** y mejorado: ahora lleva dos puertas —«Ver el catálogo» y, solo si hay algo
  rebajado, «Ver lo rebajado»—. Antes era un cartel del que no se salía: había que bajar hasta la
  primera fila para entrar al catálogo.
- **Sin precios en la editorial**, y el contrato de la fase lo pide con esas palabras. El precio se
  resuelve con lista, canal, promociones y condiciones de la sesión; calcularlo en dos componentes
  es cómo se llega a una portada que anuncia un importe que el carrito no respeta. El enlace a
  ofertas es un enlace: lleva al catálogo filtrado y allí manda el resolvedor de siempre.
- `product` sigue siendo una **preferencia, no una orden**: sin nada rebajado cae a la editorial.

### 3. `categoryVariant`, con dos composiciones de verdad

- **`tiles`** → `CategoryDoorGrid` (los azulejos de P03, con foto o tinte).
- **`pills`** → `CategoryPills`, nuevo: una línea densa de píldoras con su icono, que aguanta treinta
  familias sin empujar el catálogo fuera de la primera pantalla. Es lo que necesita `catalog`.
- **Son ENLACES, no filtros.** La barra del catálogo (`CategoryBar`) son `Chip` con `aria-pressed`:
  un filtro que se enciende y se apaga sobre la lista que ya se mira. Estas llevan a otro sitio, así
  que son `<a>` — un lector anuncia «enlace» y del enlace se vuelve con el botón de atrás.
- Llevan icono porque una línea de treinta píldoras de texto gris no se recorre: todas pesan igual.

### 4. Un acoplamiento real que la conexión destapó

El reparto de productos de la portada da por usado lo que el hero coge, para que el mismo producto no
salga en cuatro sitios. Correcto mientras la portada pintara siempre producto.

Con `statement` —que no pinta producto— la reserva **apartaba cuatro productos sin enseñarlos en
ninguna parte**: en una tienda con un solo rebajado, ese producto desaparecía de la portada entera.
Lo cazó `theme-parity.test.tsx`, que exige que el precio y el descuento sean los mismos en los cuatro
temas.

Arreglado en la causa: `heroReserva` es 0 cuando la portada no va a pintar producto (variante
editorial **o** cubierta del CMS). La decisión vive en la página porque es quien tiene las listas
completas; el registro recibe el reparto ya hecho. Hay una prueba dedicada.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `home/types.ts` | `theme` y `hayOfertas` en `HomeSectionData`. |
| `home/SectionRegistry.tsx` | `hero` y `categories` leen el tema y eligen composición. |
| `StoreHomePage.tsx` | Pasa el tema, `hayOfertas`, y calcula `heroReserva`. El bloque derivado del CMS sube por encima del reparto porque el reparto ahora depende de él. |
| `components/StoreHero.tsx` | Portada editorial de verdad: `data-hero-variant="statement"`, puertas al catálogo y a las ofertas. |
| `components/StoreFeaturedHero.tsx` | `data-hero-variant="product"`. |
| `components/CategoryDoors.tsx` | `CategoryPills` nuevo, junto a las puertas. |
| `e2e/theme-engine.e2e.ts` | Una prueba más: la portada declara su composición en un navegador real. |
| i18n ES/EN | `store.hero.browseCatalog`, `store.hero.seeOffers`. |

## Tests

| Archivo | Casos |
|---|---|
| `theme/theme-contract.test.tsx` | **Nuevo**, 24. Un caso por VALOR de las siete claves, montando `universal` y pisando **solo** el que se prueba —si se cambiara el preset, cualquiera de las siete podría ser la responsable del cambio observado—. Incluye: `statement` sin precios, sus dos puertas, `product` cayendo a editorial sin rebajas, el producto que no desaparece, píldoras vs azulejos, los dos como enlaces, altura de barra por variante, ancho del contenedor, `--sf-image-ratio` por proporción, tres aires **distintos**, `premium` obedeciendo `statement`, `catalog` obedeciendo `pills`, y una guarda que falla si el contrato gana una opción sin caso. |
| `theme/multi-industry.test.tsx` | El caso de `catalog` pasa a esperar píldoras — y ese cambio **es** la prueba de que el control funciona. |
| `home/HomeComposer.test.tsx` | La base de datos de prueba gana `theme` y `hayOfertas`. |
| `theme/theme-parity.test.tsx` | Sin cambios — y es el que cazó el acoplamiento del reparto. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 291 ficheros, 5756 tests |
| `npm run build` | **PASS** |
| Playwright (`e2e/theme-engine.e2e.ts`) | **NO EJECUTADO** — exige una tienda desplegada y navegadores de Playwright; no hay ninguna de las dos en esta máquina. La prueba nueva queda escrita y se marca como pendiente de ejecución, sin darla por verde. |

Ciclos correctivos usados: **2 de 3**.

1. **El reparto reservaba productos para un hero que no los pinta.** Causa raíz arriba; lo cazó la
   paridad de temas.
2. **Tres fixtures y una espera.** `HomeComposer` necesitaba el tema; el caso de `catalog` en
   multi-industria esperaba azulejos; y las aserciones del hero miraban el DOM antes de que la
   portada terminara de cargar —la portada no se pinta a medias, enseña un esqueleto— así que se
   añadió una espera explícita en vez de relajar la aserción.

`PHASE_RESULT: PASS`

---

# P05 — Storefront Shell V2

**HEAD inicial:** `18ea862` · **Sin migración.** Esta fase no toca la base, ni la autenticación, ni
el carrito, ni el precio, ni el checkout: solo marco visual.

## 1. El ancho: la tienda usaba 1200 px en un monitor de 1920

`Container maxWidth="lg"` son 1200 px y `xl` son 1536. Son los de una herramienta de trabajo, y en
la vitrina se notaban: en 1920 la tienda dejaba **360 px de desierto a cada lado** y el catálogo se
veía en una columna estrecha entre dos márgenes.

Ahora el ancho lo pone el tema: `--sf-content-w` = **1320 px** en `lg` y **1680 px** en `xl`. Los
cuatro contenedores de la vitrina —cabecera, barra de familias, contenido y pie— leen la misma
variable.

**Y esto no convierte el texto en líneas infinitas**, que es el riesgo evidente: el ancho del
CONTENEDOR y la medida del TEXTO son cosas distintas y aquí solo se toca la primera. El titular de la
portada sigue topado a 680 px, su bajada a 560, la descripción del pie a 368, y una rejilla de
tarjetas gana columnas en vez de ensanchar las que tiene. Crece cuánto CABE, no cuánto mide una línea.

### Un bug de ancho que estaba escrito a mano

`StoreCategoryNav` tenía `Container maxWidth="lg"` **fijo**. En `catalog` —que usa `xl`— la barra de
familias era más estrecha que la cabecera y que el catálogo: tres anchos en la misma pantalla, con
dos escalones visibles en el borde izquierdo. Ahora usa la misma variable que el resto.

## 2. `headerVariant` deja de ser doce píxeles

Era su único efecto: la altura de la barra, 68 → 56. Se le suman dos medidas más, las dos del tema:

| Variable | `standard` | `compact` |
|---|---|---|
| `--sf-header-h-md` | 68 px | 56 px |
| `--sf-search-h` | 42 px | 34 px |
| `--sf-nav-pad` | 6 px | 2 px |

Sumado, la primera pantalla de un catálogo grande gana casi treinta píxeles de producto — que es
exactamente lo que `compact` promete y lo que hasta ahora no entregaba.

La caja de búsqueda además ensancha de 420 a 520 px en escritorio: es la primera herramienta de una
tienda con catálogo y con 420 px no cabían cinco palabras.

## 3. El ancla ya no queda debajo de la cabecera

La cabecera es pegajosa y la barra de familias va justo debajo. El enlace «Marcas» saltaba a su
sección y la dejaba medio tapada: había que subir a mano. Estaba resuelto con un `96` escrito a mano
en `BrandRow`, que dejó de ser cierto en cuanto la barra cambió de alto por variante.

Ahora hay `--sf-anchor-offset`, derivado del alto real (barra + aire de familias ×2 + píldora + 12
de respiro), y lo usan el ancla del salto de contenido y la sección de marcas.

## 4. Menos «aplicación de gestión», sin tocar el modo claro/oscuro

Dos superficies dejan de ser tarjetas:

- **La franja de propuestas de valor.** Con borde y sombra era la tercera caja en los primeros
  ochocientos píxeles —portada, franja, banda de ofertas— y las tres pesaban igual. No es contenido
  que se mire: es información de servicio que se lee de pasada. Pasa a un tinte del acento del
  comercio, sin borde y sin sombra, y **la tarjeta de producto recupera el único recuadro con peso
  de la pantalla**.
- **La barra de contexto B2B.** Tenía fondo de tarjeta y borde, así que competía con las tarjetas de
  producto de debajo: lo primero que veía un comprador con cuenta de empresa era una caja blanca con
  texto administrativo. Pasa a banda teñida y baja de altura. Sigue visible y sigue diciendo para
  quién se compra (`data-commerce-audience` intacto).

**Lo que NO se tocó, y está explicado en `storefront.css`:** `--sf-line`, `--sf-shadow` y
`--sf-media-bg` se quedan fuera de los bloques de tema. Se redefinen por MODO —hay un bloque para
oscuro y otro para claro explícito, los dos con más peso—, así que un tema que los pisara solo se
notaría con el modo del sistema sin elegir, y al tocar el interruptor la tienda cambiaría de canto.
El MODO manda en color y profundidad; el TEMA, en geometría y escala.

## Archivos

| Archivo | Qué cambia |
|---|---|
| `theme/theme-context.ts` | `--sf-content-w`, `--sf-search-h`, `--sf-nav-pad`, `--sf-anchor-offset`. |
| `StorefrontLayout.tsx` | Cabecera y contenido con el ancho del tema (`maxWidth={false}` + variable) y `scrollMarginTop`. `data-content-width` para poder comprobarlo. |
| `components/StoreCategoryNav.tsx` | Ancho del tema (era `lg` fijo) y aire por variante. |
| `components/StoreFooter.tsx` | Ancho del tema. |
| `components/StoreSearchField.tsx` | 520 px de tope y alto por variante. |
| `components/BrandRow.tsx` | `scrollMarginTop` del tema. |
| `components/StoreValueProps.tsx` | Banda teñida en vez de tarjeta. |
| `commerce/CommerceContextBar.tsx` | Banda teñida en vez de tarjeta, más baja. |

## Validación visual mínima de la fase

Los cuatro temas × escritorio/móvil y la tienda con contexto B2B se ejercitan en
`theme-parity.test.tsx` (4 temas × 4 casos), `multi-industry.test.tsx` (4 rubros × 4 temas, más 8
rubros para las familias), `layout-theme.test.tsx`, `storefront-a11y-seo.test.tsx` y
`commerce-context-bar.test.tsx`. El desbordamiento horizontal a 320 y 360 px está cubierto por
`e2e/theme-engine.e2e.ts`, **no ejecutable aquí** (ver gates).

## Tests

`theme-contract.test.tsx` sube a 27 casos con tres pruebas nuevas, y las tres comprueban la MEDIDA,
no la clase de MUI —la clase es un detalle de la librería; la variable es lo que de verdad se
aplica—:

- los dos anchos llegan como `--sf-content-w` y son distintos, y el pie usa el mismo que el contenido;
- `compact` recorta buscador y aire de familias respecto a `standard`;
- el desplazamiento del ancla sigue al alto real de la cabecera y cambia con la variante.

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 291 ficheros, 5759 tests |
| `npm run build` | **PASS** |
| Playwright | **NO EJECUTADO** — sin tienda desplegada ni navegadores de Playwright en esta máquina. |

Ciclos correctivos usados: **1 de 3** — al quitar el uso de `style` en la cabecera quedó una variable
sin leer; se retiró junto con su comentario, que ya no describía lo que hacía el componente.

`PHASE_RESULT: PASS`

---

# P06 — Home Merchandising V2

**HEAD inicial:** `4ce721b` · **Sin migración.**

## El problema, con números

La fila de productos pintaba siempre lo mismo: un carrusel de tarjetas de 168 px. Con veinte
productos está bien. Con **uno**, la portada enseñaba una tarjeta pequeña pegada al margen izquierdo
y **mil doscientos píxeles de blanco** a su derecha, debajo de un título que prometía una sección.

Eso no se lee como «esta tienda tiene una oferta»: se lee como una tienda rota. Y le pasa a toda
tienda que empieza, que es justo cuando peor sienta.

## Las tres composiciones de la fila

La regla es una sola: **la fila ocupa su ancho con lo que de verdad tiene**. Nunca se rellena con
productos repetidos, inventados ni traídos de otra sección — eso sería mentir sobre el catálogo.

| Productos | Composición | Por qué |
|---|---|---|
| 0 | no se pinta | una sección vacía es peor que una sección menos |
| 1–3 | rejilla de `n + 1` columnas, con tarjetas **grandes** y **completas** | las columnas se reparten entre lo que hay más una puerta al catálogo; la fila queda cuadrada |
| 4–6 | rejilla de `n` columnas | ya llenan la fila |
| 7+ | carrusel | una rejilla se partiría en filas desiguales —seis arriba, una abajo— |

Con 1–3 las tarjetas son las **completas** (estado y botón de comprar), no la versión reducida: con
tres productos en fila no se está ojeando un escaparate, se está mirando lo que hay.

### La celda que cierra la fila corta

Un enlace de altura completa, con trazo discontinuo, que dice «Recorre el catálogo · Busca, filtra y
ordena todo lo publicado». **No afirma que haya más productos** —en una tienda con dos sería falso—
ni inventa recomendaciones: promete lo único que hace, llevar al catálogo. Hay una prueba que
comprueba que la fila no contiene «hay más», «más productos» ni «otros N».

## La banda de ofertas reservaba media pantalla vacía

`OffersFeaturedBand` repartía siempre 5fr para lo rebajado y 7fr para lo destacado. Con las dos
mitades llenas está bien; con una sola —una tienda que empieza, o un comercio que separó lo destacado
a su propia fila— la mitad vacía **se quedaba reservada**: 40 % o 58 % de blanco al lado del
contenido. Ahora la banda usa una columna cuando solo hay una cosa que poner
(`data-offers-band="both" | "offers" | "featured"`).

Y su rejilla interna era `repeat(3)` fija: con una sola oferta dejaba dos huecos. Ahora son tantas
columnas como ofertas haya, hasta tres.

## La portada abre con una foto, no con un marcador gris

La portada de producto es media pantalla de imagen. Con un rebajado **sin foto** abría con un
rectángulo gris del tamaño de la cubierta —lo peor que puede enseñar una tienda en su primera
pantalla— mientras el siguiente rebajado, que sí tenía foto, esperaba su turno en la banda.

Ahora lo rebajado con foto va primero. **No se descarta nada ni se cambia qué está rebajado: solo se
ordena**, y el orden es estable, así que una tienda sin ninguna foto ve exactamente lo que veía y la
banda de ofertas sigue recibiendo a todos.

Con esto, la cadena de reserva de la cubierta queda completa: cubierta del CMS → banner de la tienda
→ producto rebajado **con buena media** → composición editorial con el lema → degradado del acento.

## Ritmo: cuatro filas iguales se leen como una lista sin fin

La portada encadenaba título-tarjetas, título-tarjetas, título-tarjetas. `ProductRow` gana un
`tone`: `plain` (el de siempre) o `tinted`, que la apoya en un tinte muy bajo del acento. Lo usa
`new-arrivals`, así que la portada alterna fondo entre secciones y se ve dónde acaba una y empieza la
siguiente, sin meter una línea divisoria en cada hueco. **Quien decide el ritmo es el registro de
secciones**, que es el único que sabe qué va antes y después.

## Lo que NO cambió, a propósito

- **La deduplicación.** El reparto que impide que el mismo producto salga en cuatro sitios sigue
  donde estaba, y hay pruebas nuevas de que con uno o dos productos se pinta cada uno **una vez**.
- **El CMS como fuente editorial.** Nada de lo anterior sustituye un bloque del comercio: si el CMS
  trae cubierta, no se pinta ninguna de las dos portadas, como antes.
- **Los umbrales son de diseño, no dogma.** 3 y 6 salen del ancho real de una tarjeta contra los
  1320 px del contenedor de P05.

## Tests

`components/product-row.test.tsx`, **nuevo**, 15 casos: 0 no pinta; 1, 2 y 3 dan `spotlight` con
tarjetas completas y puerta al catálogo; 4, 5 y 6 dan `grid` sin puerta; 7+ da `carousel`; cargando no
finge rejilla; la puerta enlaza y no afirma cantidades; el tono cambia el fondo; y **con uno se pinta
uno, no tres copias**.

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 292 ficheros, 5774 tests |
| `npm run build` | **PASS** |

Ciclos correctivos usados: **0 de 3**.

`PHASE_RESULT: PASS`

---

# P07 — Product Card y catálogo V2

**HEAD inicial:** `150969d` · **Sin migración.**

## 1. Las tres presentaciones de la tarjeta, de verdad

Hasta P07 la diferencia entre presentaciones eran **medidas**: relleno, cuerpo del nombre, aire de la
rejilla. Se notaba poco, y sobre todo no se notaba lo que cada tema promete — «editorial» y «denso»
no son dos tamaños del mismo dibujo.

| Presentación | Qué cambia | Por qué |
|---|---|---|
| **densa** (`retail`, `catalog`) | la categoría no se pinta | con cinco o seis columnas, el nombre de la familia sale truncado y se come la línea que necesita el nombre del **producto**, que es lo que se busca. No se encoge la letra —eso sería miniaturizar hasta lo ilegible—: se quita lo que sobra |
| **editorial** (`premium`) | sin canto ni sombra en reposo; la sombra vuelve al apuntar | la rejilla deja de leerse como una cuadrícula de fichas y pasa a ser una secuencia de imágenes |
| **editorial** | no pinta la pastilla «disponible» | `in` es el estado **esperado** de un producto publicado: repetida en cada tarjeta no informa, decora |
| todas | **`out` se pinta siempre**, en los cuatro temas | eso sí es información, y es la que decide si el botón sirve |

Y **ni un `if` por tema dentro del componente**: la tarjeta pone sus clases (`eb-card`,
`eb-card-eyebrow`, `eb-card-state[data-stock]`) y la hoja de estilos decide desde la frontera. Esa es
la diferencia entre tematizar y tener cuatro tarjetas — con cuatro ramas, la que se olvida de pintar
el botón de comprar es un tema donde no se puede comprar.

**Lo que no cambia en ninguna:** enlace al producto, corazón, vista rápida, comprar o elegir
opciones, precio, tachado y aviso de agotado. Ya lo fijaba `ProductCard.theme.test.tsx` y sigue verde.

## 2. El hueco sin foto dejaba de parecer un producto y parecía un fallo

`ProductMedia` sin `url` pintaba un rectángulo gris con un icono de imagen en medio. Eso es
**exactamente lo que dibuja un esqueleto de carga**, y media rejilla así se lee como una tienda que
no terminó de cargar — que es el caso normal de un catálogo recién importado.

Ahora el hueco es un panel con el tinte que le toca al **nombre** del producto y el icono como marca
de agua grande en la esquina: la misma gramática que las puertas de categoría y las marcas. El tinte
sale del nombre y no al azar, así que el mismo producto cae siempre en el mismo color, una rejilla
sin fotos se puede recorrer y recargar no la baraja.

Sigue sin pintarse ni un logotipo ni una imagen de archivo: nada que le ponga a la tienda una
identidad que no eligió.

## 3. El catálogo con pocos resultados

Dos tarjetas y media pantalla de blanco debajo. Quien buscó algo y encontró dos cosas se va, y lo que
le falta es una salida.

`ExploreMore`, nuevo: **«También puedes explorar»**, debajo de los resultados, en su propia sección,
con su propio título y separada por una línea. Aparece con **0 resultados** y con **1–3** (el mismo
umbral que usa la fila de la portada para crecer).

**La regla que no se rompe: esto no forma parte del conteo.** No lleva ni un producto — solo familias
y marcas, que son navegación y nadie confunde con un resultado. Productos «recomendados» dentro de la
rejilla serían resultados que el filtro no devolvió, y el contador de arriba pasaría a mentir: «2
resultados» sobre nueve tarjetas.

De dónde salen: familias del árbol que la pantalla ya tiene cargado y marcas de las facetas de la
búsqueda. **Cero peticiones nuevas.** Se excluye lo que ya está filtrado —ofrecer como salida el
sitio donde uno está no es una salida—, se corta en seis por grupo, y si no queda nada que ofrecer la
sección no se pinta.

## Lo que NO se tocó

Filtros, parámetros de la URL (`?q &c &d &b &sort &ver &p &oferta`), orden, paginación y resolución
server-side del catálogo: intactos. El precio comercial B2B de la tarjeta, intacto y con su prueba
(`b2b-price.test.tsx`).

## Tests

| Archivo | Casos |
|---|---|
| `components/explore-more.test.tsx` | **Nuevo**, 10. La sección va aparte con su título; familias y marcas como enlaces; no ofrece donde ya se está; no se pinta sin nada que ofrecer ni con todo filtrado; **no contiene ni un producto**; corta en seis. Y tres casos que leen `storefront.css` para fijar las presentaciones de la tarjeta —el entorno de pruebas no aplica hojas de estilo (`css: false`), así que se comprueba el texto de la hoja, la misma técnica de `presets-behaviour.test.ts`—, incluido que el selector nombre `data-stock='in'` y **no** `'out'`. |
| `ProductCard.theme.test.tsx`, `ProductCard.test.tsx`, `b2b-price.test.tsx`, `ProductMedia.test.tsx` | Sin cambios y verdes: la tarjeta sigue haciendo lo mismo en los cuatro temas. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 293 ficheros, 5784 tests |
| `npm run build` | **PASS** |

Ciclos correctivos usados: **0 de 3**.

`PHASE_RESULT: PASS`
