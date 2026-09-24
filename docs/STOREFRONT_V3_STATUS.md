# Storefront V3 · Commerce Design System — estado de ejecución

Ejecución del pack `EBIM_ECOMMERCE_STOREFRONT_V3` (P00–P14) sobre este repositorio, que ya contiene
Storefront V2 completo.

- **Inicio:** 2026-09-23 (hora local del operador)
- **Rama de trabajo:** `feat/storefront-v3-commerce-design-system` (creada desde el HEAD con V2)
- **HEAD inicial (P00):** `b4dc01e8db8ec0608bb6cab546b2c150ff9a1161`
- **PUSH:** NO · **DEPLOY:** NO · **MIGRACIONES REMOTAS:** NO

---

# P00 · Línea base, rama y evidencia inicial

**Commit:** `9217828` · **Ciclos correctivos:** 0 de 3

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

---

# P01 · Identidad de la tienda con roles semánticos

**Commit:** `60196f0` · **Ciclos correctivos:** 1 de 3

## El problema

`hero_subtitle` hacía dos trabajos incompatibles. Es la bajada del hero —que es
estacional: «Campaña de invierno»— y desde P09 de V2 también la **descripción
estable** del comercio que pintan el pie y los datos del negocio.

La consecuencia era concreta y silenciosa: un comercio estrenaba campaña y, sin
querer, cambiaba lo que su tienda decía de sí misma en el pie de **todas** sus
páginas. Al revés también: quien quería un resumen serio abajo se quedaba sin
poder usar el hero para una campaña.

Y había dos decisiones de cabecera que el comercio nunca pudo tomar: si su
logotipo —que muchas veces ya lleva el nombre dentro— tenía que salir *además*
con el nombre al lado, y si la vitrina ofrecía un selector claro/oscuro que
nadie había pedido y que compite por atención con el carrito.

## Lo que se hizo

### Migración `20260923180000_store_identity_v3.sql`

| Columna | Qué es | Defecto |
|---|---|---|
| `store_description` | resumen **estable**: pie, datos del negocio, reserva de SEO (360) | `null` |
| `hero_kicker` | línea corta encima del titular (80) | `null` |
| `brand_lockup` | `logo_name` · `logo` · `name`, con CHECK | `logo_name` |
| `show_theme_toggle` | selector claro/oscuro en la vitrina | **`false`** |
| `announcement_messages` | 0–2 avisos del comercio | `[]` |

Dos validadores nuevos —`ebim.announcement_is_valid` y
`ebim.announcements_are_valid`— con la regla que de verdad protege: **un objeto
con una sola clave, `text`**. Sin eso, el primer `{"text":"…","html":"<script>"}`
que alguien guarde acaba en el DOM de sus compradores. Grants por columna,
`public_stores` recreada con los cinco campos y `security_invoker` intacto.

**Ninguna tienda cambia de aspecto por aplicar la migración**, con una excepción
deliberada: el selector de tema desaparece de la cabecera hasta que el comercio
lo encienda. No hay ni un UPDATE masivo.

### El contrato en el front: `storefront/identity.ts`

Cinco resolvedores y ni una regla de negocio. Los dos que importan:

- **`resolveStoreDescription`** — usa `store_description`, y solo cae a
  `hero_subtitle` mientras esa descripción esté sin escribir. Es compatibilidad,
  no acoplamiento: en cuanto el comercio escribe la descripción, los dos campos
  se separan para siempre. Y el respaldo es texto que el comercio ya había
  escrito, no texto que la plataforma invente.
- **`resolveBrandLockup`** — respeta lo elegido salvo en el caso que no se puede
  pintar: `logo` o `logo_name` **sin logotipo** dejarían un hueco donde va la
  marca, así que se enseña el nombre. Al revés no se corrige: `name` con
  logotipo es una decisión legítima. Esa corrección vive del lado que pinta, una
  sola vez, y no como un control desactivado en el formulario — el orden en que
  alguien rellena un formulario no es asunto del formulario.

