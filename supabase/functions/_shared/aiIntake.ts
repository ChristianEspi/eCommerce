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

/** Una presentación (variante) elegible en la misma fila de la revisión. */
export interface Presentacion {
  readonly variant_id: string
  readonly sku: string
  readonly name: string
}

/** Tope de presentaciones por producto en la revisión. */
export const INTAKE_MAX_PRESENTACIONES = 20

export interface FilaVariante {
  readonly id: string
  readonly product_id: string
  readonly sku: string | null
  readonly name: string | null
}

/**
 * Las variantes activas agrupadas por producto, en el orden recibido. Una
 * variante sin SKU no se puede pedir por el pedido rápido y se omite.
 */
export function agruparPresentaciones(filas: readonly FilaVariante[]): Map<string, Presentacion[]> {
  const porProducto = new Map<string, Presentacion[]>()
  for (const fila of filas) {
    const sku = fila.sku?.trim()
    if (!sku) continue
    const lista = porProducto.get(fila.product_id) ?? []
    if (lista.length >= INTAKE_MAX_PRESENTACIONES) continue
    lista.push({ variant_id: fila.id, sku: sku.slice(0, 64), name: (fila.name ?? sku).slice(0, 80) })
    porProducto.set(fila.product_id, lista)
  }
  return porProducto
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
export function proponerLinea(
  indice: number,
  linea: LineaLeida,
  busqueda: ResultadoBusqueda,
  /**
   * 2026-11-22 · En la cotización de OTRO proveedor el código impreso es el
   * SUYO, no un SKU de esta tienda. Solo vale si coincide con uno nuestro; si
   * no, la línea se resuelve por su texto como cualquier otra. Antes salía
   * marcada con «No encontramos este producto en la tienda».
   */
  opciones: { codigoAjeno?: boolean } = {},
): LineaPropuesta {
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
  const exacto = linea.sku
    ? items.find((hit) => hit.sku && hit.sku.toLowerCase() === linea.sku!.toLowerCase())
    : undefined
  if (linea.sku && (!opciones.codigoAjeno || exacto)) {
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

// ---------------------------------------------------------------------------
// «Mejora esta cotización» (2026-11-20)
// ---------------------------------------------------------------------------
//
// El comprador sube la cotización de OTRO proveedor. El modelo hace lo mismo
// que con un pedido —transcribir líneas— y además copia el PRECIO UNITARIO que
// esa cotización pone a cada línea, la moneda y si los precios llevan IGV.
//
// Lo que NO hace: decir cuánto cuesta en esta tienda. Ese precio lo calcula el
// servidor de precios con la sesión del comprador (lista, convenio, escala),
// igual que el carrito. El modelo no ve un solo precio propio, así que no puede
// «mejorar» nada por su cuenta: solo lee lo que trae el papel.

export const COTIZACION_MAX_PRECIO = 1_000_000

export const SISTEMA_COTIZACION = [
  'Eres el lector de cotizaciones de una tienda online. Recibes una foto, un PDF o un texto con la cotización que OTRO proveedor le hizo a un cliente.',
  'Tu único trabajo es TRANSCRIBIR sus líneas tal como están. No comparas, no recomiendas, no corriges, no calculas y no inventas productos ni precios.',
  '',
  'Por cada producto cotizado devuelve una línea con:',
  '- texto: el producto tal como está escrito (nombre, presentación, concentración). Sin cantidad ni precio. Máximo 120 caracteres.',
  '- cantidad: entero positivo cotizado. Si no se indica, 1 y cantidad_supuesta = true.',
  '- unidad: la unidad de venta si aparece (caja, unidad, frasco, galón, paquete…); si no, cadena vacía.',
  '- sku: SOLO si junto a esa línea aparece un código de producto. Si no, cadena vacía. Nunca lo deduzcas.',
  '- precio_unitario: el precio por UNA unidad de esa línea, tal como figura. Si solo aparece el importe de la línea, divídelo entre la cantidad. Si no aparece ningún precio, 0 y precio_leido = false.',
  '- precio_leido: true solo si el precio está escrito y lo lees con claridad.',
  '- legible: false si no estás seguro de lo que dice la línea.',
  '',
  'De la cotización completa:',
  '- moneda: «PEN» si los precios están en soles (S/), «USD» si están en dólares (US$, $), «otra» si es otra moneda, cadena vacía si no se ve.',
  '- incluye_igv: «si» si los precios unitarios ya incluyen IGV o impuestos, «no» si el IGV se suma aparte (por ejemplo una fila «IGV 18%» sobre un subtotal), «desconocido» si no se puede saber.',
  '',
  'Reglas:',
  '- Subtotales, totales, IGV, descuentos globales, fletes, fechas, condiciones de pago, firmas y sellos NO son líneas.',
  '- No copies datos personales ni de empresas (nombres, RUC, DNI, direcciones, teléfonos, correos, cuentas bancarias).',
  '- Si el contenido no es una cotización ni una lista de productos con precios, devuelve lineas vacía y es_cotizacion = false.',
  `- Como máximo ${INTAKE_MAX_LINEAS} líneas.`,
  '- notas: una frase corta en el idioma pedido si hay algo que el cliente deba revisar (precios ilegibles, unidades raras). Si no, cadena vacía. Sin cifras.',
].join('\n')

export const ESQUEMA_COTIZACION = {
  type: 'object',
  properties: {
    es_cotizacion: { type: 'boolean' },
    moneda: { type: 'string', enum: ['PEN', 'USD', 'otra', ''] },
    incluye_igv: { type: 'string', enum: ['si', 'no', 'desconocido'] },
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
          precio_unitario: { type: 'number', minimum: 0, maximum: COTIZACION_MAX_PRECIO },
          precio_leido: { type: 'boolean' },
          legible: { type: 'boolean' },
        },
        required: ['texto', 'cantidad', 'cantidad_supuesta', 'unidad', 'sku', 'precio_unitario', 'precio_leido', 'legible'],
        additionalProperties: false,
      },
    },
    notas: { type: 'string', maxLength: 300 },
  },
  required: ['es_cotizacion', 'moneda', 'incluye_igv', 'lineas', 'notas'],
  additionalProperties: false,
} as const satisfies EsquemaIA

