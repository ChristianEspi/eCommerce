/**
 * Asistente de ficha (PIM) — fase 03 de `EBIM_AI_SEQUENCE`. TypeScript PURO.
 *
 * Es la extensión de `catalog-copy` (modo `assist`), no una función nueva: misma
 * funcionalidad `catalog.copy`, misma cuota, mismo recorrido (`ejecutarIA`) y el
 * mismo candado clínico de `aiCopy.ts`. Lo que añade es QUÉ se le deja proponer
 * y cómo se comprueba cada propuesta antes de enseñarla.
 *
 * ## Lo que propone
 *
 *   título comercial · descripción corta · descripción completa · SEO (título y
 *   meta descripción) · categoría · valores de atributos faltantes ·
 *   normalización segura del nombre · posibles duplicados · etiquetas.
 *
 * ## Lo que NO puede hacer, y cómo se comprueba (no se confía en el prompt)
 *
 *  1. **Inventar cifras.** Todo número de un texto propuesto tiene que existir
 *     ya en los datos del producto (nombre, descripción, marca, familia,
 *     atributos). Así no hay precio, stock, SKU, código ERP ni concentración
 *     inventada: una propuesta con un número nuevo se descarta entera.
 *  2. **Hablar de precio, impuestos, stock o identificadores.** Lista de
 *     términos prohibidos (`hablaDeDatosProhibidos`) y el SKU literal no puede
 *     aparecer en un texto comercial.
 *  3. **Afirmaciones clínicas.** `tieneAfirmacionClinica` de `aiCopy.ts`, sobre
 *     TODOS los textos (también etiquetas y motivos).
 *  4. **Elegir entidades que no existen.** Categorías, atributos, opciones y
 *     productos candidatos van con referencia (`C1`, `A1`, `P1`) de una lista
 *     cerrada que construye el servidor con el JWT de quien pide; el id real
 *     nunca lo escribe el modelo. Referencia desconocida ⇒ fuera.
 *  5. **Normalizar cambiando el significado.** El nombre normalizado solo se
 *     acepta si su clave comparable (sin mayúsculas, tildes, espacios,
 *     puntuación y con unidades canónicas) es IDÉNTICA a la del nombre actual.
 *  6. **Pisar datos.** Solo propone atributos VACÍOS; los que ya tienen valor
 *     son de quien los escribió.
 *
 * Nada de esto guarda: el front enseña ACTUAL frente a SUGERENCIA y es una
 * persona quien aplica, edita o descarta. Lo aplicado pasa por los mismos
 * comandos y validaciones que si lo hubiera tecleado.
 *
 * Lo determinista (atributos faltantes, candidatos a duplicado por similitud)
 * se calcula aquí y viaja SIEMPRE, haya IA o no: es del sistema, no del modelo.
 */
import { tieneAfirmacionClinica } from './aiCopy.ts'
import { datosJson, delimitarDatos, type EsquemaIA } from './aiCore.ts'

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export const PIM_TASKS = [
  'title',
  'short_description',
  'description',
  'seo',
  'category',
  'attributes',
  'normalize',
  'duplicates',
  'tags',
] as const
export type PimTask = (typeof PIM_TASKS)[number]

export function isPimTask(value: unknown): value is PimTask {
  return typeof value === 'string' && (PIM_TASKS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

export const PIM_LIMITES = {
  titulo: 120,
  corta: 280,
  descripcion: 2000,
  descripcionEntrada: 1500,
  seoTitulo: 70,
  seoDescripcion: 160,
  nombre: 240,
  razon: 200,
  tag: 40,
  tags: 12,
  categorias: 80,
  atributos: 30,
  opciones: 25,
  candidatos: 8,
  valorTexto: 200,
} as const

/** Umbral de similitud (Jaccard de tokens) para proponer un candidato. */
export const UMBRAL_DUPLICADO = 0.5

/** Techo de salida del modo `assist` (el registro de `catalog.copy` es 300). */
export const PIM_MAX_TOKENS = 2048
export const PIM_TIMEOUT_MS = 20000

// ---------------------------------------------------------------------------
// Normalización comparable
// ---------------------------------------------------------------------------

const UNIDADES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:mg|mgs|miligramos?)$/, 'mg'],
  [/^(?:mcg|ug|microgramos?)$/, 'mcg'],
  [/^(?:g|gr|grs|gramos?)$/, 'g'],
  [/^(?:kg|kgs|kilos?|kilogramos?)$/, 'kg'],
  [/^(?:ml|mls|mililitros?)$/, 'ml'],
  [/^(?:l|lt|lts|litros?)$/, 'l'],
  [/^(?:cm|cms|centimetros?)$/, 'cm'],
  [/^(?:mm|milimetros?)$/, 'mm'],
  [/^(?:m|mts|metros?)$/, 'm'],
  [/^(?:u|un|und|unds|unid|unids|unidad|unidades)$/, 'un'],
]

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Tokens comparables: minúsculas, sin tildes, número y unidad separados. */
export function tokensComparables(texto: string): string[] {
  const base = sinTildes(texto.toLowerCase())
    .replace(/µ/g, 'u')
    // «0,5» y «0.5» son el mismo número.
    .replace(/(\d),(\d)/g, '$1.$2')
    // «500mg» → «500 mg», «x21» → «x 21».
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
  const crudos = base.match(/\d+(?:\.\d+)?|[a-z]+/g) ?? []
  return crudos.map((token) => {
    if (/^\d/.test(token)) return normalizarNumero(token)
    for (const [patron, canonica] of UNIDADES) if (patron.test(token)) return canonica
    return token
  })
}

