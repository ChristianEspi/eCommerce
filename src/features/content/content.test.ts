import { describe, expect, it } from 'vitest'
import {
  ALL_BLOCK_LAYOUTS,
  BANNER_LAYOUTS,
  CATEGORY_COLLECTION_LAYOUTS,
  CONTENT_BLOCK_TYPES,
  CONTENT_SETTING_KEYS,
  MEDIA_LAYOUTS,
  PRODUCT_COLLECTION_LAYOUTS,
  blockAcceptsItems,
  blockChoosesLayout,
  blockFieldRules,
  blockLayoutDefault,
  blockLayoutFamily,
  blockLayoutOf,
  blockLayoutOptions,
  blockShapeIsComplete,
  isSafeHref,
  isSafeRichText,
  looksLikeMarkup,
  parseRichText,
  contentSettingsSchema,
  type RichTextDocument,
} from '@/domain/content'
// El diccionario COMPLETO de los dos idiomas: `messages` trae el español y
// carga el inglés aparte, y aquí hace falta comprobar los dos a la vez.
import { MESSAGES } from '@/shared/i18n/messages.all'
import {
  clearUnusedBlockFields,
  parseExpansions,
  validateBlockForm,
  type BlockFormValues,
} from './types'
import { documentToTiptap, tiptapToDocument } from './tiptapDocument'

/**
 * P11-SaaS · La mitad de CLIENTE de las reglas del CMS.
 *
 * Lo que se prueba aquí no es la seguridad —esa vive en los CHECK de
 * `20260828140000_cms_core.sql` y se comprueba contra Postgres real en
 * `supabase/tests/cms-content.test.ts`— sino que el editor diga que no ANTES de
 * pulsar Guardar, con el foco en el campo. Las dos mitades tienen que dar la
 * misma respuesta: si discrepan, el usuario ve un 400 genérico en vez de un
 * mensaje útil, o —peor— cree que algo está permitido y no lo está.
 */

function form(overrides: Partial<BlockFormValues> = {}): BlockFormValues {
  return {
    block_type: 'hero',
    position: 0,
    title: 'Rebajas',
    subtitle: '',
    body: null,
    media_url: null,
    media_alt: '',
    cta_label: '',
    cta_href: '',
    category_id: null,
    promotion_id: null,
    item_limit: 8,
    is_active: true,
    publish_from: '2026-08-01T00:00',
    publish_to: '',
    channel_id: null,
    segment_id: null,
    columns: 4,
    descendants: false,
    layout: 'carousel',
    ...overrides,
  }
}

