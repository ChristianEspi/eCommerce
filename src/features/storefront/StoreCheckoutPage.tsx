import { zodResolver } from '@hookform/resolvers/zod'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import { Alert, AlertTitle, Box, Button, Card, Chip, Divider, Stack, TextField, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useCartQuote } from '@/features/pricing/useCartQuote'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { useCart } from './cart/cart-context'
import { DeliveryPicker } from './components/DeliveryPicker'
import { PaymentPicker } from './components/PaymentPicker'
import { useDeliveryOptions } from './delivery'
import { defaultPaymentCode, usePaymentMethods } from './payment'
import {
  CheckoutError,
  checkoutSchema,
  clearPendingAttempt,
  mapCheckoutStage,
  newIdempotencyKey,
  readPendingAttempt,
  startCheckout,
  writePendingAttempt,
  type CheckoutStage,
  type CheckoutValues,
} from './checkout'
import { useStorefront } from './hooks'
import { privateMeta } from './seo'

/**
 * Checkout: nombre, correo, teléfono, dirección y una referencia opcional.
 * **Sin pasarela de pago**: el pedido queda en `pending` y la tienda cobra por
 * su canal.
 *
 * El importe que se ve aquí se lo pregunta al SERVIDOR (P04-SaaS): la misma
 * función que va a cobrar el pedido. El subtotal del carrito es de escaparate;
 * con listas de precio por canal y escalas por cantidad, enseñar ese número al
 * lado del botón de comprar es prometer un importe que no se ha calculado. Si
 * la cotización no llega, se cae al subtotal local, se dice, y la confirmación
 * sigue mostrando los números del servidor, que son los que mandan.
 *
 * ## Lo que P07 añade a esta pantalla
 *
 * 1. **Una clave de idempotencia por intento de compra.** Se genera al montar y
 *    se conserva mientras dure el intento: los reintentos —el del comprador y
 *    el de la red— viajan con la MISMA clave, así que el servidor devuelve el
 *    mismo pedido en vez de crear el segundo. El botón deshabilitado sigue
 *    estando, pero como cortesía: la garantía es del servidor.
 *
 * 2. **Recuperación después de recargar.** Si quedó un intento a medias en esta
 *    pestaña, se recupera su clave y se le dice al comprador que volver a
 *    enviar no duplica nada. Lo único que se guarda es la clave y la hora — ni
 *    el nombre, ni el correo, ni la dirección.
 *
 * 3. **El error dice en qué etapa murió.** «No pudimos apartar el stock» en vez
 *    de «algo salió mal», porque el servidor manda la etapa con el código. Y el
 *    aviso recibe el foco: sin eso, quien navega con lector de pantalla pulsa
 *    comprar y no se entera de que no pasó nada.
 *
 * 4. **Un cambio de precio detiene la compra UNA vez.** El servidor lo detecta
 *    comparando su cotización con el snapshot del carrito —el navegador no
 *    manda ni un céntimo— y la pantalla ofrece confirmar con el precio nuevo,
 *    que reintenta con la misma clave y `accept_price_changes`.
 */
/**
 * Un paso del checkout.
 *
 * El formulario era una columna de diez campos sin una sola division: se lee
 * como un tramite largo y no como tres decisiones cortas, y esa sensacion es
 * la que hace abandonar. No es un stepper —partir la pagina en pantallas
 * anadiria navegacion, estado y una forma nueva de perder lo escrito—: es la
 * misma pagina de siempre, numerada, que da sentido de avance sin tocar el
 * flujo ni la validacion.
 *
 * El numero va `aria-hidden`: el titulo ya encabeza la seccion, y leer
 * «uno Contacto» no anade nada.
 */
function Paso({ numero, titulo }: { numero: number; titulo: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, mb: 2 }}>
      <Box
        aria-hidden
        sx={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: '999px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'var(--accent-soft)',
          color: 'var(--accent-deep)',
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {numero}
      </Box>
      <Typography component="h2" sx={{ fontSize: TS.cardTitle, fontWeight: 800 }}>
        {titulo}
      </Typography>
    </Stack>
  )
}

