import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { Link, useLocation } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useMyAccounts, useMyPendingAccounts } from '@/features/customers/hooks'
import { StoreNotificationsSection } from '@/features/notifications/StoreNotificationsSection'
import { formatAddress } from '@/features/customers/types'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { AccountStatementSection } from './account/AccountStatementSection'
import { useStoreAccounts } from './commerce/accounts'
import { ConsumerAccount } from './account/ConsumerAccount'
import { MyCouponsSection } from './account/MyCouponsSection'
import { MyOrdersSection } from './account/MyOrdersSection'
import { MySuggestionsSection } from './account/MySuggestionsSection'
import { useStorefrontOptional } from './hooks'
import { privateMeta } from './seo'

/**
 * Área de cuenta del comprador B2B (P05-SaaS).
 *
 * **De dónde sale lo que se ve, y de dónde NO.** Todo llega de
 * `my_business_accounts()`, una función de servidor que no acepta ni un
 * argumento: el vínculo entre la persona con sesión y su cuenta lo resuelve la
 * base contra `business_account_users`. La URL de la tienda no decide nada aquí
 * —ni el slug, ni un id de cuenta, ni nada guardado en el navegador—, que es la
 * regla 8 de la fase: el acceso a una cuenta exige vínculo servidor.
 *
 * **Por qué usa el cliente con sesión y no el de la vitrina.** El catálogo lo
 * lee un cliente anónimo a propósito (policies `to anon`); esto exige un JWT,
 * porque sin él no hay a quién preguntarle por su cuenta.
 *
 * **Y los tres estados, que son tres y no dos.** Sin sesión no es lo mismo que
 * con sesión y sin cuenta: al primero se le invita a entrar, al segundo se le
 * dice que su usuario no está vinculado a ninguna empresa, y solo el tercero
 * ve datos. Juntarlos mandaría a alguien a reintentar el login para arreglar
 * algo que un administrador tiene que vincular.
 *
 * El comprador todavía no compra en nombre de su cuenta: el checkout sigue
 * siendo anónimo hasta que la identidad del comprador exista (P16). Lo que ya
 * existe es el contexto, y está aquí para que se vea que existe.
 */
