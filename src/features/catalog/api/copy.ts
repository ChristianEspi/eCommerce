import { z } from 'zod'
import { CATALOG_COPY_FUNCTION } from '@/shared/lib/db-schema'
import { AI_ERROR_KINDS, parseAiResult, type AiErrorKind } from '@/features/ai/result'
import type { ProductAttributeInput } from '../pim/api'
import { catalogClient } from './client'
import { catalogErrorFromInvoke } from './errors'

export { CATALOG_COPY_FUNCTION }

/**
 * Por qué no hay borrador. Los seis primeros son los de siempre y tienen texto
 * propio de fichas (`catalog.copy.motivo.*`); el resto son los tipos comunes
 * de la fase 01 (`ai.motivo.*`). Un «no se pudo» genérico deja a quien lo lee
 * sin saber si le toca comprar, esperar, pedir otro rol o editar el nombre.
 */
export const MOTIVOS_DE_FICHA = [
  'sin_proveedor',
  'sin_contratar',
  'sin_cuota',
  'proveedor',
  'vacia',
  'clinica',
] as const

export type MotivoSinBorrador = (typeof MOTIVOS_DE_FICHA)[number] | Exclude<AiErrorKind, 'bloqueada'>

export interface BorradorDeFicha {
  readonly draft: string | null
  readonly motivo: MotivoSinBorrador | null
  /** Para el pulgar en contexto. `null` si la llamada no dejó traza. */
  readonly interactionId: string | null
}

const borradorSchema = z.object({
  draft: z.string().trim().min(1).max(2000).nullable(),
  motivo: z
    .enum([...MOTIVOS_DE_FICHA, ...AI_ERROR_KINDS.filter((k) => k !== 'bloqueada')] as [
      MotivoSinBorrador,
      ...MotivoSinBorrador[],
    ])
    .nullable(),
  interaction_id: z.string().uuid().nullable().optional(),
})

/**
 * Pide el borrador de la ficha de un producto.
 *
 * No lanza cuando no hay borrador: la ausencia es una respuesta válida y viene
 * con su motivo. Solo lanza si la llamada en sí falló —sin sesión, producto de
 * otra sociedad, red caída—. Una respuesta que no pasa el esquema se trata
 * como «sin borrador» (`esquema`), nunca se pinta a ciegas.
 */
export async function pedirBorradorDeFicha(productId: string): Promise<BorradorDeFicha> {
  const supabase = catalogClient()
  const { data, error } = await supabase.functions.invoke<{ data: unknown }>(
    CATALOG_COPY_FUNCTION,
    { body: { product_id: productId } },
  )

  if (error) throw await catalogErrorFromInvoke(error)
  const parsed = borradorSchema.safeParse(data?.data)
  if (!parsed.success) return { draft: null, motivo: 'esquema', interactionId: null }
  const interactionId = parsed.data.interaction_id ?? null
  if (!parsed.data.draft) {
    return { draft: null, motivo: parsed.data.motivo ?? 'proveedor', interactionId }
  }
  return { draft: parsed.data.draft, motivo: null, interactionId }
}

/** Clave i18n del motivo: la de fichas si existe, la común si no. */
export function claveDeMotivo(motivo: MotivoSinBorrador): string {
  return (MOTIVOS_DE_FICHA as readonly string[]).includes(motivo)
    ? `catalog.copy.motivo.${motivo}`
    : `ai.motivo.${motivo}`
}

// ---------------------------------------------------------------------------
// Asistente de ficha (fase 03): `catalog-copy` en modo `assist`
// ---------------------------------------------------------------------------

/** Espejo de `PIM_TASKS` (`supabase/functions/_shared/aiPim.ts`). */
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

const texto = (max: number) => z.string().trim().min(1).max(max).nullable()

const valorAtributoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option'), option_id: z.string().uuid() }),
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal('number'), number: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/) }),
  z.object({ kind: z.literal('boolean'), boolean: z.boolean() }),
])
export type ValorAtributoPropuesto = z.infer<typeof valorAtributoSchema>

