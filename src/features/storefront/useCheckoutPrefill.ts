import { useQuery } from '@tanstack/react-query'
import { useSessionContext } from '@/features/auth/session-context'
import { checkoutProfileKey, fetchCheckoutProfile, profileFromSession, type SavedAddress } from './consumer'

const SIN_DIRECCIONES: readonly SavedAddress[] = []

/**
 * Lo que el checkout puede PROPONER a quien compra con sesión (H04).
 *
 * Propone, no decide: los campos solo se rellenan si están vacíos y las
 * direcciones se ofrecen para elegir, nunca se ponen solas. Una dirección de
 * entrega que aparece escrita sin que nadie la eligiera es un pedido que llega
 * a la casa de antes.
 *
 * Sin sesión no se pregunta nada: el checkout de invitado es exactamente el de
 * siempre. Y si la base no contesta —función aún no desplegada, red— se sigue
 * con lo que ya dice la sesión.
 *
 * Nada de esto viaja al servidor como tal: termina en los mismos campos del
 * formulario, que el pipeline vuelve a validar como cualquier otro texto.
 */
export function useCheckoutPrefill(storeSlug: string, authenticated: boolean) {
  const { session } = useSessionContext()
  const query = useQuery({
    queryKey: checkoutProfileKey(storeSlug),
    queryFn: () => fetchCheckoutProfile(storeSlug),
    enabled: authenticated && storeSlug !== '',
    retry: false,
    staleTime: 60_000,
  })

  const profile = profileFromSession(authenticated ? session : null)
  const contact = query.data?.contact ?? null

  return {
    /** `true` cuando ya hay algo que proponer (o se sabe que no habrá más). */
    ready: authenticated && (query.isSuccess || query.isError),
    name: profile.fullName || (contact?.name ?? ''),
    email: profile.email,
    phone: profile.phone || (contact?.phone ?? ''),
    addresses: query.data?.addresses ?? SIN_DIRECCIONES,
  }
}
