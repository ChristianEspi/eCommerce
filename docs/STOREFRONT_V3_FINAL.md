# Storefront V3 · Commerce Design System — informe final

Ejecución completa del pack `EBIM_ECOMMERCE_STOREFRONT_V3` (P00–P14) sobre este repositorio, que
ya contenía Storefront V2 terminado. El detalle de cada fase —decisiones, desviaciones del prompt,
ciclos correctivos y pruebas— está en [`STOREFRONT_V3_STATUS.md`](./STOREFRONT_V3_STATUS.md); aquí
va el resumen y la evidencia.

## Fases

| Fase | Estado | Commit | Resumen |
|---|---|---|---|
| P00 | PASS | `9217828` | Línea base, rama y gates iniciales. Se confirmó V2 **en código** —no en documentos— y se registró el bundle de partida como referencia contra la que medir todo lo demás. |
| P01 | PASS | `60196f0` | Identidad con roles semánticos: `store_description` separada de `hero_subtitle`, `hero_kicker`, `brand_lockup`, `show_theme_toggle` y hasta dos avisos. Migración con validadores y columna a columna. |
| P02 | PASS | `12b3d2e` | Theme Engine V3: cabecera `brand`, tarjeta `editorial`, familias `mosaic` y `productMediaFit`. Las cuatro personalidades dejan de ser el mismo tema con otro relleno. |
| P03 | PASS | `bae138c` | Tres composiciones de cabecera reales, barra de avisos solo con lo que el comercio escribió, lockup configurable y el selector de tema **oculto salvo que se pida**. |
| P04 | PASS | `e485446` | Hero editorial/comercial con respaldos de verdad: foto de rebajado, foto de familia o degradado con el lema. Se retiró el subtítulo que escribía la plataforma. |
| P05 | PASS | `ff4cf50` | Tarjetas y filas que respetan el tema: Premium deja de caer en tarjetas miniatura por estar en un carrusel. Hueco de fila por variante. |
| P06 | PASS | `128cdeb` | Home Layout V2: presentación cerrada por sección —composición, fondo, ancho— y el full bleed en **un solo sitio**, con `50vw` y `clip`. |
| P07 | PASS | `efe32ba` | Mosaico de familias y muro de logotipos. `brands` y `trust` dejan de decir lo mismo dos veces. |
| P08 | PASS | `ba463e7` | CMS editorial: cinco composiciones de colección, cuatro de familias y tres de banner, sin migración —`settings.layout` ya estaba validada—. Y se pinta el `split` que P06 dejó declarado. |
| P09 | PASS | `44783c6` | Catálogo móvil con barra y cajón de filtros; la columna de escritorio deja de parecer backoffice y pasa **después** de los resultados en el DOM. |
| P10 | PASS | `a1c2e55` | Ficha comercial: sin tarjetas apiladas, detalle plegado, barra de compra en el teléfono y sugerencias con la fila V3. |
| P11 | PASS | `652d494` | Reducción de imágenes antes de subir, con cinco reglas de seguridad, y readiness V2 con ocho señales que ya no preguntan mal. |
| P12 | PASS | `a39f0e8` | Presentación por sección desde el taller, con las opciones de su sección y el valor heredado escrito. Destapó la versión escrita a mano. |
| P13 | PASS | `a83e1cb` | Paridad de la vista previa: tres piezas compartidas de verdad y el resto declarando qué representa. Matriz visual de Playwright escrita. |
| P14 | PASS | `7dca992` | Auditoría funcional, multi-industria, accesibilidad, responsive y seguridad. **Tres** defectos reales encontrados y corregidos, dos de ellos en copy de producción. |

## Contexto

| | |
|---|---|
| **Rama** | `feat/storefront-v3-commerce-design-system` |
| **HEAD inicial (P00)** | `b4dc01e8db8ec0608bb6cab546b2c150ff9a1161` |
| **HEAD final** | `7dca992` |
| **Commits** | 16: uno por fase (15) más la nota del HEAD final. Todos **locales**. |
| **PUSH** | **NO** |
| **DEPLOY** | **NO** |
| **Migraciones remotas** | **NO** |