describe('enlaces admisibles: lista blanca, no lista negra', () => {
  it.each([
    'https://ejemplo.test/promo',
    '/s/tienda/p/envios',
    'mailto:hola@ejemplo.test',
    'tel:+51999111222',
  ])('acepta %s', (href) => {
    expect(isSafeHref(href)).toBe(true)
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['JavaScript con mayúsculas', 'JavaScript:alert(1)'],
    ['data', 'data:text/html,<b>x</b>'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['protocolo-relativo', '//otro-dominio.test/x'],
    ['http sin cifrar', 'http://ejemplo.test'],
    ['con espacios', 'https://ejemplo.test/a b'],
    ['esquema desconocido', 'ftp://ejemplo.test/x'],
  ])('rechaza %s', (_label, href) => {
    expect(isSafeHref(href)).toBe(false)
  })

  it('nulo es válido: un bloque puede no tener enlace', () => {
    expect(isSafeHref(null)).toBe(true)
    expect(isSafeHref(undefined)).toBe(true)
  })
})

describe('el documento enriquecido', () => {
  it('acepta los cuatro tipos de nodo del vocabulario', () => {
    expect(
      isSafeRichText([
        { type: 'heading', level: 2, text: 'Envíos' },
        { type: 'paragraph', text: 'Llegamos a todo el país.' },
        { type: 'list', items: ['Lima en 24 h'] },
        { type: 'quote', text: 'Sin coste desde 200.' },
      ]),
    ).toBe(true)
  })

  it.each([
    ['un tipo inventado', [{ type: 'iframe', text: 'x' }]],
    ['una clave desconocida', [{ type: 'paragraph', text: 'x', onclick: 'y()' }]],
    ['un titular de nivel 1', [{ type: 'heading', level: 1, text: 'x' }]],
    ['un enlace ejecutable', [{ type: 'paragraph', text: 'x', href: 'javascript:alert(1)' }]],
    ['una etiqueta dentro del texto', [{ type: 'paragraph', text: 'hola <b>mundo</b>' }]],
    ['una lista vacía', [{ type: 'list', items: [] }]],
    ['un documento vacío', []],
    ['algo que no es un array', { type: 'paragraph', text: 'x' }],
  ])('rechaza %s', (_label, doc) => {
    expect(isSafeRichText(doc)).toBe(false)
  })

  it('un documento inválido se lee como `null`, no a medias', () => {
    expect(parseRichText([{ type: 'paragraph', text: '<script>x</script>' }])).toBeNull()
    expect(parseRichText(null)).toBeNull()
    expect(parseRichText([{ type: 'paragraph', text: 'bien' }])).toHaveLength(1)
  })

  it('`looksLikeMarkup` no da falsos positivos con una comparación', () => {
    expect(looksLikeMarkup('el precio es < 100')).toBe(false)
    expect(looksLikeMarkup('3 < 4 y 5 > 2')).toBe(false)
    expect(looksLikeMarkup('<span>')).toBe(true)
    expect(looksLikeMarkup('</p>')).toBe(true)
    expect(looksLikeMarkup('<!doctype html>')).toBe(true)
  })
})

describe('el editor de texto: ida y vuelta sin perder nada', () => {
  it('traduce los cinco nodos del dominio y sus marcas', () => {
    const doc = [
      { type: 'heading', level: 2, text: 'Envíos' },
      { type: 'paragraph', text: 'Llegamos a todo el país.' },
      { type: 'list', items: ['Lima en 24 h', 'Provincia en 72 h'] },
      { type: 'list', items: ['Primero', 'Después'], ordered: true },
      { type: 'quote', text: 'Gratis desde 200' },
      { type: 'divider' },
      {
        type: 'paragraph',
        align: 'center',
        text: [
          { text: 'Envíos ' },
          { text: 'gratis', bold: true },
          { text: ' aquí', href: 'https://ejemplo.test' },
        ],
      },
    ] satisfies RichTextDocument

    // La vuelta completa: dominio → TipTap → dominio. Si alguna clave se
    // perdiera por el camino, el contenido publicado cambiaría al editarlo.
    expect(tiptapToDocument(documentToTiptap(doc))).toEqual(doc)
  })

  it('el texto sin ninguna marca se guarda como CADENA, no como un tramo', () => {
    // Envolver todo en tramos llenaría la base de `[{text: '…'}]` y haría
    // ilegible cualquier diff de contenido.
    const doc = tiptapToDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola' }] }],
    })
    expect(doc).toEqual([{ type: 'paragraph', text: 'Hola' }])
  })

  it('un enlace de párrafo del formato antiguo se abre como tramo con enlace', () => {
    const doc = tiptapToDocument(
      documentToTiptap([
        { type: 'paragraph', text: 'Ver zonas', href: '/s/tienda/p/envios', linkLabel: 'aquí' },
      ]),
    )
    expect(doc).toEqual([
      {
        type: 'paragraph',
        text: [{ text: 'Ver zonas ' }, { text: 'aquí', href: '/s/tienda/p/envios' }],
      },
    ])
  })

  it('un documento sin nada que guardar es NULL, no un array vacío', () => {
    expect(tiptapToDocument({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull()
  })

  it('una etiqueta escrita a mano NO se sanea: el documento entero se rechaza', () => {
    const doc = tiptapToDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola <script>' }] }],
    })
    // El texto se conserva —no se borra el trabajo de nadie— pero no valida, y
    // es el mismo juez que el CHECK de la base.
    expect(doc).toEqual([{ type: 'paragraph', text: 'Hola <script>' }])
    expect(isSafeRichText(doc)).toBe(false)
  })
})

