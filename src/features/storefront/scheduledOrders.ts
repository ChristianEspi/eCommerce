import { codeFromDbError, type PostgrestLike } from '@/shared/lib/appError'
import {
  ARCHIVE_MY_ORDER_SCHEDULE_RPC,
  CHECK_MY_ORDER_SCHEDULE_LINES_RPC,
  DISMISS_MY_ORDER_SCHEDULE_RUN_RPC,
  MY_ORDER_SCHEDULES_RPC,
  SAVE_MY_ORDER_SCHEDULE_RPC,
  SET_MY_ORDER_SCHEDULE_STATUS_RPC,
  TAKE_MY_ORDER_SCHEDULE_RUN_RPC,
} from '@/shared/lib/db-schema'
import type { MessageKey } from '@/shared/i18n/messages'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * Pedidos programados del comprador en la vitrina (cierre, item 4).
 *
 * ## Programar no es comprar
 *
 * Una programación guarda QUÉ, CUÁNTO y CADA CUÁNTO. Cuando vence, el trabajo de
 * servidor deja una PROPUESTA y avisa; el comprador la pasa al carrito y confirma
 * en el checkout de siempre, con el precio, el stock, el crédito y la aprobación
 * de ese día. Nada de aquí crea un pedido ni manda un importe.
 *
 * ## Ningún id de cuenta viaja
 *
 * La tienda va por slug y la cuenta la resuelve la sesión. Los únicos ids que
 * salen del navegador son los de la plantilla o la propuesta, y la base responde
 * lo mismo para «no existe» que para «es de otra empresa».
 */

export type ScheduleStatus = 'active' | 'paused' | 'finished'

export interface ScheduledItem {
  readonly product_id: string
  readonly variant_id: string | null
  readonly slug: string
  readonly name: string
  readonly variant_name: string | null
  readonly quantity: number
  /** El artículo se puede vender hoy. Lo que no, no entrará al carrito. */
  readonly available: boolean
}

export interface OrderSchedule {
  readonly id: string
  readonly status: ScheduleStatus
  readonly interval_days: number
  readonly next_run_on: string
  readonly ends_on: string | null
  readonly last_run_at: string | null
}

export interface ScheduledTemplate {
  readonly id: string
  readonly name: string
  readonly created_at: string
  readonly schedule: OrderSchedule | null
  readonly pending_run: { readonly id: string; readonly run_on: string; readonly status: 'ready' } | null
  readonly items: readonly ScheduledItem[]
}

export interface MyOrderSchedules {
  readonly has_account: boolean
  readonly entitled: boolean
  readonly can_manage: boolean
  readonly templates: readonly ScheduledTemplate[]
}

export interface ScheduleLine {
  readonly product_id: string
  readonly variant_id?: string | null
  readonly quantity: number
}

export interface SaveScheduleInput {
  readonly storeSlug: string
  /** `null` = alta. */
  readonly templateId: string | null
  readonly name: string
  /** En una edición, `null` deja las líneas como están. */
  readonly lines: readonly ScheduleLine[] | null
  readonly intervalDays: number
  /** `YYYY-MM-DD`. */
  readonly nextRunOn: string
  readonly endsOn: string | null
  readonly requestKey: string | null
}

export const myOrderSchedulesKey = (storeSlug: string) => ['storefront', 'my-order-schedules', storeSlug] as const

/** Intervalos que se ofrecen en pantalla. La base admite de 1 a 365. */
export const SCHEDULE_INTERVALS = [7, 14, 15, 30, 60] as const

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().rpc(name, params)
  if (error) throw error
  return data as T
}

export async function fetchMyOrderSchedules(storeSlug: string): Promise<MyOrderSchedules> {
  const data = await rpc<MyOrderSchedules | null>(MY_ORDER_SCHEDULES_RPC, { p_store_slug: storeSlug })
  return data ?? { has_account: false, entitled: false, can_manage: false, templates: [] }
}

export async function saveMyOrderSchedule(input: SaveScheduleInput): Promise<ScheduledTemplate & { replayed: boolean }> {
  return rpc(SAVE_MY_ORDER_SCHEDULE_RPC, {
    p_store_slug: input.storeSlug,
    p_template_id: input.templateId,
    p_name: input.name.trim(),
    p_lines:
      input.lines === null
        ? null
        : input.lines.map((line) => ({
            product_id: line.product_id,
            ...(line.variant_id ? { variant_id: line.variant_id } : {}),
            quantity: line.quantity,
          })),
    p_interval_days: input.intervalDays,
    p_next_run_on: input.nextRunOn,
    p_ends_on: input.endsOn,
    p_request_key: input.requestKey,
  })
}

/** Motivos estables de `check_my_order_schedule_lines` (20260914192000). */
export type ScheduleLineReason =
  | 'LINEAS_INVALIDAS'
  | 'CANTIDAD_INVALIDA'
  | 'LINEA_DUPLICADA'
  | 'PRODUCTO_NO_DISPONIBLE'
  | 'VARIANTE_REQUERIDA'
  | 'VARIANTE_NO_DISPONIBLE'
  | 'FUERA_DE_CANAL'
  | 'OTRA_MONEDA'
  | 'FUERA_DE_SURTIDO'

export interface ScheduleLineCheck {
  readonly index: number
  readonly product_id: string
  readonly variant_id?: string | null
  readonly status: 'ok' | 'rejected'
  readonly reason?: ScheduleLineReason
}

export interface ScheduleLinesReview {
  readonly lines: readonly ScheduleLineCheck[]
  readonly accepted: number
  readonly rejected: number
}

/**
 * La revisión PREVIA: qué líneas se pueden programar y por qué no las otras.
 * Mismas reglas que el guardado —es la misma función en la base—, sin escribir
 * nada. La pantalla la pide al abrir el diálogo para avisar antes de pulsar.
 */