## Migraciones creadas

Tres, todas **sin aplicar** a ningún entorno remoto:

| Archivo | Qué hace |
|---|---|
| `20260923180000_store_identity_v3.sql` | Cinco columnas de identidad en `store_settings`, sus validadores (`announcement_is_valid`, `announcements_are_valid`), GRANT por columna y `public_stores` recreada. |
| `20260923190000_theme_contract_v3.sql` | `storefront_style_is_valid` reescrita con las ocho claves del contrato V3 y sus listas cerradas. |
| `20260924100000_home_layout_v2.sql` | `section_presentation_is_valid` (por `id` de sección), `home_section_is_valid` y `home_layout_is_valid` aceptando V1 **y** V2. |

**Auditoría de seguridad de las tres (P14):**

- **Ningún `SECURITY DEFINER`.** Los seis validadores son `immutable` con `set search_path = ''`.
- **`revoke execute … from public`** en los seis, con GRANT explícito a `anon, authenticated,
  service_role` — que es lo que necesita un CHECK evaluado con el rol que inserta.
- **Escritura solo para `authenticated`**: las cinco columnas nuevas tienen `grant update` a
  `authenticated` y `grant select` a `anon` (la vista pública es `security_invoker`, así que la
  lectura anónima necesita la columna). `anon` **no** puede escribir ninguna.
- **Policies intactas**: `store_settings_update_admin` sigue exigiendo owner/admin y aislamiento de
  tenant; ninguna de las cinco columnas entra en el `with check` de marca blanca, así que funcionan
  sin el addon.
- **`public_stores`** conserva `security_invoker = on` y el filtro de tienda activa. No expone
  `organization_id`, `company_id`, `tax_rate`, `config`, el estado del dominio ni la identidad del
  correo.
- **Ninguna migración aplicada fue editada.** Cada cambio va en un archivo nuevo.

## Áreas principales

**Vitrina** — `theme/` (contrato, presets, presentación, resolvedor), `identity.ts`,
`StorefrontLayout`, `StoreHomePage`, `StoreProductPage`, `home/` (compositor y registro) y
veintiuna piezas en `components/`, de las que **nueve son nuevas**: `StoreBrandLockup`,
`StoreAnnouncementBar`, `StoreSectionFrame`, `CategoryMosaic`, `BrandLogoWall`, `StoreSplitBand`,
`StoreCatalogToolbar`, `StoreFilterDrawer`, `StoreProductDetails` y `StoreProductPurchaseBar`.

**CMS** — `domain/content.ts` (vocabularios cerrados de composición), `ContentBlocks` y el editor
de bloques.

**Backoffice** — el taller de diseño: `StorefrontDesignSection`, `AdvancedStyleSettings`,
`HomeLayoutEditor`, `SectionPresentationPopover` (nuevo), `styleLabels` (nuevo),
`StorefrontPreview`, `StoreReadiness` y `readiness.ts`.

**Compartido** — `shared/lib/imageOptimizer.ts` (nuevo) y los cuatro flujos de subida.

## Gates finales

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — **313 ficheros, 6289 tests** (base P00: 300 / 5925) |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — los cuatro recorridos dentro del techo |
| `npm run scan:secrets` | **PASS** — sin hallazgos; `service_role` en su sitio |
| `npm run test:db` | **PASS** — **137 ficheros, 3653 tests** contra Postgres real (PGlite) |
| Playwright | **PASS** — 9 de 9 celdas de la matriz visual; la décima (el taller) se salta sola por falta de sesión de backoffice. |

### Bundle: final contra la línea base de P00

