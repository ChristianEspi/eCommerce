import { z } from 'zod'
import { isSafeHref as isSafeHrefValue } from './href'

/**
 * Contenido administrable: el vocabulario y, sobre todo, QUÉ ES CONTENIDO
 * SEGURO (P11-SaaS).
 *
 * ## La decisión que gobierna este archivo: el contenido enriquecido no es HTML
 *
 * El encargo pide «rich content sanitizado» y «no permitas JavaScript arbitrario
 * del tenant». Hay dos formas de cumplirlo y solo una envejece bien:
 *
 *  - **Guardar HTML y sanearlo.** La seguridad pasa a ser una lista de etiquetas
 *    y atributos que hay que mantener al día contra cada mXSS nuevo, y basta una
 *    ruta de renderizado que se salte el saneador —un correo, un export, un
 *    `dangerouslySetInnerHTML` puesto con prisa— para que el agujero vuelva.
 *  - **No guardar HTML.** El documento es un array plano de cuatro tipos de nodo
 *    y el renderizador mapea nodo → componente de React. No hay cadena que
 *    escapar mal porque no hay cadena que interpretar.
 *
 * Este proyecto elige la segunda. La consecuencia es que un editor de texto rico
 * completo (tablas, imágenes en línea, colores) no cabe; la contrapartida es que
 * «¿puede el tenant ejecutar código?» tiene una respuesta demostrable en vez de
 * una lista de mitigaciones. Un test de arquitectura comprueba que
 * `dangerouslySetInnerHTML` no aparece en ningún archivo de `src/`.
 *
 * ## Esto es la MITAD de cliente de una regla que manda en Postgres
 *
 * Las mismas reglas están escritas como CHECK en `20260828140000_cms_core.sql`
 * (`ebim.rich_text_is_safe`, `ebim.is_safe_href`). Lo de aquí existe para que el
 * editor diga «este enlace no vale» antes de pulsar Guardar, no para decidir: si
 * las dos discrepan, la que manda es la base. Un test compara las dos mitades
 * contra Postgres real.
 */

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

/**
 * Esquemas admitidos: lista BLANCA, no lista negra.
 *
 * `javascript:` es el que todo el mundo recuerda, pero `data:text/html`,
 * `vbscript:` y el protocolo-relativo `//otro-dominio` hacen daño igual. Con
 * lista blanca, el esquema que nadie ha pensado todavía cae en el lado de «no».
 *
 * **P16-SaaS: la regla vive en un solo sitio.** Hasta esta fase había tres
 * copias de la misma condición —esta, la del borde del storefront y el CHECK de
 * Postgres— y las tres compartían el mismo fallo: aceptaban `/\evil.com` como
 * ruta interna cuando el navegador la resuelve a OTRO DOMINIO. Se corrigió en
 * las tres, y las tres de cliente pasan ahora por `@/domain/href` para
 * que no vuelvan a separarse. La semántica de `null` se conserva aquí: un
 * enlace ausente es válido, igual que en el CHECK.
 */
export function isSafeHref(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true
  return isSafeHrefValue(value)
}

/**
 * Nada que se parezca a una etiqueta, ni siquiera como texto plano.
 *
 * El renderizador no interpreta HTML, así que un `<script>` guardado como texto
 * no ejecuta nada aquí. Se rechaza igual porque ese texto acaba en sitios que sí
 * interpretan: un correo, un CSV exportado, el `<title>` de una página.
 */
export function looksLikeMarkup(value: string): boolean {
  return /<[a-zA-Z/!]/.test(value)
}

// ---------------------------------------------------------------------------
// El documento
// ---------------------------------------------------------------------------

const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !looksLikeMarkup(value), { message: 'content.error.markup' })

const hrefSchema = z
  .string()
  .refine((value) => isSafeHref(value), { message: 'content.error.href' })

