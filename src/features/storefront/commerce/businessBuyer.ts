import { useSessionContext } from '@/features/auth/session-context'
import { useMyAccounts } from '@/features/customers/hooks'

/**
 * ¿Compra para una EMPRESA? (2026-11-20)
 *
 * Es la misma señal con la que «Mi cuenta» elige entre la cuenta de empresa y
 * la del consumidor (`my_business_accounts`, vínculo ACTIVO). La cabecera y el
 * pie la usan para no ofrecer «Cotizaciones» ni «Estado de cuenta» a quien
 * compra para sí: su cuenta no tiene esas pestañas y el enlace lo dejaba en
 * «Pedidos» sin explicación. Comparte la consulta (y su caché) con la cuenta.
 */
export function useIsBusinessBuyer(): boolean {
  const { status } = useSessionContext()
  const authenticated = status === 'authenticated'
  const cuentas = useMyAccounts(authenticated)
  return authenticated && (cuentas.data?.length ?? 0) > 0
}
