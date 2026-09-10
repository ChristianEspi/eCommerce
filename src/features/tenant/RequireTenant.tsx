import { Button, Stack } from '@mui/material'
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useMyAccounts } from '@/features/customers/hooks'
import { useDefaultStoreSlug } from '@/features/storefront/default-store'
import { useI18n } from '@/shared/i18n/i18n-context'
import { ErrorState, LoadingState, UnauthorizedState } from '@/shared/ui/states'
import { useTenant } from './tenant-context'

/**
 * Guard de tenant. Cada estado tiene su salida y ninguno cae en pantalla
 * blanca ni en un listado vacío que parezca un error del usuario:
 *
 *  · `unauthorized` — hay sesión pero el token no trae la jerarquía del hub, o
 *    no la trae para esta app.
 *  · `onboarding` — token correcto y todavía sin espacio: se crea uno.
 *
 * ## Un comprador no es un empleado sin permisos
 *
 * `unauthorized` junta dos personas muy distintas, porque el síntoma es el
 * mismo —un token sin `org_id`— y desde el token no se distinguen:
 *
 *  · el empleado de un tenant cuya cuenta del hub todavía no tiene eCommerce.
 *    Para él, «pide al administrador que te habilite» es la respuesta correcta;
 *  · el comprador que se registró EN LA TIENDA. Nunca va a tener jerarquía del
 *    hub porque no es miembro de ningún tenant, así que ese cartel es un final
 *    del que no se sale. Es lo que se veía al entrar a `/app`.
 *
 * Lo que sí los distingue es un dato de servidor: el vínculo con una cuenta
 * B2B. `my_business_accounts()` no acepta argumentos —el vínculo lo resuelve la
 * base contra `business_account_users`— así que un navegador no puede hacerse
 * pasar por comprador de nadie. Con vínculo, se va a la tienda; sin él no se
 * adivina, porque mandar a la vitrina a un empleado mal configurado le esconde
 * su problema real: se le deja el cartel y, si hay tienda a la que ir, también
 * la puerta.
 *
 * Las dos consultas van con `enabled` atado a este estado: un miembro normal
 * del backoffice no paga dos llamadas por un caso que no es el suyo.
 */
export function RequireTenant({ children }: { children: ReactNode }) {
  const { status, error, refetch } = useTenant()
  const { signOut } = useSessionContext()
  const { t } = useI18n()

  const sinJerarquia = status === 'unauthorized'
  const compras = useMyAccounts(sinJerarquia)
  const tienda = useDefaultStoreSlug(sinJerarquia)

  if (status === 'loading') return <LoadingState />
  if (status === 'error') return <ErrorState error={error} onRetry={refetch} />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />

  if (sinJerarquia) {
    // Sin esperar, un comprador vería el cartel un instante antes de que se lo
    // cambien por la tienda. Un cartel que dice «no estás habilitado» y se va
    // solo es peor que no enseñarlo.
    if (compras.isLoading || tienda.isLoading) return <LoadingState />

    const esComprador = (compras.data ?? []).length > 0
    if (esComprador && tienda.slug) return <Navigate to={`/s/${tienda.slug}`} replace />

    return (
      <UnauthorizedState
        title={t('tenant.unauthorized.title')}
        description={t('tenant.unauthorized.body')}
        action={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {/* Solo si hay una tienda a la que ir. Con varias no se elige
                ninguna: la lista de tiendas activas es la lista de clientes. */}
            {tienda.slug && (
              <Button variant="contained" component={Link} to={`/s/${tienda.slug}`}>
                {t('landing.visit')}
              </Button>
            )}
            <Button variant={tienda.slug ? 'outlined' : 'contained'} onClick={() => void signOut()}>
              {t('nav.signOut')}
            </Button>
          </Stack>
        }
      />
    )
  }

  return <>{children}</>
}
