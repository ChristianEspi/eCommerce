/**
 * Redactar la ficha de un producto. TypeScript PURO, sin proveedor.
 *
 * Vive en `_shared` por lo mismo que `ai.ts`: aquí no hay ni un especificador
 * `npm:`, así que el `tsc` del repo y los tests lo compilan y lo ejercitan. Y lo
 * que de verdad hay que vigilar de esta funcionalidad no es cómo viaja la
 * llamada, es **qué se le deja escribir al modelo** — que es justo lo que está
 * aquí y se puede probar sin red y sin clave.
 *
 * ## Por qué esto no es «escribe la descripción»
 *
 * De las 281 fichas vacías del catálogo de la demo, **181 son medicamentos**. Un
 * modelo redactando prosa libre sobre un medicamento se inventa indicaciones,
 * dosis o contraindicaciones, y eso en una botica no es un fallo de producto: es
 * un asunto sanitario, y en Perú es DIGEMID.
 *
 * Así que el encargo es **describir la presentación**, no aconsejar: forma
 * farmacéutica, concentración, contenido del envase, laboratorio, familia. «Caja
 * de 21 cápsulas de 500 mg» es lo que dice el envase, es útil para buscar y para
 * la tarjeta de la vitrina, y no afirma nada sobre para qué sirve.
 *
 * ## La regla tiene DOS candados, no uno
 *
 * 1. El sistema se lo prohíbe.
 * 2. Y la respuesta se revisa antes de devolverla (`tieneAfirmacionClinica`).
 *
 * El segundo existe porque un prompt es una petición, no una garantía. Si el
 * borrador se cuela hablando de para qué sirve, no se enseña: se registra como
 * bloqueado y quien pidió el borrador se queda como estaba. Es la misma
 * política que el asistente de la vitrina —se degrada, no se rompe— aplicada a
 * lo que aquí puede hacer daño.
 */

/** Lo que se le cuenta al modelo del producto. Nada de precio ni de stock. */
export interface ProductoParaFicha {
  readonly name: string
  readonly brandName: string | null
  readonly categoryName: string | null
  readonly sku: string
}

export const ESQUEMA_FICHA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
  },
  required: ['description'],
  additionalProperties: false,
} as const

/** Cuánto puede ocupar el borrador. Dos frases, no un prospecto. */
export const FICHA_MAX_CARACTERES = 320

export const SISTEMA_FICHA = [
  'Redactas la ficha comercial de un producto de una botica, en espanol neutro.',
  '',
  'Describes UNICAMENTE la presentacion: forma (comprimido, jarabe, crema, ampolla),',
  'concentracion si aparece en el nombre, contenido del envase, laboratorio y familia.',
  '',
  'PROHIBIDO, sin excepcion:',
  '- para que sirve, que trata, que alivia, que cura o que previene;',
  '- indicaciones, contraindicaciones, dosis, posologia o modo de empleo;',
  '- afirmaciones de eficacia, seguridad o beneficio para la salud;',
  '- inventar datos que no esten en el nombre, la marca o la categoria que recibes.',
  '',
  'Si con lo que recibes no puedes describir la presentacion sin inventar, devuelve',
  'una descripcion vacia. Una ficha en blanco es mejor que una ficha falsa.',
  '',
  'Dos frases como maximo. Sin encabezados, sin listas, sin emoji.',
].join('\n')

/**
 * Lo que el modelo ve del producto.
 *
 * Se le da poco a propósito: nombre, marca, categoría y SKU. Sin precio —el
 * modelo no emite dinero, es la regla 2 de `ai.ts`— y sin stock, que cambia cada
 * hora y no describe nada.
 */
export function datosDeProducto(producto: ProductoParaFicha): string {
  return [
    `Nombre: ${producto.name}`,
    `Marca: ${producto.brandName ?? '(sin marca)'}`,
    `Categoria: ${producto.categoryName ?? '(sin categoria)'}`,
    `SKU: ${producto.sku}`,
  ].join('\n')
}

/**
 * Las formas de decir «para qué sirve», que es lo único que no puede decir.
 *
 * Es una lista de FRASES y no de palabras sueltas: «trata» aparece en «se trata
 * de», y «alivio» en «alivio de la carga»; una lista de raíces bloquearía
 * fichas correctas y acabaría desactivada por inútil. Se buscan giros que solo
 * aparecen cuando se está afirmando un efecto.
 *
 * No pretende ser exhaustiva, y no hace falta que lo sea: el primer candado es
 * el sistema. Este es la red que recoge lo que se le escape, y una red con
 * agujeros sigue siendo mejor que ninguna.
 */
const AFIRMACIONES_CLINICAS: readonly RegExp[] = [
  /\bindicad[oa]s?\s+(?:para|en)\b/i,
  /\bindicaci(?:on|ón|ones)\b/i,
  /\bcontraindicaci/i,
  /\bpara\s+(?:el\s+)?(?:tratamiento|alivio|control|manejo)\b/i,
  /\b(?:trata|alivia|cura|previene|combate|elimina|reduce)\s+(?:el|la|los|las|un|una)\b/i,
  /\bayuda\s+a\s+(?:tratar|aliviar|curar|prevenir|combatir|reducir|mejorar)\b/i,
  /\b(?:dosis|posolog(?:ia|ía)|modo\s+de\s+(?:empleo|uso)|administraci(?:on|ón))\b/i,
  /\b(?:eficaz|efectivo|seguro)\s+(?:para|contra|en)\b/i,
  /\brecomendad[oa]\s+(?:para|en)\b/i,
  /\bs(?:i|í)ntomas?\b/i,
]

/** ¿Se ha puesto a decir para qué sirve? */
export function tieneAfirmacionClinica(texto: string): boolean {
  return AFIRMACIONES_CLINICAS.some((patron) => patron.test(texto))
}

/** Estado del borrador, que es lo que decide qué se registra en la traza. */
export type ResultadoFicha =
  | { readonly ok: true; readonly description: string }
  | { readonly ok: false; readonly motivo: 'vacia' | 'clinica' }

/**
 * Valida el borrador antes de que salga de aquí.
 *
 * `vacia` no es un fallo: es el modelo haciendo lo que se le pidió cuando no
 * tiene con qué describir sin inventar. Se distingue de `clinica` porque una se
 * cuenta como degradada y la otra como bloqueada, y mezclarlas escondería justo
 * la métrica que dice si el sistema está aguantando.
 */
export function revisarBorrador(texto: unknown): ResultadoFicha {
  const limpio = typeof texto === 'string' ? texto.trim().replace(/\s+/g, ' ') : ''
  if (!limpio) return { ok: false, motivo: 'vacia' }
  if (tieneAfirmacionClinica(limpio)) return { ok: false, motivo: 'clinica' }
  return { ok: true, description: limpio.slice(0, FICHA_MAX_CARACTERES) }
}
