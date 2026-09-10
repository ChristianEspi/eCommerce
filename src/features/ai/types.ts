import { z } from 'zod'

export {
  AI_INTERACTIONS_TABLE,
  AI_QUOTAS_TABLE,
  AI_USAGE_TABLE,
  AI_ENTITLEMENT_RPC,
  AI_FEEDBACK_RPC,
} from '@/shared/lib/db-schema'

/**
 * La IA medida, en el CLIENTE.
 *
 * Mitad de pantalla de `20260910100000_ai_metering.sql`.
 *
 * Aquí no se llama a ningún proveedor. La clave de Anthropic vive en los
 * secretos de las Edge Functions y no entra jamás en el bundle; lo que el
 * navegador puede saber es cuánto saldo le queda a su sociedad y si lo que le
 * respondieron sirvió.
 */

/**
 * En qué punto está el saldo.
 *
 * `disabled` no es un error: es la respuesta correcta para una sociedad que no
 * tiene la IA contratada. Se distingue de `trial_expired` y `quota_exceeded`
 * porque llevan a sitios distintos —contratar frente a ampliar— y ofrecer
 * «amplía tu cuota» a quien nunca contrató nada es ofrecerle un botón que no
 * existe.
 */
export const AI_STATUSES = [
  'disabled',
  'trial',
  'active',
  'trial_expired',
  'quota_exceeded',
] as const
export type AiStatus = (typeof AI_STATUSES)[number]

/**
 * Lo que devuelve `public.ai_entitlement()`.
 *
 * Los campos de saldo son opcionales a propósito: cuando la IA no está
 * contratada, la función devuelve solo `enabled` y `status`. Tiparlos como
 * obligatorios obligaría a inventar un cero que se leería como «te has gastado
 * todo» en vez de «no lo tienes».
 */
export const aiEntitlementSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(AI_STATUSES),
  plan: z.enum(['trial', 'active']).optional(),
  period: z.string().optional(),
  used: z.number().int().nonnegative().optional(),
  quota: z.number().int().nonnegative().optional(),
  remaining: z.number().int().nonnegative().optional(),
})

export type AiEntitlement = z.infer<typeof aiEntitlementSchema>

/** Saldo agotado: la acción no va a salir, y hay que decirlo antes de gastarla. */
export function agotado(estado: AiEntitlement): boolean {
  return estado.status === 'trial_expired' || estado.status === 'quota_exceeded'
}

/**
 * Cuándo avisar de que queda poco.
 *
 * Un umbral relativo y no un número fijo: «te quedan 3» significa algo muy
 * distinto sobre una cuota de 25 que sobre una de 500. Se avisa en el último
 * quinto, que es cuando todavía da tiempo a hacer algo.
 */
export function porAgotarse(estado: AiEntitlement): boolean {
  if (!estado.enabled || agotado(estado)) return false
  if (estado.quota === undefined || estado.remaining === undefined) return false
  if (estado.quota === 0) return false
  return estado.remaining / estado.quota <= 0.2
}
