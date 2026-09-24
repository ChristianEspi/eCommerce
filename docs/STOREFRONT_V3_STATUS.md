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

---

# P01 · Identidad de la tienda con roles semánticos

**Commit:** `<pendiente>` · **Ciclos correctivos:** 1 de 3

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
