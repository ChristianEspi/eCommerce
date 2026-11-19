/**
 * Ficha de producto desde el documento del proveedor (2026-11-19). PURO.
 *
 * El proveedor manda una ficha técnica en PDF o la foto de la caja. Antes, una
 * persona copiaba a mano presentación, concentración, contenido, laboratorio…
 * Ahora:
 *
 *  1. **Transcribir** (este módulo): el modelo lee el documento y devuelve su
 *     TEXTO —los datos del producto, sin contacto ni precios—. La transcripción
 *     se le enseña a la persona tal cual, para que vea de dónde sale cada dato.
 *  2. **Proponer** (el asistente de ficha de siempre, `aiPim.ts`): la
 *     transcripción entra como una fuente más. Con eso, la regla «un número que
 *     no está en los datos ⇒ fuera» sigue mandando, ahora con el documento como
 *     dato, y el candado sanitario no cambia: aunque el prospecto diga para qué
 *     sirve un medicamento, la ficha no lo repite.
 *
 * Dos llamadas y no una a propósito: el asistente de ficha ya está probado, con
 * sus candados y su pantalla de «aplicar». Mezclar la lectura del documento en
 * su esquema obligaba a reabrir todo eso.
 */
import type { EsquemaIA } from './aiCore.ts'

export const DOCUMENTO_MAX_TEXTO = 4000

export const SISTEMA_TRANSCRIPCION = [
  'Eres el lector de fichas técnicas de un catálogo de productos. Recibes un documento del proveedor (ficha técnica, catálogo, etiqueta o foto del empaque).',
  'Transcribe SOLO los datos que describen el producto: nombre, marca, laboratorio o fabricante, presentación, contenido, concentración, composición o principio activo, dimensiones, peso, material, color, origen, registro sanitario y condiciones de almacenamiento.',
  '',
  'Reglas:',
  '- Copia los valores como están escritos, con sus unidades. No conviertas, no redondees, no completes lo que no se lee.',
  '- Una línea por dato, en la forma «Campo: valor».',
  '- NO copies precios, descuentos, condiciones comerciales, datos de contacto (teléfonos, correos, direcciones, webs) ni nombres de personas.',
  '- NO copies indicaciones de uso médico, dosis ni posología: no forman parte de la ficha comercial.',
  '- Si el documento no describe un producto, devuelve es_ficha = false y texto vacío.',
  `- Como máximo ${DOCUMENTO_MAX_TEXTO} caracteres.`,
].join('\n')

export const ESQUEMA_TRANSCRIPCION = {
  type: 'object',
  properties: {
    es_ficha: { type: 'boolean' },
    texto: { type: 'string', maxLength: DOCUMENTO_MAX_TEXTO + 500 },
  },
  required: ['es_ficha', 'texto'],
  additionalProperties: false,
} as const satisfies EsquemaIA

export interface RespuestaModeloTranscripcion {
  es_ficha: boolean
  texto: string
}

const CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const WEB = /\b(?:https?:\/\/|www\.)\S+/gi
const TELEFONO = /\+?\d[\d\s().-]{7,}\d/g
const DINERO = /(?:S\/\.?|US\$|\$|USD|PEN|€)\s*\d/i
const CLINICA = /\b(indicaci[oó]n|indicado para|posolog[ií]a|dosis|contraindicaci[oó]n|tratamiento de|alivi[ao]|cura)\b/i

/**
 * La transcripción revisada: fuera contacto y webs; fuera las LÍNEAS con dinero
 * o con lenguaje clínico (el modelo tiene la instrucción, esto es el cinturón).
 */
export function revisarTranscripcion(
  data: RespuestaModeloTranscripcion,
): { ok: true; value: string } | { ok: false; motivo: 'vacia' } {
  if (!data.es_ficha) return { ok: false, motivo: 'vacia' }
  const lineas = String(data.texto ?? '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(CORREO, ' ')
        .replace(WEB, ' ')
        .replace(TELEFONO, (m) => (/[a-z]/i.test(m) ? m : ' '))
        .replace(/[ \t]+/g, ' ')
        .trim(),
    )
    .filter((l) => l.length >= 3 && !DINERO.test(l) && !CLINICA.test(l))
  const texto = lineas.join('\n').slice(0, DOCUMENTO_MAX_TEXTO).trim()
  return texto.length >= 10 ? { ok: true, value: texto } : { ok: false, motivo: 'vacia' }
}