`sanitizeAnnouncements` descarta entrada a entrada en vez de tirar la lista: una
barra con un aviso bueno y otro corrupto enseña el bueno.

### Configuración

- **General** → la tarjeta de identidad pasa de un campo a tres, con sus roles
  dichos en la etiqueta: «Descripción de la tienda» (estable), «Línea superior de
  la portada» (kicker) y «Mensaje de la portada» (campaña).
- **Marca** → tarjeta nueva «Cabecera y avisos»: lockup, selector de tema y la
  barra de 0–2 avisos. Va ahí y no en General porque es el *chrome* de la
  vitrina y vive al lado del logotipo, que es justo lo que el lockup decide
  enseñar.

Las cinco columnas entran en el grupo de **columnas de despliegue reciente** de
`api.ts`, junto a las del tema: hasta que la migración esté aplicada, pedirlas
tumbaría la consulta entera con un `42703` y dejaría sin abrir toda la pantalla
de Configuración. Entran en el mismo grupo y no en uno nuevo porque el error no
dice **qué** columna falta.

### El lado de lectura

Pie, datos del negocio y meta descripción pasan a `resolveStoreDescription`. Lo
que un buscador indexa deja de cambiar cada temporada.

## Lo que NO se hizo, y es deliberado

El prompt pedía el modelo, no el rediseño: **no se tocó el aspecto del header ni
del hero**. `hero_kicker`, `brand_lockup` y los avisos quedan guardados y
validados, esperando a P03 y P04. Meter estilos V3 aquí habría mezclado dos
fases y dejado el rediseño sin su contrato terminado.

## Ciclo correctivo

1. `store-default-country.test.ts` fija **por inventario** las columnas de
   `public_stores` y se puso rojo al sumar las cinco. Es un gate deliberado —
   existe para que nadie amplíe la frontera pública sin decirlo— así que se
   actualizó la lista declarando los cinco campos, conservando intacto lo que
   comprueba: que no se cuela nada interno.

## Tests

| Archivo | Casos |
|---|---|
| `storefront/identity.test.ts` | **Nuevo**, 26. La descripción se separa del hero y **cambiar de campaña deja de tocar el pie**; una tienda anterior a V3 no pierde su pie; sin ninguno de los dos no se inventa nada; el kicker vacío no se rellena; los tres lockups; **sin logotipo se enseña el nombre** y «solo nombre» con logotipo se respeta; el selector solo se enciende con un `true` de verdad; la barra corta en dos, descarta lo corrupto, **rechaza cualquier clave de más**, conserva el marcado como texto, no admite repetidos y quita los caracteres de control. |
| `supabase/tests/store-identity-v3.test.ts` | **Nuevo**, 30 contra Postgres real. Defectos que no cambian ninguna tienda; la migración no tocó `hero_subtitle`; lo que el comercio sí puede escribir, incluidos los límites exactos; y lo que la base rechaza —textos largos, lockup inventado, tres avisos, claves de más, saltos de línea, repetidos, nulo—. Aislamiento: el admin de otra sociedad no escribe esta tienda. Vitrina anónima: lee los cinco, **no puede escribirlos**, la vista no expone nada interno y una tienda suspendida no se ve. Y una tienda sin fila de ajustes recibe los defectos por la vista. |
| `store-default-country.test.ts` | Inventario de `public_stores` ampliado con los cinco campos. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 302 ficheros, 5981 tests |
| `npm run build` | **PASS** |
| `npm run test:db` | **PASS** — 137 ficheros, 3625 tests |
| `npm run bundle:report` | **PASS** — portada 399,8 kB (techo 405; base 398,8) |

`PHASE_RESULT: PASS`

---

# P02 · Theme Engine V3: personalidades reales y encaje de foto

**Commit:** `12b3d2e` · **Ciclos correctivos:** 2 de 3

## El problema

Dos, y el segundo era un acoplamiento con consecuencias comerciales.