export function StoreCheckoutPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const { store, storeSlug } = useStorefront()
  const { cart, subtotal, currency, cartToken, clear, forgetServerCart } = useCart()
  const { status: sessionStatus } = useSessionContext()
  const authenticated = sessionStatus === 'authenticated'

  // Carrito, checkout, cuenta y seguimiento NO se indexan (P15-SaaS). No es
  // pudor: son estado de una sesión, no contenido. `robots.txt` pide que no se
  // rastreen; esto impide que se indexen si alguien las enlaza desde fuera.
  useDocumentMeta(
    privateMeta(
      { store, storeSlug, locale, pathname: `/s/${storeSlug}` },
      t('store.checkout.title'),
      '/checkout',
    ),
  )

  const [errorKey, setErrorKey] = useState<MessageKey | null>(null)
  const [errorStage, setErrorStage] = useState<CheckoutStage | null>(null)
  const [priceChanged, setPriceChanged] = useState(false)
  const alertRef = useRef<HTMLDivElement | null>(null)

  /**
   * La clave del intento. Se recupera la pendiente de esta pestaña si la hay
   * —para que reenviar devuelva el pedido que quizá ya existe— y si no, se
   * genera una nueva. `useState` con inicializador: una clave nueva por render
   * convertiría cada reintento en un pedido distinto, que es justo lo contrario
   * de lo que hace falta.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => readPendingAttempt(storeSlug)?.key ?? newIdempotencyKey(),
  )
  const [resuming] = useState(() => readPendingAttempt(storeSlug) !== null)

  // El array entra en la clave de la consulta: uno nuevo por render la
  // invalidaría en bucle. Se arma con la forma del PUERTO, no con la del
  // transporte: quien cotiza puede ser mañana el ERP del tenant.
  const requests = useMemo(
    () =>
      cart.lines.map((line) => ({
        productId: line.product_id,
        variantId: line.variant_id,
        uomCode: null,
        quantity: line.quantity,
      })),
    [cart.lines],
  )
  const quote = useCartQuote(storeSlug, currency, requests)
  const quoted = quote.data ?? null

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      address: '',
      reference: '',
      couponCode: '',
      city: '',
      region: '',
      postalCode: '',
      country: '',
      deliveryMethodCode: '',
      pickupPointId: '',
      paymentMethodCode: '',
    },
  })

  /**
   * La cotización de entrega se pide con lo que hay ESCRITO en el formulario y
   * no con lo que se envía al confirmar: el comprador tiene que ver el precio
   * del envío antes de pulsar comprar, no descubrirlo en la confirmación.
   *
   * `useWatch` y no `watch()` a secas: solo estos campos vuelven a disparar
   * esta parte, así que teclear el nombre no vuelve a cotizar el envío.
   *
   * Aquí no se calcula ninguna tarifa. El importe llega resuelto del servidor,
   * que además recalcula el subtotal por su cuenta: si viajara en la petición,
   * el umbral de envío gratis lo decidiría el navegador.
   */
  const watched = useWatch({ control })
  const deliveryAddress = useMemo(
    () => ({
      address: (watched.address ?? '').trim(),
      city: (watched.city ?? '').trim() || undefined,
      region: (watched.region ?? '').trim() || undefined,
      postal_code: (watched.postalCode ?? '').trim() || undefined,
      country: (watched.country ?? '').trim().toUpperCase() || undefined,
    }),
    [watched.address, watched.city, watched.region, watched.postalCode, watched.country],
  )
  const delivery = useDeliveryOptions({
    storeSlug,
    address: deliveryAddress,
    cart,
    enabled: cart.lines.length > 0,
  })
  const deliveryOptions = delivery.data?.options ?? []

  /**
   * Los medios de pago de la tienda (P09-SaaS).
   *
   * No dependen de la direccion ni del carrito —una tienda cobra igual en
   * Lima que en Arequipa—, asi que se piden una vez y no se recotizan al
   * teclear, al reves que la entrega.
   */
  const payment = usePaymentMethods(store.store_id)
  const paymentMethods = useMemo(() => payment.data ?? [], [payment.data])

  // Se marca solo cuando la eleccion es inequivoca: con un unico medio,
  // obligar a pulsarlo es un clic que no decide nada. Con dos o mas se deja en
  // blanco, porque «pagar con lo que salia puesto» es una reclamacion.
  useEffect(() => {
    if (paymentMethods.length === 0) return
    const porDefecto = defaultPaymentCode(paymentMethods)
    if (porDefecto) setValue('paymentMethodCode', porDefecto)
  }, [paymentMethods, setValue])
  const selectedDelivery =
    deliveryOptions.find((option) => option.code === (watched.deliveryMethodCode ?? '')) ?? null
  const shippingAmount =
    selectedDelivery?.available && selectedDelivery.amount !== null
      ? Number(selectedDelivery.amount)
      : 0

  const mutation = useMutation({
    mutationFn: (input: { values: CheckoutValues; acceptPriceChanges: boolean }) => {
      writePendingAttempt(storeSlug, { key: idempotencyKey, startedAt: Date.now() })
      return startCheckout({
        ...input.values,
        storeSlug,
        cart,
        idempotencyKey,
        cartToken,
        // Si el carrito de servidor ya no existe, el checkout reintenta sin el
        // y avisa aqui para que el token muerto no siga en el navegador.
        onCartGone: forgetServerCart,
        acceptPriceChanges: input.acceptPriceChanges,
        authenticated,
      })
    },
    onSuccess: (order, variables) => {
      // El intento se cierra y el carrito se vacía SOLO cuando el servidor
      // confirmó el pedido. Si se vaciara al enviar, un error de red dejaría al
      // comprador sin carrito y sin pedido.
      clearPendingAttempt(storeSlug)
      clear()
      // El token va en la URL, no solo en el state del router: es lo que hace
      // que la confirmacion sobreviva a una recarga y se pueda guardar.
      const permalink = order.access_token
        ? `/s/${storeSlug}/order/${order.order_number}?t=${order.access_token}`
        : `/s/${storeSlug}/order/${order.order_number}`
      // El medio elegido viaja en el estado de navegacion y no en la URL: es
      // una preferencia del comprador, no parte de la direccion del pedido.
      // Al volver por el enlace permanente no estara, y la confirmacion
      // simplemente no pinta ese bloque — el pedido ya se explica solo.
      navigate(permalink, {
        replace: true,
        state: { order, paymentMethodCode: variables.values.paymentMethodCode ?? '' },
      })
    },
    onError: (error) => {
      const checkoutError = error instanceof CheckoutError ? error : null
      setErrorKey(checkoutError?.key ?? 'store.checkout.error.generic')
      setErrorStage(checkoutError?.stage ?? null)
      setPriceChanged(checkoutError?.code === 'PRECIO_CAMBIADO')

      if (checkoutError?.code === 'PRECIO_CAMBIADO') {
        // Los precios que se ven al lado del botón dejaron de ser los buenos.
        void quote.refetch()
      }
      if (checkoutError?.code === 'IDEMPOTENCIA_EN_CONFLICTO') {
        // Esa clave ya está atada a otra petición: seguir usándola es garantía
        // de fallar otra vez. Se empieza un intento nuevo.
        clearPendingAttempt(storeSlug)
        setIdempotencyKey(newIdempotencyKey())
      }
    },
  })

  /**
   * Foco accesible en el error. Sin esto, quien usa lector de pantalla pulsa
   * «Confirmar pedido», no pasa nada visible para él y no tiene forma de saber
   * que hay un aviso arriba. El `role="alert"` lo anuncia; el foco es lo que
   * deja el cursor donde está la explicación y el botón de reintento.
   */
  useEffect(() => {
    if (errorKey) alertRef.current?.focus()
  }, [errorKey])

  /**
   * P18 · La tienda que solo vende a quien ha entrado.
   *
   * Se para ANTES del formulario, y no al pulsar «Confirmar pedido»: rellenar
   * doce campos para que al final te digan que hacía falta una cuenta es la
   * forma más cara de enterarse.
   *
   * Esto no es el guard. El guard está en el servidor, en la etapa
   * `validate_account`, contra la identidad verificada — aquí solo se evita
   * enseñar un formulario que se va a rechazar. `sessionStatus === 'loading'`
   * no cuenta como anónimo: enseñar «inicia sesión» a quien ya la tiene, medio
   * segundo, mientras se hidrata, sería peor que esperar.
   */
  if (store.checkout_requires_account && sessionStatus === 'anonymous') {
    return (
      <>
        <PageHeader title={t('store.checkout.title')} />
        <Card>
          <EmptyState
            title={t('store.checkout.signInTitle')}
            description={t('store.checkout.signInBody')}
            icon={<LockRoundedIcon fontSize="small" />}
            action={
              <Button
                component={Link}
                to="/login"
                // Vuelve AQUÍ al entrar: mandarlo al backoffice después de
                // pedirle la sesión para comprar sería perderlo.
                state={{ from: `/s/${storeSlug}/checkout` }}
                variant="contained"
              >
                {t('store.checkout.signIn')}
              </Button>
            }
          />
        </Card>
      </>
    )
  }

  if (cart.lines.length === 0 && !mutation.isPending) {
    return (
      <>
        <PageHeader title={t('store.checkout.title')} />
        <Card>
          <EmptyState
            title={t('store.cart.empty')}
            description={t('store.cart.emptyBody')}
            icon={<ShoppingCartRoundedIcon fontSize="small" />}
            action={
              <Button component={Link} to={`/s/${storeSlug}`} variant="contained">
                {t('store.cart.continue')}
              </Button>
            }
          />
        </Card>
      </>
    )
  }

  const submit = (acceptPriceChanges: boolean) =>
    handleSubmit((values) => {
      // Doble candado contra el doble envío: el botón se deshabilita mientras la
      // mutación está en vuelo y, además, un segundo submit (Enter repetido, doble
      // clic rápido) no llega a disparar nada. Ninguno de los dos es la garantía:
      // la garantía es la clave de idempotencia del servidor.
      if (mutation.isPending) return

      // Dos comprobaciones de FORMA, no de precio: que se eligió una opción
      // cuando la tienda ofrece alguna, y que un recojo dice dónde. Las dos las
      // vuelve a exigir la base; aquí evitan un viaje al servidor para recibir
      // un error que ya se sabe.
      if (deliveryOptions.length > 0 && !values.deliveryMethodCode) {
        setErrorKey('store.checkout.error.delivery.method')
        return
      }
      if (selectedDelivery?.strategy === 'pickup' && !values.pickupPointId) {
        setErrorKey('store.checkout.error.delivery.pickup')
        return
      }
      // Misma regla que la entrega: se exige elegir solo cuando hay algo que
      // elegir. Una tienda sin medios configurados sigue vendiendo.
      if (paymentMethods.length > 0 && !values.paymentMethodCode) {
        setErrorKey('store.checkout.error.payment.method')
        return
      }

      setErrorKey(null)
      setErrorStage(null)
      mutation.mutate({ values, acceptPriceChanges })
    })

  const stageKey = mapCheckoutStage(errorStage)

  return (
    <>
      <PageHeader title={t('store.checkout.title')} subtitle={t('store.checkout.subtitle')} />

      {resuming && !mutation.isSuccess && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <AlertTitle>{t('store.checkout.resumeTitle')}</AlertTitle>
          {t('store.checkout.resumeBody')}
        </Alert>
      )}

      <Box
        component="form"
        onSubmit={submit(false)}
        noValidate
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 3 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        {/* Los tokens de la vitrina y no los del backoffice: el comprador
            viene de una tienda con esquinas redondeadas y sombra suave, y
            aterrizar en un formulario plano se lee como haber salido del
            sitio justo cuando va a pagar. */}
        <Card
          sx={{
            p: { xs: 2, md: 3 },
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Paso numero={1} titulo={t('store.checkout.contact')} />

          <Stack sx={{ gap: 2 }}>
            <TextField
              label={t('store.checkout.name')}
              autoComplete="name"
              required
              error={Boolean(errors.customerName)}
              helperText={errors.customerName ? t(errors.customerName.message as MessageKey) : ' '}
              {...register('customerName')}
            />
            {/* Correo y teléfono comparten fila desde `sm`. Un teléfono con el
                ancho de una dirección no solo desperdicia espacio: sugiere que
                cabe algo más de lo que cabe, y alarga el formulario justo donde
                el comprador ya decidió y solo quiere terminar. El nombre y la
                dirección sí se quedan a lo ancho, que es lo que piden. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t('store.checkout.email')}
                type="email"
                autoComplete="email"
                required
                fullWidth
                error={Boolean(errors.customerEmail)}
                helperText={
                  errors.customerEmail
                    ? t(errors.customerEmail.message as MessageKey)
                    : t('store.checkout.emailHint')
                }
                {...register('customerEmail')}
              />
              <TextField
                label={t('store.checkout.phone')}
                type="tel"
                autoComplete="tel"
                required
                sx={{ width: { xs: '100%', sm: 220 }, flexShrink: 0 }}
                error={Boolean(errors.customerPhone)}
                helperText={
                  errors.customerPhone ? t(errors.customerPhone.message as MessageKey) : ' '
                }
                {...register('customerPhone')}
              />
            </Stack>
            <Divider sx={{ mt: 1 }} />
            <Paso numero={2} titulo={t('store.checkout.step.delivery')} />

            <TextField
              label={t('store.checkout.address')}
              autoComplete="street-address"
              required
              error={Boolean(errors.address)}
              helperText={errors.address ? t(errors.address.message as MessageKey) : ' '}
              {...register('address')}
            />
            {/* P12 · los cuatro campos de COBERTURA. Opcionales: una tienda
                sin zonas configuradas no tiene por qué pedirlos, y exigirlos
                rompería el checkout mínimo que funciona desde P06. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label={t('store.checkout.city')}
                autoComplete="address-level2"
                {...register('city')}
              />
              <TextField
                fullWidth
                label={t('store.checkout.region')}
                autoComplete="address-level1"
                {...register('region')}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label={t('store.checkout.postalCode')}
                autoComplete="postal-code"
                {...register('postalCode')}
              />
              <TextField
                fullWidth
                label={t('store.checkout.country')}
                autoComplete="country"
                inputProps={{ maxLength: 2, style: { textTransform: 'uppercase' } }}
                {...register('country')}
              />
            </Stack>
            <TextField
              label={t('store.checkout.reference')}
              error={Boolean(errors.reference)}
              helperText={
                errors.reference
                  ? t(errors.reference.message as MessageKey)
                  : t('store.checkout.referenceHint')
              }
              {...register('reference')}
            />
            {/* P10 · el cupón. Un solo campo, y lo que se manda es TEXTO: si
                descuenta y cuánto lo decide el servidor, que vuelve a evaluar
                con la fila delante y bloqueada. Aquí no se valida contra nada:
                comprobarlo en el navegador sería una segunda autoridad sobre el
                mismo dato, y la del navegador siempre acaba desactualizada. */}
            <TextField
              label={t('store.checkout.coupon')}
              error={Boolean(errors.couponCode)}
              helperText={
                errors.couponCode
                  ? t(errors.couponCode.message as MessageKey)
                  : t('store.checkout.couponHint')
              }
              inputProps={{ style: { textTransform: 'uppercase' } }}
              {...register('couponCode')}
            />
            <Divider />

            {/* P12 · cómo lo quiere recibir. Envío, recojo, reparto propio y
                entrega digital son opciones de ESTE checkout, no de otro. */}
            <DeliveryPicker
              options={deliveryOptions}
              loading={delivery.isFetching && deliveryOptions.length === 0}
              failed={delivery.isError}
              selectedCode={watched.deliveryMethodCode ?? ''}
              onSelect={(code) => {
                setValue('deliveryMethodCode', code)
                setValue('pickupPointId', '')
              }}
              selectedPickupPointId={watched.pickupPointId ?? ''}
              onSelectPickupPoint={(id) => setValue('pickupPointId', id)}
              error={null}
            />

            <Divider />
            <Paso numero={3} titulo={t('store.checkout.payment')} />

            {/* El pago va DESPUES de la entrega y antes del boton: es la
                ultima decision de la compra, y ponerlo arriba obliga a
                elegir como se paga algo cuyo total todavia no se conoce. */}
            <PaymentPicker
              methods={paymentMethods}
              loading={payment.isLoading}
              failed={payment.isError}
              selectedCode={watched.paymentMethodCode ?? ''}
              onSelect={(code) => setValue('paymentMethodCode', code)}
              error={null}
            />
            {deliveryOptions.length > 0 && (
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {t('store.delivery.help')}
              </Typography>
            )}
          </Stack>
        </Card>

        <Card
          sx={{
            p: { xs: 2, md: 2.5 },
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Typography component="h2" sx={{ fontSize: TS.cardTitle, fontWeight: 800, mb: 1.5 }}>
            {t('store.cart.summary')}
          </Typography>

          {/* Resumen previo COMPLETO: qué, cuántas, a cuánto la unidad y cuánto
              suma la línea. Un resumen que solo enseña el total obliga a
              confiar; este se puede comprobar. */}
          <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1 }}>
            {cart.lines.map((line) => {
              const quotedLine = quoted?.lines.find(
                (item) =>
                  item.productId === line.product_id &&
                  (item.variantId ?? null) === line.variant_id,
              )
              const unitPrice = quotedLine?.unitPrice.amount ?? line.unit_price
              const lineCurrency = quoted?.currency ?? line.currency
              return (
                <Stack
                  component="li"
                  key={`${line.product_id}|${line.variant_id ?? ''}`}
                  direction="row"
                  sx={{ justifyContent: 'space-between', gap: 1, fontSize: TS.body }}
                >
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', fontWeight: 600 }}>
                      {line.quantity} × {line.name}
                    </Typography>
                    <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                      {formatMoney(Number(unitPrice), lineCurrency, locale)} · {t('store.cart.each')}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: TS.body, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {formatMoney(Number(unitPrice) * line.quantity, lineCurrency, locale)}
                  </Typography>
                </Stack>
              )
            })}
          </Stack>

          <Divider sx={{ my: 1.5 }} />

          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography sx={{ fontWeight: 700 }}>{t('store.cart.subtotal')}</Typography>
            <Typography sx={{ fontWeight: 800 }}>
              {formatMoney(
                Number(quoted?.netTotal ?? subtotal),
                quoted?.currency ?? currency,
                locale,
              )}
            </Typography>
          </Stack>

          {quoted && Number(quoted.taxTotal) > 0 && (
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
              <Typography sx={{ color: 'var(--muted)' }}>{t('store.cart.tax')}</Typography>
              <Typography sx={{ color: 'var(--muted)' }}>
                {formatMoney(Number(quoted.taxTotal), quoted.currency, locale)}
              </Typography>
            </Stack>
          )}

          {/* El transporte va SEPARADO del total. Un comprador que ve un total
              mayor que la suma de sus líneas y ninguna línea que lo explique es
              un comprador que abandona el carrito. */}
          {selectedDelivery?.available && (
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
              <Typography sx={{ color: 'var(--muted)' }}>
                {t('store.delivery.shipping')}
              </Typography>
              <Typography sx={{ color: 'var(--muted)' }}>
                {shippingAmount === 0
                  ? t('store.delivery.free')
                  : formatMoney(shippingAmount, selectedDelivery.currency, locale)}
              </Typography>
            </Stack>
          )}

          {quoted && (
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
              <Typography sx={{ fontWeight: 800 }}>{t('store.cart.total')}</Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {formatMoney(Number(quoted.grossTotal) + shippingAmount, quoted.currency, locale)}
              </Typography>
            </Stack>
          )}

          {/* Estado de la cotización: siempre uno de los tres, nunca el vacío.
              «Confirmando precios…» tiene que poder distinguirse de «este es el
              precio» y de «no pudimos confirmarlo». */}
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.5 }}>
            {quote.isFetching
              ? t('store.cart.quoting')
              : quoted
                ? t('store.cart.quoted')
                : quote.isError
                  ? t('store.cart.quoteFailed')
                  : t('store.cart.taxNote')}
          </Typography>

          {priceChanged && (
            <Chip
              size="small"
              color="warning"
              label={t('store.cart.priceChanged')}
              sx={{ mt: 1 }}
            />
          )}

          {errorKey && (
            <Alert
              severity="error"
              sx={{ mt: 2 }}
              role="alert"
              tabIndex={-1}
              ref={alertRef}
            >
              {t(errorKey)}
              {stageKey && (
                <Typography component="span" sx={{ display: 'block', fontSize: TS.label, mt: 0.5 }}>
                  {t(stageKey)}
                </Typography>
              )}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={mutation.isPending}
            sx={{ mt: 2 }}
          >
            {mutation.isPending ? t('store.checkout.sending') : t('store.checkout.submit')}
          </Button>

          {/* Confirmar el precio nuevo reintenta con la MISMA clave: es la misma
              compra, no una segunda. */}
          {priceChanged && !mutation.isPending && (
            <Button
              type="button"
              variant="outlined"
              fullWidth
              sx={{ mt: 1 }}
              onClick={() => void submit(true)()}
            >
              {t('store.checkout.acceptPrices')}
            </Button>
          )}

          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 1.5 }}>
            {t('store.checkout.noPayment')}
          </Typography>
        </Card>
      </Box>
    </>
  )
}
