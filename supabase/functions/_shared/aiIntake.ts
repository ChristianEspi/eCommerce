/**
 * Pedido desde foto, PDF o texto libre (2026-11-19). TypeScript PURO.
 *
 * ## El reparto, que es lo que hace que esto se pueda vender
 *
 *  · **El modelo LEE.** De una foto de una lista escrita a mano, de una orden de
 *    compra en PDF o de «mándame 3 cajas de donecil y un doxiplus» saca líneas
 *    `{texto, cantidad, unidad, sku}`. Nada más: ni elige productos, ni pone
 *    precios, ni decide si se puede comprar.
 *  · **El catálogo DECIDE qué producto es.** Cada línea se busca con el mismo
 *    buscador de la vitrina (`catalog_search_for_slug`). Lo que el buscador no
 *    devuelve no existe para esta función, así que el modelo no puede «encontrar»
 *    un artículo que la tienda no vende.
 *  · **El carrito de siempre hace el resto.** Las líneas que la persona acepta
 *    pasan al pedido rápido (SKU + cantidad) y de ahí al carrito: precio
 *    convenio, surtido, existencia, crédito y aprobación los aplica el servidor
 *    como en cualquier otro pedido.
 *
 * La persona revisa SIEMPRE antes de añadir: la confianza de cada línea se
 * enseña, y lo dudoso no se marca por defecto.
 */
import type { EsquemaIA } from './aiCore.ts'

export const INTAKE_MAX_LINEAS = 60
export const INTAKE_MAX_TEXTO = 4000
export const INTAKE_MAX_CANTIDAD = 9999
export const INTAKE_ALTERNATIVAS = 3

export const SISTEMA_INTAKE = [
  'Eres el lector de pedidos de una tienda online. Recibes una foto, un PDF o un texto con lo que un cliente quiere comprar.',
  'Tu único trabajo es TRANSCRIBIR las líneas del pedido. No recomiendas, no completas, no corriges marcas ni inventas productos.',
  '',
  'Por cada producto pedido devuelve una línea con:',
  '- texto: el producto tal como está escrito (nombre, presentación, concentración). Sin la cantidad. Máximo 120 caracteres.',
  '- cantidad: entero positivo. Si no se indica, 1 y cantidad_supuesta = true.',
  '- unidad: la unidad que se pide si aparece (caja, unidad, blíster, frasco, paquete, docena…); si no aparece, cadena vacía.',
  '- sku: SOLO si en el documento aparece un código de producto junto a esa línea (código interno, SKU o código de barras). Si no, cadena vacía. Nunca lo deduzcas del nombre.',
  '- legible: false si no estás seguro de lo que dice (letra dudosa, imagen borrosa, texto cortado).',
  '',
  'Reglas:',
  '- Ignora precios, importes, totales, impuestos, fechas, firmas y sellos: no son líneas del pedido.',
  '- No copies datos personales (nombres de personas, documentos de identidad, RUC, direcciones, teléfonos, correos). No forman parte de ninguna línea.',
  '- Una docena son 12 unidades solo si el cliente lo pide así; si pide «1 docena», devuelve cantidad 1 y unidad «docena».',
  '- Si el contenido no es una lista de productos para comprar, devuelve lineas vacía y es_pedido = false.',
  `- Como máximo ${INTAKE_MAX_LINEAS} líneas.`,
  '- notas: una frase corta en el idioma pedido si hay algo que el cliente deba revisar (líneas ilegibles, cantidades no indicadas). Si no, cadena vacía. Sin cifras.',
].join('\n')

export const ESQUEMA_INTAKE = {
  type: 'object',
  properties: {
    es_pedido: { type: 'boolean' },
    lineas: {
      type: 'array',
      maxItems: INTAKE_MAX_LINEAS,
      items: {
        type: 'object',
        properties: {
          texto: { type: 'string', maxLength: 160 },
          cantidad: { type: 'integer', minimum: 1, maximum: INTAKE_MAX_CANTIDAD },
          cantidad_supuesta: { type: 'boolean' },
          unidad: { type: 'string', maxLength: 30 },
          sku: { type: 'string', maxLength: 80 },
          legible: { type: 'boolean' },
        },
        required: ['texto', 'cantidad', 'cantidad_supuesta', 'unidad', 'sku', 'legible'],
        additionalProperties: false,
      },
    },
    notas: { type: 'string', maxLength: 300 },
  },
  required: ['es_pedido', 'lineas', 'notas'],
  additionalProperties: false,
} as const satisfies EsquemaIA

export interface LineaModelo {
  texto: string
  cantidad: number
  cantidad_supuesta: boolean
  unidad: string
  sku: string
  legible: boolean
}