describe('forma del bloque: las reglas ENTRE campos', () => {
  it('un hero necesita título o imagen', () => {
    expect(blockShapeIsComplete({ type: 'hero', title: null, mediaUrl: null, body: null })).toBe(false)
    expect(blockShapeIsComplete({ type: 'hero', title: 'Hola', mediaUrl: null, body: null })).toBe(true)
    expect(blockShapeIsComplete({ type: 'hero', title: null, mediaUrl: 'x/y/z.png', body: null })).toBe(
      true,
    )
  })

  it('un bloque de texto necesita un documento válido', () => {
    expect(blockShapeIsComplete({ type: 'rich_text', title: 'T', mediaUrl: null, body: null })).toBe(false)
    expect(
      blockShapeIsComplete({
        type: 'rich_text',
        title: null,
        mediaUrl: null,
        body: [{ type: 'paragraph', text: 'Hola' }],
      }),
    ).toBe(true)
  })

  it('solo tres tipos aceptan una lista de items', () => {
    expect(blockAcceptsItems('product_collection')).toBe(true)
    expect(blockAcceptsItems('category_collection')).toBe(true)
    expect(blockAcceptsItems('carousel')).toBe(true)
    expect(blockAcceptsItems('hero')).toBe(false)
    expect(blockAcceptsItems('rich_text')).toBe(false)
  })

  it('un formulario correcto no tiene incidencias', () => {
    expect(validateBlockForm(form())).toEqual([])
  })

  it('un botón con texto y sin destino se marca en el destino', () => {
    const issues = validateBlockForm(form({ cta_label: 'Ver', cta_href: '' }))
    expect(issues).toContainEqual({ field: 'cta_href', key: 'content.error.ctaPair' })
  })

  it('un destino ejecutable se marca aunque el botón esté completo', () => {
    const issues = validateBlockForm(form({ cta_label: 'Ver', cta_href: 'javascript:alert(1)' }))
    expect(issues).toContainEqual({ field: 'cta_href', key: 'content.error.href' })
  })

  it('una campaña fuera de un bloque de campaña se marca', () => {
    const issues = validateBlockForm(
      form({ block_type: 'banner', promotion_id: '11111111-1111-4111-8111-111111111111' }),
    )
    expect(issues).toContainEqual({
      field: 'promotion_id',
      key: 'content.error.promotionOnlyCampaign',
    })
  })

  it('una vigencia invertida se marca en la fecha de fin', () => {
    const issues = validateBlockForm(
      form({ publish_from: '2026-09-01T00:00', publish_to: '2026-08-01T00:00' }),
    )
    expect(issues).toContainEqual({ field: 'publish_to', key: 'content.error.window' })
  })

  it('un hero sin nada que enseñar se marca en el título', () => {
    const issues = validateBlockForm(form({ title: '', media_url: null }))
    // Y el aviso nombra las DOS salidas, porque con cualquiera de ellas basta.
    expect(issues).toContainEqual({ field: 'title', key: 'content.error.titleOrMedia' })
  })

  /**
   * El fallo que lo destapó: un carrusel de imágenes con texto escrito en
   * «Contenido». La base lo rechazaba con `content_blocks_body_only_text` —solo
   * texto, hero y banner llevan cuerpo— y el aviso que llegaba a la pantalla
   * decía «faltan datos obligatorios», que es justo lo contrario de lo que
   * pasaba: sobraban.
   */
  it('un campo que el tipo NO admite se marca en ese campo, y dice que sobra', () => {
    const issues = validateBlockForm(
      form({ block_type: 'slider', title: 'Campañas', body: [{ type: 'paragraph', text: 'hola' }] }),
    )
    expect(issues).toContainEqual({ field: 'body', key: 'content.error.notForThisType' })
  })

  it('un carrusel de imágenes sin nada más es válido: sus diapositivas van aparte', () => {
    expect(validateBlockForm(form({ block_type: 'slider', title: 'Campañas' }))).toEqual([])
  })

  it('el título de una campaña es obligatorio, y se dice en el título', () => {
    const issues = validateBlockForm(form({ block_type: 'campaign', title: '' }))
    expect(issues).toContainEqual({ field: 'title', key: 'content.error.titleRequired' })
  })

  it('un texto sin contenido se marca en el contenido, no en el título', () => {
    const issues = validateBlockForm(form({ block_type: 'rich_text', title: 'T', body: null }))
    expect(issues).toContainEqual({ field: 'body', key: 'content.error.bodyRequired' })
  })
})

/**
 * La tabla de campos y los CHECK de la base tienen que decir lo mismo.
 *
 * Lo que se fija aquí es la parte que se puede comprobar sin Postgres: que
 * ningun tipo declare como usable un campo que la base prohibe para el. Los
 * nombres de la derecha son los de los CHECK que lo imponen.
 */