export interface LineaModeloCotizacion extends LineaModelo {
  precio_unitario: number
  precio_leido: boolean
}

export interface RespuestaModeloCotizacion {
  es_cotizacion: boolean
  moneda: 'PEN' | 'USD' | 'otra' | ''
  incluye_igv: 'si' | 'no' | 'desconocido'
  lineas: LineaModeloCotizacion[]
  notas: string
}

export interface LineaLeidaCotizacion extends LineaLeida {
  /** Precio unitario de la OTRA cotización; `null` si no se leyó con claridad. */
  readonly precio: number | null
}

export interface CotizacionRevisada {
  readonly lineas: readonly LineaLeidaCotizacion[]
  readonly notas: string | null
  /** `null` = no se vio o no es soles ni dólares: no se puede comparar. */
  readonly moneda: 'PEN' | 'USD' | null
  /** `null` = no se sabe; la pantalla deja elegir. */
  readonly incluyeIgv: boolean | null
}

/** Precio con forma: positivo, en rango y con 4 decimales como mucho. */
export function limpiarPrecio(valor: unknown, leido: unknown): number | null {
  if (leido !== true) return null
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0 || n > COTIZACION_MAX_PRECIO) return null
  return Math.round(n * 10_000) / 10_000
}

/**
 * La cotización del modelo, pasada por las reglas de dominio. Igual que el
 * pedido salvo en una cosa: las líneas repetidas NO se fusionan, porque en una
 * cotización la misma descripción con dos precios son dos ofertas distintas.
 */
export function revisarCotizacion(
  data: RespuestaModeloCotizacion,
): { ok: true; value: CotizacionRevisada } | { ok: false; motivo: 'vacia' } {
  if (!data.es_cotizacion) return { ok: false, motivo: 'vacia' }

  const lineas: LineaLeidaCotizacion[] = []
  for (const cruda of data.lineas.slice(0, INTAKE_MAX_LINEAS)) {
    const texto = limpiarTexto(String(cruda.texto ?? ''))
    const sku = limpiarSku(String(cruda.sku ?? ''))
    if (texto.length < 2 && !sku) continue
    const cantidad = Math.trunc(Number(cruda.cantidad))
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > INTAKE_MAX_CANTIDAD) continue
    lineas.push({
      texto: texto || (sku ?? ''),
      cantidad,
      cantidadSupuesta: Boolean(cruda.cantidad_supuesta),
      unidad: limpiarTexto(String(cruda.unidad ?? '')).slice(0, 30) || null,
      sku,
      legible: Boolean(cruda.legible),
      precio: limpiarPrecio(cruda.precio_unitario, cruda.precio_leido),
    })
  }
  if (lineas.length === 0) return { ok: false, motivo: 'vacia' }

  const notas = limpiarTexto(String(data.notas ?? '')).replace(/\d/g, '').replace(/\s+/g, ' ').trim()
  return {
    ok: true,
    value: {
      lineas,
      notas: notas.length >= 3 ? notas.slice(0, 300) : null,
      moneda: data.moneda === 'PEN' || data.moneda === 'USD' ? data.moneda : null,
      incluyeIgv: data.incluye_igv === 'si' ? true : data.incluye_igv === 'no' ? false : null,
    },
  }
}
