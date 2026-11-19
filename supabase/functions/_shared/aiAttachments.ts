/**
 * Adjuntos para el modelo: una foto o un PDF que la persona sube para que la IA
 * lo LEA (2026-11-19 · IA multimodal). TypeScript PURO: se prueba sin red.
 *
 * ## Por qué se valida aquí y no se le deja al proveedor
 *
 * El proveedor acepta lo que le llegue y lo cobra. Un archivo de 30 MB, un
 * ejecutable renombrado a `.jpg` o un base64 roto cuestan tokens o un 400 que la
 * persona no entiende. Tres comprobaciones baratas antes de gastar cuota:
 *
 *  1. **Tipo declarado de una lista cerrada** (`image/jpeg|png|webp|gif`,
 *     `application/pdf`). Ni SVG (es código), ni HEIC (el proveedor no lo lee).
 *  2. **Firma de los bytes** (magic numbers): el tipo lo declara el navegador y
 *     se puede falsear; los primeros bytes no mienten.
 *  3. **Tamaño decodificado** con techo por tipo. Se calcula desde la longitud
 *     del base64, sin decodificar el archivo entero.
 *
 * El archivo NO se guarda en ningún sitio: viaja al proveedor y se descarta. La
 * traza guarda el tipo y el tamaño, nunca el contenido.
 */

export const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type AiImageType = (typeof AI_IMAGE_TYPES)[number]

export const AI_ATTACHMENT_TYPES = [...AI_IMAGE_TYPES, 'application/pdf'] as const
export type AiAttachmentType = (typeof AI_ATTACHMENT_TYPES)[number]

/** Techo decodificado. El proveedor admite más; una lista de compra, no. */
export const AI_MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const AI_MAX_PDF_BYTES = 6 * 1024 * 1024

export interface AdjuntoIA {
  readonly mediaType: AiAttachmentType
  /** Base64 estándar, sin prefijo `data:`. */
  readonly data: string
  /** Bytes decodificados, ya calculados. */
  readonly bytes: number
}

export type MotivoAdjunto = 'TIPO_NO_ADMITIDO' | 'ARCHIVO_VACIO' | 'ARCHIVO_DEMASIADO_GRANDE' | 'ARCHIVO_ILEGIBLE'

export type ValidacionAdjunto =
  | { readonly ok: true; readonly adjunto: AdjuntoIA }
  | { readonly ok: false; readonly motivo: MotivoAdjunto }

export function esTipoAdjunto(value: unknown): value is AiAttachmentType {
  return typeof value === 'string' && (AI_ATTACHMENT_TYPES as readonly string[]).includes(value)
}

export function esImagen(mediaType: AiAttachmentType): mediaType is AiImageType {
  return mediaType !== 'application/pdf'
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Bytes que ocupa un base64 una vez decodificado, sin decodificarlo. */
export function bytesDeBase64(data: string): number {
  const relleno = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((data.length * 3) / 4) - relleno
}

/** Los primeros bytes, decodificados a mano para no depender de `atob`. */
function cabecera(data: string, cuantos: number): number[] {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const trozo = data.slice(0, Math.ceil((cuantos * 4) / 3) + 4).replace(/=+$/, '')
  const bytes: number[] = []
  let acumulado = 0
  let bits = 0
  for (const caracter of trozo) {
    const valor = alfabeto.indexOf(caracter)
    if (valor < 0) break
    acumulado = (acumulado << 6) | valor
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acumulado >> bits) & 0xff)
      if (bytes.length >= cuantos) break
    }
  }
  return bytes
}

function empiezaPor(bytes: readonly number[], firma: readonly number[], desde = 0): boolean {
  return firma.every((valor, i) => bytes[desde + i] === valor)
}

/** ¿Los bytes son de verdad del tipo que se declara? */
export function firmaCoincide(mediaType: AiAttachmentType, data: string): boolean {
  const b = cabecera(data, 12)
  switch (mediaType) {
    case 'image/jpeg':
      return empiezaPor(b, [0xff, 0xd8, 0xff])
    case 'image/png':
      return empiezaPor(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif':
      return empiezaPor(b, [0x47, 0x49, 0x46, 0x38])
    case 'image/webp':
      // RIFF....WEBP
      return empiezaPor(b, [0x52, 0x49, 0x46, 0x46]) && empiezaPor(b, [0x57, 0x45, 0x42, 0x50], 8)
    case 'application/pdf':
      return empiezaPor(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
  }
}

/**
 * Valida un adjunto que llega del navegador como `{ media_type, data }`.
 * Acepta un `data:` URL por comodidad y lo reduce a base64.
 */
export function validarAdjunto(mediaType: unknown, data: unknown): ValidacionAdjunto {
  if (!esTipoAdjunto(mediaType)) return { ok: false, motivo: 'TIPO_NO_ADMITIDO' }
  if (typeof data !== 'string') return { ok: false, motivo: 'ARCHIVO_ILEGIBLE' }

  const limpio = data.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
  if (limpio.length === 0) return { ok: false, motivo: 'ARCHIVO_VACIO' }

  const techo = esImagen(mediaType) ? AI_MAX_IMAGE_BYTES : AI_MAX_PDF_BYTES
  // El tamaño se mira ANTES que la expresión regular: probar una regex sobre
  // 40 MB de texto ya es el coste que el techo existe para evitar.
  const bytes = bytesDeBase64(limpio)
  if (bytes > techo) return { ok: false, motivo: 'ARCHIVO_DEMASIADO_GRANDE' }
  if (limpio.length % 4 !== 0 || !BASE64.test(limpio)) return { ok: false, motivo: 'ARCHIVO_ILEGIBLE' }
  if (!firmaCoincide(mediaType, limpio)) return { ok: false, motivo: 'ARCHIVO_ILEGIBLE' }

  return { ok: true, adjunto: { mediaType, data: limpio, bytes } }
}

/**
 * Bloques de contenido del proveedor (`messages[].content`). Los adjuntos van
 * ANTES del texto: es el orden que recomienda el proveedor para documentos e
 * imágenes, y deja la instrucción como lo último que el modelo lee.
 */
export function bloquesDeContenido(adjuntos: readonly AdjuntoIA[], texto: string): Array<Record<string, unknown>> {
  const bloques: Array<Record<string, unknown>> = adjuntos.map((adjunto) =>
    esImagen(adjunto.mediaType)
      ? { type: 'image', source: { type: 'base64', media_type: adjunto.mediaType, data: adjunto.data } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: adjunto.data } },
  )
  bloques.push({ type: 'text', text: texto })
  return bloques
}

/** Lo que queda en la traza: tipo y tamaño, nunca el contenido. */
export function resumenAdjuntos(adjuntos: readonly AdjuntoIA[]): string {
  if (adjuntos.length === 0) return 'sin adjunto'
  return adjuntos.map((a) => `${a.mediaType} ${Math.ceil(a.bytes / 1024)} KB`).join(', ')
}