describe('la tabla de campos no contradice a los CHECK', () => {
  it('solo texto, hero y banner llevan cuerpo (`content_blocks_body_only_text`)', () => {
    const conCuerpo = CONTENT_BLOCK_TYPES.filter(
      (type) => blockFieldRules(type).body !== 'unused',
    )
    expect([...conCuerpo].sort()).toEqual(['banner', 'hero', 'rich_text'])
  })

  it('solo la campaña lleva promoción (`content_blocks_promotion_only_campaign`)', () => {
    const conPromo = CONTENT_BLOCK_TYPES.filter(
      (type) => blockFieldRules(type).promotion !== 'unused',
    )
    expect(conPromo).toEqual(['campaign'])
  })

  it('solo las colecciones llevan categoría (`content_blocks_category_only_collection`)', () => {
    const conCategoria = CONTENT_BLOCK_TYPES.filter(
      (type) => blockFieldRules(type).category !== 'unused',
    )
    expect([...conCategoria].sort()).toEqual([
      'carousel',
      'category_collection',
      'product_collection',
    ])
  })

  it('lo que la base EXIGE se declara obligatorio (`content_blocks_shape`)', () => {
    expect(blockFieldRules('campaign').title).toBe('required')
    expect(blockFieldRules('rich_text').body).toBe('required')
    expect(blockFieldRules('hero').titleOrMedia).toBe(true)
    expect(blockFieldRules('banner').titleOrMedia).toBe(true)
  })
})

describe('cambiar de tipo limpia lo que el nuevo no admite', () => {
  it('el cuerpo de un hero no sobrevive al pasarlo a carrusel de imágenes', () => {
    const limpio = clearUnusedBlockFields(
      form({ block_type: 'slider', body: [{ type: 'paragraph', text: 'hola' }], cta_label: 'Ver' }),
    )

    // Sin esto quedaria escondido —el campo ya no se pinta— y la base
    // rechazaria el guardado sin que el formulario tuviera nada que senalar.
    expect(limpio.body).toBeNull()
    expect(limpio.cta_label).toBe('')
    expect(validateBlockForm(limpio)).toEqual([])
  })

  it('no toca lo que el tipo nuevo sí admite', () => {
    const limpio = clearUnusedBlockFields(form({ block_type: 'hero', title: 'Hola' }))
    expect(limpio.title).toBe('Hola')
  })
})

describe('`settings` tiene vocabulario cerrado', () => {
  it('acepta las claves declaradas con valores escalares', () => {
    expect(contentSettingsSchema.safeParse({ columns: 3, show_price: false }).success).toBe(true)
  })

  it.each([
    ['una clave desconocida', { script: 'https://malo.test/x.js' }],
    ['un objeto anidado', { layout: { deep: true } }],
    ['un texto demasiado largo', { layout: 'x'.repeat(61) }],
  ])('rechaza %s', (_label, settings) => {
    expect(contentSettingsSchema.safeParse(settings).success).toBe(false)
  })
})

describe('sinónimos', () => {
  it('separa por comas, quita duplicados y recorta a doce', () => {
    expect(parseExpansions('tenis, zapatilla , tenis')).toEqual(['tenis', 'zapatilla'])
    expect(parseExpansions(Array.from({ length: 20 }, (_, i) => `term${i}`).join(','))).toHaveLength(
      12,
    )
  })

  it('descarta lo demasiado corto: un término de una letra no es un sinónimo', () => {
    expect(parseExpansions('a, ok, b')).toEqual(['ok'])
  })
})

/**
 * Storefront V3 · P08 · Las composiciones de un bloque.
 *
 * Tres propiedades, y las tres son la misma preocupación: que el editor, la
 * vitrina y la base digan lo mismo.
 *
 *  1. **El vocabulario es cerrado y viaja en `settings.layout`**, que ya estaba
 *     en la lista blanca desde el CMS original. Por eso esta fase no lleva
 *     migración: la clave existía y lo que se añade son valores.
 *  2. **El defecto de cada tipo es su composición de HOY**, así que una página
 *     publicada antes de esta fase se ve igual después.
 *  3. **Cada valor tiene etiqueta en los dos idiomas.** Es lo que evita que el
 *     comercio lea `photo-grid` en un desplegable.
 */
