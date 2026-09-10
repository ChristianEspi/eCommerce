/**
 * El contrato de las llamadas a IA. TypeScript PURO, sin proveedor.
 *
 * Vive en `_shared` y no en `_runtime` por la misma razón que el resto: aquí no
 * hay ni un especificador `npm:`, así que el `tsc` del repo y los tests lo
 * compilan y lo ejercitan. El transporte —el SDK de Anthropic— está en
 * `_runtime/anthropic.ts`, que solo tiene sentido dentro de Deno.
 *
 * La separación no es prolijidad: lo que de verdad hay que vigilar de una
 * llamada a un modelo no es cómo viaja, es **qué se le deja devolver**. Eso es
 * lo que está aquí y por eso se puede probar sin red y sin clave.
 *
 * ## Las tres reglas, escritas una sola vez
 *
 * 1. **Lista cerrada.** El modelo elige DENTRO de lo que ya devolvió la base.
 *    Si inventa un identificador, se cae en `filtrarPermitidos` y no llega al
 *    navegador. Las salidas estructuradas garantizan la FORMA, nunca la verdad:
 *    un uuid bien formado puede seguir sin existir.
 * 2. **El modelo no emite dinero.** Se devuelven identificadores; el precio y
 *    el stock los resuelve quien pinta, contra el catálogo.
 * 3. **Se degrada, no se rompe.** Sin clave, con el proveedor caído o con una
 *    respuesta ilegible, quien llama se queda con lo que ya tenía. Una tienda
 *    cuyo buscador se cae porque expiró una clave de IA es peor que una tienda
 *    sin IA.
 */

/**
 * El modelo por defecto.
 *
 * SIN sufijo de fecha: los identificadores actuales son `claude-haiku-4-5`, y
 * `claude-haiku-4-5-20251001` —lo que había escrito antes aquí y lo que sigue
 * escrito en cinco funciones de GMAO— no es un identificador válido.
 *
 * Haiku y no Opus para el asistente de vitrina, y es una decisión deliberada:
 * elige entre ocho candidatos de una lista cerrada y responde en dos frases con
 * el comprador esperando. Ahí la latencia pesa más que la profundidad. Para lo
 * que exige criterio —redactar el motivo de un sugerido, agrupar incidentes—
 * quien llama pasa su propio modelo.
 */
export const AI_DEFAULT_MODEL = 'claude-haiku-4-5'

/** Si el proveedor no contesta en este tiempo, se responde sin él. */
export const AI_DEFAULT_TIMEOUT_MS = 9000

/** Cómo salió la llamada. Es lo que se guarda en la traza. */
export type AiStatus = 'ai' | 'search' | 'blocked' | 'error'

/** Lo que costó, tal y como lo reporta el proveedor. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export const AI_USAGE_CERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

/**
 * Normaliza el `usage` de la respuesta.
 *
 * Defensivo a propósito: este objeto acaba sumándose a un contador de cobro, y
 * un `NaN` colado ahí envenena el total del mes sin que nadie lo note hasta que
 * el número deja de tener sentido.
 */
export function normalizarUso(raw: unknown): AiUsage {
  const fuente = (raw ?? {}) as Record<string, unknown>
  return {
    inputTokens: enteroNoNegativo(fuente.input_tokens),
    outputTokens: enteroNoNegativo(fuente.output_tokens),
    cacheReadTokens: enteroNoNegativo(fuente.cache_read_input_tokens),
  }
}

function enteroNoNegativo(valor: unknown): number {
  const numero = typeof valor === 'number' ? valor : Number(valor)
  if (!Number.isFinite(numero) || numero < 0) return 0
  return Math.floor(numero)
}

