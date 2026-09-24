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

**Commit:** `bae138c` · **Ciclos correctivos:** 2 de 3

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

---

# P04 · La portada editorial: respaldos reales y sin copy inventado

**Commit:** `e485446` · **Ciclos correctivos:** 2 de 3

## Los dos problemas

**Caía al degradado demasiado pronto.** Sin `banner_url` el hero era un
rectángulo de color. Una tienda con quinientas fotos dentro y sin banner —que es
toda tienda el primer día— abría con algo que se lee como «a medio montar».

**Se repetía y se inventaba.** El antetítulo pintaba **siempre** el nombre de la
tienda y el titular caía al nombre cuando no había `hero_title`: toda tienda sin
lema propio abría con su nombre dos veces, uno encima del otro. Y la bajada,
cuando no había, la escribía la plataforma — «Explora el catálogo, revisa precios
y disponibilidad al día», copy comercial en la tienda de alguien que no lo había
pedido.

## Lo que se hizo

### Cuatro escalones de respaldo, y tres son fotos del comercio

```
1 · banner_url            → el banner que el comercio subió; manda siempre
2 · collage 1-3 fotos     → productos publicados, de datos YA cargados
3 · foto de una familia   → si alguna categoría tiene
4 · degradado del acento  → último recurso: COLOR, no una foto de archivo
```

`data-hero-media` declara cuál se está usando, así que la cadena es comprobable
sin comparar capturas.

**Ni una consulta nueva.** Las fotos salen de los productos que la portada ya
tiene repartidos (`ofertas`, `destacados`, `novedades`) cruzados con las
miniaturas que ya firmó para sus filas. Decorar una portada no puede costar una
petición por visita, y menos una por foto. Una URL sin firmar no cuenta: un
`src` con la ruta cruda del bucket da 403 y el hero se quedaría con un hueco en
vez de caer al respaldo siguiente.

El collage **cambia de forma** con el número: una foto alta, dos columnas, o una
grande con dos apiladas. Una foto estirada al ancho de dos no es una composición.
Y va al lado del texto, no debajo: son fotos de producto sobre fondo claro, y
poner texto blanco encima las estropea. En el teléfono, texto y botón primero.

### La regla de no repetirse

| | antes | ahora |
|---|---|---|
| kicker del comercio | no existía | manda cuando está |
| sin kicker, titular ≠ nombre | nombre arriba + titular | igual (el nombre da contexto) |
| sin kicker, titular = nombre | **nombre dos veces** | una sola vez |
| sin bajada | copy de la plataforma | **nada** |

Se retira la clave `store.hero.fallbackSubtitle` de los dos diccionarios: dejarla
invitaba a volver a rellenar la portada de otro.

## Lo que se conservó a propósito

`StoreFeaturedHero` —la portada de producto— **no se tocó**. El prompt pedía
«pulir composición», y la actual ya cumple lo que pide el resto del punto:
precio, descuento y CTA reales resueltos por el motor comercial, sin badges de
relleno, con `contain` para no recortar el producto y con controles accesibles.
Cambiarla habría sido riesgo sobre pricing real sin ganancia demostrable; lo que
sí gana en esta fase es la variante `statement`, que era la que no competía.

## Ciclos correctivos

1. La prueba de «respaldos neutrales» de `storefront-ui.test.tsx` exigía la
   bajada inventada. Se invierte: ahora comprueba que **no** está y que el nombre
   se escribe una sola vez dentro de la portada.
2. Dos localizadores míos mal puestos en las pruebas nuevas: la portada se busca
   por su atributo y no por su nombre accesible —el nombre **es** el titular, que
   es justo lo que cambia en cada caso—, y el botón de rebajas se llama «Ver lo
   rebajado», no «ofertas».

## Tests

| Archivo | Casos |
|---|---|
| `components/hero-v3.test.tsx` | **Nuevo**, 18. Los cuatro escalones en orden, con el banner ganando a todo; el collage cambia de forma con 1, 2 y 3 fotos, corta en tres y es decorativo; una URL vacía no cuenta. Verdad: sin titular propio el nombre se escribe una vez, con titular el nombre da contexto, con kicker manda el kicker y el nombre no se cuela, el kicker funciona incluso cuando el titular es el nombre, sin bajada **no se inventa** y con bajada se pinta la suya. Puertas: siempre al catálogo, a lo rebajado **solo si hay**, **ni un precio** en la portada editorial, y sin slug la portada sigue pintándose sin enlaces. |
| `storefront-ui.test.tsx` | Actualizado: la portada sin datos ya no escribe una bajada y no repite el nombre. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 305 ficheros, 6052 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — portada 401,3 kB (techo 405) |

`PHASE_RESULT: PASS`

---

# P05 · Tarjetas y filas que respetan el tema

**Commit:** `ff4cf50` · **Ciclos correctivos:** 3 de 3

## El problema

La fila de la portada usaba **`itemWidth={168}` para todas las tiendas** y
forzaba la tarjeta reducida en cuanto había más de seis productos. 168 px es el
ancho de una tarjeta de catálogo denso: en Catalog está bien, y en Premium
convertía una portada editorial en una tira de miniaturas.

El tema declaraba una personalidad y la fila la deshacía **en cuanto la tienda
tenía catálogo**, que es siempre. Era además el fallo más difícil de ver
revisando código: cada pieza por separado parecía correcta.

Y detrás había una confusión de nombres. `ProductCard` tenía una prop `compact`
que significaba «esta tarjeta es un anuncio de una fila, no un mostrador»,
mientras que `productCardVariant: 'compact'` del contrato significa «densidad
alta». Dos ejes distintos con el mismo nombre: la fila pasaba `compact={true}` y
la tarjeta entendía «densa».

## Lo que se hizo

### Dos ejes, dos nombres

| eje | quién decide | prop |
|---|---|---|
| presentación (cómoda · densa · editorial) | el **tema** | `variant`, leída del contexto |
| ¿es un anuncio o un mostrador? | la **fila** | `reduced` |