function normalizarNumero(token: string): string {
  const [entero, decimales] = token.split('.')
  const e = (entero ?? '').replace(/^0+(?=\d)/, '')
  const d = (decimales ?? '').replace(/0+$/, '')
  return d ? `${e}.${d}` : e
}

/** Dos textos con la misma clave dicen lo mismo con distinta escritura. */
export function claveComparable(texto: string): string {
  return tokensComparables(texto).join(' ')
}

/** Los números de un texto, normalizados (`0,50` = `0.5`). */
export function numerosDe(texto: string): string[] {
  return tokensComparables(texto).filter((t) => /^\d/.test(t))
}

/** Números del texto propuesto que no están en la fuente. */
export function numerosNuevos(texto: string, fuente: ReadonlySet<string>): string[] {
  return numerosDe(texto).filter((n) => !fuente.has(n))
}

/**
 * Precio, dinero, impuestos, existencias e identificadores: el modelo no los
 * emite (regla 2 de `ai.ts`). Frases y palabras completas, ES y EN.
 */
const DATOS_PROHIBIDOS: readonly RegExp[] = [
  /[$€£]/,
  /\bs\/\.?/i,
  /\b(?:precios?|soles|d[oó]lares|usd|igv|iva|impuestos?|exonerad[oa]s?|ruc|tributari[oa]s?)\b/i,
  /\b(?:stock|existencias?|agotad[oa]s?|disponibilidad)\b/i,
  /\b(?:descuentos?|ofertas?|promoci[oó]n|gratis|rebaja)\b/i,
  /\b(?:sku|c[oó]digo\s+(?:erp|interno|de\s+barras)|ean|gtin|upc)\b/i,
  /\b(?:price|prices|tax|vat|discount|free\s+shipping|in\s+stock|out\s+of\s+stock|barcode)\b/i,
]

export function hablaDeDatosProhibidos(texto: string): boolean {
  return DATOS_PROHIBIDOS.some((patron) => patron.test(texto))
}

// ---------------------------------------------------------------------------
// Contexto: lo que el sistema sabe (y el modelo puede referenciar)
// ---------------------------------------------------------------------------

type Fila = Readonly<Record<string, unknown>>

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const textoONulo = (v: unknown): string | null => texto(v) || null
const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export interface FilasPim {
  readonly producto: Fila
  /** Categoría actual del producto en la tienda pedida (null = ninguna). */
  readonly categoriaActualId: string | null
  readonly categorias: readonly Fila[]
  readonly atributos: readonly Fila[]
  readonly opciones: readonly Fila[]
  readonly valores: readonly Fila[]
  readonly similares: readonly Fila[]
}

export interface CategoriaCandidata {
  readonly ref: string
  readonly id: string
  readonly path: string
}

export type TipoAtributo = 'option' | 'text' | 'number' | 'boolean'

export interface AtributoContexto {
  readonly ref: string
  readonly id: string
  readonly code: string
  readonly name: string
  readonly dataType: TipoAtributo
  readonly unit: string | null
  /** Valor actual ya legible, o `null` si falta. */
  readonly current: string | null
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>
}

export interface CandidatoDuplicado {
  readonly ref: string
  readonly id: string
  readonly sku: string
  readonly name: string
  readonly brandName: string | null
  /** 0–1, similitud determinista. */
  readonly score: number
}

