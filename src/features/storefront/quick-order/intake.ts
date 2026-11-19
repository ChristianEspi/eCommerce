import { z } from 'zod'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import { ORDER_INTAKE_FUNCTION } from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Pedido desde foto, PDF o texto libre, del lado del navegador (2026-11-19).
 *
 * El navegador manda el archivo y recibe PROPUESTAS: cada línea leída con el
 * producto que el buscador del catálogo encontró y su confianza. Nada se añade
 * solo: la persona revisa, y lo que acepta pasa al editor del pedido rápido,
 * que lo valida como cualquier otra línea (`resolve_order_lines_for_slug`) y
 * de ahí al carrito de siempre.
 *
 * El cliente CON sesión, igual que el pedido rápido: el SKU no es público y la
 * función vuelve a exigir sesión en la base (`ai_intake_check`).
 */

/** Lo que admite la función: imágenes legibles por el modelo y PDF. */
export const INTAKE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'
export const INTAKE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export const INTAKE_MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const INTAKE_MAX_PDF_BYTES = 6 * 1024 * 1024
export const INTAKE_MAX_TEXT = 4000

export const CONFIDENCES = ['codigo', 'probable', 'dudosa', 'variante', 'ninguna'] as const
export type Confidence = (typeof CONFIDENCES)[number]

const productSchema = z.object({
  product_id: z.string().uuid(),
  slug: z.string(),
  name: z.string().min(1),
  sku: z.string().nullable(),
  kind: z.enum(['simple', 'variant', 'bundle']),
  brand_name: z.string().nullable(),
  in_stock: z.boolean(),
})
export type IntakeProduct = z.infer<typeof productSchema>

const lineSchema = z.object({
  indice: z.number().int().min(0),
  texto: z.string(),
  cantidad: z.number().int().min(1).max(9999),
  cantidad_supuesta: z.boolean(),
  unidad: z.string().nullable(),
  sku_leido: z.string().nullable(),
  legible: z.boolean(),
  confianza: z.enum(CONFIDENCES),
  sku_propuesto: z.string().nullable(),
  coincidencia: productSchema.nullable(),
  alternativas: z.array(productSchema).max(3),
})
export type IntakeLine = z.infer<typeof lineSchema>

export const intakeDataSchema = z.object({
  lineas: z.array(lineSchema).max(60),
  notas: z.string().nullable(),
})
export type IntakeData = z.infer<typeof intakeDataSchema>

/** Fallos ANTES de la IA (archivo, sesión, freno). La IA degrada con `motivo`. */
export type IntakeFileIssue = 'TIPO_NO_ADMITIDO' | 'ARCHIVO_DEMASIADO_GRANDE' | 'ARCHIVO_VACIO'

export class IntakeError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'IntakeError'
    this.code = code
  }
}

/** Comprueba el archivo en el navegador: lo mismo que mirará el servidor. */
export function checkIntakeFile(file: { type: string; size: number }): IntakeFileIssue | null {
  if (file.size === 0) return 'ARCHIVO_VACIO'
  const isImage = (INTAKE_IMAGE_TYPES as readonly string[]).includes(file.type)
  if (!isImage && file.type !== 'application/pdf') return 'TIPO_NO_ADMITIDO'
  const max = isImage ? INTAKE_MAX_IMAGE_BYTES : INTAKE_MAX_PDF_BYTES
  return file.size > max ? 'ARCHIVO_DEMASIADO_GRANDE' : null
}

/** El archivo en base64, sin el prefijo `data:`. */
export { fileToBase64 } from '@/shared/lib/fileToBase64'

export async function readIntake(input: {
  storeSlug: string
  locale: 'es' | 'en'
  text?: string | null
  file?: { mediaType: string; data: string } | null
}): Promise<AiResult<IntakeData>> {
  const client = tryGetSupabaseClient()
  if (!client) throw new IntakeError('CONFIG_INCOMPLETA')

  const body: Record<string, unknown> = { store_slug: input.storeSlug, locale: input.locale }
  const text = input.text?.trim()
  if (text) body.text = text.slice(0, INTAKE_MAX_TEXT)
  if (input.file) body.file = { media_type: input.file.mediaType, data: input.file.data }

  const { data, error } = await client.functions.invoke<{ data: unknown }>(ORDER_INTAKE_FUNCTION, { body })
  if (error) throw new IntakeError(await codeFromInvokeError(error))
  return parseAiResult(intakeDataSchema, data?.data)
}

/**
 * ¿Se marca la línea para pasar al pedido al abrir la revisión? Solo lo que no
 * exige una decisión: un código leído o una coincidencia de texto clara. Lo
 * dudoso lo decide la persona.
 */
export function preselected(line: IntakeLine): boolean {
  return Boolean(line.sku_propuesto) && (line.confianza === 'codigo' || line.confianza === 'probable')
}