/**
 * El `href` de un TRAMO no admite la cadena vacía.
 *
 * En un nodo, `href` ausente y `href` vacío son lo mismo —no hay enlace— y
 * `isSafeHref` los deja pasar a los dos. En un tramo no: el tramo existe para
 * ser un enlace, y uno con destino vacío es texto subrayado que no lleva a
 * ninguna parte.
 */
const spanHrefSchema = z
  .string()
  .min(1)
  .refine((value) => isSafeHref(value), { message: 'content.error.href' })

/**
 * Un TRAMO de texto: lo que permite negrita, cursiva y enlaces en línea sin
 * guardar una sola etiqueta.
 *
 * Las marcas son BOOLEANOS de un vocabulario cerrado, no marcado: `bold: true`
 * no se puede convertir en `<b onclick=…>` porque nunca es una cadena que
 * alguien interprete — el renderizador elige un componente de React y ya. Es la
 * misma decisión que gobierna el archivo entero, aplicada un nivel más abajo.
 *
 * El `href` de un tramo pasa por el mismo guard que el del nodo (`isSafeHref`),
 * porque el sumidero es idéntico: un `<a>` en el DOM del comprador.
 */
export const richTextSpanSchema = z
  .object({
    text: safeText(2000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    href: spanHrefSchema.optional(),
  })
  .strict()

export type RichTextSpan = z.infer<typeof richTextSpanSchema>

/**
 * El texto de un nodo: una CADENA o una lista de tramos.
 *
 * La cadena no es un atajo, es el formato que ya está guardado: los documentos
 * escritos antes de que existieran las marcas siguen siendo válidos y siguen
 * pintándose igual. Migrar filas para ganar una forma nueva habría sido cambiar
 * datos publicados por comodidad del código.
 */
export const richTextValueSchema = z.union([
  safeText(2000),
  z.array(richTextSpanSchema).min(1).max(50),
])
export type RichTextValue = z.infer<typeof richTextValueSchema>

/** Alineación del bloque. Tres valores: lo que se puede leer, no lo que se puede pedir. */
export const RICH_TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const
export type RichTextAlign = (typeof RICH_TEXT_ALIGNMENTS)[number]
const alignSchema = z.enum(RICH_TEXT_ALIGNMENTS)

/** El texto plano de un valor: lo que se cuenta, se busca o se resume. */
export function richTextPlainText(value: RichTextValue): string {
  return typeof value === 'string' ? value : value.map((span) => span.text).join('')
}

/**
 * Los cinco nodos, y por qué son cinco.
 *
 * Los cinco son `.strict()`: una clave que el vocabulario no declara —un
 * `onclick`, un `style`— NO se ignora al leer, invalida el nodo entero. Zod
 * descarta las claves de más por defecto, y ese defecto convertiría «esto no
 * está permitido» en «esto se pierde en silencio», que es justo la diferencia
 * entre rechazar y aceptar a medias. Es la misma regla que el CHECK de la base.
 *
 * `paragraph`, `heading`, `list`, `quote` y `divider` cubren lo que una página
 * de comercio necesita escribir. **No hay anidamiento**: un árbol admite
 * profundidad arbitraria y la profundidad arbitraria es, en la práctica, un
 * lenguaje — con su coste de validación, de renderizado y de auditoría. Por eso
 * tampoco hay tablas: una tabla es un árbol de filas y celdas, y en un móvil se
 * sale del ancho de la vitrina.
 *
 * El titular solo tiene dos niveles (`2` y `3`): el `h1` es el título de la
 * página, y dejar que un bloque escriba otro rompe el árbol de encabezados, que
 * es lo que un lector de pantalla usa para navegar (WCAG AA).
 */
export const richTextNodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('paragraph'),
      text: richTextValueSchema,
      align: alignSchema.optional(),
      // Enlace de PÁRRAFO: es anterior a los tramos y sigue vivo porque hay
      // contenido publicado que lo usa. Para un enlace dentro de la frase, lo
      // que corresponde hoy es un tramo con `href`.
      href: hrefSchema.optional(),
      linkLabel: safeText(120).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('heading'),
      level: z.union([z.literal(2), z.literal(3)]),
      text: richTextValueSchema,
      align: alignSchema.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('quote'), text: richTextValueSchema, align: alignSchema.optional() })
    .strict(),
  z
    .object({
      type: z.literal('list'),
      items: z.array(richTextValueSchema).min(1).max(20),
      /** Numerada. Ausente es la de viñetas, que es la de siempre. */
      ordered: z.boolean().optional(),
    })
    .strict(),
  // Separador: no lleva texto ni ninguna otra clave. Es el único nodo que no
  // dice nada, y por eso el único que no puede llevar nada dentro.
  z.object({ type: z.literal('divider') }).strict(),
])