export interface RespuestaModeloIntake {
  es_pedido: boolean
  lineas: LineaModelo[]
  notas: string
}

export interface LineaLeida {
  readonly texto: string
  readonly cantidad: number
  readonly cantidadSupuesta: boolean
  readonly unidad: string | null
  readonly sku: string | null
  readonly legible: boolean
}

export interface LecturaRevisada {
  readonly lineas: readonly LineaLeida[]
  readonly notas: string | null
}

const SKU = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/
const CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/g
// Nueve o más dígitos seguidos (teléfono, RUC, DNI con prefijo): fuera.
const NUMERO_LARGO = /\+?\d[\d\s-]{8,}\d/g

/** El texto de una línea, sin contacto ni documentos y en un solo renglón. */
export function limpiarTexto(texto: string): string {
  return texto
    .replace(CORREO, ' ')
    .replace(NUMERO_LARGO, ' ')
    // Saltos, tabuladores y demás caracteres de control: un solo renglón.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function limpiarSku(sku: string): string | null {
  const s = sku.trim()
  return SKU.test(s) ? s : null
}

/**
 * Lo que el modelo devolvió, ya con forma (el transporte validó el esquema),
 * pasado por las reglas de dominio:
 *
 *  · líneas sin texto útil fuera; cantidades enteras dentro de rango;
 *  · un SKU con forma rara se descarta (la línea queda, sin código);
 *  · la misma línea dos veces (mismo texto y mismo SKU) se fusiona SUMANDO,
 *    porque en una lista escrita a mano repetir es pedir más, no un error;
 *  · `es_pedido = false` o cero líneas útiles ⇒ `vacia` (no hay nada que
 *    revisar, pero la cuota ya se gastó y la traza lo dice).
 *
 * Las notas no pueden traer dígitos: las cantidades las enseña la tabla, que
 * sale de las líneas revisadas, no de una frase del modelo.
 */
export function revisarIntake(
  data: RespuestaModeloIntake,
): { ok: true; value: LecturaRevisada } | { ok: false; motivo: 'vacia' } {
  if (!data.es_pedido) return { ok: false, motivo: 'vacia' }

  const fusion = new Map<string, LineaLeida>()
  for (const cruda of data.lineas.slice(0, INTAKE_MAX_LINEAS)) {
    const texto = limpiarTexto(String(cruda.texto ?? ''))
    const sku = limpiarSku(String(cruda.sku ?? ''))
    if (texto.length < 2 && !sku) continue
    const cantidad = Math.trunc(Number(cruda.cantidad))
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > INTAKE_MAX_CANTIDAD) continue
    const unidad = limpiarTexto(String(cruda.unidad ?? '')).slice(0, 30) || null

    const clave = `${texto.toLowerCase()}|${(sku ?? '').toLowerCase()}|${(unidad ?? '').toLowerCase()}`
    const previa = fusion.get(clave)
    if (previa) {
      fusion.set(clave, {
        ...previa,
        cantidad: Math.min(INTAKE_MAX_CANTIDAD, previa.cantidad + cantidad),
        cantidadSupuesta: previa.cantidadSupuesta && Boolean(cruda.cantidad_supuesta),
        legible: previa.legible && Boolean(cruda.legible),
      })
      continue
    }
    fusion.set(clave, {
      texto: texto || (sku ?? ''),
      cantidad,
      cantidadSupuesta: Boolean(cruda.cantidad_supuesta),
      unidad,
      sku,
      legible: Boolean(cruda.legible),
    })
  }

  const lineas = [...fusion.values()]
  if (lineas.length === 0) return { ok: false, motivo: 'vacia' }

  const notas = limpiarTexto(String(data.notas ?? '')).replace(/\d/g, '').replace(/\s+/g, ' ').trim()
  return { ok: true, value: { lineas, notas: notas.length >= 3 ? notas.slice(0, 300) : null } }
}

// ---------------------------------------------------------------------------
// De la línea leída al producto: SIN modelo
// ---------------------------------------------------------------------------

/** Un resultado del buscador de la vitrina, con lo que hace falta aquí. */
export interface HitCatalogo {
  readonly product_id: string
  readonly slug: string
  readonly name: string
  readonly sku: string | null
  readonly kind: 'simple' | 'variant' | 'bundle'
  readonly brand_name: string | null
  readonly in_stock: boolean
}

export interface ResultadoBusqueda {
  readonly mode: 'fts' | 'fuzzy' | 'browse' | 'empty'
  readonly items: readonly HitCatalogo[]
}