`reduced` quita lo que se decide *dentro* de la ficha —botón de comprar,
pastilla de estado— y **no toca la densidad**. Sigue habiendo **una** tarjeta
funcional: enlace, favorito, vista rápida, precio público y comercial,
compare-at, disponibilidad, variantes y añadir al carrito. No cuatro componentes
de negocio.

La presentación se lee del contexto del tema con la prop como excepción —para la
vista previa y las pruebas—, así que la rejilla, las filas y el cajón del
asistente coinciden sin que nadie tenga que acordarse de pasarla. Y no hay ni un
`if (theme === 'premium')` en la tarjeta: hay tres presentaciones nombradas.

### `editorial`: la tarjeta que desaparece

Sin borde y sin sombra permanente, sin fondo de tarjeta y sin relleno: queda la
fotografía sobre el fondo de la página con el texto debajo. El relieve aparece
solo al apuntar o al enfocar, que es cuando hace falta saber qué tarjeta está
activa. **Es la diferencia que se ve en una captura sin inspeccionar nada.**

### `rowSlots.ts`: los anchos como datos

```
compact      156 / 172 / 184     (xs / sm / md)
comfortable  176 / 208 / 236
editorial    232 / 272 / 304
```

En su propio módulo porque son datos del sistema de diseño —los consumen la fila
y su esqueleto de carga, y en P13 los consumirá la vista previa— y porque
exportar una constante desde un archivo de componentes rompe la recarga en
caliente (lo dijo el linter, y tiene razón).

En el teléfono los tres miden **menos** que en escritorio y ninguno llega al
ancho de la pantalla: ese recorte es lo que deja ver un trozo de la siguiente
tarjeta, y ese trozo es la única señal de que la fila se arrastra. Ninguno baja
de 150 px, que es donde un nombre de producto deja de entrar en dos líneas.

## Ciclos correctivos

1. El linter cazó un `useStorefrontTheme()` **después** del retorno temprano de
   la fila: el orden de los hooks no puede depender de si hay productos. Movido
   arriba, con los otros dos.
2. Tres supuestos míos equivocados en las pruebas nuevas: la fila necesita
   `CartProvider` —vive en el layout de la vitrina—, hay más de un enlace al
   catálogo en una fila corta (el «ver todo» y la puerta), y **la vista rápida no
   es un botón**: es lo que hace el clic en la tarjeta conservando el `href`. La
   última se reescribió como una prueba de comportamiento —se pulsa la tarjeta y
   se espera la llamada—, que es mejor de lo que había escrito.
3. El ancho del hueco no se puede comprobar con `getComputedStyle` —llega como
   objeto responsive y en un entorno sin maquetación lo calculado no distingue
   uno de otro—, así que se comprueba la **tabla**: tres anchos distintos,
   ordenados, y ninguno vuelve al 168 universal.

## Tests

| Archivo | Casos |
|---|---|
| `components/card-rows-v3.test.tsx` | **Nuevo**, 21. **Con 7+ productos Premium NO cae en tarjetas densas** y Catalog sigue denso; los tres anchos son distintos, ordenados y ninguno es 168; en el teléfono todos encogen sin bajar de 150. La reducción es de la fila: sin botón de comprar en el carrusel, tarjetas completas con 4-6, y la presentación del tema manda también en la rejilla corta. Filas cortas: 1, 2 y 3 reparten y ofrecen el catálogo; 4 y 6 son rejilla; 7 pasa a carrusel; sin productos no hay fila. Y las tres presentaciones conservan enlace, precio, favorito, botón de compra **y** la vista rápida al pulsar. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 306 ficheros, 6073 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — portada 401,5 kB (techo 405) |

`PHASE_RESULT: PASS`

---

# P06 · Home Layout V2: merchandising y full bleed

**Commit:** `128cdeb` · **Ciclos correctivos:** 3 de 3

## El problema

La portada se componía como «título + fila de tarjetas», repetido. El orden se
podía cambiar y las secciones apagar, pero el ritmo era siempre el mismo: seis
bandas idénticas una debajo de otra. Para un catálogo denso eso es correcto
—lo que se quiere es recorrer—; para una tienda de marca es una lista, no una
portada.

## Lo que se hizo

### El contrato crece: `presentation` por sección

```json
{"id": "new-arrivals", "enabled": true, "maxItems": 12,
 "presentation": {"variant": "rail", "surface": "soft", "width": "bleed"}}
```

Tres campos, todos opcionales, **y las listas dependen de la sección**:

| familia | variantes | superficies |
|---|---|---|
| producto (`new-arrivals`, `best-sellers`, `featured`) | `auto · rail · grid · spotlight` | plain · soft · contrast |
| familias (`categories`) | `auto · tiles · pills · mosaic` | plain · soft |
| marcas (`brands`, `trust`) | `auto · cards · logos` | plain · soft |
| ofertas (`offers`, `promotions`) | `auto · band · split` | plain · soft · contrast |
| hero · cms · servicios · negocio | *(ninguna: ya la traen)* | plain (hero/cms) |

Una variante de producto en el hero **no se rechaza porque sea peligrosa**: se
rechaza porque no significa nada. Y no hay CSS, ni HTML, ni URL de fondo, ni
número de columnas — un maquetador libre convierte cada tienda en un caso único,
y a partir de ahí ninguna mejora de la vitrina llega a nadie sin romperle la
portada a alguien.

### `auto`, y por qué ninguna tienda cambia de portada

`auto` es el defecto y significa «lo que mi tema considere correcto aquí». Es lo
que tienen guardado **todas** las tiendas que existen, así que la compatibilidad
depende de una cosa: que `auto` de Universal resuelva lo que la portada pintaba
ayer. Lo hace, y hay una prueba dedicada.

| tema | producto | ofertas a sangre |
|---|---|---|
| Universal | `rail` *(lo de siempre)* | no |
| Retail | `grid` — enseña el surtido de una vez | no |
| Premium | `spotlight` — pocas piezas, grandes | **sí** |
| Catalog | `rail` — la primera pantalla es catálogo | no |