**Premium se distinguía en las medidas, no en la forma.** Declaraba
`standard` / `comfortable` / `tiles`: las mismas piezas que Universal con más
aire y proporción vertical. El pack V3 rechaza eso explícitamente como rediseño,
y con razón — un tema que solo cambia el relleno no es una personalidad.

**`ProductCard` traía `fit="contain"` cableado.** Es la decisión correcta para un
catálogo de referencias fotografiadas sobre fondo claro —recortar una caja de
medicamento se come el principio activo; recortar un tornillo, la métrica— y la
equivocada para una tienda de moda, donde el encuadre completo deja franjas
vacías arriba y abajo de cada prenda y la rejilla se ve descosida. Con la
decisión dentro del componente no había forma de tener las dos sin un `if` por
tema dentro de la tarjeta, que es justo lo que este contrato existe para evitar.

## Lo que se hizo

### El contrato pasa de 7 claves a 8, y tres listas crecen

| Clave | V2 | V3 |
|---|---|---|
| `headerVariant` | `standard` · `compact` | **+ `brand`** |
| `productCardVariant` | `comfortable` · `compact` | **+ `editorial`** |
| `categoryVariant` | `tiles` · `pills` | **+ `mosaic`** |
| `productMediaFit` | *(cableado en la tarjeta)* | **`cover` · `contain`** |

Las tres composiciones nuevas no son medidas: `brand` reparte la cabecera en dos
filas con la marca centrada; `editorial` suelta el recuadro de la tarjeta para
que mande la fotografía; `mosaic` da a las familias tamaños distintos, que es lo
que dice cuál manda —azulejos iguales dicen que ninguna—.

### Premium estrena las tres

| Preset | header | hero | card | categorías | fit |
|---|---|---|---|---|---|
| Universal | standard | product | comfortable | tiles | **contain** |
| Retail | standard | product | compact | tiles | contain |
| **Premium** | **brand** | statement | **editorial** | **mosaic** | **cover** |
| Catalog | compact | product | compact | pills | contain |

Y la clave nueva tiene un sitio donde de verdad cambia algo: Premium es el único
con `cover`, porque es el tema que se elige cuando la fotografía **es** el
argumento de venta.

### Desvío declarado: Universal se queda en `contain`

El prompt de la fase proponía `cover` para Universal. Se conserva `contain`, y
por dos motivos que apuntan al mismo sitio:

1. Universal es el tema de quien **no ha elegido**, y la plataforma no sabe qué
   vende. `cover` recorta, y recortar la foto de otro es pérdida de información
   irreversible desde la vitrina.
2. El mismo prompt exige que Universal conserve una apariencia compatible. Hoy
   **todas** las tiendas ven `contain` (estaba cableado), así que poner `cover`
   habría recortado las fotos de cada tienda que nunca eligió tema.

Los dos requisitos del prompt chocaban entre sí; se resuelve del lado que no
destruye datos ajenos. Quien quiera el encuadre lleno lo tiene a un control de
distancia, o eligiendo Premium.

### La decisión sale del componente

`--sf-media-fit` viaja como variable de CSS desde la frontera `.sf-scope`, y
`ProductMedia` la recibe por su prop `fit` con reserva (`contain`). No hay ni un
`if (theme === …)` dentro de la tarjeta: el tema decide una vez, en la frontera,
y los componentes leen. Se añaden también `data-store-cats` y `data-store-media`
al DOM, los dos de lista cerrada.

### Migración `20260923190000_theme_contract_v3.sql`

`create or replace` de `ebim.storefront_style_is_valid` con las ocho claves. La
migración V2 no se toca. Sigue rechazando claves desconocidas y aceptando objetos
parciales, con los mismos grants y `search_path` vacío.

**No hace falta revalidar ninguna fila**: la lista solo crece, y una función más
permisiva no puede invalidar lo que ya pasaba.

## Ciclos correctivos

