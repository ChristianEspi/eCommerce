import type { WatchFinding } from './api'

/**
 * Qué módulo del vigilante corresponde a la pantalla abierta.
 *
 * La lista es de rutas EXACTAS del backoffice, no una heurística: una pantalla
 * que no está aquí simplemente no tiene módulo, y entonces el panel se comporta
 * como siempre. Vale más no decir nada que señalar el módulo equivocado.
 */
const RUTAS: ReadonlyArray<readonly [string, string]> = [
  ['/app/orders', 'orders'],
  ['/app/inventory', 'inventory'],
  ['/app/planning', 'inventory'],
  ['/app/fulfillment', 'fulfillment'],
  ['/app/credit', 'credit'],
  ['/app/payments', 'credit'],
  ['/app/products', 'catalog'],
  ['/app/categories', 'catalog'],
  ['/app/integrations', 'integrations'],
  ['/app/operations', 'ops'],
]

export function watchModuleFromPath(pathname: string): string | null {
  const limpio = pathname.replace(/\/+$/, '')
  for (const [ruta, modulo] of RUTAS) {
    if (limpio === ruta || limpio.startsWith(`${ruta}/`)) return modulo
  }
  return null
}

/**
 * Los del módulo donde estás, primero; el resto detrás y en su orden.
 *
 * No se filtra: el panel sigue siendo la vista de TODA la tienda —para eso
 * existe—, pero abrirlo desde Cobranza y tener que buscar el aviso de cobranza
 * es trabajo que puede hacer la pantalla.
 */
export function sortByModuleFirst(
  items: readonly WatchFinding[],
  modulo: string | null,
): WatchFinding[] {
  if (!modulo) return [...items]
  return [...items].sort((a, b) => Number(b.module === modulo) - Number(a.module === modulo))
}
