/**
 * Pasos de la línea de tiempo del pedido. Vive aparte del componente para
 * poder probarse sin pintar nada.
 */
export type Estado = 'done' | 'current' | 'pending' | 'failed'

export interface OrderTimelineInput {
  /** Estado comercial del pedido (`pending`, `paid`, `fulfilled`, `cancelled`…). */
  status: string
  paid: boolean
  /** `not_required` | `pending` | `approved` | `rejected`, o `null` si no llegó. */
  approvalStatus: string | null
  /** `unfulfilled` | `in_progress` | `partially_fulfilled` | `fulfilled`…, o `null`. */
  fulfillmentStatus: string | null
}

/**
 * Los pasos del pedido, calculados de los ejes que YA tiene la fila.
 *
 * Nada se infiere de «lo normal»: si el pedido no pasa por aprobación, ese paso
 * no existe; si la aprobación se rechazó, se dice y lo que viene después queda
 * en espera. Un paso marcado como hecho es un dato del pedido, no una promesa.
 */
export function orderSteps(input: OrderTimelineInput): Array<{ key: string; estado: Estado }> {
  const cancelado = input.status === 'cancelled'
  const conAprobacion = input.approvalStatus !== null && input.approvalStatus !== 'not_required'
  const aprobado = !conAprobacion || input.approvalStatus === 'approved'
  const rechazado = input.approvalStatus === 'rejected'
  const envio = input.fulfillmentStatus
  const entregado = envio === 'fulfilled' || input.status === 'fulfilled'
  const enCamino = entregado || envio === 'in_progress' || envio === 'partially_fulfilled'

  const pasos: Array<{ key: string; estado: Estado }> = [{ key: 'placed', estado: 'done' }]
  if (conAprobacion) {
    pasos.push({ key: 'approval', estado: rechazado ? 'failed' : aprobado ? 'done' : 'current' })
  }
  const bloqueado = rechazado || cancelado || !aprobado
  pasos.push({
    key: 'payment',
    estado: input.paid ? 'done' : bloqueado ? 'pending' : 'current',
  })
  pasos.push({
    key: 'shipping',
    estado: entregado ? 'done' : enCamino ? 'current' : 'pending',
  })
  pasos.push({ key: 'delivered', estado: entregado ? 'done' : 'pending' })
  if (cancelado) return pasos.map((paso) => (paso.estado === 'current' ? { ...paso, estado: 'pending' } : paso))
  return pasos
}

/**
 * Un pedido que ya no va a moverse: cancelado, reembolsado, o pagado y
 * entregado. Decide si la confirmación sigue consultando el estado. Sin datos
 * todavía, se sigue consultando.
 */
export function pedidoTerminado(
  data:
    | { status: string; payment_status?: string | null; fulfillment_status?: string | null }
    | undefined,
): boolean {
  if (!data) return false
  if (data.status === 'cancelled' || data.status === 'refunded') return true
  const entregado = data.status === 'fulfilled' || data.fulfillment_status === 'fulfilled'
  const pagado = data.payment_status === 'paid' || data.status === 'paid' || data.status === 'fulfilled'
  return entregado && pagado
}