| Recorrido | P00 | P14 | Techo | Diferencia |
|---|---|---|---|---|
| vitrina · portada | 398,8 | **398,8** | 405 | **0,0** |
| vitrina · ficha de producto | 377,1 | **391,2** | 400 | +14,1 |
| vitrina · checkout | 397,8 | **403,2** | 430 | +5,4 |
| backoffice · panel | 422,8 | **425,7** | 430 | +2,9 |

**La portada termina exactamente donde empezó**, con catorce fases de funcionalidad encima. No fue
casualidad: al cerrar P09 el margen era de 0,1 kB, y lo que lo recuperó fue una observación —la
barra del catálogo, el panel de filtros y el menú de orden **no existen en la portada**— que valió
nueve kilobytes. Es la misma regla que ya seguían la vista rápida y el cajón: lo que aparece por una
acción se descarga con la acción.

Los tres aumentos, explicados:

- **Ficha +14,1 kB.** El acordeón de detalle (MUI) y la fila de producto V3, que a cambio trae la
  densidad del tema en las sugerencias. Queda a 8,8 kB del techo.
- **Checkout +5,4 kB.** No se tocó el checkout: hereda el crecimiento de la entrada compartida
  (275,9 → 277,7 kB) y de piezas comunes de la vitrina.
- **Backoffice +2,9 kB.** El panel de presentación por sección y la vista previa con paridad.
  Queda a 4,3 kB del techo, y es el recorrido más ajustado que deja V3.

Nada crítico se difirió: el buscador y el carrito siguen en el primer pintado.

## Auditorías de P14

### Multi-industria — **dos hallazgos reales**

La auditoría se amplió del `store.*` de la vitrina al **diccionario completo de los dos idiomas**, y
ahí apareció lo que ninguna comprobación anterior podía ver: el español está **partido en dos
archivos** y solo se auditaba uno.

1. **`aiQuotes.example1` y `aiQuotes.example2`** — los ejemplos del borrador de cotización con IA
   decían «Cotización para **Farmacia** Central: 12 **jarabe para la tos**» y «20 cajas de
   **paracetamol** 500 y 10 de **ibuprofeno**». Copy de producción que veía **todo** comercio, de
   cualquier rubro. Reescritos con referencias genéricas, conservando la forma de la instrucción —a
   quién, cuánto, de qué, vigencia, entrega— en ES y EN.
2. **`pim.bundle.needsKind`** — decía «definir su **receta**», la única palabra del diccionario que
   se leía como vocabulario de farmacia. Ahora dice «sus **componentes**», que es como se llaman en
   las otras siete líneas del mismo bloque.

La lista de excepciones está **vacía**: no hay ni una palabra de rubro en ningún texto de la
plataforma, en ninguno de los dos idiomas.

### Accesibilidad — **un hallazgo real**

La comprobación nueva —«ningún par de controles tabulables comparte nombre accesible»— encontró que
la rejilla del catálogo tenía **veinticuatro botones llamados «Agregar al carrito»** y otros
veinticuatro «Guardar en favoritos». Quien la recorre con un lector de pantalla oía la misma frase
veinticuatro veces sin saber de qué producto. Ahora el nombre accesible lleva el producto detrás
—«Agregar al carrito: Silla de roble»— y el texto visible se queda corto, porque la tarjeta ya dice
de qué producto es. Veinte consultas de prueba se adaptaron al nombre nuevo, ninguna se debilitó.

Lo demás ya estaba cubierto y sigue verde: un solo `h1` por página (portada, catálogo y ficha, con
todo encendido), skip link, `<main>` enfocable pero fuera del tabulador, buscador como landmark,
cajón de filtros con foco atrapado y cierre por `Escape`, acordeones con `aria-expanded`, columna de
filtros como `complementary` con nombre, `prefers-reduced-motion` respetado en la barra de avisos y
en los carruseles, y contraste garantizado con `accent-deep` para texto.

### Responsive