export type RichTextNode = z.infer<typeof richTextNodeSchema>

/** Un documento: array plano, con los mismos topes que el CHECK de la base. */
export const richTextSchema = z
  .array(richTextNodeSchema)
  .min(1)
  .max(60)
  .refine((doc) => JSON.stringify(doc).length <= 24000, { message: 'content.error.tooLong' })

export type RichTextDocument = z.infer<typeof richTextSchema>

/** ¿Este documento lo aceptaría la base? Misma respuesta, antes de guardar. */
export function isSafeRichText(value: unknown): value is RichTextDocument {
  return richTextSchema.safeParse(value).success
}

/**
 * Lee un documento que viene de la base. Devuelve `null` si no valida.
 *
 * `null` y no «lo que se pueda salvar»: un documento que no cumple el contrato
 * no se pinta a medias. Si la base lo guardó, es que pasó el CHECK, así que
 * llegar aquí con algo inválido significa que las dos mitades se han separado —
 * y pintar la mitad buena escondería justo eso.
 */
export function parseRichText(value: unknown): RichTextDocument | null {
  if (value === null || value === undefined) return null
  const parsed = richTextSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

/** Los siete tipos de bloque. Réplica del enum `public.content_block_type`. */
export const CONTENT_BLOCK_TYPES = [
  'hero',
  'banner',
  'carousel',
  'product_collection',
  'category_collection',
  'rich_text',
  'campaign',
  /**
   * P18 · Carrusel de IMAGENES. Distinto de `carousel`, que desde P11 es un
   * carrusel de productos: un tipo que significa dos cosas segun lo que le
   * falte acaba enseñando lo que no es.
   */
  'slider',
] as const
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number]

/** Réplica del enum `public.content_page_kind`. */
export const CONTENT_PAGE_KINDS = ['home', 'landing', 'legal'] as const
export type ContentPageKind = (typeof CONTENT_PAGE_KINDS)[number]

/** Réplica del enum `public.content_status`. */
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/** Réplica del enum `public.content_item_kind`. */
export const CONTENT_ITEM_KINDS = ['product', 'variant', 'category', 'media'] as const
export type ContentItemKind = (typeof CONTENT_ITEM_KINDS)[number]

/**
 * Mandos de presentación admitidos, con vocabulario CERRADO.
 *
 * Réplica de `ebim.content_settings_are_safe`. Existe para que «dos columnas o
 * tres» no sea un tipo de bloque nuevo. En el momento en que admitiera objetos
 * anidados o claves libres, sería el sitio donde alguien mete una URL de script
 * «porque es solo configuración».
 */
export const CONTENT_SETTING_KEYS = [
  'layout',
  'columns',
  'autoplay',
  'interval_ms',
  'align',
  'tone',
  'show_price',
  'show_cta',
  'aspect',
  'background',
  'compact',
  'reverse',
  /**
   * P18 · Una colección por categoría incluye las subcategorías.
   *
   * Apagada por defecto, igual que en las campañas: un bloque publicado no
   * puede cambiar de contenido porque alguien añada una subcategoría mañana.
   */
  'descendants',
] as const
export type ContentSettingKey = (typeof CONTENT_SETTING_KEYS)[number]