export interface ContextoPim {
  readonly producto: {
    readonly id: string
    readonly sku: string
    readonly name: string
    readonly description: string | null
    readonly brandName: string | null
    readonly familyName: string | null
    readonly kind: string
  }
  readonly categoriaActual: CategoriaCandidata | null
  readonly categorias: readonly CategoriaCandidata[]
  readonly atributos: readonly AtributoContexto[]
  readonly candidatos: readonly CandidatoDuplicado[]
  /** Números que ya dicen los datos: lo único que un texto puede repetir. */
  readonly numerosFuente: ReadonlySet<string>
}

const TIPOS_PROPONIBLES: readonly TipoAtributo[] = ['option', 'text', 'number', 'boolean']

const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'con', 'para', 'por', 'x', 'a', 'al',
  'the', 'and', 'of', 'for', 'with',
])

function tokensSignificativos(nombre: string): Set<string> {
  return new Set(tokensComparables(nombre).filter((t) => !PALABRAS_VACIAS.has(t)))
}

/** Jaccard de tokens (con números: 250 mg y 500 mg NO son el mismo producto). */
export function similitud(a: string, b: string): number {
  const ta = tokensSignificativos(a)
  const tb = tokensSignificativos(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let comunes = 0
  for (const t of ta) if (tb.has(t)) comunes += 1
  return comunes / (ta.size + tb.size - comunes)
}

const skuComparable = (sku: string) => sinTildes(sku.toLowerCase()).replace(/[^a-z0-9]/g, '')

/**
 * Hasta tres palabras del nombre para buscar parecidos con `ilike`. Solo
 * `[a-z0-9]`: van dentro de un filtro de PostgREST y no pueden llevar comas,
 * paréntesis ni comodines.
 */
export function tokensDeBusqueda(nombre: string): string[] {
  const unicos = [...new Set(tokensComparables(nombre))]
    .filter((t) => /^[a-z]{4,}$/.test(t) && !PALABRAS_VACIAS.has(t))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
  return unicos.slice(0, 3)
}

function rutaDeCategoria(id: string, porId: ReadonlyMap<string, Fila>): string {
  const partes: string[] = []
  let actual: string | null = id
  const vistos = new Set<string>()
  while (actual && !vistos.has(actual) && partes.length < 6) {
    vistos.add(actual)
    const fila = porId.get(actual)
    if (!fila) break
    partes.unshift(texto(fila.name))
    actual = textoONulo(fila.parent_id)
  }
  return partes.filter(Boolean).join(' > ')
}

function valorActual(
  fila: Fila | undefined,
  opciones: ReadonlyArray<{ id: string; label: string }>,
  unit: string | null,
): string | null {
  if (!fila) return null
  const id = textoONulo(fila.value_id)
  if (id) return opciones.find((o) => o.id === id)?.label ?? '(valor asignado)'
  const t = textoONulo(fila.value_text)
  if (t) return t
  const n = fila.value_number
  if (typeof n === 'number' || (typeof n === 'string' && n.trim())) {
    return unit ? `${String(n).trim()} ${unit}` : String(n).trim()
  }
  if (typeof fila.value_boolean === 'boolean') return fila.value_boolean ? 'si' : 'no'
  if (textoONulo(fila.value_date)) return texto(fila.value_date)
  return null
}

/**
 * De las filas que leyó la Edge Function (con el JWT de quien pide) al
 * contexto con referencias. Lo que no tiene forma se ignora: estas filas son
 * datos no confiables aunque vengan de la base.
 */
export function construirContexto(filas: FilasPim): ContextoPim {
  const p = filas.producto
  const producto = {
    id: texto(p.id),
    sku: texto(p.sku),
    name: texto(p.name),
    description: textoONulo(p.description)?.slice(0, PIM_LIMITES.descripcionEntrada) ?? null,
    brandName: textoONulo(p.brand_name),
    familyName: textoONulo(p.family_name),
    kind: texto(p.kind) || 'simple',
  }

  // Categorías: solo activas de la tienda pedida, con su ruta completa.
  const porId = new Map<string, Fila>()
  for (const c of filas.categorias) if (texto(c.id)) porId.set(texto(c.id), c)
  const todas = [...porId.values()]
    .filter((c) => c.is_active !== false)
    .map((c) => ({ id: texto(c.id), path: rutaDeCategoria(texto(c.id), porId) }))
    .filter((c) => c.path)
    .sort((a, b) => a.path.localeCompare(b.path))
  const categorias = todas
    .slice(0, PIM_LIMITES.categorias)
    .map((c, i) => ({ ref: `C${i + 1}`, ...c }))
  const actualId = filas.categoriaActualId
  const categoriaActual = actualId
    ? (categorias.find((c) => c.id === actualId) ??
      (porId.has(actualId) ? { ref: 'C0', id: actualId, path: rutaDeCategoria(actualId, porId) } : null))
    : null

  // Atributos: activos, sin ejes de variante (se deciden por variante) y sin
  // fechas (el modelo no tiene de dónde sacar una fecha que no invente).
  const valoresPorAtributo = new Map<string, Fila>()
  for (const v of filas.valores) valoresPorAtributo.set(texto(v.attribute_id), v)
  const opcionesPorAtributo = new Map<string, Array<{ id: string; label: string; position: number }>>()
  for (const o of filas.opciones) {
    if (o.is_active === false || !texto(o.id) || !texto(o.label)) continue
    const lista = opcionesPorAtributo.get(texto(o.attribute_id)) ?? []
    lista.push({ id: texto(o.id), label: texto(o.label), position: numero(o.position) })
    opcionesPorAtributo.set(texto(o.attribute_id), lista)
  }
  const atributos = filas.atributos
    .filter(
      (a) =>
        a.is_active !== false &&
        a.is_variant_axis !== true &&
        (TIPOS_PROPONIBLES as readonly string[]).includes(texto(a.data_type)) &&
        texto(a.id) &&
        texto(a.name),
    )
    .sort((a, b) => numero(a.position) - numero(b.position) || texto(a.name).localeCompare(texto(b.name)))
    .slice(0, PIM_LIMITES.atributos)
    .map((a, i): AtributoContexto => {
      const id = texto(a.id)
      const unit = textoONulo(a.unit)
      const options = (opcionesPorAtributo.get(id) ?? [])
        .sort((x, y) => x.position - y.position || x.label.localeCompare(y.label))
        .slice(0, PIM_LIMITES.opciones)
        .map(({ id: oid, label }) => ({ id: oid, label }))
      return {
        ref: `A${i + 1}`,
        id,
        code: texto(a.code),
        name: texto(a.name),
        dataType: texto(a.data_type) as TipoAtributo,
        unit,
        current: valorActual(valoresPorAtributo.get(id), options, unit),
        options,
      }
    })

  // Candidatos a duplicado: similitud determinista, nunca el propio producto.
  const skuPropio = skuComparable(producto.sku)
  const candidatos = filas.similares
    .filter((s) => texto(s.id) && texto(s.id) !== producto.id && texto(s.name))
    .map((s) => {
      const mismoSku = skuPropio !== '' && skuComparable(texto(s.sku)) === skuPropio
      return {
        id: texto(s.id),
        sku: texto(s.sku),
        name: texto(s.name),
        brandName: textoONulo(s.brand_name),
        score: mismoSku ? 1 : Math.round(similitud(producto.name, texto(s.name)) * 100) / 100,
      }
    })
    .filter((s) => s.score >= UMBRAL_DUPLICADO)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, PIM_LIMITES.candidatos)
    .map((s, i) => ({ ref: `P${i + 1}`, ...s }))

  const numerosFuente = new Set<string>()
  const fuentes = [
    producto.name,
    producto.description ?? '',
    producto.brandName ?? '',
    producto.familyName ?? '',
    categoriaActual?.path ?? '',
    ...atributos.map((a) => a.current ?? ''),
  ]
  for (const f of fuentes) for (const n of numerosDe(f)) numerosFuente.add(n)

  return { producto, categoriaActual, categorias, atributos, candidatos, numerosFuente }
}