describe('las composiciones de un bloque', () => {
  it('la lista completa es exactamente la unión de las familias', () => {
    // Un valor que estuviera en una familia y no en la lista completa no se
    // podría guardar; uno que estuviera solo en la lista completa sería un
    // valor que nadie ofrece y nadie pinta.
    const familias = [
      ...MEDIA_LAYOUTS,
      ...PRODUCT_COLLECTION_LAYOUTS,
      ...CATEGORY_COLLECTION_LAYOUTS,
      ...BANNER_LAYOUTS,
    ]
    expect([...ALL_BLOCK_LAYOUTS].sort()).toEqual([...new Set(familias)].sort())
  })

  it('`layout` ya estaba en el vocabulario de `settings`: esta fase no toca la base', () => {
    expect(CONTENT_SETTING_KEYS).toContain('layout')
    expect(contentSettingsSchema.safeParse({ layout: 'spotlight' }).success).toBe(true)
  })

  it.each([
    ['product_collection', 'grid'],
    ['carousel', 'rail'],
    ['category_collection', 'tiles'],
    ['banner', 'contained'],
    ['slider', 'carousel'],
  ] as const)('un %s sin nada guardado se enseña como %s', (type, esperado) => {
    expect(blockLayoutOf(type, {})).toBe(esperado)
  })

  it('lo guardado manda si es de su familia', () => {
    expect(blockLayoutOf('product_collection', { layout: 'spotlight' })).toBe('spotlight')
    expect(blockLayoutOf('category_collection', { layout: 'photo-grid' })).toBe('photo-grid')
    expect(blockLayoutOf('banner', { layout: 'bleed' })).toBe('bleed')
  })

  it.each([
    ['banner', 'spotlight'],
    ['product_collection', 'bleed'],
    ['category_collection', 'rail'],
    ['slider', 'mosaic'],
  ] as const)('un %s con «%s» guardado cae a la suya: la vitrina no se queda en blanco', (type, ajeno) => {
    expect(blockLayoutOf(type, { layout: ajeno })).toBe(blockLayoutDefault(type))
  })

  it('los tipos que no eligen composición no ofrecen ninguna', () => {
    // Y no por olvido: la composición de una campaña la decide el muro que las
    // agrupa, que es quien sabe cuántas hay.
    expect(blockLayoutOptions('hero')).toBeNull()
    expect(blockLayoutOptions('rich_text')).toBeNull()
    expect(blockLayoutOptions('campaign')).toBeNull()
    expect(blockChoosesLayout('campaign')).toBe(false)
  })

  it('el editor rechaza una composición que no es de ese tipo', () => {
    // El desplegable no puede llegar a ofrecerla —sale de la misma tabla—, así
    // que esto solo salta si la llamada no viene del formulario.
    const issues = validateBlockForm(
      form({ block_type: 'banner', title: 'Aviso', layout: 'spotlight' }),
    )
    expect(issues.some((issue) => issue.field === 'layout')).toBe(true)

    expect(
      validateBlockForm(form({ block_type: 'banner', title: 'Aviso', layout: 'bleed' })).some(
        (issue) => issue.field === 'layout',
      ),
    ).toBe(false)
  })

  it('cambiar de tipo devuelve la composición a la del tipo nuevo', () => {
    // Sin esto, pasar un banner a sangre a colección de productos dejaría
    // `bleed` guardado en un bloque que no sabe qué es eso: el formulario no lo
    // enseñaría y la validación lo rechazaría al guardar sin nada que señalar.
    const limpio = clearUnusedBlockFields(
      form({ block_type: 'product_collection', layout: 'bleed' }),
    )
    expect(limpio.layout).toBe('grid')

    // Y una que sí vale se conserva: cambiar de tipo no es perder lo elegido.
    expect(
      clearUnusedBlockFields(form({ block_type: 'product_collection', layout: 'spotlight' })).layout,
    ).toBe('spotlight')
  })

  it('cada composición tiene etiqueta en español y en inglés', () => {
    const familias: readonly [string, readonly string[]][] = [
      ['media', MEDIA_LAYOUTS],
      ['products', PRODUCT_COLLECTION_LAYOUTS],
      ['categories', CATEGORY_COLLECTION_LAYOUTS],
      ['banner', BANNER_LAYOUTS],
    ]

    const faltan: string[] = []
    for (const [familia, valores] of familias) {
      for (const valor of valores) {
        const key = `content.blocks.layout.${familia}.${valor}`
        if (!(key in MESSAGES.es)) faltan.push(`es:${key}`)
        if (!(key in MESSAGES.en)) faltan.push(`en:${key}`)
      }
    }
    expect(faltan).toEqual([])
  })

  it('y la familia de cada tipo es la que nombra sus etiquetas', () => {
    expect(blockLayoutFamily('product_collection')).toBe('products')
    expect(blockLayoutFamily('carousel')).toBe('products')
    expect(blockLayoutFamily('category_collection')).toBe('categories')
    expect(blockLayoutFamily('banner')).toBe('banner')
    expect(blockLayoutFamily('slider')).toBe('media')
    expect(blockLayoutFamily('hero')).toBeNull()
  })
})