/**
 * Qué tan seguro es que la línea es ese producto. Se enseña tal cual:
 *
 *  · `codigo`   — el documento traía un SKU de la tienda; el pedido rápido lo
 *                 confirma o lo rechaza con su motivo.
 *  · `probable` — el buscador encontró el texto (coincidencia real).
 *  · `dudosa`   — solo hubo parecido (trigramas) o la letra era ilegible.
 *  · `variante` — el producto tiene variantes: hay que elegir cuál.
 *  · `ninguna`  — el catálogo no tiene nada parecido.
 */
export type Confianza = 'codigo' | 'probable' | 'dudosa' | 'variante' | 'ninguna'

export interface ProductoPropuesto {
  readonly product_id: string
  readonly slug: string
  readonly name: string
  readonly sku: string | null
  readonly kind: HitCatalogo['kind']
  readonly brand_name: string | null
  readonly in_stock: boolean
}

export interface LineaPropuesta {
  readonly indice: number
  readonly texto: string
  readonly cantidad: number
  readonly cantidad_supuesta: boolean
  readonly unidad: string | null
  readonly sku_leido: string | null
  readonly legible: boolean
  readonly confianza: Confianza
  /** El SKU que irá al pedido rápido si la persona acepta. `null` = elegir. */
  readonly sku_propuesto: string | null
  readonly coincidencia: ProductoPropuesto | null
  readonly alternativas: readonly ProductoPropuesto[]
}

function aPropuesto(hit: HitCatalogo): ProductoPropuesto {
  return {
    product_id: hit.product_id,
    slug: hit.slug,
    name: hit.name,
    sku: hit.sku,
    kind: hit.kind,
    brand_name: hit.brand_name,
    in_stock: hit.in_stock,
  }
}

/** La consulta al buscador: el texto leído, sin cantidades ni unidades sueltas. */
export function consultaDeLinea(linea: LineaLeida): string {
  return linea.texto
    .replace(/\b\d+\s*(x|unid(?:ades)?|uds?|cajas?|cjs?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * Decide la propuesta de una línea con lo que devolvió el buscador. Pura y
 * determinista: misma línea y mismos resultados, misma propuesta.
 */
export function proponerLinea(indice: number, linea: LineaLeida, busqueda: ResultadoBusqueda): LineaPropuesta {
  const items = busqueda.items.filter((hit) => hit.kind !== 'bundle' || hit.sku)
  const base = {
    indice,
    texto: linea.texto,
    cantidad: linea.cantidad,
    cantidad_supuesta: linea.cantidadSupuesta,
    unidad: linea.unidad,
    sku_leido: linea.sku,
    legible: linea.legible,
  }

  // 1 · El documento traía un código que coincide con un resultado: es ese.
  if (linea.sku) {
    const exacto = items.find((hit) => hit.sku && hit.sku.toLowerCase() === linea.sku!.toLowerCase())
    const alternativas = items.filter((hit) => hit !== exacto).slice(0, INTAKE_ALTERNATIVAS).map(aPropuesto)
    // Con o sin resultado del buscador, el código leído va al pedido rápido:
    // allí se valida contra la tienda (SKU no publicado, surtido…) con su motivo.
    return {
      ...base,
      confianza: 'codigo',
      sku_propuesto: exacto?.sku ?? linea.sku,
      coincidencia: exacto ? aPropuesto(exacto) : null,
      alternativas,
    }
  }

  if (items.length === 0 || busqueda.mode === 'empty' || busqueda.mode === 'browse') {
    return { ...base, confianza: 'ninguna', sku_propuesto: null, coincidencia: null, alternativas: [] }
  }

  const [primero, ...resto] = items as [HitCatalogo, ...HitCatalogo[]]
  const alternativas = resto.slice(0, INTAKE_ALTERNATIVAS).map(aPropuesto)

  // 2 · Producto con variantes: el SKU del maestro no se compra; hay que elegir.
  if (primero.kind === 'variant' || !primero.sku) {
    return { ...base, confianza: 'variante', sku_propuesto: null, coincidencia: aPropuesto(primero), alternativas }
  }

  // 3 · Coincidencia de texto real y letra legible: probable. Si no, dudosa.
  const confianza: Confianza = busqueda.mode === 'fts' && linea.legible ? 'probable' : 'dudosa'
  return { ...base, confianza, sku_propuesto: primero.sku, coincidencia: aPropuesto(primero), alternativas }
}

/** Lo que se guarda en la traza: cuántas líneas y de qué confianza. Sin texto. */
export function resumenIntake(lineas: readonly LineaPropuesta[]): string {
  const cuenta = new Map<Confianza, number>()
  for (const l of lineas) cuenta.set(l.confianza, (cuenta.get(l.confianza) ?? 0) + 1)
  return `${lineas.length} líneas · ${[...cuenta].map(([c, n]) => `${c}=${n}`).join(' ')}`
}