export const contentSettingsSchema = z
  .record(z.union([z.string().max(60), z.number(), z.boolean()]))
  .refine(
    (value) =>
      Object.keys(value).length <= 12 &&
      Object.keys(value).every((key) =>
        (CONTENT_SETTING_KEYS as readonly string[]).includes(key),
      ),
    { message: 'content.error.settings' },
  )

export type ContentSettings = z.infer<typeof contentSettingsSchema>

/**
 * ¿Qué tiene que traer cada tipo de bloque para valer algo?
 *
 * Réplica del CHECK `content_blocks_shape`. Sin esto, la vitrina tendría que
 * decidir en tiempo de pintado si un bloque se enseña o no — y esa es la clase
 * de decisión que acaba dando dos respuestas distintas en dos sitios.
 */
export function blockShapeIsComplete(input: {
  type: ContentBlockType
  title: string | null
  mediaUrl: string | null
  body: unknown
}): boolean {
  switch (input.type) {
    case 'hero':
    case 'banner':
      return Boolean(input.title) || Boolean(input.mediaUrl)
    case 'rich_text':
      return isSafeRichText(input.body)
    case 'campaign':
      return Boolean(input.title)
    default:
      return true
  }
}

/**
 * Qué campos usa cada tipo de bloque, y cuáles exige.
 *
 * ## Por qué existe
 *
 * El formulario enseñaba los DIECISÉIS campos para los ocho tipos, y la base
 * rechazaba después las combinaciones imposibles: `content_blocks_body_only_text`
 * solo admite contenido en texto, hero y banner, `content_blocks_promotion_only_campaign`
 * solo deja la campaña en el bloque de campaña, `content_blocks_category_only_collection`
 * solo la categoría en las colecciones. Escribir en un campo que el tipo elegido
 * no admite terminaba en un error de CHECK traducido a «faltan datos
 * obligatorios» — que además dice lo contrario de lo que pasaba: sobraban.
 *
 * Esta tabla es la ÚNICA fuente: de ella salen los campos que se pintan, el
 * asterisco de los obligatorios y las reglas que se comprueban antes de guardar.
 * Que el formulario y la base discrepen deja de ser posible por construcción, y
 * hay un test que la contrasta contra los CHECK de Postgres.
 *
 * `unused` no es «opcional pero raro»: es «la base lo rechaza o la vitrina no lo
 * pinta». Un campo así no se enseña, y al cambiar de tipo se vacía — si no,
 * pasar un hero con contenido a carrusel guardaría un cuerpo que nadie ve y que
 * el CHECK ni siquiera admite.
 */
export type BlockFieldUse = 'required' | 'optional' | 'unused'

export interface BlockFieldRules {
  readonly title: BlockFieldUse
  readonly subtitle: BlockFieldUse
  readonly body: BlockFieldUse
  readonly media: BlockFieldUse
  readonly cta: BlockFieldUse
  readonly promotion: BlockFieldUse
  readonly category: BlockFieldUse
  readonly columns: BlockFieldUse
  readonly itemLimit: BlockFieldUse
  /**
   * Hero y banner piden título O imagen, no los dos: un banner que es solo una
   * ilustración es legítimo, y uno que es solo un titular también. Como no es
   * una exigencia de un campo suelto, viaja aparte y el formulario la explica
   * en una línea en vez de poner un asterisco que mentiría en ambos.
   */
  readonly titleOrMedia: boolean
}

const COLECCION: BlockFieldRules = {
  title: 'optional',
  subtitle: 'optional',
  body: 'unused',
  media: 'unused',
  cta: 'optional',
  promotion: 'unused',
  category: 'optional',
  columns: 'optional',
  itemLimit: 'optional',
  titleOrMedia: false,
}

const CARTEL: BlockFieldRules = {
  title: 'optional',
  subtitle: 'optional',
  body: 'optional',
  media: 'optional',
  cta: 'optional',
  promotion: 'unused',
  category: 'unused',
  columns: 'unused',
  itemLimit: 'unused',
  titleOrMedia: true,
}