1. Seis pruebas rojas al crecer el contrato, todas de gates deliberados: el censo
   de valores probados de `theme-contract.test.tsx`, la altura de la cabecera
   —que ahora tiene tres alturas y no dos—, el inventario de claves del estilo
   normalizado, y dos textos del taller («2 de 7» → «2 de 8», y el resumen de
   Premium, que pasa de «Cómoda» a «Editorial»). Se actualizaron declarando los
   valores nuevos, sin relajar lo que comprueban.
2. `multi-industry.test.ts` fija por inventario las claves de `ThemeDefinition`
   para que nadie cuele un campo `industry`. Se añadió `productMediaFit` a la
   lista esperada, conservando intacta la prohibición.

## Tests

| Archivo | Casos |
|---|---|
| `theme/contract-v3.test.ts` | **Nuevo**, 17. Las tres listas crecieron; el encaje es clave del contrato; **los valores de V2 siguen validando**; el saneador y el esquema aceptan lo nuevo; **un encaje inventado no llega como CSS** —ni `fill`, ni `scale-down`, ni una inyección—; un valor inventado cae al del preset; el estilo normalizado trae siempre el encaje; sigue aceptando parciales. Y las personalidades: Premium estrena las tres composiciones, es el único con `cover`, Universal conserva exactamente lo de antes, Catalog y Retail siguen siendo el productivo y el denso, ninguna combinación se repite y **cada composición nueva la usa al menos un preset** — un contrato con opciones que nadie usa declara trabajo que no se hizo. |
| `supabase/tests/storefront-theme.test.ts` | 98 → **104**. Bloque nuevo: la base acepta las tres composiciones y el encaje, una a una y juntas, y los valores de V2 siguen entrando. Y seis rechazos nuevos: los otros `object-fit` que existen en CSS (`fill`, `scale-down`), CSS colado en el encaje y las tres variantes que V3 **no** añadió. |
| `theme/theme-contract.test.tsx`, `theme/theme.test.ts`, `settings/storefront-design.test.tsx`, `multi-industry.test.ts` | Actualizados para el contrato de ocho claves, con las alturas de las tres cabeceras y el nuevo censo. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 303 ficheros, 6012 tests |
| `npm run build` | **PASS** |
| `npm run test:db` | **PASS** — 137 ficheros, 3637 tests |
| `npm run bundle:report` | **PASS** — portada 400,1 kB (techo 405) |

`PHASE_RESULT: PASS`

---

# P03 · Cabecera, navegación y barra de avisos

**Commit:** `<pendiente>` · **Ciclos correctivos:** 2 de 3

## El problema

Había **una** barra —logotipo, buscador, acciones— y `headerVariant` solo le
cambiaba la altura y el alto de la caja de búsqueda. Doce píxeles. La primera
pantalla de una tienda premium se veía igual que la de un catálogo de
ferretería, y eso es lo primero que dice a qué se dedica una página.

Además: la cabecera pintaba logotipo **y** nombre siempre —y la mayoría de los
logotipos comerciales ya llevan el nombre dentro, así que esas tiendas lo
enseñaban dos veces— y ofrecía un selector claro/oscuro que ningún comercio
había pedido, compitiendo por atención con el carrito.

## Lo que se hizo

### Tres repartos de las mismas piezas

| | marca | buscador | acciones |
|---|---|---|---|
| `standard` | izquierda, `md` | centro, en la barra | derecha |
| `compact` | izquierda, **`sm`** | **centro ancho**, gana lo que la marca suelta | derecha, compactas |
| `brand` | **centro, `lg`** | **debajo**, acotado a 520 px | derecha, sobre la marca |

No son tres cabeceras: son tres composiciones de `StoreBrandLockup`,
`StoreQuickSearch` y los cuatro botones. **Ninguna variante quita ninguna
pieza** —un tema que dejara la tienda sin carrito dejaría de ser un tema— y hay
una prueba por variante que lo comprueba.

