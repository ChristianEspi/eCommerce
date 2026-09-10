import type { SupabaseClient } from '@supabase/supabase-js'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { AiError, aiErrorFromDb } from './errors'
import {
  AI_ENTITLEMENT_RPC,
  AI_FEEDBACK_RPC,
  AI_INTERACTIONS_TABLE,
  AI_TRACE_LIMIT,
  aiEntitlementSchema,
  aiInteractionSchema,
  type AiEntitlement,
  type AiInteraction,
} from './types'

/**
 * Acceso al saldo de IA.
 *
 * Ninguna consulta filtra por sociedad: lo hace la RLS desde el JWT, y las dos
 * funciones son `security definer` y solo hablan de la tuya.
 */

function client(): SupabaseClient {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AiError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

/**
 * Cuánto saldo queda. NO consume.
 *
 * Separado de `ai_consume` a propósito: si pintar el medidor gastara cuota, la
 * pantalla que enseña el saldo sería la que se lo come.
 */
export async function fetchAiEntitlement(): Promise<AiEntitlement> {
  const { data, error } = await client().rpc(AI_ENTITLEMENT_RPC)
  if (error) throw aiErrorFromDb(error)

  const parsed = aiEntitlementSchema.safeParse(data)
  // Un saldo que no se entiende se trata como «no contratado», nunca como
  // «ilimitado»: equivocarse hacia el lado permisivo aquí cuesta dinero real.
  if (!parsed.success) return { enabled: false, status: 'disabled' }
  return parsed.data
}

/**
 * Las últimas consultas, con lo que costaron.
 *
 * No filtra por sociedad: lo hace la policy, que además exige `owner` o
 * `admin`. La traza lleva dentro texto que escribió una persona, y quien lleva
 * el catálogo no tiene por qué leerlo.
 *
 * Devuelve lista vacía en vez de lanzar cuando la fila no pasa el esquema: una
 * bitácora es lo último que debe tumbar una pantalla de diagnóstico, que es
 * justo donde se va a mirar cuando algo va mal.
 */
export async function fetchAiInteractions(): Promise<AiInteraction[]> {
  const { data, error } = await client()
    .from(AI_INTERACTIONS_TABLE)
    .select(
      'id, feature, model, status, prompt_excerpt, reply_excerpt, input_tokens, output_tokens, cache_read_tokens, latency_ms, feedback, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(AI_TRACE_LIMIT)

  if (error) throw aiErrorFromDb(error)

  const filas: AiInteraction[] = []
  for (const fila of data ?? []) {
    const parsed = aiInteractionSchema.safeParse(fila)
    if (parsed.success) filas.push(parsed.data)
  }
  return filas
}

/**
 * Deja el pulgar sobre una respuesta.
 *
 * Devuelve `false` en silencio cuando la traza no es de tu sociedad. No lanza
 * porque una opinión que no se pudo guardar no debe romperle la pantalla a
 * nadie: es la señal más barata que existe y la menos importante.
 */
export async function sendAiFeedback(interactionId: string, value: 1 | -1): Promise<boolean> {
  const { data, error } = await client().rpc(AI_FEEDBACK_RPC, {
    p_interaction: interactionId,
    p_value: value,
  })
  if (error) throw aiErrorFromDb(error)
  return data === true
}