/** Atributos sin valor: determinista, lo calcula el sistema. */
export function atributosFaltantes(contexto: ContextoPim): AtributoContexto[] {
  return contexto.atributos.filter((a) => a.current === null)
}

/**
 * Las tareas que tiene sentido pedir con ESTOS datos. Sin categorías no hay
 * categoría que sugerir; sin candidatos no hay duplicado que juzgar. Si no
 * queda ninguna, no se llama al modelo ni se gasta cuota.
 */
export function tareasEfectivas(tareas: readonly PimTask[], contexto: ContextoPim): PimTask[] {
  return [...new Set(tareas)].filter((tarea) => {
    if (!contexto.producto.name) return false
    switch (tarea) {
      case 'category':
        return contexto.categorias.length > 0
      case 'attributes':
        return atributosFaltantes(contexto).length > 0
      case 'duplicates':
        return contexto.candidatos.length > 0
      default:
        return true
    }
  })
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const SISTEMA_PIM = [
  'Eres el asistente de ficha de producto del backoffice de una tienda (puede ser una',
  'botica o farmacia). Propones mejoras de la ficha; una persona las revisa y decide.',
  '',
  'Recibes los datos del producto y una lista de TAREAS. Rellena SOLO los campos de',
  'las tareas pedidas; los demas van vacios ("" o []).',
  '',
  'Campos:',
  '- title: titulo comercial claro (max 120). Solo con lo que dicen los datos.',
  '- short_description: una frase para la tarjeta (max 280).',
  '- description: descripcion completa (max 2000), prosa sin encabezados ni listas.',
  '- seo_title (max 70) y seo_description (max 160).',
  '- category.ref: la referencia (C1, C2...) de la categoria MAS adecuada de la lista',
  '  recibida, o "" si ninguna encaja. Nunca inventes una categoria.',
  '- attributes: solo para atributos SIN valor, con su referencia (A1...). En los de',
  '  lista, value es exactamente una de sus opciones. En los numericos, value es solo',
  '  el numero y tiene que aparecer en los datos. Si no se deduce de los datos, omitelo.',
  '- normalized_name: el mismo nombre con escritura limpia (mayusculas, espacios,',
  '  unidades como "500 mg"). No cambies, anadas ni quites palabras ni numeros. "" si ya',
  '  esta bien.',
  '- duplicates: referencias (P1...) de los candidatos que parecen el MISMO producto',
  '  (no uno parecido de otra concentracion o tamano), con el motivo.',
  '- tags: hasta 12 etiquetas o palabras clave cortas en minusculas.',
  '',
  'PROHIBIDO, sin excepcion:',
  '- precios, monedas, descuentos, ofertas, impuestos o datos tributarios;',
  '- stock, disponibilidad, SKU, codigos ERP, codigos de barras o cualquier identificador;',
  '- cualquier numero que no aparezca en los datos recibidos;',
  '- para que sirve, que trata, alivia, cura o previene; indicaciones, dosis, posologia,',
  '  modo de empleo o beneficios para la salud;',
  '- inventar caracteristicas que no esten en los datos.',
  '',
  'Si no puedes proponer algo sin inventar, dejalo vacio. Vacio es mejor que falso.',
].join('\n')

/** El turno de usuario: tareas e idioma (nuestros) + datos (no confiables). */
export function datosParaPim(
  contexto: ContextoPim,
  tareas: readonly PimTask[],
  locale: 'es' | 'en',
): string {
  const quiere = (t: PimTask) => tareas.includes(t)
  const faltantes = atributosFaltantes(contexto)
  const datos = {
    producto: {
      nombre: contexto.producto.name,
      descripcion_actual: contexto.producto.description ?? '(sin descripcion)',
      marca: contexto.producto.brandName ?? '(sin marca)',
      familia: contexto.producto.familyName ?? '(sin familia)',
      categoria_actual: contexto.categoriaActual?.path ?? '(sin categoria)',
      atributos_con_valor: contexto.atributos
        .filter((a) => a.current !== null)
        .map((a) => ({ nombre: a.name, valor: a.current, unidad: a.unit ?? undefined })),
    },
    categorias: quiere('category')
      ? contexto.categorias.map((c) => ({ ref: c.ref, ruta: c.path }))
      : undefined,
    atributos_sin_valor: quiere('attributes')
      ? faltantes.map((a) => ({
          ref: a.ref,
          nombre: a.name,
          tipo: a.dataType,
          unidad: a.unit ?? undefined,
          opciones: a.dataType === 'option' ? a.options.map((o) => o.label) : undefined,
        }))
      : undefined,
    candidatos_duplicado: quiere('duplicates')
      ? contexto.candidatos.map((c) => ({ ref: c.ref, nombre: c.name, marca: c.brandName ?? undefined }))
      : undefined,
  }
  return [
    `Tareas: ${tareas.join(', ')}`,
    `Idioma de los textos: ${locale === 'en' ? 'ingles' : 'espanol neutro'}`,
    delimitarDatos('ficha_pim', datosJson(datos)),
  ].join('\n')
}

const TEXTO_LIBRE = { type: 'string', maxLength: 4000 } as const
const REF = { type: 'string', maxLength: 8 } as const

export const ESQUEMA_PIM = {
  type: 'object',
  properties: {
    title: TEXTO_LIBRE,
    short_description: TEXTO_LIBRE,
    description: { type: 'string', maxLength: 6000 },
    seo_title: TEXTO_LIBRE,
    seo_description: TEXTO_LIBRE,
    normalized_name: TEXTO_LIBRE,
    category: {
      type: 'object',
      properties: { ref: REF, reason: TEXTO_LIBRE },
      required: ['ref', 'reason'],
      additionalProperties: false,
    },
    attributes: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        properties: { ref: REF, value: TEXTO_LIBRE, reason: TEXTO_LIBRE },
        required: ['ref', 'value', 'reason'],
        additionalProperties: false,
      },
    },
    duplicates: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: { ref: REF, reason: TEXTO_LIBRE },
        required: ['ref', 'reason'],
        additionalProperties: false,
      },
    },
    tags: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 200 } },
  },
  required: [
    'title',
    'short_description',
    'description',
    'seo_title',
    'seo_description',
    'normalized_name',
    'category',
    'attributes',
    'duplicates',
    'tags',
  ],
  additionalProperties: false,
} as const satisfies EsquemaIA