const RULES: Record<ContentBlockType, BlockFieldRules> = {
  hero: CARTEL,
  banner: CARTEL,
  rich_text: {
    ...CARTEL,
    body: 'required',
    media: 'unused',
    titleOrMedia: false,
  },
  campaign: {
    ...CARTEL,
    title: 'required',
    body: 'unused',
    promotion: 'optional',
    titleOrMedia: false,
  },
  product_collection: COLECCION,
  carousel: COLECCION,
  category_collection: COLECCION,
  /**
   * El carrusel de imágenes no tiene contenido propio: sus diapositivas SON el
   * bloque, y se cargan en su propio panel. El título solo se usa como nombre
   * accesible de la región, así que ni siquiera es obligatorio.
   */
  slider: {
    title: 'optional',
    subtitle: 'unused',
    body: 'unused',
    media: 'unused',
    cta: 'unused',
    promotion: 'unused',
    category: 'unused',
    columns: 'unused',
    itemLimit: 'optional',
    titleOrMedia: false,
  },
}

/**
 * Cómo se enseñan las imágenes de un bloque de imágenes.
 *
 * `carousel` pasa una a una; `grid` las pone todas a la vez en un mosaico. Es la
 * MISMA lista de diapositivas: cambia la disposición, no el contenido, así que
 * pasar de una a otra no obliga a volver a subir nada. Viaja en `settings.layout`,
 * que ya está en el vocabulario cerrado — no hace falta migración ni un tipo de
 * bloque nuevo, que habría duplicado la pantalla de carga de imágenes.
 */
export const MEDIA_LAYOUTS = ['carousel', 'grid'] as const
export type MediaLayout = (typeof MEDIA_LAYOUTS)[number]

export function mediaLayoutOf(settings: Record<string, unknown>): MediaLayout {
  return blockLayoutOf('slider', settings)
}

// ---------------------------------------------------------------------------
// Storefront V3 · P08 · Las composiciones de un bloque del CMS
// ---------------------------------------------------------------------------

/**
 * Cómo se enseña una COLECCIÓN DE PRODUCTOS del CMS.
 *
 * Los cinco son la misma lista de productos con otra disposición — no otro
 * contenido, no otra consulta, no otro tipo de bloque:
 *
 *  · `grid` reparte a partes iguales. Es lo que quiere una colección que se
 *    recorre entera («Lo nuevo de temporada», doce piezas).
 *  · `rail` cabe en una franja y aguanta cuarenta referencias sin empujar el
 *    resto de la página fuera de la primera pantalla.
 *  · `editorial` da a cada pieza el doble de foto y le quita la caja: es la
 *    disposición de una selección corta donde la imagen es el argumento.
 *  · `spotlight` dice CUÁL manda: la primera ocupa el doble de área y las demás
 *    la acompañan. Con menos de tres piezas no hay jerarquía que enseñar y se
 *    comporta como `grid`.
 *  · `split` pone el mensaje del bloque a un lado y los productos al otro. Es
 *    lo que pide una colección que viene con una razón escrita («Rebajas de
 *    fin de temporada · hasta el domingo»), y en el teléfono se apila.
 */
export const PRODUCT_COLLECTION_LAYOUTS = [
  'grid',
  'rail',
  'editorial',
  'spotlight',
  'split',
] as const
export type ProductCollectionLayout = (typeof PRODUCT_COLLECTION_LAYOUTS)[number]

/**
 * Cómo se enseña una COLECCIÓN DE CATEGORÍAS del CMS.
 *
 * `tiles` y `pills` son las dos de siempre —puertas altas y navegación densa—.
 * Las dos nuevas aprovechan la foto que V2 ya deja subir por categoría:
 *
 *  · `photo-grid` es una rejilla de piezas IGUALES que nunca se convierte en
 *    carrusel. Es lo que quiere quien tiene ocho familias con foto y las quiere
 *    ver todas a la vez; `tiles` pasa a fila desplazable a partir de cuatro.
 *  · `mosaic` es la composición editorial: la primera familia manda.
 *
 * Ninguna inventa imágenes: la familia sin foto sigue cayendo a su tinte y su
 * icono, que es lo correcto para un catálogo donde la foto de la familia no
 * añade nada.
 */