Se lee del **tema**, nunca del rubro: si una farmacia elige Premium, su portada
será editorial, y estará bien porque lo eligió.

Y `auto` **no resuelve nada que nadie pinte todavía**. El muro de logotipos
(`logos`) y la banda partida (`split`) son de P07: las listas cerradas ya los
aceptan, pero `auto` sigue dando `cards` y `band` hasta que sus componentes
existan. Es exactamente el fallo que `heroVariant` tuvo en V2 durante tres fases
—declarado y sin consumidor— y hay una prueba que lo impide.

### `StoreSectionFrame`: el full bleed, escrito una vez

Sacar una sección a sangre dentro de un contenedor centrado se hace con
`margin-inline: calc(50% - 50vw)`, que es fácil de escribir y fácil de escribir
mal: con `100vw` aparece una barra horizontal en cuanto hay barra vertical,
porque `vw` incluye su ancho. Repetido en seis secciones, es cuestión de tiempo
que una lo tenga mal y la tienda entera se arrastre de lado.

Aquí está una vez, con `overflow-x: clip` como red —y `clip` y no `hidden`,
porque `hidden` convierte la caja en contenedor de desplazamiento y **rompe** la
cabecera pegajosa y los anclas—. El marco no se pinta cuando no hace falta:
superficie plana y ancho contenido son los defectos de casi todas las secciones,
y trece envoltorios vacíos son trece nodos de más.

Las superficies son mezclas con **su** acento (`color-mix`), nunca colores
nuevos: el color sigue siendo 100 % del comercio.

### La versión describe el contenido

`sanitizeHomeLayout` declara `2` solo si alguna sección lleva presentación. Una
tienda que únicamente ordenó sus secciones sigue siendo V1: escribir `2` en su
fila haría creer que usa algo que no usa.

### Migración `20260924100000_home_layout_v2.sql`

`ebim.section_presentation_is_valid(text, jsonb)` —nueva, valida **por `id`**— y
reemplazo de las dos funciones de V2. Las dos versiones pasan el CHECK, la 3 no:
aceptar una versión desconocida sería prometer que se sabe leerla. **No se
actualiza ninguna fila.**

## Ciclos correctivos

1. El linter cazó el `useStorefrontTheme()` de la fila después de su retorno
   temprano (heredado de P05, corregido aquí).
2. `storefront-theme.test.ts` rechazaba `version: 2` como «versión futura», que
   era correcto hasta esta fase. Ahora la futura es la 3, y se añadió un bloque
   con lo que V2 acepta y doce casos de lo que rechaza.
3. Mi propia prueba «`auto` no resuelve nada que nadie pinte» cazó que **Catalog
   seguía resolviendo `logos`** — solo había corregido Premium. Y una expectativa
   mía sobre el saneador estaba mal: `band` se conserva aunque hoy coincida con
   lo que el tema resolvería, porque una elección explícita tiene que seguir en
   pie el día que el tema cambie de opinión.

## Tests

| Archivo | Casos |
|---|---|
| `theme/presentation.test.ts` | **Nuevo**, 19. Lo guardado manda y lo que no encaja se descarta; el hero no elige variante; familias y marcas no admiten contraste; ni CSS, ni URL, ni columnas. `auto`: **Universal resuelve exactamente lo de antes**, Premium estrena ritmo, Retail y Catalog sus prioridades, las familias siguen al contrato del tema, `spotlight` no se combina con tarjetas densas y **ningún tema resuelve una variante que nadie pinta**. Saneador: no guarda defectos, guarda lo que se apartó, descarta lo que no encaja. Y ninguna regla nombra un rubro. |
| `components/section-frame.test.tsx` | **Nuevo**, 8. El marco solo existe cuando hace falta; **usa `50vw` y no `100vw`**; devuelve el contenido a su ancho; recorta con `clip` y no con `hidden`; las superficies son mezclas del acento y el contraste pesa más que el tinte. |
| `theme/theme.test.ts` | +6. V1 se lee igual que siempre y sigue declarando V1; con presentación pasa a V2; lo que no encaja no se guarda; las secciones sin tope también pueden tener presentación; el CSS colado no sobrevive. |
| `supabase/tests/storefront-theme.test.ts` | 104 → **120**. V1 sigue válido, V2 con presentación completa y parcial, secciones sin presentación dentro de V2, y doce rechazos —variantes cruzadas de familia, contraste donde taparía fotos, anchos inventados, CSS, URL, columnas, tipos—. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 308 ficheros, 6122 tests |
| `npm run build` | **PASS** |
| `npm run test:db` | **PASS** — 137 ficheros, 3653 tests |
| `npm run bundle:report` | **PASS** — portada 402,6 kB (techo 405) |

`PHASE_RESULT: PASS`

---

# P07 · Mosaico de familias y muro de logotipos

`ESTADO: PASS`

## Qué se hizo, y qué pregunta contesta cada pieza

V2 ya aceptaba foto de categoría y logotipo de marca; lo que no había era una
composición que los aprovechara. Las familias salían siempre como cuatro puertas
del mismo tamaño y las marcas siempre como tarjetas con su cuenta de productos —
dos respuestas correctas, usadas también donde la pregunta era otra.

### El mosaico (`CategoryMosaic`)

Los azulejos reparten la atención a partes iguales: cuatro puertas del mismo
tamaño dicen «estas cuatro cosas valen lo mismo». Es lo correcto cuando ninguna
familia manda, y sigue siendo lo de Universal y Retail.

El mosaico dice **cuál manda**: la primera familia ocupa el doble de área en las
dos direcciones, y eso es lo que convierte una fila de puertas en una portada
editorial.

Tres decisiones que no se ven pero sostienen el resto:

- **No reordena.** La pieza principal es la primera que ordenó el comercio, no
  la que tenga mejor foto. Subir al frente «la que queda bien» sería decidir por
  él cuál es su familia principal.