export interface RespuestaModeloPim {
  readonly title?: unknown
  readonly short_description?: unknown
  readonly description?: unknown
  readonly seo_title?: unknown
  readonly seo_description?: unknown
  readonly normalized_name?: unknown
  readonly category?: unknown
  readonly attributes?: unknown
  readonly duplicates?: unknown
  readonly tags?: unknown
}

// ---------------------------------------------------------------------------
// Revisión: lo que sale de aquí es lo único que ve una persona
// ---------------------------------------------------------------------------

/** Valor de atributo listo para `saveProductAttribute` (forma del front). */
export type ValorAtributoPropuesto =
  | { readonly kind: 'option'; readonly option_id: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly number: string }
  | { readonly kind: 'boolean'; readonly boolean: boolean }

export interface SugerenciasPim {
  readonly title: string | null
  readonly short_description: string | null
  readonly description: string | null
  readonly seo_title: string | null
  readonly seo_description: string | null
  readonly normalized_name: string | null
  readonly category: { readonly id: string; readonly path: string; readonly reason: string } | null
  readonly attributes: ReadonlyArray<{
    readonly attribute_id: string
    readonly name: string
    readonly display: string
    readonly value: ValorAtributoPropuesto
    readonly reason: string
  }>
  readonly duplicates: ReadonlyArray<{
    readonly product_id: string
    readonly sku: string
    readonly name: string
    readonly score: number
    readonly reason: string
  }>
  readonly tags: readonly string[]
  /** Propuestas descartadas por un candado (para la UI y la traza). */
  readonly discarded: number
}

