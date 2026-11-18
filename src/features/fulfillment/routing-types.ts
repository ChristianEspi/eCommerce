import { z } from 'zod'
import { matchesRule, zRule } from '@/shared/lib/fieldRules'

export {
  DELIVERY_VEHICLES_TABLE,
  DELIVERY_PLANS_TABLE,
  DELIVERY_PLAN_STOPS_TABLE,
  PROOF_OF_DELIVERY_TABLE,
  POD_EVIDENCE_TABLE,
} from '@/shared/lib/db-schema'

/**
 * Reparto propio y evidencia de entrega, en el CLIENTE.
 *
 * Mitad de pantalla de `20260902160000_fulfillment_routing_pod.sql`. La hoja de
 * ruta agrupa despachos que YA existen: no crea ninguno. Si lo hiciera habría
 * dos verdades sobre lo que salió del almacén.
 */

export const PLAN_STATUSES = ['draft', 'dispatched', 'closed', 'cancelled'] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

/**
 * A dónde puede ir una hoja de ruta.
 *
 * **La base NO lo impone**: no hay trigger de estado en `delivery_plans`. Esto
 * es criterio de pantalla y se dice para que nadie lo confunda con una barrera
 * — el orden es el del oficio: se arma, sale, y al volver se cierra. Cancelar
 * cabe mientras no esté cerrada; de `closed` no se sale, porque una hoja
 * cerrada ya tiene evidencias colgando y esas sí son inmutables.
 */
export function nextPlanStatuses(status: PlanStatus): PlanStatus[] {
  if (status === 'draft') return ['dispatched', 'cancelled']
  if (status === 'dispatched') return ['closed', 'cancelled']
  return []
}

export const vehicleSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  plate: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  capacity_kg: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
})
export type Vehicle = z.infer<typeof vehicleSchema>

export const planSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable().default(null),
  code: z.string(),
  plan_date: z.string(),
  status: z.enum(PLAN_STATUSES).catch('draft'),
  driver_name: z.string().nullable().default(null),
  dispatched_at: z.string().nullable().default(null),
  closed_at: z.string().nullable().default(null),
  vehicle_code: z.string().nullable().default(null),
})
export type Plan = z.infer<typeof planSchema>

export const planStopSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  fulfillment_id: z.string().uuid(),
  sequence: z.number(),
  eta: z.string().nullable().default(null),
})
export type PlanStop = z.infer<typeof planStopSchema>

export const POD_OUTCOMES = ['delivered', 'partial', 'refused', 'not_found'] as const
export type PodOutcome = (typeof POD_OUTCOMES)[number]

export const podSchema = z.object({
  id: z.string().uuid(),
  fulfillment_id: z.string().uuid(),
  stop_id: z.string().uuid().nullable().default(null),
  outcome: z.enum(POD_OUTCOMES).catch('delivered'),
  received_by: z.string().nullable().default(null),
  document_id: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  created_at: z.string(),
})
export type Pod = z.infer<typeof podSchema>

const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/, 'fulfillment.error.code')

export const planFormSchema = z.object({
  code,
  plan_date: z.string().min(1, 'fulfillment.error.date'),
  /** Cadena vacía = sin vehículo asignado todavía. */
  vehicle_id: z.string(),
  driver_name: z
    .string()
    .trim()
    .max(160, 'fulfillment.error.driver')
    .refine((value) => value === '' || matchesRule('personName', value), 'field.error.personName'),
})
export type PlanFormValues = z.infer<typeof planFormSchema>

export function emptyPlanForm(): PlanFormValues {
  return {
    code: '',
    plan_date: new Date().toISOString().slice(0, 10),
    vehicle_id: '',
    driver_name: '',
  }
}

/**
 * El formulario de la prueba de entrega.
 *
 * `reason` es obligatorio cuando NO se entregó, exactamente como
 * `proof_of_delivery_reason_when_failed`: un rechazo sin motivo es una entrega
 * fallida que nadie puede reclamar ni corregir. Se comprueba aquí para poder
 * señalar el campo — y porque la fila, una vez escrita, ya no se puede arreglar.
 */
export const podFormSchema = z
  .object({
    outcome: z.enum(POD_OUTCOMES),
    received_by: z
      .string()
      .trim()
      .max(160, 'fulfillment.error.receivedBy')
      .refine((value) => value === '' || matchesRule('personName', value), 'field.error.personName'),
    document_id: zRule('document', 'help.fulfillment.error.documentId'),
    reason: z.string().trim().max(400, 'fulfillment.error.reason'),
  })
  .refine((values) => values.outcome === 'delivered' || values.reason.length > 0, {
    path: ['reason'],
    message: 'fulfillment.error.reasonRequired',
  })
export type PodFormValues = z.infer<typeof podFormSchema>

export function emptyPodForm(): PodFormValues {
  return { outcome: 'delivered', received_by: '', document_id: '', reason: '' }
}

/** El primer hueco libre en el orden de una hoja de ruta. */
export function nextStopSequence(stops: readonly PlanStop[]): number {
  const usados = new Set(stops.map((stop) => stop.sequence))
  let candidato = 1
  while (usados.has(candidato)) candidato += 1
  return candidato
}