Sin barra de desplazamiento horizontal, **comprobado en un navegador de verdad**: las nueve celdas
de la matriz miden `scrollWidth` contra `innerWidth` a 1280, 768 y 390, y ninguna se arrastra. Como
segunda red está la regla **R12** en `architecture.test.ts`:
ningún archivo de la vitrina escribe `100vw` para medir. `100vw` incluye el ancho de la barra
vertical, y es el fallo clásico de una línea que arrastra la tienda entera de lado. La única
excepción es un `maxWidth` —un tope de ancho no puede provocar desbordamiento, lo evita— y está
nombrada en la propia prueba.

Las diferencias entre teléfono y escritorio se comprueban por estructura, que es lo que jsdom sí
puede ver: el orden del documento, la presencia del cajón, el marco del panel y las reglas CSS con
sus `@media` intactos.

## Playwright: ejecutada, y encontró un defecto real

`npx playwright install chromium` + `npx playwright test --project=escritorio visual-matrix`:
**9 celdas en verde** —portada, catálogo y ficha × 1280/768/390—, consola limpia en todas y nueve
capturas en `test-results/visual/`. La décima, la del taller de diseño, se salta a sí misma con su
motivo escrito: necesita sesión de backoffice, y una prueba roja por falta de entorno enseña a
ignorar el rojo.

Y justificó su existencia en la primera ejecución: **un comentario de código se estaba pintando en
la ficha de producto**, en los tres anchos, entre la disponibilidad y la barra de compra.

En JSX, `//` solo es comentario donde hay JavaScript. El que explica el `role="group"` del grupo de
compra vivía justo después del `return (` de `AddToCart`, donde era código; al envolver ese retorno
en un fragmento —para añadir la barra de compra del teléfono, en P10— quedó **dentro** del
fragmento, y cuatro líneas sobre lectores de pantalla pasaron a ser contenido visible.

Ninguna de las 6 289 pruebas de unidad lo vio: el texto de sobra no rompía una sola aserción. Hizo
falta mirar una captura.

Arreglado con llaves (`{/* … */}`), y con una red en `storefront-ui.test.tsx` que cubre la clase
entera: el texto visible de portada, catálogo y ficha no puede contener un acento invertido. Es un
marcador limpio —los comentarios de este repo están llenos de ellos y ninguna copia de interfaz usa
uno, porque las comillas de la copia son angulares—. Comprobado que la red funciona: reintroduciendo
el fallo, la ficha se pone roja.

Se descartó hacerlo con una regla sobre el texto de los archivos: `return <LoadingState />` seguido
de un comentario a nivel de sentencia es indistinguible, sin analizar el árbol, de un comentario en
posición de hijos. Se intentó y daba doce falsos positivos.

## Limitaciones

1. **La celda del taller de la matriz visual no se ejecuta** sin sesión de backoffice en el servidor
   de desarrollo. Las otras nueve sí, y están en verde.