export async function checkMyOrderScheduleLines(
  storeSlug: string,
  lines: readonly ScheduleLine[],
): Promise<ScheduleLinesReview> {
  return rpc(CHECK_MY_ORDER_SCHEDULE_LINES_RPC, {
    p_store_slug: storeSlug,
    p_lines: lines.map((line) => ({
      product_id: line.product_id,
      ...(line.variant_id ? { variant_id: line.variant_id } : {}),
      quantity: line.quantity,
    })),
  })
}

const REASON_KEY: Record<ScheduleLineReason, MessageKey> = {
  LINEAS_INVALIDAS: 'account.schedules.reason.LINEAS_INVALIDAS',
  CANTIDAD_INVALIDA: 'account.schedules.reason.CANTIDAD_INVALIDA',
  LINEA_DUPLICADA: 'account.schedules.reason.LINEA_DUPLICADA',
  PRODUCTO_NO_DISPONIBLE: 'account.schedules.reason.PRODUCTO_NO_DISPONIBLE',
  VARIANTE_REQUERIDA: 'account.schedules.reason.VARIANTE_REQUERIDA',
  VARIANTE_NO_DISPONIBLE: 'account.schedules.reason.VARIANTE_NO_DISPONIBLE',
  FUERA_DE_CANAL: 'account.schedules.reason.FUERA_DE_CANAL',
  OTRA_MONEDA: 'account.schedules.reason.OTRA_MONEDA',
  FUERA_DE_SURTIDO: 'account.schedules.reason.FUERA_DE_SURTIDO',
}

/** El motivo de una línea, en palabras. Uno desconocido cae en el genérico. */
export function scheduleReasonKey(reason: string | undefined): MessageKey {
  return (reason && REASON_KEY[reason as ScheduleLineReason]) || 'account.schedules.reason.DESCONOCIDO'
}

export async function setMyOrderScheduleStatus(
  storeSlug: string,
  templateId: string,
  status: 'active' | 'paused',
): Promise<ScheduledTemplate> {
  return rpc(SET_MY_ORDER_SCHEDULE_STATUS_RPC, {
    p_store_slug: storeSlug,
    p_template_id: templateId,
    p_status: status,
  })
}

export async function archiveMyOrderSchedule(storeSlug: string, templateId: string): Promise<void> {
  await rpc(ARCHIVE_MY_ORDER_SCHEDULE_RPC, { p_store_slug: storeSlug, p_template_id: templateId })
}

export async function takeMyOrderScheduleRun(
  storeSlug: string,
  runId: string,
): Promise<{ run_id: string; already_taken: boolean; lines: ScheduleLine[] }> {
  return rpc(TAKE_MY_ORDER_SCHEDULE_RUN_RPC, { p_store_slug: storeSlug, p_run_id: runId })
}

export async function dismissMyOrderScheduleRun(storeSlug: string, runId: string): Promise<void> {
  await rpc(DISMISS_MY_ORDER_SCHEDULE_RUN_RPC, { p_store_slug: storeSlug, p_run_id: runId })
}

/** El código de dominio de un error de la base (solo `codeFromDbError` lee su texto). */
export function scheduleErrorCode(error: unknown): string {
  return codeFromDbError(error as PostgrestLike)
}

export function mapScheduleCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_PERMISO':
    case 'SIN_CUENTA_B2B':
    case 'NO_AUTENTICADO':
    case '42501':
      return 'account.schedules.error.forbidden'
    case 'SIN_MODULO':
      return 'account.schedules.error.unavailable'
    // Cada familia de motivo con su texto: «algún producto no se puede
    // programar» no le decía al comprador qué hacer.
    case 'FUERA_DE_SURTIDO':
      return 'account.schedules.error.assortment'
    case 'PRODUCTO_NO_DISPONIBLE':
    case 'VARIANTE_REQUERIDA':
    case 'VARIANTE_NO_DISPONIBLE':
      return 'account.schedules.error.unavailable_product'
    case 'FUERA_DE_CANAL':
    case 'OTRA_MONEDA':
      return 'account.schedules.error.channel'
    case 'CANTIDAD_INVALIDA':
    case 'LINEA_DUPLICADA':
    case 'LINEAS_INVALIDAS':
    case 'LINEAS_EXCESIVAS':
    case 'CAMPO_NO_PERMITIDO':
      return 'account.schedules.error.lines'
    case 'FECHA_INVALIDA':
    case 'INTERVALO_INVALIDO':
    case 'NOMBRE_INVALIDO':
      return 'account.schedules.error.dates'
    case 'PROGRAMACION_TERMINADA':
      return 'account.schedules.error.finished'
    case 'PROGRAMACION_NO_ENCONTRADA':
    case 'EJECUCION_NO_DISPONIBLE':
      return 'account.schedules.error.notFound'
    default:
      return 'account.schedules.error.generic'
  }
}

/** Fecha local `YYYY-MM-DD` desplazada `days` días desde hoy. */
export function isoDateFromToday(days: number, today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Lo que impide guardar, o `null`. Es un adelanto de la base, no la regla: la
 * base valida lo mismo y es la que decide.
 */
export function scheduleFormError(input: {
  name: string
  intervalDays: number
  nextRunOn: string
  endsOn: string | null
  today: string
}): 'name' | 'interval' | 'nextRunOn' | 'endsOn' | null {
  const name = input.name.trim()
  if (name.length < 1 || name.length > 120) return 'name'
  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1 || input.intervalDays > 365) return 'interval'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextRunOn) || input.nextRunOn < input.today) return 'nextRunOn'
  if (input.endsOn !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.nextRunOn)) {
    return 'endsOn'
  }
  return null
}
