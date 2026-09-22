import { z } from 'zod'

/**
 * La respuesta de una Edge Function de IA, validada ANTES de usarla.
 *
 * Forma común (`cuerpoIA` en `supabase/functions/_shared/aiPipeline.ts`):
 * `{ data | null, motivo, interaction_id }`. El servidor ya validó la salida
 * del modelo; aquí se valida otra vez porque lo que cruza la red es un dato,
 * y una pantalla que pinta un objeto sin mirarlo es la que acaba enseñando un
 * `undefined` o, peor, una cifra que no salió de la base.
 *
 * Inválido ⇒ «sin resultado» con motivo `esquema`, nunca una excepción.
 */
export const AI_ERROR_KINDS = [
  'sin_proveedor',
  'sin_contratar',
  'sin_cuota',
  'sin_permiso',
  'modulo_no_contratado',
  'no_declarada',
  'timeout',
  'rate_limit',
  'proveedor',
  'refusal',
  'truncado',
  'esquema',
  'vacia',
  'bloqueada',
] as const
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number]

export interface AiResult<T> {
  readonly data: T | null
  readonly motivo: AiErrorKind | null
  readonly interactionId: string | null
}

const envelopeSchema = z.object({
  data: z.unknown(),
  motivo: z.enum(AI_ERROR_KINDS).nullable(),
  interaction_id: z.string().uuid().nullable().optional(),
})

export function parseAiResult<S extends z.ZodTypeAny>(
  dataSchema: S,
  raw: unknown,
): AiResult<z.infer<S>> {
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) return { data: null, motivo: 'esquema', interactionId: null }

  const interactionId = envelope.data.interaction_id ?? null
  if (envelope.data.motivo) {
    return { data: null, motivo: envelope.data.motivo, interactionId }
  }
  const data = dataSchema.safeParse(envelope.data.data)
  if (!data.success || data.data === null || data.data === undefined) {
    return { data: null, motivo: 'esquema', interactionId }
  }
  return { data: data.data, motivo: null, interactionId }
}

/** Motivos que se resuelven reintentando más tarde (la UI ofrece «reintentar»). */
export function esReintentable(motivo: AiErrorKind | null): boolean {
  return motivo === 'timeout' || motivo === 'rate_limit' || motivo === 'proveedor'
}