- **Con una o dos familias no destaca nada.** Una puerta «destacada» sobre nada
  no destaca: queda un hueco. De tres en adelante hay jerarquía que enseñar.
- **Tope de seis.** Un mosaico de diez piezas deja de tener jerarquía y pasa a
  ser una cuadrícula irregular. Lo que pase de seis se queda fuera, y la sección
  sigue teniendo su salida al catálogo.

Y las puertas son **las mismas** de los azulejos (`CategoryDoor`): misma foto,
mismo tinte de reserva, mismo icono, mismo enlace con su filtro. Un mosaico con
otro tipo de puerta serían dos componentes que hay que arreglar dos veces.

**En el teléfono no hay mosaico.** En 390 px, «el doble de área» es una puerta
que ocupa media pantalla y dos que no se leen. El `span` vive dentro del `@media`
de escritorio y la base son dos columnas iguales — que es el error clásico de
los mosaicos, y hay una prueba que se pone roja el día que alguien lo saque del
`md`.

### El muro de logotipos (`BrandLogoWall`)

Las tarjetas dan a cada marca su caja, su nombre y su **cuenta de productos**:
es lo correcto cuando la marca es un FILTRO y quien busca quiere saber cuántas
referencias hay detrás.

Un muro no informa, **reconoce**. Quien duda de una tienda en línea deja de
dudar cuando ve nombres que ya conoce, y para eso el logotipo tiene que estar
limpio: sin caja, sin tinte y sin «12 productos» al lado. Columnas `auto-fit`
con mínimo en `clamp`, así que se lee igual con tres marcas y con treinta.

Lo que **no** se hace con una identidad ajena:

- **No se deforma**: `contain` y hueco de tamaño fijo. Un logotipo apaisado
  recortado a un cuadrado es un trozo de letra.
- **No se pinta en gris.** Pasar todos los logotipos a monocromo queda ordenado
  y cambia la identidad de cada marca, que no es nuestra. Si algún día se ofrece,
  será una opción explícita del comercio, no un defecto.
- **No se inventa.** La marca sin logotipo cae a su monograma, que es lo que ya
  hacía `BrandLogo`.

Para quitar la caja sin perder lo que la hacía segura, `BrandLogo` estrena
`marco: 'tarjeta' | 'limpio'`: `limpio` quita la línea y el fondo y **conserva**
el hueco fijo —que es lo que evita el salto de contenido al cargar— y el
`contain`.

### `brands` y `trust` ya no dicen lo mismo dos veces

Las dos secciones salen de la misma lista de marcas. Con las dos encendidas, la
portada enseñaba dos veces los mismos nombres con dos maquetaciones distintas, y
eso se lee como un fallo de la tienda, no como una decisión.

`trust` **sigue en el contrato** —su trabajo es cerrar la página con nombres
conocidos, no ofrecer un filtro— y sigue siendo la franja compacta de siempre.
Lo que se añade es que **se calla si `brands` ya lo dijo**, con el mismo
mecanismo que ya usaba `destacadosAparte`: un dato resuelto arriba
(`marcasAparte`), no un `if` dentro del componente.

## Diferencias con lo que sugería el prompt

1. **Los azulejos del muro son BOTONES, no enlaces.** El prompt pedía
   «navegación clara». La primera versión hacía cada logotipo un enlace a
   `?marca=…`, y eso era un error doble: el catálogo lee el filtro de marca en
   `?b=`, así que el enlace no filtraba nada, y además rompía la promesa de las
   tarjetas, donde pulsar una marca filtra la vitrina que ya se está mirando y
   volver a pulsarla la suelta. Ahora el muro usa el mismo `onSelect` —que
   escribe `?b=` en la URL, con lo que el filtro se comparte y el botón de atrás
   lo deshace— y la salida al catálogo completo está en la cabecera, donde
   también la tienen las tarjetas.
2. **La cuenta de productos no se «muestra si existe» en el muro.** El prompt la
   admitía en `cards` y el modelo la tiene siempre (sale de las facetas del
   buscador). En el muro se omite igual: en una composición de reconocimiento,
   «12 productos» es ruido. Quien quiera el dato lo tiene en las tarjetas y en el
   catálogo, donde la marca sí es un filtro.
3. **El muro se queda ESTÁTICO en el paquete de la portada.** Sacarlo a su propio
   trozo parecía gratis —lo ve una minoría de las tiendas— y sale al revés:
   comparte `BrandRow`, `BrandLogo` y `SectionHeading` con la fila de marcas, que
   ya viaja en la portada. El empaquetador acaba con un trozo aparte que depende
   **estáticamente** del de la portada: los mismos bytes en el primer pintado,
   una petición más, y la portada deja de ser un punto de entrada con nombre
   propio, con lo que el informe de bundle ya no la encuentra. Medido: 403,0 kB
   en los dos casos. El mosaico sí va por `lazy`, porque solo arrastra
   `CategoryDoors`, que también es perezoso.

## Archivos principales

| Archivo | Qué cambia |
|---|---|
| `components/CategoryMosaic.tsx` | **Nuevo.** Reparto por cantidad, tope de seis, pieza principal solo en escritorio, `data-category-mosaic` / `data-mosaic-cell`. |
| `components/BrandLogoWall.tsx` | **Nuevo.** Muro `auto-fit`, azulejos que filtran, nombre debajo, sin cuenta, `data-brand-wall` / `data-brand-tile`. |
| `components/BrandLogo.tsx` | `marco: 'tarjeta' \| 'limpio'`; sin caja no se pierde el hueco fijo ni el `contain`. |
| `components/BrandTrustStrip.tsx` | `data-brand-trust`: marca estructural para poder comprobar que se calla sin depender de cómo esté redactado su título. |
| `home/SectionRegistry.tsx` | Rama de mosaico en `categories`, rama de muro en `brands`, `trust` mudo cuando `brands` está encendida. |
| `home/types.ts` · `StoreHomePage.tsx` | `marcasAparte`, resuelto donde ya se resuelve `destacadosAparte`. |
| `theme/presentation.ts` | Premium y Catalog resuelven `logos`; Premium ya resolvía `mosaic`. |

