import { Button, Stack } from '@mui/material'
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useDefaultStoreSlug, useMyStores } from '@/features/storefront/default-store'
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
 * Lo que sí los distingue es un dato de servidor: `my_stores()`, que no acepta
 * argumentos y resuelve el vínculo contra `business_account_users` y de ahí a
 * las tiendas de esa sociedad. Un navegador no puede hacerse pasar por
 * comprador de nadie.
 *
 * ## A SU tienda, no a una cualquiera
 *
 * La primera versión de esto mandaba a la tienda por defecto del DESPLIEGUE —el
 * slug declarado, o la única tienda activa del proyecto—. Con una sola tienda
 * acierta por casualidad; con dos, manda al comprador de una empresa a la
 * vitrina de otra. Ahora el destino sale del vínculo, y la del despliegue queda
 * como último recurso para quien no es comprador de nadie.
 *
 * Con varias tiendas propias no se elige por la persona: se le enseñan las
 * suyas. No es la lista de clientes del SaaS, son las tiendas donde ya compra.
 *
 * Sin ninguna no se adivina: mandar a la vitrina a un empleado mal configurado
 * le esconde su problema real, así que se le deja el cartel y, si hay tienda a
 * la que ir, también la puerta.
 *
 * Las consultas van con `enabled` atado a este estado: un miembro normal del
 * backoffice no paga llamadas por un caso que no es el suyo.
 */
export function RequireTenant({ children }: { children: ReactNode }) {
  const { status, error, refetch } = useTenant()
  const { signOut } = useSessionContext()
  const { t } = useI18n()

  const sinJerarquia = status === 'unauthorized'
  const mias = useMyStores(sinJerarquia)
  const porDefecto = useDefaultStoreSlug(sinJerarquia)

  if (status === 'loading') return <LoadingState />
  if (status === 'error') return <ErrorState error={error} onRetry={refetch} />
  if (status === 'onboarding') return <Navigate to="/onboarding" replace />

  if (sinJerarquia) {
    // Sin esperar, un comprador vería el cartel un instante antes de que se lo
    // cambien por la tienda. Un cartel que dice «no estás habilitado» y se va
    // solo es peor que no enseñarlo.
    if (mias.isLoading || porDefecto.isLoading) return <LoadingState />

    const propias = mias.data ?? []
    // Una sola: no hay nada que preguntar.
    if (propias.length === 1 && propias[0]) {
      return <Navigate to={`/s/${propias[0].slug}`} replace />
    }

    return (
      <UnauthorizedState
        title={t('tenant.unauthorized.title')}
        description={propias.length > 1 ? t('tenant.buyer.pickStore') : t('tenant.unauthorized.body')}
        action={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {/* Las SUYAS, con su nombre. No es la lista de clientes del SaaS:
                son las tiendas donde esta persona ya compra. */}
            {propias.map((tienda) => (
              <Button key={tienda.slug} variant="contained" component={Link} to={`/s/${tienda.slug}`}>
                {t('landing.visitNamed').replace('{store}', tienda.name)}
              </Button>
            ))}
            {/* Último recurso, solo para quien no compra en ninguna: la tienda
                del despliegue, si es que hay una sola y por tanto no hay que
                elegir por nadie. */}
            {propias.length === 0 && porDefecto.slug && (
              <Button variant="contained" component={Link} to={`/s/${porDefecto.slug}`}>
                {t('landing.visit')}
              </Button>
            )}
            <Button
              variant={propias.length > 0 || porDefecto.slug ? 'outlined' : 'contained'}
              onClick={() => void signOut()}
            >
              {t('nav.signOut')}
            </Button>
          </Stack>
        }
      />
    )
  }

  return <>{children}</>
}