2. **Los lineamientos EBIM no se pudieron leer.** La ruta montada
   (`<unidad>:\.shortcut-targets-by-id\…\EBIM-Plataforma\`) no resolvió en esta máquina y tampoco el
   acceso directo `<Drive>:\Mi unidad\EBIM-Plataforma.lnk`. Se trabajó con
   `docs/EBIM_GUIDELINES_TRACE.md` —la transcripción del repo— tal y como autoriza P00, y por el
   mismo motivo **no se pudo leer `coordinacion/BANDEJA.md`**: si hay mensajes `to: ecommerce` sin
   atender, siguen sin atender.
3. **Las dimensiones de las imágenes no se guardan en base.** Readiness no puede avisar de «esta
   foto es demasiado pequeña para la portada» porque no hay columna donde esté. Es modelo nuevo y el
   propio encargo de P11 lo deja fuera; la utilidad ya **devuelve** ancho y alto, así que el día que
   se decida, el dato está donde hay que cogerlo.
4. **No se generan derivados de imagen** (`srcset`, `@2x`). Sin generación en el storage, inventar
   URLs de derivados es prometer archivos que no existen.
5. **La vista previa sigue aproximando** la cabecera completa, las puertas de familia y la tarjeta
   de producto. Compartirlas arrastraría carrito, sesión, consultas y enlaces a rutas de la vitrina
   al backoffice. Lo que se añade es que cada aproximación **declara qué representa**, así que una
   variante nueva sin representación sale en rojo.

## Pendientes reales

**Del operador, y bloqueantes para ver esto en QAS:**

1. **`git push` sigue bloqueado por credenciales.** GitHub rechaza la clave SSH `github-ebim`
   (`Permission denied (publickey)`), diagnosticado con `ssh -vT`: la configuración resuelve y la
   clave se ofrece. Hay que añadir la clave a la cuenta, pasar el remoto a HTTPS con token, o
   instalar `gh`.
2. **Siete migraciones sin aplicar en QAS.** Las cuatro de V2 —`…140000_storefront_value_props`,
   `…150000_brand_logos`, `…160000_category_media`, `…170000_store_best_sellers`— y las tres de V3.
   Sin ellas, la pantalla de diseño enseña «el diseño de tienda estará disponible en cuanto se
   aplique la última actualización de la base de datos», que es exactamente lo que se vio en QAS.
   **No se ejecutó ninguna migración remota.**
3. **Ejecutar la matriz visual** en una máquina con navegador.

**Técnicos, no bloqueantes:**

4. El backoffice queda a **4,3 kB** de su techo. Si algo lo empuja, el candidato es la vista previa
   del taller por `lazy`: solo se pinta en escritorio y es la mitad de la pantalla.
5. La ficha queda a **8,8 kB**. El candidato es la zona de detalle por `lazy`: está debajo del
   pliegue y no forma parte de la decisión de compra.
6. `split` de la banda de rebajados existe y **ningún tema lo resuelve**: cuesta alto de página y
   se dejó como elección del comercio. Si se quiere por defecto en algún tema, es una línea en
   `AUTO_POR_TEMA` y una prueba.

## Definition of Done

| Criterio | Estado |
|---|---|
| Los cuatro temas tienen personalidades visuales reales | ✅ cabecera, hero, tarjeta, familias, marcas, ritmo y encaje de foto distintos por preset |
| El header deja de sentirse como backoffice | ✅ tres composiciones, la de marca a dos alturas |
| Premium prioriza marca/fotografía/editorial | ✅ cabecera `brand`, hero `statement`, tarjeta `editorial`, mosaico, muro de logotipos |
| Retail prioriza conversión y descubrimiento | ✅ rejilla, densidad alta sin miniaturizar |
| Catalog prioriza productividad/densidad | ✅ seis columnas, píldoras, `contain`, buscador primero |
| Universal sigue siendo seguro y equilibrado | ✅ resuelve **exactamente** lo de V2 |
| El hero nunca repite el nombre sin necesidad | ✅ y no se inventa subtítulo |
| Un storefront incompleto parece intencional | ✅ respaldos en hero, familias, marcas y descripción |
| `ProductRow` no fuerza tarjetas miniatura iguales | ✅ hueco y tarjeta por variante |
| Home soporta merchandising | ✅ presentación por sección, superficie y full bleed |
| Catálogo móvil con filtros en cajón | ✅ con foco atrapado y `Escape` |
| PDP comercial, no panels de backoffice | ✅ sin tarjetas, detalle plegado, barra de compra |
| El editor controla lo nuevo sin volverse complejo | ✅ panel por sección, no 78 controles en la lista |
| Preview y storefront con paridad comprobable | ✅ 15 pruebas de paridad; tres piezas compartidas |
| Existe una matriz visual desktop/tablet/mobile | ✅ ejecutada: 9/9 en verde, y encontró un defecto real |
| typecheck, lint, unit, build, secret scan, bundle | ✅ todos verdes |
| DB tests verdes | ✅ 3653 |
| No hay push ni deploy | ✅ |

---

`PUSH: NO`
`DEPLOY: NO`