**Migraciones: ninguna.** El contrato de presentación de P06 ya aceptaba
`mosaic` y `logos` en base; esta fase solo los pinta.

## Ciclos correctivos

1. La prueba de P06 «ningún tema resuelve una variante que nadie pinta todavía»
   se puso roja a propósito: era la guardia que impedía declarar `logos` antes de
   tener el componente. Al existir el muro, `logos` entra en la lista de
   pintadas; `split` sigue fuera, que es de P08.
2. `getComputedStyle` no sirve para lo que este mosaico tiene que defender: jsdom
   no evalúa media queries y de un valor por punto de ruptura devuelve la cadena
   vacía. Se leen las reglas que el sistema de estilos inyecta, con sus `@media`
   intactos, y así la prueba dice literalmente «dos columnas en el teléfono,
   `span 2` solo a partir de 900 px».
3. Dos locators míos estaban mal: el `aria-label` de la sección de familias y el
   del propio mosaico son el mismo texto —había que señalar el mosaico por su
   atributo—, y `BrandRow` traduce con su propio `useI18n`, no con la `t` de
   identidad del compositor, así que la de-duplicación se comprueba por
   estructura (`#marcas` / `[data-brand-trust]`) y no por una cadena.
4. El intento de sacar el muro a su propio trozo (ver diferencia 3) rompió la
   atribución del informe de bundle. Revertido, con el porqué escrito donde está
   el import.

## Tests

| Archivo | Casos |
|---|---|
| `components/category-brand-v3.test.tsx` | **Nuevo**, 21. Mosaico con 1, 2, 3, 6 y 10 familias; no reordena; familia con foto y sin foto; el enlace conserva ruta y filtro; en el teléfono dos columnas y el doble de área **solo** en escritorio. Muro: logotipo entero sin estirar con su hueco reservado, marca sin logotipo al monograma, sin caja —y la misma marca **sí** con línea dentro de una tarjeta—, sin cuenta de productos, sin marcas no pinta sección, azulejo que filtra y se suelta, salida al catálogo intacta. Y ninguna de las dos composiciones nombra un rubro. |
| `home/HomeComposer.test.tsx` | +7. La sección pedida en mosaico se pinta en mosaico y sin pedir nada siguen los azulejos; las marcas pedidas como logotipos se pintan como muro y sin pedir nada siguen las tarjetas con su cuenta; la franja de cierre sola se pinta, se calla con `brands` encendida y vuelve al apagarla. |
| `theme/presentation.test.ts` | Lista de variantes pintadas al día: entra `logos`, `split` sigue fuera. |

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 309 ficheros, 6150 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — portada 403,0 kB (techo 405) |

`npm run test:db` no se repite: esta fase no toca base ni migraciones.

## Pendiente real

El techo de la portada queda a **2 kB**. P08 trae bloques editoriales del CMS y
la banda partida; si no caben, lo que hay que mover a `lazy` es algo que **no**
comparta módulos con la portada eager — el muro de logotipos ya demostró que
partir por ahí no ahorra nada.

`PHASE_RESULT: PASS`

---

# P08 · CMS editorial: composiciones cerradas por bloque

`ESTADO: PASS`

## El problema, dicho con precisión

El CMS tenía ocho tipos de bloque y **una** forma de enseñar cada uno. Una
colección de productos era siempre una rejilla; el tipo `carousel` era la misma
lista en una franja —y para cambiar de una a otra había que **cambiar el tipo de
bloque**, que es cambiar el contenido para conseguir otra maquetación—. Una
colección de familias eran siempre puertas, aunque el comercio hubiera subido
foto a las ocho. Y un banner era siempre una franja dentro del ancho de la
página.

Con cuatro bloques seguidos, una portada del CMS se lee como una lista de filas.

## Lo que se añade, y dónde vive

Tres vocabularios **cerrados**, todos en `settings.layout`:

| Familia | Valores | Defecto |
|---|---|---|
| Colección de productos (`product_collection`, `carousel`) | `grid` · `rail` · `editorial` · `spotlight` · `split` | `grid` / `rail` |
| Colección de familias (`category_collection`) | `tiles` · `pills` · `photo-grid` · `mosaic` | `tiles` |
| Banner (`banner`) | `contained` · `bleed` · `split` | `contained` |
| Imágenes (`slider`) | `carousel` · `grid` (las de P18) | `carousel` |

**Sin migración, y no por atajo:** `layout` ya estaba en la lista blanca de
`settings` desde el CMS original (`ebim.content_settings_are_safe`), que admite
claves de un vocabulario cerrado con valores escalares. Lo que esta fase añade
son **valores** de una clave que ya existía y ya estaba validada. Hay un test
que lo dice explícitamente, para que no parezca un descuido.

**El defecto de cada tipo es su composición de hoy.** Una página publicada antes
de esta fase se ve exactamente igual después: un bloque sin `layout` no es un
bloque a medio configurar, es la mayoría.

**Una sola tabla, tres lectores.** `BLOCK_LAYOUTS` en `src/domain/content.ts` la
leen la vitrina (qué pinta), el editor (qué ofrece) y la validación (qué se
puede guardar). Con tres `switch` separados es cuestión de tiempo que el editor
ofrezca algo que nadie pinta — que es exactamente lo que pasó en V2 con
`heroVariant`, declarado tres fases sin consumidor.

## Las composiciones, una por una

**`editorial`** quita la caja, la sombra y el relleno de la tarjeta y deja la
foto sola, a dos o tres columnas como mucho: seis columnas de «foto grande» son
seis fotos pequeñas. La línea no se borra, se vuelve **transparente**, porque
quitarla movería la rejilla un píxel al pasar el ratón.

**`spotlight`** da a la primera pieza el doble de área en las dos direcciones, y
solo en escritorio. Con menos de tres piezas no destaca nada: una pieza doble y
una sencilla no es una jerarquía, es un hueco. Es la misma cifra y el mismo
motivo que el mosaico de familias de P07.