/**
 * La barrera: lo que no estaba en la lista no sale de aquí.
 *
 * Se mantiene AUNQUE la respuesta venga con salidas estructuradas. El esquema
 * obliga a que `ids` sea un array de cadenas; no puede obligar a que esas
 * cadenas nombren algo que existe. Quitar este filtro al migrar al SDK es el
 * error fácil, y el que deja recomendar un producto que la tienda no vende.
 *
 * Preserva el ORDEN del modelo: es su respuesta a «qué encaja mejor», y
 * reordenarla por el orden del catálogo tira justo lo que aportó.
 */
export function filtrarPermitidos(
  ids: unknown,
  permitidos: ReadonlySet<string>,
  maximo = 4,
): string[] {
  if (!Array.isArray(ids)) return []
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    if (!permitidos.has(id)) continue
    if (vistos.has(id)) continue
    vistos.add(id)
    salida.push(id)
    if (salida.length >= maximo) break
  }
  return salida
}

/**
 * Recorta el texto del modelo antes de que llegue a una pantalla.
 *
 * `max_tokens` acota lo que se paga, no lo que se pinta: una respuesta que se
 * fue de largo rompe la maqueta del panel. El corte es duro y sin puntos
 * suspensivos porque el texto ya es una respuesta cerrada, no un extracto.
 */
export function recortarRespuesta(texto: unknown, maximo = 600): string {
  if (typeof texto !== 'string') return ''
  const limpio = texto.trim()
  return limpio.length > maximo ? limpio.slice(0, maximo) : limpio
}

/**
 * El esquema de la respuesta del asistente de compra.
 *
 * Esto es lo que sustituye al apaño de recortar entre la primera llave y la
 * última y hacer `JSON.parse`. Aquel truco fallaba en silencio cada vez que el
 * modelo envolvía el JSON en prosa o en un bloque de código: la función
 * devolvía `null`, el asistente caía a modo búsqueda y desde fuera parecía que
 * no había IA. La había, y se perdía.
 */
export const ESQUEMA_SUGERENCIA = {
  type: 'object' as const,
  properties: {
    reply: { type: 'string' as const, description: 'Dos frases como máximo, en español.' },
    ids: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Entre 1 y 4 identificadores, exclusivamente de la lista dada.',
    },
  },
  required: ['reply', 'ids'],
  additionalProperties: false,
}

/**
 * Un candidato tal y como se le enseña al modelo.
 *
 * El precio entra como TEXTO y solo para que pueda ordenar y comparar. Lo que
 * devuelva no se usa para pintar ningún importe.
 */
export interface CandidatoIA {
  product_id: string
  name: string
  brand_name?: string | null
  category_name?: string | null
  price?: string | null
  currency?: string | null
  in_stock?: boolean
}

/** La lista numerada que ve el modelo. Una línea por candidato, sin adornos. */
export function listarCandidatos(candidatos: readonly CandidatoIA[]): string {
  return candidatos
    .map(
      (c, i) =>
        `${i + 1}. id=${c.product_id} · ${c.name}` +
        (c.brand_name ? ` · ${c.brand_name}` : '') +
        (c.category_name ? ` · ${c.category_name}` : '') +
        (c.price ? ` · ${c.currency ?? ''} ${c.price}` : '') +
        (c.in_stock ? ' · con stock' : ' · sin stock'),
    )
    .join('\n')
}

/**
 * Las instrucciones del asistente de compra.
 *
 * Constante y no plantilla: es el prefijo estable de la petición, y la caché de
 * prompt funciona por coincidencia de prefijo. Meter aquí dentro algo que
 * cambie en cada llamada —la consulta, una marca de tiempo— invalidaría la
 * caché entera sin que ningún error lo diga.
 */
export const SISTEMA_ASISTENTE = [
  'Eres el asistente de compra de una tienda. Respondes en español, en dos frases como máximo.',
  'Elige entre 1 y 4 productos EXCLUSIVAMENTE de la lista que se te da.',
  'No inventes productos, precios, stock ni envíos. No prometas plazos ni descuentos.',
  'Si nada encaja, dilo y deja la lista de identificadores vacía.',
].join(' ')
