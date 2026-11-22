/**
 * Búsqueda por intención (2026-11-19). TypeScript PURO.
 *
 * ## El problema
 *
 * El buscador de la vitrina es de texto completo: exige que casen las palabras.
 * «Algo para la tos de mi hijo», «el genérico del Donecil» o «lo que se pone en
 * la piel quemada por el sol» no casan con ningún nombre de producto, y la
 * tienda contesta «no hay» teniendo el producto en el anaquel.
 *
 * ## La respuesta, sin proveedor nuevo
 *
 * Cuando la búsqueda determinista no encuentra nada (o solo parecidos por
 * letras), el modelo REESCRIBE la necesidad en hasta cuatro términos de
 * catálogo —tipo de producto, categoría, principio activo, sinónimos— y el MISMO
 * buscador los resuelve. El modelo no ve el catálogo en este paso y no elige
 * productos: solo propone qué buscar. Lo que el buscador no devuelve no existe.
 *
 * Es la versión sin vectores de la búsqueda semántica: cuesta una consulta de IA
 * solo cuando la búsqueda normal falla, y no exige indexar el catálogo con un
 * proveedor de embeddings. Si un día se añade pgvector, este paso sigue sirviendo
 * para las consultas que describen una necesidad en vez de un producto.
 */
import type { EsquemaIA } from './aiCore.ts'

export const INTENCION_MAX_TERMINOS = 4
const MAX_TERMINO = 40

export const SISTEMA_INTENCION = [
  'Eres el traductor de búsquedas de una tienda online. El cliente escribió lo que necesita y el buscador de la tienda no encontró nada con esas palabras.',
  `Devuelve entre 1 y ${INTENCION_MAX_TERMINOS} términos de búsqueda cortos (1 a 3 palabras cada uno) con los que un catálogo de productos sí podría encontrarlo:`,
  'tipo de producto, categoría, principio activo, nombre genérico o sinónimos comunes en Perú.',
  '',
  'Reglas:',
  '- Solo términos de búsqueda, en minúsculas y sin signos. Nada de frases, explicaciones ni marcas que el cliente no mencionó.',
  '- Si la consulta describe síntomas o una condición de salud, devuelve tipos de producto de venta libre (por ejemplo «jarabe tos», «antigripal», «protector solar»). Nunca diagnósticos, dosis ni medicamentos que requieran receta.',
  '- Si pide «el genérico de» un producto, devuelve el principio activo si lo conoces con certeza; si no, el nombre tal cual.',
  '- No incluyas datos personales ni precios.',
  '- Si la consulta no tiene que ver con comprar productos, devuelve la lista vacía.',
].join('\n')

export const ESQUEMA_INTENCION = {
  type: 'object',
  properties: {
    terminos: {
      type: 'array',
      maxItems: INTENCION_MAX_TERMINOS,
      items: { type: 'string', maxLength: 60 },
    },
  },
  required: ['terminos'],
  additionalProperties: false,
} as const satisfies EsquemaIA

export interface RespuestaModeloIntencion {
  terminos: string[]
}

const CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/
const NUMERO_LARGO = /\d{6,}/

/** Un término utilizable por el buscador, o `null`. */
export function limpiarTermino(termino: string): string | null {
  const t = termino
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length < 3 || t.length > MAX_TERMINO) return null
  if (CORREO.test(termino) || NUMERO_LARGO.test(t)) return null
  if (t.split(' ').length > 4) return null
  return t
}

/**
 * Los términos del modelo, revisados: limpios, sin repetir, sin el que ya se
 * buscó y como mucho cuatro. Ninguno útil ⇒ `vacia`.
 */
export function revisarIntencion(
  data: RespuestaModeloIntencion,
  yaBuscado: string,
): { ok: true; value: string[] } | { ok: false; motivo: 'vacia' } {
  const previo = yaBuscado.toLowerCase().trim()
  const vistos = new Set<string>()
  const terminos: string[] = []
  for (const crudo of data.terminos ?? []) {
    const t = limpiarTermino(String(crudo ?? ''))
    if (!t || t === previo || vistos.has(t)) continue
    vistos.add(t)
    terminos.push(t)
    if (terminos.length >= INTENCION_MAX_TERMINOS) break
  }
  return terminos.length > 0 ? { ok: true, value: terminos } : { ok: false, motivo: 'vacia' }
}

/**
 * ¿Hace falta reescribir? Solo cuando la búsqueda normal no sirvió: sin
 * resultados, o con parecidos por letras (`fuzzy`), que para un asistente es
 * la diferencia entre responder e inventar.
 *
 * 2026-11-22 · También cuando lo hallado salió de UNA palabra suelta de la
 * frase y no de la frase entera. «algo para el sol en la playa» se quedaba en
 * «playa», y el lematizador español reduce «playa» y «player» a `play`: el
 * «Gel Capilar Sebman Player» contaba como coincidencia real y la intención
 * nunca se consultaba. Una palabra arrancada de la frase es una pista, no una
 * respuesta.
 */
export function hayQueReescribir(mode: string, resultados: number, porPalabraSuelta = false): boolean {
  return resultados === 0 || mode === 'fuzzy' || porPalabraSuelta
}

/** Junta los resultados de varios términos sin repetir producto, en orden. */
export function fusionarResultados<T extends { product_id: string }>(listas: readonly (readonly T[])[], tope: number): T[] {
  const vistos = new Set<string>()
  const salida: T[] = []
  // Intercalado: el primero de cada término antes que el segundo de ninguno,
  // para que un término con muchos resultados no tape a los demás.
  const largo = Math.max(0, ...listas.map((l) => l.length))
  for (let i = 0; i < largo && salida.length < tope; i++) {
    for (const lista of listas) {
      const item = lista[i]
      if (!item || vistos.has(item.product_id)) continue
      vistos.add(item.product_id)
      salida.push(item)
      if (salida.length >= tope) break
    }
  }
  return salida
}