export const sugerenciasPimSchema = z.object({
  title: texto(240),
  short_description: texto(400),
  description: texto(8000),
  seo_title: texto(120),
  seo_description: texto(240),
  normalized_name: texto(240),
  category: z
    .object({ id: z.string().uuid(), path: z.string().min(1).max(600), reason: z.string().max(400) })
    .nullable(),
  attributes: z
    .array(
      z.object({
        attribute_id: z.string().uuid(),
        name: z.string().min(1).max(160),
        display: z.string().min(1).max(500),
        value: valorAtributoSchema,
        reason: z.string().max(400),
      }),
    )
    .max(40),
  duplicates: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        sku: z.string().max(80),
        name: z.string().min(1).max(300),
        score: z.number().min(0).max(1),
        reason: z.string().max(400),
      }),
    )
    .max(20),
  tags: z.array(z.string().min(1).max(60)).max(20),
  discarded: z.number().int().min(0),
})
export type SugerenciasPim = z.infer<typeof sugerenciasPimSchema>

/** Lo determinista: lo calcula el sistema y llega haya IA o no. */
export const sistemaPimSchema = z.object({
  tasks: z.array(z.enum(PIM_TASKS)).max(PIM_TASKS.length),
  missing_attributes: z.array(z.object({ id: z.string().uuid(), name: z.string() })).max(60),
  duplicate_candidates: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        sku: z.string(),
        name: z.string(),
        score: z.number().min(0).max(1),
      }),
    )
    .max(20),
})
export type SistemaPim = z.infer<typeof sistemaPimSchema>

export interface AsistenciaDeFicha {
  readonly suggestions: SugerenciasPim | null
  readonly motivo: AiErrorKind | null
  readonly interactionId: string | null
  readonly system: SistemaPim | null
}

/**
 * Interpreta la respuesta del modo `assist`. Puro, para probarlo sin red: lo
 * que no pasa el esquema se trata como «sin sugerencias» (`esquema`), nunca se
 * pinta a ciegas. El bloque `system` se valida aparte: una sugerencia rota no
 * se lleva por delante lo determinista.
 */
export function interpretarAsistencia(raw: unknown): AsistenciaDeFicha {
  const envoltorio = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const sistema = sistemaPimSchema.safeParse(envoltorio.system)
  const resultado = parseAiResult(sugerenciasPimSchema, raw)
  return {
    suggestions: resultado.data,
    motivo: resultado.motivo,
    interactionId: resultado.interactionId,
    system: sistema.success ? sistema.data : null,
  }
}

/**
 * Pide sugerencias para la ficha. NO guarda nada: quien llama enseña ACTUAL
 * frente a SUGERENCIA y aplicar es una decisión de una persona.
 */
export async function pedirSugerenciasDeFicha(input: {
  productId: string
  storeId: string | null
  tasks?: readonly PimTask[]
  locale: 'es' | 'en'
}): Promise<AsistenciaDeFicha> {
  const { data, error } = await catalogClient().functions.invoke<{ data: unknown }>(
    CATALOG_COPY_FUNCTION,
    {
      body: {
        product_id: input.productId,
        mode: 'assist',
        locale: input.locale,
        ...(input.storeId ? { store_id: input.storeId } : {}),
        ...(input.tasks ? { tasks: [...input.tasks] } : {}),
      },
    },
  )
  if (error) throw await catalogErrorFromInvoke(error)
  return interpretarAsistencia(data?.data)
}

/** Clave i18n del motivo en el asistente: `vacia` y `bloqueada` tienen texto propio. */
export function claveDeMotivoPim(motivo: AiErrorKind): string {
  return motivo === 'vacia' || motivo === 'bloqueada' ? `aiPim.motivo.${motivo}` : `ai.motivo.${motivo}`
}

/** Del valor propuesto por el servidor a la forma de `saveProductAttribute`. */
export function aEntradaDeAtributo(valor: ValorAtributoPropuesto, editado?: string): ProductAttributeInput {
  switch (valor.kind) {
    case 'option':
      return { kind: 'option', optionId: valor.option_id }
    case 'text':
      return { kind: 'text', text: (editado ?? valor.text).trim() }
    case 'number':
      return { kind: 'number', number: (editado ?? valor.number).trim().replace(',', '.') }
    case 'boolean':
      return { kind: 'boolean', boolean: valor.boolean }
  }
}