export const CATEGORY_COLLECTION_LAYOUTS = ['tiles', 'pills', 'photo-grid', 'mosaic'] as const
export type CategoryCollectionLayout = (typeof CATEGORY_COLLECTION_LAYOUTS)[number]

/**
 * Cómo se enseña un BANNER.
 *
 * `contained` es el de siempre: la pieza dentro del ancho del contenido.
 *
 * `bleed` la lleva al ancho de la ventana. No trae cálculo propio: usa el
 * marco de sección de P06, que es donde vive el único `50vw` de la vitrina —
 * repetir el truco por bloque es cómo aparece una barra de desplazamiento
 * horizontal en toda la tienda.
 *
 * `split` deja de poner el texto ENCIMA de la foto y lo pone AL LADO. Es mejor
 * respuesta cuando la imagen tiene sujeto —una cara, un producto— porque el
 * velo que garantiza el contraste del texto es justo lo que lo tapa.
 */
export const BANNER_LAYOUTS = ['contained', 'bleed', 'split'] as const
export type BannerLayout = (typeof BANNER_LAYOUTS)[number]

/**
 * Todos los valores de composición que existen, sin repetir.
 *
 * Es lo que el esquema del editor acepta como cadena; que el valor encaje con
 * el TIPO del bloque se comprueba aparte, con las reglas entre campos, porque es
 * una relación entre dos campos y no una propiedad de uno.
 */
export const ALL_BLOCK_LAYOUTS = [
  'carousel',
  'grid',
  'rail',
  'editorial',
  'spotlight',
  'split',
  'tiles',
  'pills',
  'photo-grid',
  'mosaic',
  'contained',
  'bleed',
] as const
export type BlockLayout = (typeof ALL_BLOCK_LAYOUTS)[number]

/**
 * Qué composiciones admite cada tipo de bloque, y cuál es la suya por defecto.
 *
 * ## Por qué una tabla y no un `switch` en cada sitio
 *
 * Porque hay tres consumidores —la vitrina que pinta, el editor que ofrece el
 * desplegable y el esquema que valida lo que se guarda— y con tres `switch`
 * separados es cuestión de tiempo que el editor ofrezca algo que la vitrina no
 * pinta. Eso ya pasó en V2 con `heroVariant`.
 *
 * ## Y por qué el defecto es lo que ya se veía
 *
 * El valor por defecto de cada tipo es **exactamente su composición de hoy**, así
 * que una página publicada antes de esta fase se ve igual después. Un bloque sin
 * `layout` guardado no es un bloque a medio configurar: es la mayoría.
 *
 * Los tipos que no están en la tabla no eligen composición. `campaign` es el
 * caso que más cuesta explicar: el prompt de la fase la pedía junto al banner, y
 * no puede ser, porque las campañas consecutivas se AGRUPAN en un muro
 * (`groupCampaigns`) y un ancho o un reparto por bloque dentro de un grupo pelea
 * con el grupo. Su composición la decide el muro, que es quien sabe cuántas hay.
 */
const BLOCK_LAYOUTS = {
  slider: { options: MEDIA_LAYOUTS, fallback: 'carousel' },
  product_collection: { options: PRODUCT_COLLECTION_LAYOUTS, fallback: 'grid' },
  // El tipo `carousel` ES la colección en franja: su defecto no puede ser otro.
  carousel: { options: PRODUCT_COLLECTION_LAYOUTS, fallback: 'rail' },
  category_collection: { options: CATEGORY_COLLECTION_LAYOUTS, fallback: 'tiles' },
  banner: { options: BANNER_LAYOUTS, fallback: 'contained' },
} as const satisfies Partial<
  Record<ContentBlockType, { options: readonly BlockLayout[]; fallback: BlockLayout }>
>

/** Los tipos de bloque que eligen composición. */
export type LayoutedBlockType = keyof typeof BLOCK_LAYOUTS