**`split`** es un primitivo nuevo, `StoreSplitBand`, y lo usan **tres** sitios:
la colección de productos con copy, el banner y la banda de rebajados de la
portada. Reparto `5fr / 7fr` —el mensaje pide menos sitio que una rejilla—, y en
el teléfono se apila con el **mensaje primero**, porque el mensaje explica lo que
viene después. Tres versiones de «dos columnas» es cómo se acaba con tres
proporciones distintas y una que no se apila bien.

**`photo-grid`** existe porque `tiles` se rinde: pasa a fila desplazable a partir
de cuatro familias, y eso deja media colección detrás de una flecha. La rejilla
de fotos crece hacia abajo, que es la dirección en la que una página tiene sitio.
Tres o cuatro columnas según cuántas haya: con cinco a cuatro columnas queda una
sola en la segunda fila, y eso se lee como un hueco.

**`bleed`** no trae cálculo propio: usa `StoreSectionFrame` de P06, donde vive el
único `50vw` de la vitrina. Repetir ese truco por bloque es cómo aparece una
barra de desplazamiento horizontal en toda la tienda.

**La banda partida de la portada (`offers` · `split`)** cierra una deuda de P06:
estaba en el contrato, la base la aceptaba y no la pintaba nadie. En `band`, lo
rebajado son tres tarjetas en dos quintos de pantalla; en `split`, el descuento
se lee desde la misma distancia que el titular. Cuesta alto de página, así que
**ningún tema la resuelve**: es una elección del comercio.

## Diferencias con lo que sugería el prompt

1. **`campaign` no recibe las tres disposiciones del banner.** El prompt las
   pedía para «banner/campaign». Las campañas consecutivas se **agrupan** en un
   muro (`groupCampaigns`), y un ancho o un reparto por bloque dentro de un grupo
   pelea con el grupo: la composición de una campaña la decide el muro, que es
   quien sabe cuántas hay. Está escrito en el propio contrato, junto a la tabla.
2. **El banner ya era un «split» a medias.** Su composición de siempre pone la
   imagen al 40 % **al lado** del texto, no detrás. Así que `split` no podía ser
   «texto al lado de la imagen» —eso ya existía— y es lo que de verdad faltaba:
   mitad y mitad, con la imagen **sin tope de alto** (hoy 260 px) y más aire en
   el texto. De franja informativa a pieza de campaña.
3. **El enum de Zod es la lista ENTERA, no la del tipo.** Un esquema valida un
   campo mirando ese campo, y «vale para este tipo de bloque» es una relación
   entre dos campos. El vocabulario se cierra en el esquema y el encaje con el
   tipo lo comprueba `validateBlockForm`, donde ya viven las demás reglas entre
   campos. Y cambiar de tipo devuelve la composición a la del tipo nuevo — el
   mismo problema que el cuerpo escondido de un hero que pasa a carrusel,
   resuelto en el mismo sitio (`clearUnusedBlockFields`).
4. **Las etiquetas del editor se buscan por FAMILIA.** «Mosaico» no quiere decir
   lo mismo en un carrusel de imágenes que en una lista de familias, y el
   comercio no tiene por qué leer `photo-grid`. Hay un test que comprueba que
   los doce valores tienen etiqueta en los dos idiomas y que el desplegable no
   enseña ningún valor técnico.

## La vista previa sale gratis, y es a propósito

`src/features/content/PreviewSection.tsx` importa el **mismo** `ContentBlocks`
de la vitrina y le pasa los bloques por el mismo parseo (`settings` saneado con
`contentSettingsSchema`). Así que la previa representa cada composición sin una
línea nueva. Las pruebas de render de esta fase montan el árbol exactamente como
lo monta la previa —`assets={{}}`, `images={{}}`— para que eso siga siendo
cierto.

## Archivos principales

| Archivo | Qué cambia |
|---|---|
| `src/domain/content.ts` | Los tres vocabularios, la tabla `BLOCK_LAYOUTS`, `blockLayoutOf/Options/Default/Family`, `blockChoosesLayout`, `blockLayoutIsValid`. `mediaLayoutOf` delega, para no tener dos verdades. |
| `components/StoreSplitBand.tsx` | **Nuevo.** El primitivo de dos columnas, con el apilado y el reparto decididos una vez. |
| `components/ContentBlocks.tsx` | Las cinco de producto, las cuatro de familias (con `CategoryPhotoGrid` nuevo), las tres de banner y la variante `editorial` de `CollectionCard`. |
| `components/OffersFeaturedBand.tsx` | `presentacion: 'band' \| 'split'`, con lo rebajado en su banda partida. |
| `home/SectionRegistry.tsx` | La sección `offers` ya lee su presentación. |
| `features/content/types.ts` · `api.ts` · `BlocksSection.tsx` | Esquema del editor, guardado de `layout` en los cinco tipos y un solo desplegable que sale de la tabla. |
| `shared/i18n/messages.{es,en}.ts` | Doce etiquetas nuevas, por familia. |

**Migraciones: ninguna.** Ver arriba.

## Ciclos correctivos

1. El `blockLayoutOf` genérico y la tabla tipada contra la lista completa no
   compilaban a la primera: la tabla usaba `readonly string[]` y el esquema
   necesitaba una tupla de literales. La lista completa pasó a ser una tupla
   explícita, con un test que la compara con la unión de las cuatro familias —
   que es lo que impide que se separen.
2. Mi campo de columnas nuevo duplicaba el que ya existía para las colecciones.
   Corregido: el del mosaico de imágenes se queda con su condición y las
   colecciones siguen con el de la regla de su tipo.
3. Dos aserciones mías apuntaban al texto en vez de a la estructura:
   `OffersFeaturedBand` traduce con su propio `useI18n`, no con la `t` de
   identidad del compositor, así que el enlace se comprueba por su **destino**.
   Y el documento de texto enriquecido es un **array plano** de nodos, no un
   árbol tipo Tiptap.

