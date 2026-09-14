import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSessionContext } from '@/features/auth/session-context'
import {
  addressBookKey,
  checkoutProfileKey,
  fetchAddressBook,
  fetchCheckoutProfile,
  mergeAddresses,
  profileFromSession,
  type SavedAddress,
} from './consumer'

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
 *
 * N06 · Primero la LIBRETA (la predeterminada delante), después las
 * direcciones de pedidos anteriores que no estén ya guardadas. Si la libreta no
 * está desplegada o falla, se proponen solo las de los pedidos, como antes.
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

  const book = useQuery({
    queryKey: addressBookKey(storeSlug),
    queryFn: () => fetchAddressBook(storeSlug),
    enabled: authenticated && storeSlug !== '',
    retry: false,
    staleTime: 60_000,
  })

  const profile = profileFromSession(authenticated ? session : null)
  const contact = query.data?.contact ?? null
  const history = query.data?.addresses ?? SIN_DIRECCIONES
  const addresses = useMemo<readonly SavedAddress[]>(
    () => (book.data ? mergeAddresses(book.data, history) : history),
    [book.data, history],
  )

  return {
    /** `true` cuando ya hay algo que proponer (o se sabe que no habrá más). */
    ready: authenticated && (query.isSuccess || query.isError) && !book.isPending,
    name: profile.fullName || (contact?.name ?? ''),
    email: profile.email,
    phone: profile.phone || (contact?.phone ?? ''),
    addresses,
  }
}