/** ¿Este tipo de bloque elige cómo se enseña? */
export function blockChoosesLayout(type: ContentBlockType): type is LayoutedBlockType {
  return type in BLOCK_LAYOUTS
}

/** Lo que admite un tipo de bloque, o `null` si no elige composición. */
export function blockLayoutOptions(type: ContentBlockType): readonly BlockLayout[] | null {
  return blockChoosesLayout(type) ? BLOCK_LAYOUTS[type].options : null
}

/**
 * A qué FAMILIA de composiciones pertenece un tipo de bloque.
 *
 * Existe para las etiquetas del editor: «Mosaico» no quiere decir lo mismo en
 * un carrusel de imágenes que en una colección de categorías, así que el texto
 * que lee el comercio se busca por familia y no por valor. Y para que no haya
 * dos tablas, la familia sale de la misma que las opciones.
 */
const FAMILIA: Readonly<Record<LayoutedBlockType, string>> = {
  slider: 'media',
  product_collection: 'products',
  carousel: 'products',
  category_collection: 'categories',
  banner: 'banner',
}

export function blockLayoutFamily(type: ContentBlockType): string | null {
  return blockChoosesLayout(type) ? FAMILIA[type] : null
}

/**
 * La composición de serie de un tipo, o `null` si no elige.
 *
 * Es **su composición de hoy**, no la primera de la lista: el tipo `carousel`
 * ofrece las cinco de una colección de productos y la suya es `rail`, porque un
 * carrusel que se abriera como rejilla cambiaría de cara todas las páginas
 * publicadas antes de esta fase.
 */
export function blockLayoutDefault(type: ContentBlockType): BlockLayout | null {
  return blockChoosesLayout(type) ? BLOCK_LAYOUTS[type].fallback : null
}

/**
 * La composición de un bloque: lo guardado si es de su lista, y si no, la suya.
 *
 * Lo desconocido cae al defecto en silencio **a propósito**. Lo que llega aquí
 * es una cadena de una fila que pudo guardarse con otra versión del código —o a
 * mano— y la vitrina de un comercio no puede quedarse en blanco por eso. El
 * sitio donde un valor inventado se rechaza es el esquema del editor, antes de
 * guardarlo.
 */
export function blockLayoutOf<T extends LayoutedBlockType>(
  type: T,
  settings: Record<string, unknown>,
): (typeof BLOCK_LAYOUTS)[T]['options'][number] {
  type Valor = (typeof BLOCK_LAYOUTS)[T]['options'][number]
  const { options, fallback } = BLOCK_LAYOUTS[type]
  const guardado = settings.layout
  return typeof guardado === 'string' && (options as readonly string[]).includes(guardado)
    ? (guardado as Valor)
    : (fallback as Valor)
}

/**
 * ¿Vale esta composición para este tipo de bloque?
 *
 * Un `spotlight` en un banner o un `bleed` en una colección de productos son
 * combinaciones que el editor no puede llegar a guardar: el desplegable sale de
 * la misma tabla, así que esto solo salta si alguien llama a la API por su
 * cuenta.
 */
export function blockLayoutIsValid(type: ContentBlockType, layout: string): boolean {
  const opciones: readonly string[] | null = blockLayoutOptions(type)
  // Un tipo que no elige composición no puede tener una mal puesta.
  return opciones === null || opciones.includes(layout)
}

export function blockFieldRules(type: ContentBlockType): BlockFieldRules {
  return RULES[type]
}

/** Los tipos que muestran una lista de items. */
export function blockAcceptsItems(type: ContentBlockType): boolean {
  return (
    type === 'product_collection' ||
    type === 'category_collection' ||
    type === 'carousel' ||
    // El carrusel de imagenes NO tiene otra forma de contenido: sus items son
    // el bloque entero.
    type === 'slider'
  )
}

/** Los que llevan IMAGENES como items, en vez de filas del catalogo. */
export function blockUsesMediaItems(type: ContentBlockType): boolean {
  return type === 'slider'
}