## Tests

| Archivo | Casos |
|---|---|
| `components/cms-editorial-v3.test.tsx` | **Nuevo**, 33. Las cinco de producto pintan la misma lista en el mismo orden y sin pedir nada por item; `editorial` sin caja; `spotlight` con su pieza doble solo en escritorio y sin destacar con menos de tres; `split` con el mensaje en su columna, sin duplicarlo, apilado en el teléfono. Las cuatro de familias enseñan las tres familias y conservan ruta y filtro; `photo-grid` no se convierte en carrusel; `pills` no son puertas; una familia sin foto no se rellena. Las tres de banner conservan mensaje e imagen; `bleed` usa el marco con su `50vw`; `contained` no envuelve nada; `split` da la mitad y quita el tope. Y lo que no cambia: sin `layout` se ve como antes, un valor inventado cae al defecto y el texto enriquecido sale como texto. |
| `features/content/content.test.ts` | 60 → **71**. La lista completa es la unión de las familias; `layout` ya estaba en el vocabulario de `settings`; el defecto de los cinco tipos; lo guardado manda si es de su familia y cae si no; los tipos que no eligen no ofrecen nada; el editor rechaza una composición ajena al tipo; cambiar de tipo la devuelve al defecto y conserva la que sí vale; los doce valores tienen etiqueta ES/EN; y la familia de cada tipo. |
| `features/content/content-ui.test.tsx` | 21 → **24**. Un hero no pregunta disposición; una colección de productos ofrece las cinco con nombres —no con valores—; una de familias ofrece las suyas y **no** enseña `photo-grid`. |
| `home/HomeComposer.test.tsx` | +3. Sin pedir nada, la banda de siempre; pedida partida, el titular y su enlace en su columna con las mismas ofertas; y el enlace lleva al catálogo filtrado por lo rebajado en las dos. |
| `theme/presentation.test.ts` | `split` entra en la lista de variantes pintadas; ningún tema la resuelve. |

`architecture.test.ts` ya vigila `dangerouslySetInnerHTML` en todo `src/`: esta
fase no añade ninguna ruta que interprete HTML y no hacía falta repetir el test.

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 310 ficheros, 6206 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — portada 403,7 kB (techo 405) |
| `npm run scan:secrets` | **PASS** — sin hallazgos |

`npm run test:db` no se repite: no hay migración ni cambio de validador de base.

## Pendiente real

El techo de la portada queda a **1,3 kB**. Es el aviso serio para P09: los
filtros en cajón y la ficha comercial tienen que entrar **por `lazy`**, que es
además lo que pide la regla 19. Y lo que se mueva a un trozo aparte no puede
compartir módulos con lo que ya viaja en la portada — el muro de logotipos de
P07 ya demostró que partir por ahí no ahorra nada.

`PHASE_RESULT: PASS`

---

# P09 · Catálogo: barra, cajón de filtros y lectura mobile-first

`ESTADO: PASS`

## El fallo, dicho con precisión

El catálogo repartía filtros y resultados en dos columnas con
`direction={{ xs: 'column', md: 'row' }}`. En escritorio está bien. En el
teléfono, «columna» significa **el panel entero encima de los productos**: quien
buscaba «jarabe» recibía primero dos interruptores, una lista de familias y otra
de marcas con sus contadores, y los jarabes empezaban pasada la primera
pantalla.

Y no era solo lo que se veía: con los filtros primero **en el DOM**, llegar al
primer producto con el tabulador o con un lector de pantalla costaba treinta
paradas.

## Lo que se hizo

### La barra (`StoreCatalogToolbar`)

Reemplaza la línea de «N resultados + Ordenar» y añade lo que faltaba:

- **«Filtros» con el número de los puestos**, solo hasta escritorio. Un botón
  que dice «Filtros» no distingue un catálogo entero de uno con tres filtros
  encima, y esa es justo la duda de quien vuelve atrás y no reconoce la lista.
  El número va también en el **nombre accesible** («Filtros (3 activos)»),
  porque un globo con una cifra no lo lee nadie.
- **Las píldoras de lo puesto, debajo y quitables de una.** Abrir un cajón para
  desmarcar una casilla son tres gestos para deshacer uno.
- **Pegada arriba en el teléfono**, bajo la cabecera: en una lista de 568
  productos, el momento de querer ordenar llega cuando ya se ha bajado.

### El cajón (`StoreFilterDrawer`)

`Drawer` de MUI anclado abajo, con **el mismo `StoreFilterPanel`** dentro: no se
recorta ni una opción por caber. Lo que aporta MUI y no se escribe a mano es el
foco —atraparlo mientras está abierto, devolverlo al botón al cerrar, `Escape`,
y marcar el resto de la página como `aria-hidden`—; escribir eso a mano es cómo
se acaba con un panel del que no se sale con el teclado.

Los filtros **se aplican al tocarlos**, porque el estado vive en la URL y ya
funcionaba así: los resultados de detrás cambian mientras se elige. Por eso el
botón dice **«Ver resultados (N)»** y cierra, que es lo que de verdad hace;
llamarlo «Aplicar» prometería que sin pulsarlo no pasa nada, y sería mentira.

### La columna de escritorio

Dos cambios, el mismo fallo:

1. `display: none` hasta `md`, con el panel en el cajón por debajo.
2. **Después de los resultados en el DOM**, con `order: -1` en escritorio para
   que siga saliendo a la izquierda. La vista no cambia; la lectura sí.

Y deja de parecer un panel de backoffice: `StoreFilterPanel` estrena
`marco: 'tarjeta' | 'columna' | 'hoja'`. `columna` quita la caja, la sombra y el
fondo y deja una línea vertical y aire —lo que de verdad separa unos filtros de
unos resultados—; `hoja` quita también el título y su botón de limpiar, porque
el cajón ya los lleva y dos botones con el mismo nombre en la misma pantalla no
se distinguen.

