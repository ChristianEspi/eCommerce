import type { WatchFinding } from './api'

/**
 * A dónde lleva el botón de un aviso (2026-11-23).
 *
 * La base guarda el enlace del MÓDULO (`/app/orders`, `/app/inventory?alerta=…`),
 * y eso dejaba al operador buscando a mano lo que el aviso ya sabía: «Reponer»
 * abría el inventario y había que encontrar el artículo. Aquí se afina con lo
 * que trae el propio aviso, sin tocar la base:
 *
 * - Inventario: si los ejemplos son UN solo artículo, la lista de alertas se
 *   abre filtrada por ese SKU, donde cada fila tiene su botón «Reponer» que abre
 *   el ingreso con el artículo y el almacén ya puestos.
 * - Pedidos: la lista se abre en la pestaña de estado que corresponde; si el
 *   aviso es de un solo pedido, buscado por su número.
 *
 * Solo se AÑADEN parámetros de consulta: la ruta y el `#` de la base se
 * respetan, así que un aviso nuevo que esta versión no afine sigue llevando al
 * módulo correcto.
 */
export function watchActionHref(finding: Pick<WatchFinding, 'key' | 'href' | 'samples' | 'count'>): string {
  const extra = new URLSearchParams()
  const unico = finding.samples.length === 1 ? finding.samples[0]!.label : null

  switch (finding.key) {
    case 'inventory.below_reorder':
    case 'inventory.negative':
      if (unico) extra.set('buscar', unico)
      break
    case 'orders.unpaid':
      extra.set('estado', 'pending')
      if (unico && finding.count === 1) extra.set('buscar', unico)
      break
    case 'orders.paid_unshipped':
      extra.set('estado', 'paid')
      if (unico && finding.count === 1) extra.set('buscar', unico)
      break
    case 'orders.awaiting_approval':
      extra.set('estado', 'awaiting_approval')
      break
    default:
      return finding.href
  }
  if ([...extra.keys()].length === 0) return finding.href

  const [antesDelHash, hash = ''] = finding.href.split('#', 2) as [string, string?]
  const [ruta, consulta = ''] = antesDelHash.split('?', 2) as [string, string?]
  const params = new URLSearchParams(consulta)
  for (const [k, v] of extra) params.set(k, v)
  return `${ruta}?${params.toString()}${hash ? `#${hash}` : ''}`
}
