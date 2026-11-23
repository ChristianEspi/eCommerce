/**
 * El número de orden de compra que la IA leyó del documento del cliente en el
 * pedido rápido (2026-11-22), recordado hasta el checkout de ESTA pestaña.
 *
 * Es una comodidad por pestaña: `sessionStorage`, no la base. Si el navegador
 * no deja guardar, no pasa nada: el campo llega vacío como siempre. El checkout
 * lo muestra para que la persona lo confirme o lo cambie; al cerrar el pedido
 * se olvida.
 */
const clave = (storeSlug: string) => `ebim.po.${storeSlug}`
const FORMA = /^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,59}$/

export function rememberPurchaseOrder(storeSlug: string, value: string | null | undefined): void {
  try {
    if (value && FORMA.test(value)) sessionStorage.setItem(clave(storeSlug), value)
  } catch {
    // Sin almacenamiento: el checkout lo pedirá como siempre.
  }
}

export function recallPurchaseOrder(storeSlug: string): string {
  try {
    const v = sessionStorage.getItem(clave(storeSlug)) ?? ''
    return FORMA.test(v) ? v : ''
  } catch {
    return ''
  }
}

export function forgetPurchaseOrder(storeSlug: string): void {
  try {
    sessionStorage.removeItem(clave(storeSlug))
  } catch {
    // Nada que olvidar.
  }
}