export function StoreAccountPage() {
  const { t, locale } = useI18n()
  // `useStorefrontOptional`: esta pantalla es la única de la vitrina que
  // también se monta suelta —vive en la ruta de la tienda pero la prueba
  // `features/customers`, que es de quien es el dominio—. Sin tienda resuelta
  // no hay metadatos que declarar, y no tenerlos no puede impedir que el
  // comprador vea su cuenta.
  const storefront = useStorefrontOptional()
  const { status } = useSessionContext()
  const location = useLocation()

  // Carrito, checkout, cuenta y seguimiento NO se indexan (P15-SaaS). No es
  // pudor: son estado de una sesión, no contenido, y el seguimiento además
  // lleva el token del pedido en la URL. `robots.txt` pide que no se rastreen;
  // esto impide que se indexen si alguien las enlaza desde fuera.
  useDocumentMeta(
    storefront
      ? privateMeta(
          {
            store: storefront.store,
            storeSlug: storefront.storeSlug,
            locale,
            pathname: `/s/${storefront.storeSlug}`,
          },
          t('account.title'),
          '/account',
        )
      : null,
  )

  const authenticated = status === 'authenticated'
  const query = useMyAccounts(authenticated)
  // Solo hace falta cuando no hay ningún vínculo activo: es el único caso en el
  // que cambia lo que se le dice al comprador.
  const pending = useMyPendingAccounts(
    authenticated && query.isSuccess && (query.data ?? []).length === 0,
  )
  // Con varias cuentas, cuál es la EFECTIVA en esta tienda (N01): la misma que
  // usan el precio y el checkout. Con una sola no hay nada que distinguir.
  const efectivas = useStoreAccounts(
    storefront?.storeSlug ?? '',
    authenticated && (query.data ?? []).length > 1,
  )
  const efectiva = (efectivas.data ?? []).find((cuenta) => cuenta.is_effective)?.account_id ?? null

  if (status === 'loading') return <LoadingState />

  if (!authenticated) {
    return (
      <EmptyState
        title={t('account.signedOut')}
        description={t('account.signedOutBody')}
        icon={<ApartmentRoundedIcon fontSize="small" />}
        action={
          // Vuelve AQUÍ al entrar (N02), y quien no tiene cuenta puede crearla en
          // esta tienda sin pasar por el alta de empresas.
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button component={Link} to="/login" state={{ from: location.pathname }} variant="contained" size="small">
              {t('auth.submit')}
            </Button>
            {storefront && (
              <Button
                component={Link}
                to={`/s/${storefront.storeSlug}/register`}
                state={{ from: location.pathname }}
                variant="outlined"
                size="small"
              >
                {t('store.register.submit')}
              </Button>
            )}
          </Stack>
        }
      />
    )
  }

  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const accounts = query.data ?? []

  if (accounts.length === 0) {
    if (pending.isPending) return <LoadingState />

    /**
     * Sin cuenta de empresa ACTIVA: la cuenta del consumidor (hardening H02).
     *
     * Antes caía en «tu usuario no está vinculado a ninguna empresa», que es
     * cierto y no le sirve de nada a quien compra para sí. Ahora ve lo suyo
     * —pedidos, favoritos, datos, direcciones y avisos— y, si una empresa lo
     * vinculó y todavía no activó su acceso, se le dice arriba sin taparle la
     * cuenta: el nombre de la empresa es concreto y lo que falta también.
     */
    return (
      <ConsumerAccount
        storeSlug={storefront?.storeSlug ?? null}
        storeId={storefront?.store.store_id ?? null}
        pendingAccountNames={(pending.data ?? []).map((cuenta) => cuenta.name)}
      />
    )
  }

  /**
   * Cuatro secciones y no cuatro pantallas.
   *
   * Un comprador entra a su cuenta por una de cuatro razones —ver qué pidió,
   * cuánto debe, qué cupones tiene o revisar sus datos— y las cuatro son la
   * misma sesión sobre la misma cuenta. `SectionTabs` es el patrón de suite
   * para eso, con `#hash`: la pestaña abierta se comparte y sobrevive al
   * refresco, que es lo que hace falta cuando alguien manda «mira mi estado de
   * cuenta» por chat.
   */
  const resumen = (
    <Stack spacing={3}>
      {accounts.map((account) => (
        <Card key={account.account_id}>
          <CardContent>
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}
              >
                <Stack>
                  <Typography component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
                    {account.name}
                  </Typography>
                  <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                    {account.customer_name} · {account.code}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  {account.account_id === efectiva && (
                    <Chip size="small" color="success" label={t('store.commerce.buyingFor')} />
                  )}
                  <Chip size="small" color="primary" label={t(`customers.role.${account.role}`)} />
                  {account.requires_approval && (
                    <Chip size="small" color="warning" label={t('account.needsApproval')} />
                  )}
                  {account.purchase_order_required && (
                    <Chip size="small" label={t('customers.field.purchaseOrder')} />
                  )}
                </Stack>
              </Stack>

              {account.spending_limit && (
                <Typography sx={{ fontSize: 13 }}>
                  {t('customers.field.spendingLimit')}: <strong>{account.spending_limit}</strong>
                </Typography>
              )}

              <Divider />

              <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                {t('customers.tab.locations')}
              </Typography>
              {account.locations.length === 0 ? (
                <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                  {t('customers.locations.empty')}
                </Typography>
              ) : (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  {account.locations.map((location) => (
                    <Chip
                      key={location.id}
                      size="small"
                      color={location.is_default ? 'primary' : 'default'}
                      label={`${location.code} · ${location.name}`}
                    />
                  ))}
                </Stack>
              )}

              <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                {t('customers.tab.addresses')}
              </Typography>
              {account.addresses.length === 0 ? (
                <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                  {t('customers.addresses.empty')}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('customers.field.label')}</TableCell>
                      <TableCell>{t('customers.field.address')}</TableCell>
                      <TableCell>{t('customers.field.use')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {account.addresses.map((address) => (
                      <TableRow key={address.id}>
                        <TableCell sx={{ fontWeight: 700 }}>{address.label}</TableCell>
                        <TableCell>{formatAddress(address)}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                            {address.is_shipping && (
                              <Chip
                                size="small"
                                color={address.is_default_shipping ? 'primary' : 'default'}
                                label={t('customers.address.shipping')}
                              />
                            )}
                            {address.is_billing && (
                              <Chip
                                size="small"
                                color={address.is_default_billing ? 'primary' : 'default'}
                                label={t('customers.address.billing')}
                              />
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800 }}>
          {t('account.title')}
        </Typography>

        {/* La vuelta a comprar, explícita.
            El logotipo de la cabecera ya lleva a la portada de la tienda, pero
            eso hay que saberlo: quien entra a mirar su deuda y decide reponer
            no debería tener que adivinar dónde se pulsa. Solo aparece con
            tienda resuelta —esta pantalla también se monta suelta— porque sin
            slug no hay a dónde ir. */}
        {storefront && (
          <Button
            variant="outlined"
            size="small"
            component={Link}
            to={`/s/${storefront.storeSlug}`}
            startIcon={<StorefrontRoundedIcon fontSize="small" />}
            sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' }, flexShrink: 0 }}
          >
            {t('account.keepShopping')}
          </Button>
        )}
      </Stack>

      <SectionTabs
        ariaLabel={t('account.title')}
        items={[
          { id: 'pedidos', label: t('account.tab.orders'), content: <MyOrdersSection storeSlug={storefront?.storeSlug ?? ''} /> },
          { id: 'estado', label: t('account.tab.statement'), content: <AccountStatementSection /> },
          // Los cupones son de UNA tienda: sin tienda resuelta no hay a quien
          // preguntarle, y la pestaña no se ofrece en vez de fallar dentro.
          ...(storefront
            ? [{ id: 'cupones', label: t('account.tab.coupons'), content: <MyCouponsSection storeId={storefront.store.store_id} /> }]
            : []),
          // `sugeridos` es el ancla a la que lleva el aviso «tienes un pedido
          // sugerido»: cambiar el id rompe ese enlace.
          {
            id: 'sugeridos',
            label: t('account.tab.suggestions'),
            content: <MySuggestionsSection storeId={storefront?.store.store_id ?? null} />,
          },
          { id: 'avisos', label: t('account.tab.notifications'), content: <StoreNotificationsSection /> },
          { id: 'cuenta', label: t('account.tab.summary'), content: resumen },
        ]}
      />
    </Stack>
  )
}