export type RevisionPim =
  | { readonly ok: true; readonly value: SugerenciasPim }
  | { readonly ok: false; readonly motivo: 'vacia' | 'bloqueada' }

/** Limpia sin cambiar el sentido: sin etiquetas HTML, espacios colapsados. */
export function limpiarTexto(valor: unknown, conParrafos = false): string {
  if (typeof valor !== 'string') return ''
  const sinHtml = valor.replace(/<[^>]*>/g, ' ')
  if (!conParrafos) return sinHtml.replace(/\s+/g, ' ').trim()
  return sinHtml
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Recorta en el último espacio antes del límite: nunca media palabra. */
export function recortarEnPalabra(valor: string, max: number): string {
  if (valor.length <= max) return valor
  const corte = valor.slice(0, max + 1)
  const espacio = corte.lastIndexOf(' ')
  return (espacio > max * 0.6 ? corte.slice(0, espacio) : valor.slice(0, max)).replace(/[\s,;:.-]+$/, '')
}

interface Contador {
  descartadas: number
}

/**
 * ¿Se puede enseñar este texto? `null` si no hay texto o un candado lo tumba
 * (y entonces cuenta como descartado).
 */
function textoSeguro(
  valor: unknown,
  max: number,
  contexto: ContextoPim,
  contador: Contador,
  opciones: { parrafos?: boolean; min?: number } = {},
): string | null {
  const limpio = limpiarTexto(valor, opciones.parrafos)
  if (limpio.length < (opciones.min ?? 1)) return null
  if (
    tieneAfirmacionClinica(limpio) ||
    hablaDeDatosProhibidos(limpio) ||
    numerosNuevos(limpio, contexto.numerosFuente).length > 0 ||
    contieneSku(limpio, contexto.producto.sku)
  ) {
    contador.descartadas += 1
    return null
  }
  return recortarEnPalabra(limpio, max)
}

function contieneSku(texto: string, sku: string): boolean {
  const s = sku.trim()
  if (s.length < 3) return false
  return texto.toLowerCase().includes(s.toLowerCase())
}

/** El motivo es explicación, no propuesta: si no pasa, se queda en blanco. */
function razonSegura(valor: unknown, contexto: ContextoPim): string {
  const r = textoSeguro(valor, PIM_LIMITES.razon, contexto, { descartadas: 0 })
  return r ?? ''
}

function igualA(a: string, b: string | null): boolean {
  return b !== null && limpiarTexto(a).toLowerCase() === limpiarTexto(b).toLowerCase()
}

const BOOLEANOS: Readonly<Record<string, boolean>> = {
  si: true, true: true, yes: true, verdadero: true,
  no: false, false: false, falso: false,
}

function valorDeAtributo(
  atributo: AtributoContexto,
  crudo: string,
  contexto: ContextoPim,
): { value: ValorAtributoPropuesto; display: string } | null {
  const limpio = limpiarTexto(crudo)
  if (!limpio) return null
  switch (atributo.dataType) {
    case 'option': {
      const clave = claveComparable(limpio)
      const opcion = atributo.options.find((o) => claveComparable(o.label) === clave)
      return opcion ? { value: { kind: 'option', option_id: opcion.id }, display: opcion.label } : null
    }
    case 'number': {
      const numeros = numerosDe(limpio)
      if (numeros.length !== 1) return null
      const n = numeros[0] as string
      // El número tiene que estar en los datos: el modelo no mide nada.
      if (!contexto.numerosFuente.has(n)) return null
      return {
        value: { kind: 'number', number: n },
        display: atributo.unit ? `${n} ${atributo.unit}` : n,
      }
    }
    case 'boolean': {
      const b = BOOLEANOS[sinTildes(limpio.toLowerCase())]
      return b === undefined ? null : { value: { kind: 'boolean', boolean: b }, display: b ? 'si' : 'no' }
    }
    case 'text': {
      const t = textoSeguro(limpio, PIM_LIMITES.valorTexto, contexto, { descartadas: 0 })
      return t ? { value: { kind: 'text', text: t }, display: t } : null
    }
  }
}

function lista(valor: unknown): readonly unknown[] {
  return Array.isArray(valor) ? valor : []
}

function objeto(valor: unknown): Readonly<Record<string, unknown>> {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {}
}

/**
 * Revisa la respuesta del modelo contra el contexto. Descarta PROPUESTA a
 * propuesta (una etiqueta con precio no tumba la descripción) y devuelve solo
 * lo que se puede enseñar. Nada vacío y nada descartado ⇒ `vacia`; nada que
 * enseñar y algo descartado ⇒ `bloqueada`.
 */
export function revisarSugerencias(
  data: RespuestaModeloPim,
  contexto: ContextoPim,
  tareas: readonly PimTask[],
): RevisionPim {
  const quiere = (t: PimTask) => tareas.includes(t)
  const c: Contador = { descartadas: 0 }
  const L = PIM_LIMITES

  const title = quiere('title') ? textoSeguro(data.title, L.titulo, contexto, c, { min: 3 }) : null
  const short_description = quiere('short_description')
    ? textoSeguro(data.short_description, L.corta, contexto, c, { min: 10 })
    : null
  const description = quiere('description')
    ? textoSeguro(data.description, L.descripcion, contexto, c, { parrafos: true, min: 20 })
    : null
  const seo_title = quiere('seo') ? textoSeguro(data.seo_title, L.seoTitulo, contexto, c, { min: 3 }) : null
  const seo_description = quiere('seo')
    ? textoSeguro(data.seo_description, L.seoDescripcion, contexto, c, { min: 10 })
    : null

  // Normalización: solo si dice EXACTAMENTE lo mismo que el nombre actual.
  let normalized_name: string | null = null
  if (quiere('normalize')) {
    const propuesto = limpiarTexto(data.normalized_name).slice(0, L.nombre)
    if (propuesto && propuesto !== contexto.producto.name) {
      if (claveComparable(propuesto) === claveComparable(contexto.producto.name)) {
        normalized_name = propuesto
      } else {
        c.descartadas += 1
      }
    }
  }

  // Categoría: referencia de la lista cerrada y distinta de la actual.
  let category: SugerenciasPim['category'] = null
  if (quiere('category')) {
    const crudo = objeto(data.category)
    const ref = limpiarTexto(crudo.ref).toUpperCase()
    if (ref) {
      const cat = contexto.categorias.find((x) => x.ref === ref)
      if (!cat) c.descartadas += 1
      else if (cat.id !== contexto.categoriaActual?.id) {
        category = { id: cat.id, path: cat.path, reason: razonSegura(crudo.reason, contexto) }
      }
    }
  }

  // Atributos: solo faltantes, uno por atributo, valor válido para su tipo.
  const attributes: Array<SugerenciasPim['attributes'][number]> = []
  if (quiere('attributes')) {
    const faltantes = new Map(atributosFaltantes(contexto).map((a) => [a.ref, a]))
    const vistos = new Set<string>()
    for (const item of lista(data.attributes)) {
      const crudo = objeto(item)
      const ref = limpiarTexto(crudo.ref).toUpperCase()
      if (!ref || vistos.has(ref)) continue
      vistos.add(ref)
      const atributo = faltantes.get(ref)
      const valor = atributo ? valorDeAtributo(atributo, String(crudo.value ?? ''), contexto) : null
      if (!atributo || !valor) {
        c.descartadas += 1
        continue
      }
      attributes.push({
        attribute_id: atributo.id,
        name: atributo.name,
        display: valor.display,
        value: valor.value,
        reason: razonSegura(crudo.reason, contexto),
      })
    }
  }

  // Duplicados: solo candidatos que el sistema ya había encontrado.
  const duplicates: Array<SugerenciasPim['duplicates'][number]> = []
  if (quiere('duplicates')) {
    const porRef = new Map(contexto.candidatos.map((x) => [x.ref, x]))
    const vistos = new Set<string>()
    for (const item of lista(data.duplicates)) {
      const crudo = objeto(item)
      const ref = limpiarTexto(crudo.ref).toUpperCase()
      if (!ref || vistos.has(ref)) continue
      vistos.add(ref)
      const cand = porRef.get(ref)
      if (!cand) {
        c.descartadas += 1
        continue
      }
      duplicates.push({
        product_id: cand.id,
        sku: cand.sku,
        name: cand.name,
        score: cand.score,
        reason: razonSegura(crudo.reason, contexto),
      })
    }
  }

  // Etiquetas: cortas, en minúsculas, sin repetir y con los mismos candados.
  const tags: string[] = []
  if (quiere('tags')) {
    const vistas = new Set<string>()
    for (const item of lista(data.tags)) {
      const t = textoSeguro(item, L.tag, contexto, c, { min: 2 })?.toLowerCase().replace(/^#/, '')
      if (!t || t.length > L.tag) continue
      const clave = claveComparable(t)
      if (!clave || vistas.has(clave)) continue
      vistas.add(clave)
      tags.push(t)
      if (tags.length >= L.tags) break
    }
  }

  const value: SugerenciasPim = {
    title: title && !igualA(title, contexto.producto.name) ? title : null,
    short_description,
    description: description && !igualA(description, contexto.producto.description) ? description : null,
    seo_title,
    seo_description,
    normalized_name,
    category,
    attributes,
    duplicates,
    tags,
    discarded: c.descartadas,
  }

  const hayAlgo =
    value.title !== null ||
    value.short_description !== null ||
    value.description !== null ||
    value.seo_title !== null ||
    value.seo_description !== null ||
    value.normalized_name !== null ||
    value.category !== null ||
    value.attributes.length > 0 ||
    value.duplicates.length > 0 ||
    value.tags.length > 0

  if (!hayAlgo) return { ok: false, motivo: c.descartadas > 0 ? 'bloqueada' : 'vacia' }
  return { ok: true, value }
}

/** Lo determinista que viaja siempre al front, haya IA o no. */
export function sistemaParaFront(contexto: ContextoPim, tareas: readonly PimTask[]) {
  return {
    tasks: tareas,
    missing_attributes: atributosFaltantes(contexto).map((a) => ({ id: a.id, name: a.name })),
    duplicate_candidates: contexto.candidatos.map((c) => ({
      product_id: c.id,
      sku: c.sku,
      name: c.name,
      score: c.score,
    })),
  }
}

/** Resumen corto para la traza (la base además recorta y redacta). */
export function resumenParaTraza(s: SugerenciasPim): string {
  const partes = [
    s.title && `titulo: ${s.title}`,
    s.short_description && `corta: ${s.short_description}`,
    s.category && `categoria: ${s.category.path}`,
    s.attributes.length > 0 && `atributos: ${s.attributes.length}`,
    s.duplicates.length > 0 && `duplicados: ${s.duplicates.length}`,
    s.tags.length > 0 && `tags: ${s.tags.join(', ')}`,
  ].filter(Boolean)
  return partes.join(' | ').slice(0, 500)
}