En la de marca las acciones van en posición absoluta para que el logotipo quede
centrado respecto a la **página** y no respecto al hueco que le dejan: con
`space-between`, el logotipo se descentraba en cuanto el carrito ganaba una
insignia de dos cifras.

**En el teléfono las tres se comportan igual**, y a propósito: dos filas de marca
centrada en 390 px se comen media pantalla antes del primer producto. Y ninguna
esconde el buscador — se probó en V2 y dejaba a quien llegaba por teléfono sin
forma de buscar en un catálogo de cientos de referencias.

### `StoreBrandLockup`: la marca deja de duplicarse

Una pieza, tres modos y un tamaño que decide la composición —nunca el contenido—.
Con `logo_name` el logotipo va **decorativo** (`alt=""`, `aria-hidden`) porque el
nombre está escrito al lado: hasta V3 un lector de pantalla anunciaba «Atelier
Norte Atelier Norte». Con `logo` el logotipo sí se anuncia, porque entonces es
lo único que identifica la tienda. Y `logo` sin logotipo cae al nombre en vez de
dejar el hueco.

### `StoreAnnouncementBar`: solo lo que el comercio escribió

No existe si no hay avisos, y no hay ni uno por defecto. Escritorio: los dos, uno
al lado del otro. Teléfono: uno, rotando cada cinco segundos — y **sin rotar** con
`prefers-reduced-motion`, porque un mensaje que cambia solo es movimiento y hay
gente a la que le sienta mal.

`role="status"` y no `aria-live="assertive"`: es información de servicio, y
`assertive` interrumpiría a media frase a quien esté escuchando la página. La
rotación es estado de React y no CSS a propósito: con opacidades los dos
mensajes estarían siempre en el documento y se leerían seguidos, como una sola
frase.

### El selector de tema, apagado

`ThemeButton` devuelve `null` salvo que el comercio lo haya encendido. Lo que no
desaparece es el tema oscuro: la vitrina sigue respetando la preferencia del
sistema de quien llega. Se va el control, no el modo. El backoffice conserva el
suyo en Apariencia.

## Ciclos correctivos

1. Tres pruebas de `storefront-ui.test.tsx` rojas, las tres por consecuencias
   buscadas: el selector de tema ya no sale por defecto —se añadió el caso que
   fija que **no** está y el que lo enciende— y el logotipo junto al nombre ya no
   duplica el nombre accesible, así que las dos aserciones pasan a buscarlo por
   `src` y se añade el caso de «solo logotipo», donde sí se anuncia.
2. Dos supuestos míos equivocados en las pruebas nuevas, corregidos en las
   pruebas: el carrito es un **botón** (abre el cajón, no navega) y no un enlace;
   y la navegación de familias existe también en el pie, así que buscarla en todo
   el documento encontraba dos — se busca dentro de la cabecera y esperando, que
   es lo que hace la tienda real.

## Tests

| Archivo | Casos |
|---|---|
| `storefront/header-v3.test.tsx` | **Nuevo**, 20. Las tres variantes se declaran en el DOM y **ninguna quita buscador, carrito, cuenta ni marca**; las tres dejan llegar a las familias; la de marca reparte en dos filas de verdad —su buscador no está en la barra— y cada variante trae su altura. Lockup: los tres modos, el logotipo decorativo cuando el nombre está al lado, «solo logotipo» anunciándose, «solo nombre» respetado con logotipo y «solo logotipo» sin logotipo cayendo al nombre. Barra: no existe sin avisos ni con lista vacía, pinta lo escrito, va encima de la barra, descarta lo corrupto, el marcado se queda en texto y se anuncia como estado. Selector de tema apagado en las tres composiciones y funcionando con teclado al encenderlo. Y la cabecera no nombra ningún rubro. |
| `storefront-ui.test.tsx` | 50 → **52**, con los dos casos nuevos del selector y del lockup. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 304 ficheros, 6034 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — portada 400,8 kB (techo 405) |

`PHASE_RESULT: PASS`