## Lo que YA estaba bien y se conserva (implementación superior al prompt)

1. **La densidad por tema ya venía del contrato.** `ProductGrid` toma columnas y
   aire de `--sf-grid-*`, que pone el tema: Universal 2/3/4, Retail 2/4/5,
   Premium 2/2/3 y Catalog 2/4/6. Es exactamente lo que pedía la sección
   «Theme» de la fase —Premium más visual, Catalog más denso— y ya estaba desde
   P02, sin una sola rama por tema dentro de la tarjeta. Cubierto por
   `storefront-design.test.tsx` y `preview-responsive.test.tsx`; no se duplica.
2. **`ExploreMore` ya estaba separado del conteo.** Sección propia, título
   propio, línea arriba, debajo de la rejilla y **sin un solo producto**: solo
   familias y marcas, que son navegación. El prompt pedía mejorarlo; lo que
   pedía ya lo hacía, así que lo único que se añade es la prueba de que sigue
   siendo cierto.
3. **Las facetas ya salían de la búsqueda**, no de una lista fija, con su
   contador y sin ofrecer lo que da cero. No se tocó.

## El presupuesto, que era el riesgo real de la fase

Al terminar la funcionalidad, la portada quedó en **404,9 kB de 405**: 0,1 kB de
margen. Lo que lo devuelve a un sitio razonable es una observación simple: la
barra, el panel de filtros y el menú de orden **no existen en la portada**. Solo
se pintan con `?ver=todo` o con un filtro, y viajaban en la primera descarga de
todas las visitas.

Por `lazy`, los tres: **396,0 kB**, nueve kilobytes recuperados. Es la misma
regla que ya seguían la vista rápida, el cajón y la salida del catálogo: lo que
aparece por una acción se descarga con la acción.

Efecto medido y aceptado: el recuento llega un instante después de la rejilla
—los productos no esperan a nada— y una prueba que lo leía en el primer pintado
ahora lo espera. Está escrito en el propio test.

## Archivos principales

| Archivo | Qué cambia |
|---|---|
| `components/StoreCatalogToolbar.tsx` | **Nuevo.** Recuento, aviso de erratas, botón de filtros con contador, menú de orden y píldoras de lo puesto. |
| `components/StoreFilterDrawer.tsx` | **Nuevo.** El cajón de abajo con su cabecera, su pie y el panel entero dentro. |
| `components/StoreFilterPanel.tsx` | `marco` con tres valores; dentro del cajón calla su título y su «quitar filtros». |
| `StoreHomePage.tsx` | La barra y el cajón; los filtros puestos derivados de la URL; `update` estable con `useCallback`; la columna escondida hasta `md` y movida tras los resultados; los tres módulos del catálogo por `lazy`. |
| `shared/i18n/messages.{es,en}.ts` | `filters`, `filtersActive`, `removeFilter`, `showResults`. |

**Migraciones: ninguna.** Esta fase no toca base.

## Ciclos correctivos

1. Mi primera píldora era un `Chip` con aspa, y su nombre accesible quedaba en
   «Mesas» — el mismo que la píldora de la barra de familias, que hace lo
   contrario: una pone el filtro y la otra lo quita. Dos controles con el mismo
   nombre y efectos opuestos rompieron dos pruebas existentes, y con razón.
   Ahora es un `<button>` con nombre propio: «Quitar Mesas».
2. Tres aserciones mías miraban `window.location`: estas pruebas montan un
   `MemoryRouter`, donde la barra del navegador no se mueve por diseño. Se
   comprueban por lo que la vitrina enseña, que es lo que de verdad importa.
3. Y una miraba `getComputedStyle` de un valor por punto de ruptura, que jsdom
   no resuelve. Se cambió por algo mejor: el **orden del documento**, que es lo
   que de verdad defiende la fase.
4. La aserción del cajón abierto no encontraba la píldora porque MUI marca el
   resto de la página como `aria-hidden` mientras el diálogo está abierto. No
   era un fallo: era la prueba de que el cajón es un diálogo de verdad. Se
   comprueba con el cajón cerrado, que además es el flujo real.
5. Un `npx prettier --write` de emergencia reformateó el archivo entero con
   comillas dobles y punto y coma —que no es el estilo de este repo— y dejó un
   diff de 960 líneas. Los cambios se **reaplicaron sobre la versión de HEAD**
   con parches dirigidos: 218 líneas añadidas, 53 tocadas. La versión
   reformateada se guardó aparte antes de rehacerlo.

## Tests

| Archivo | Casos |
|---|---|
| `storefront-ui.test.tsx` | 52 → **62**. Teléfono: la barra trae Filtros y Ordenar y la columna va después de la barra en el documento; el cajón se abre con el panel entero —los dos interruptores y las facetas— y su salida; se cierra con `Escape`; filtrar desde el cajón llega a la vitrina; «Quitar filtros» limpia y deja el catálogo; las píldoras se quitan de una y se llaman «Quitar X»; el botón dice cuántos hay; sin filtros no hay píldoras. Escritorio: la columna ya no tiene sombra ni caja; el recuento coincide con las tarjetas pintadas y la salida de abajo no lleva ni un producto. |

Las pruebas de densidad por tema y de paridad de la vista previa ya existían
(`storefront-design.test.tsx`, `preview-responsive.test.tsx`) y siguen verdes.

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test` | **PASS** — 310 ficheros, 6216 tests |
| `npm run build` | **PASS** |
| `npm run bundle:report` | **PASS** — portada **396,0 kB** (techo 405) |
| `npm run scan:secrets` | **PASS** |

`npm run test:db` no se repite: esta fase no toca base.

## Pendiente real

La matriz visual a 390/768/1280 es de P13: aquí las diferencias entre teléfono y
escritorio se comprueban por estructura —orden del documento, presencia del
cajón, marco del panel— porque jsdom no tiene ancho de ventana. Lo que falta es
la captura real, y es exactamente el trabajo de esa fase.

`PHASE_RESULT: PASS`
