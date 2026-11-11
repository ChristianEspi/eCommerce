import { zodResolver } from '@hookform/resolvers/zod'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useQuotedCart } from './cart/useQuotedCart'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState } from '@/shared/ui/states'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { useCart } from './cart/cart-context'
import { CheckoutSteps } from './components/CheckoutSteps'
import { CheckoutSummary } from './components/CheckoutSummary'
import { DeliveryPicker } from './components/DeliveryPicker'
import { CheckoutStepRow } from './components/CheckoutStepRow'
import { PaymentPicker } from './components/PaymentPicker'
import { useDeliveryOptions } from './delivery'
import { defaultPaymentCode, usePaymentMethods } from './payment'
import { CardFields } from './components/CardFields'
import { pareceTarjeta, tokenizarTarjeta, type DatosTarjeta } from './cardToken'
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
import { BuyerTermsNotice } from './commerce/BuyerTermsNotice'
import { useBuyerCredit } from './commerce/buyerTerms'
import { useCommerceContext } from './commerce/context'
import { addressBookKey, checkoutProfileKey, consumerOrdersKey, formatSavedAddress, type SavedAddress } from './consumer'
import { useStorefront } from './hooks'
import { privateMeta } from './seo'
import { useCheckoutPrefill } from './useCheckoutPrefill'

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
 * Los tres pasos, en orden.
 *
 * ## Por qué ahora sí es un asistente por pasos
 *
 * Hasta ahora esto era **una sola página numerada**, y el comentario que
 * ocupaba este sitio defendía esa decisión: partirla añade navegación, estado
 * y una forma nueva de perder lo escrito. Sigue siendo verdad, y por eso el
 * reparto se paga en un solo sitio —aquí— en vez de en tres pantallas con sus
 * tres rutas: **los valores no se pierden al cambiar de paso** porque
 * `react-hook-form` conserva lo registrado aunque el campo se desmonte, y no
 * hay ruta nueva, así que tampoco hay historial que pueda devolver a alguien a
 * un paso 2 sin paso 1.
 *
 * Lo que se gana a cambio es lo que pedía la pantalla: doce campos seguidos se
 * leen como un trámite, y tres decisiones cortas se leen como una compra.
 *
 * ## La lista es el orden, y también la validación
 *
 * `CAMPOS` no es documentación: es lo que se valida al pulsar «Siguiente» y lo
 * que decide a qué paso volver si el envío final encuentra un campo malo. Un
 * campo que se añada al formulario y no a esta lista pasaría el paso sin
 * comprobarse y reventaría al final, lejos de donde se escribió.
 */
/** Constante y no `[]`: un array nuevo por render cambiaría la clave de la consulta. */
const SIN_CUPONES: readonly string[] = []

const PASOS = [
  { id: 'contacto', tituloKey: 'store.checkout.contact', cortoKey: 'store.checkout.step.contact' },
  { id: 'entrega', tituloKey: 'store.checkout.step.delivery', cortoKey: 'store.checkout.step.delivery' },
  { id: 'pago', tituloKey: 'store.checkout.payment', cortoKey: 'store.checkout.payment' },
] as const satisfies ReadonlyArray<{
  id: string
  tituloKey: MessageKey
  cortoKey: MessageKey
}>

/** Campos del esquema que vive en cada paso. El índice es el del paso. */
const CAMPOS: ReadonlyArray<ReadonlyArray<keyof CheckoutValues>> = [
  ['customerName', 'customerEmail', 'customerPhone'],
  ['address', 'city', 'region', 'postalCode', 'country', 'reference'],
  // Resumen v2 · El cupón vive en el paso de PAGO, junto al total que cambia.
  ['paymentMethodCode', 'purchaseOrderNumber', 'invoiceType', 'taxId', 'legalName', 'costCenter', 'couponCode'],
]

export function StoreCheckoutPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { store, storeSlug } = useStorefront()
  const { cart, subtotal, currency, cartToken, clear, forgetServerCart } = useCart()
  const { status: sessionStatus } = useSessionContext()
  const authenticated = sessionStatus === 'authenticated'
  // N05 · ¿La cuenta con la que se compra exige orden de compra? Lo dice el
  // servidor (el mismo contexto que la barra); sin sesión o sin cuenta, no.
  const { context: contextoComercial } = useCommerceContext(storeSlug, authenticated)
  const ordenDeCompraObligatoria = contextoComercial?.purchase_order_required === true
  // Resumen v2 · Lo que dice la tarjeta del medio «crédito»: plazo y disponible.
  const credito = useBuyerCredit(storeSlug)

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

  /** Cupón ya confirmado por el comprador. Ver `irA`. */
  const [cuponCotizado, setCuponCotizado] = useState<readonly string[]>(SIN_CUPONES)
  const { quote, quoted } = useQuotedCart(storeSlug, cuponCotizado)

  const {
    register,
    control,
    setValue,
    getValues,
    trigger,
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
      // H08 · El país que la tienda configuró al definir su cobertura. Sin
      // él, vacío como siempre: nunca un país escrito en el código.
      country: store.default_country ?? '',
      deliveryMethodCode: '',
      pickupPointId: '',
      paymentMethodCode: '',
      purchaseOrderNumber: '',
      invoiceType: 'receipt',
      taxId: '',
      legalName: '',
      costCenter: '',
    },
  })

  /**
   * Resumen v2 · Al elegir FACTURA, la razón social se propone con el nombre
   * de la cuenta de empresa. No se elige factura de entrada: sin el RUC —que
   * la vitrina no conoce— esa elección dejaría el pago bloqueado hasta que el
   * comprador lo escriba. Solo se rellena si está vacía: nunca se pisa lo
   * que escribió.
   */
  const tipoComprobante = useWatch({ control, name: 'invoiceType' })
  useEffect(() => {
    if (tipoComprobante !== 'invoice' || !contextoComercial) return
    if ((getValues('legalName') ?? '') === '') setValue('legalName', contextoComercial.account_name)
  }, [tipoComprobante, contextoComercial, getValues, setValue])

  /**
   * H04 · Lo que ya sabemos de quien compra con sesión.
   *
   * Se rellena UNA vez y solo lo que siga vacío: si el comprador ya empezó a
   * escribir, lo suyo manda. Sin sesión, `ready` nunca llega y el checkout de
   * invitado no cambia en nada.
   */
  const prefill = useCheckoutPrefill(storeSlug, authenticated)
  const prefilled = useRef(false)
  useEffect(() => {
    if (!prefill.ready || prefilled.current) return
    prefilled.current = true
    const actuales = getValues()
    if (!actuales.customerName && prefill.name) setValue('customerName', prefill.name)
    if (!actuales.customerEmail && prefill.email) setValue('customerEmail', prefill.email)
    if (!actuales.customerPhone && prefill.phone) setValue('customerPhone', prefill.phone)
  }, [prefill.ready, prefill.name, prefill.email, prefill.phone, getValues, setValue])

  /** Elegir una dirección guardada escribe los campos de entrega, y nada más. */
  const usarDireccion = (direccion: SavedAddress) => {
    const opciones = { shouldValidate: true, shouldDirty: true } as const
    setValue('address', direccion.address, opciones)
    setValue('reference', direccion.reference ?? '', opciones)
    setValue('city', direccion.city ?? '', opciones)
    setValue('region', direccion.region ?? '', opciones)
    setValue('postalCode', direccion.postal_code ?? '', opciones)
    setValue('country', (direccion.country ?? '').toUpperCase(), opciones)
  }

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

  /**
   * La tarjeta vive en estado local y NO en el formulario.
   *
   * `react-hook-form` guarda lo que se envia, y estos datos son justo lo que
   * no se envia: se cambian por un token antes de salir del navegador. Si
   * entraran en el esquema, acabarian en el `resolver`, en los reintentos y —
   * el dia que alguien anada telemetria de formularios— en una traza.
   */
  const [tarjeta, setTarjeta] = useState<DatosTarjeta>({
    numero: '',
    mes: '',
    anio: '',
    cvv: '',
    email: '',
  })
  // «Crédito empresa» solo para quien compra con una cuenta con línea de
  // crédito. Antes se ofrecía a cualquiera —un consumidor sin empresa podía
  // confirmar un pedido «a crédito» que luego no se podía despachar sin cobro—.
  const conCredito = contextoComercial?.has_credit_terms === true
  const paymentMethods = useMemo(
    () => (payment.data ?? []).filter((metodo) => metodo.kind !== 'credit' || conCredito),
    [payment.data, conCredito],
  )

  // Se pregunta por la FAMILIA y no por el codigo: `tarjeta`, `visa` o
  // `culqi-card` son nombres que pone el comercio; `card` es del sistema.
  const medioElegido = paymentMethods.find(
    (metodo) => metodo.code === (watched.paymentMethodCode ?? ''),
  )
  const pideTarjeta = medioElegido?.kind === 'card'

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

  const [paso, setPaso] = useState(0)
  /**
   * El paso más lejano ya validado.
   *
   * Es lo que permite volver a corregir el correo desde el paso 3 con UN clic
   * en la barra en vez de dos «Anterior» seguidos —el gesto más frecuente de
   * cualquier compra—, sin abrir la puerta a saltarse un paso hacia delante.
   */
  const [alcanzado, setAlcanzado] = useState(0)
  const ultimoPaso = PASOS.length - 1

  /**
   * Lo que un paso exige y el ESQUEMA no puede exigir.
   *
   * Elegir entrega y medio de pago solo es obligatorio cuando la tienda ofrece
   * alguno, así que no cabe en un `zod` que no sabe qué tiene configurado este
   * comercio. Vive aquí, y la usan las dos puertas —«Siguiente» y «Confirmar
   * pedido»— para que no puedan discrepar.
   *
   * Ninguna de estas comprobaciones es la autoridad: las tres las vuelve a
   * exigir el servidor. Aquí solo ahorran un viaje para recibir un error que
   * ya se sabe.
   */
  const faltaEn = (indice: number): MessageKey | null => {
    const values = getValues()
    if (indice === 1) {
      if (deliveryOptions.length > 0 && !values.deliveryMethodCode) {
        return 'store.checkout.error.delivery.method'
      }
      if (selectedDelivery?.strategy === 'pickup' && !values.pickupPointId) {
        return 'store.checkout.error.delivery.pickup'
      }
    }
    if (indice === 2) {
      if (paymentMethods.length > 0 && !values.paymentMethodCode) {
        return 'store.checkout.error.payment.method'
      }
      if (ordenDeCompraObligatoria && !(values.purchaseOrderNumber ?? '').trim()) {
        return 'store.checkout.error.purchaseOrderRequired'
      }
      // Luhn en el navegador no valida una tarjeta —eso lo dice el emisor—:
      // evita gastar una llamada a la pasarela por un digito mal tecleado.
      if (pideTarjeta && !pareceTarjeta(tarjeta.numero)) return 'store.card.numberInvalid'
      if (
        pideTarjeta &&
        (tarjeta.mes.length < 1 || tarjeta.anio.length < 2 || tarjeta.cvv.length < 3)
      ) {
        return 'store.card.incomplete'
      }
    }
    return null
  }

  /**
   * Ir a un paso. Hacia atrás siempre; hacia delante, validando cada tramo.
   *
   * Se recorre paso a paso y no solo el de destino: pulsar el 3 desde el 1 con
   * la dirección vacía tiene que parar en el 2, que es donde está el problema,
   * y no dejar pasar por no haberlo mirado.
   */
  const irA = async (destino: number) => {
    if (destino <= paso) {
      setPaso(destino)
      return
    }
    for (let i = paso; i < destino; i += 1) {
      if (!(await trigger(CAMPOS[i] as Array<keyof CheckoutValues>))) {
        setPaso(i)
        return
      }
      const falta = faltaEn(i)
      if (falta) {
        setErrorKey(falta)
        setPaso(i)
        return
      }
    }
    setErrorKey(null)
    setErrorStage(null)
    setPaso(destino)
    setAlcanzado((previo) => Math.max(previo, destino))

    // El cupón se cotiza al SALIR del paso donde se escribe, no mientras se
    // teclea: cada valor distinto es una llamada al servidor, y «b», «bi»,
    // «bie»… serían seis intentos fallidos por un código de seis letras. Aquí
    // el comprador ya dijo que había terminado.
    const cupon = (getValues('couponCode') ?? '').trim()
    setCuponCotizado(cupon === '' ? SIN_CUPONES : [cupon])
  }

  /** La línea de un paso plegado: lo que se eligió en él, o qué se hará. */
  const resumenDe = (indice: number): string => {
    if (indice === 0) {
      return [watched.customerName, watched.customerEmail, watched.customerPhone]
        .map((valor) => (valor ?? '').trim())
        .filter(Boolean)
        .join(' · ')
    }
    if (indice === 1) {
      const donde = [watched.address, watched.city].map((valor) => (valor ?? '').trim()).filter(Boolean).join(', ')
      return [donde, selectedDelivery?.name].filter(Boolean).join(' · ')
    }
    return t('store.checkout.paymentPending')
  }

  const pistasDePago = useMemo(() => {
    const pistas: Record<string, string> = {}
    if (!credito) return pistas
    for (const metodo of paymentMethods) {
      if (metodo.kind !== 'credit') continue
      pistas[metodo.code] = t('store.payment.creditHint')
        .replace('{days}', String(credito.termsDays))
        .replace('{amount}', formatMoney(credito.available, credito.currency ?? currency, locale))
    }
    return pistas
  }, [credito, paymentMethods, t, currency, locale])

  const mutation = useMutation({
    mutationFn: async (input: { values: CheckoutValues; acceptPriceChanges: boolean }) => {
      /**
       * La tarjeta se cambia por un token ANTES de llamar al checkout.
       *
       * Aqui y no en el servidor porque ese intercambio ocurre contra la
       * pasarela desde el propio navegador: es lo que mantiene el numero
       * fuera de todo el backend y, con el, el alcance de PCI.
       */
      const paymentToken = pideTarjeta
        ? await tokenizarTarjeta({ ...tarjeta, email: input.values.customerEmail })
        : null

      writePendingAttempt(storeSlug, { key: idempotencyKey, startedAt: Date.now() })
      return startCheckout({
        paymentToken,
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
      // Lo que «Mi cuenta» y el siguiente checkout leen de ESTA compra —sus
      // pedidos y las direcciones usadas— dejó de ser verdad. Sin esto la
      // primera compra de una cuenta nueva seguía diciendo «todavía no hay
      // direcciones» durante el minuto de caché (defecto previo, N00).
      void queryClient.invalidateQueries({ queryKey: checkoutProfileKey(storeSlug) })
      void queryClient.invalidateQueries({ queryKey: consumerOrdersKey(storeSlug) })
      void queryClient.invalidateQueries({ queryKey: addressBookKey(storeSlug) })
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
   * Cambiar de paso devuelve la vista al principio del formulario.
   *
   * Sin esto, quien viene de elegir la entrega —abajo del todo en el paso 2—
   * aterriza en el paso 3 mirando el pie de la tarjeta, con los campos de la
   * tarjeta fuera de pantalla, y parece que no ha pasado nada.
   */
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'auto' })
    } catch {
      // jsdom no implementa `scrollTo`. Que un entorno sin scroll no pueda
      // desplazarse no es un error: es que no hay a dónde.
    }
  }, [paso])

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
    handleSubmit(
      (values) => {
        // Doble candado contra el doble envío: el botón se deshabilita mientras la
        // mutación está en vuelo y, además, un segundo submit (Enter repetido, doble
        // clic rápido) no llega a disparar nada. Ninguno de los dos es la garantía:
        // la garantía es la clave de idempotencia del servidor.
        if (mutation.isPending) return

        // Las MISMAS comprobaciones que abren cada paso, y en el mismo sitio: si
        // esta lista y la de «Siguiente» pudieran discrepar, un día una dejaría
        // pasar lo que la otra rechaza. Se repasan todas y no solo las del paso
        // visible, porque un submit puede llegar por Enter desde cualquiera.
        for (let i = 0; i < PASOS.length; i += 1) {
          const falta = faltaEn(i)
          if (falta) {
            setErrorKey(falta)
            setPaso(i)
            return
          }
        }

        setErrorKey(null)
        setErrorStage(null)
        mutation.mutate({ values, acceptPriceChanges })
      },
      (invalidos) => {
        // Un campo inválido de un paso que ya no está en pantalla dejaría el
        // botón sin hacer nada visible: ni error, ni pedido. Se vuelve al paso
        // que lo contiene, que es donde está el mensaje.
        const primero = CAMPOS.findIndex((campos) => campos.some((campo) => campo in invalidos))
        if (primero >= 0) setPaso(primero)
      },
    )
  const stageKey = mapCheckoutStage(errorStage)

  const enUltimo = paso === ultimoPaso

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
        // Solo queda un camino hasta aqui: el Enter del teclado. Y solo compra
        // desde el ultimo paso — un Enter en el campo del nombre no puede
        // saltarse la entrega y el pago.
        onSubmit={(evento) => {
          evento.preventDefault()
          if (enUltimo) void submit(false)()
        }}
        noValidate
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 3 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        {/* Resumen v2 · La barra de pasos, a todo el ancho y encima de las
            dos columnas, como en el diseño «Checkout B2B enfocado». */}
        <Box sx={{ gridColumn: '1 / -1' }}>
          <CheckoutSteps
            pasos={PASOS.map((definicion) => ({
              id: definicion.id,
              titulo: t(definicion.cortoKey),
            }))}
            actual={paso}
            alcanzado={alcanzado}
            onIr={(indice) => void irA(indice)}
          />
        </Box>

        <Stack sx={{ gap: 1.5, minWidth: 0 }}>
        {/* Los pasos HECHOS, plegados: lo que se eligió y «Cambiar». */}
        {PASOS.slice(0, paso).map((definicion, indice) => (
          <CheckoutStepRow
            key={definicion.id}
            numero={indice + 1}
            titulo={t(definicion.tituloKey)}
            resumen={resumenDe(indice)}
            estado="hecho"
            onCambiar={() => void irA(indice)}
          />
        ))}

        {/* Los tokens de la vitrina y no los del backoffice: el comprador
            viene de una tienda con esquinas redondeadas y sombra suave, y
            aterrizar en un formulario plano se lee como haber salido del
            sitio justo cuando va a pagar. El paso ACTIVO lleva el borde en el
            color de la tienda: es donde está la decisión. */}
        <Card
          data-checkout-active-step={PASOS[paso]!.id}
          sx={{
            p: { xs: 2, md: 3 },
            borderRadius: 'var(--sf-radius)',
            border: '2px solid var(--accent)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, mb: 2 }}>
            <Box
              aria-hidden
              sx={{
                width: 28,
                height: 28,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                background: 'var(--hero-grad)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {paso + 1}
            </Box>
            <Typography component="h2" sx={{ fontSize: TS.cardTitle, fontWeight: 800 }}>
              {t(PASOS[paso]!.tituloKey)}
            </Typography>
          </Stack>

          <Stack sx={{ gap: 2 }}>
            {paso === 0 && (
              <>
                <TextField
                  label={t('store.checkout.name')}
                  autoComplete="name"
                  required
                  error={Boolean(errors.customerName)}
                  helperText={
                    errors.customerName ? t(errors.customerName.message as MessageKey) : ' '
                  }
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
              </>
            )}

            {paso === 1 && (
              <>
                {/* H04 · las direcciones de sus pedidos anteriores, para ELEGIR.
                    No se escribe ninguna sola: una entrega en la casa de antes
                    por no mirar el formulario es peor que teclear una línea. */}
                {prefill.addresses.length > 0 && (
                  <Box>
                    <Typography
                      id="direcciones-guardadas"
                      sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--muted)', mb: 0.75 }}
                    >
                      {t('store.checkout.savedAddresses')}
                    </Typography>
                    <Stack
                      direction="row"
                      role="group"
                      aria-labelledby="direcciones-guardadas"
                      sx={{ gap: 1, flexWrap: 'wrap' }}
                    >
                      {prefill.addresses.map((direccion, indice) => (
                        <Chip
                          key={`${formatSavedAddress(direccion)}-${indice}`}
                          clickable
                          variant={watched.address === direccion.address ? 'filled' : 'outlined'}
                          color={watched.address === direccion.address ? 'primary' : 'default'}
                          label={direccion.label ? `${direccion.label} · ${formatSavedAddress(direccion)}` : formatSavedAddress(direccion)}
                          onClick={() => usarDireccion(direccion)}
                          sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
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
                  faltaPais={deliveryAddress.country === undefined}
                />
                {deliveryOptions.length > 0 && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('store.delivery.help')}
                  </Typography>
                )}
              </>
            )}

            {paso === 2 && (
              <>
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
                  hints={pistasDePago}
                />

                {/* Los datos de la tarjeta solo cuando se ha elegido una: pedir
                    un numero de tarjeta a quien va a pagar por transferencia es
                    pedir un dato que nadie va a usar. */}
                {pideTarjeta && <CardFields datos={tarjeta} onCambio={setTarjeta} error={null} />}

                {/* Resumen v2 · El comprobante, en UNA fila: tipo, RUC y razón
                    social. Boleta no pide nada más; factura pide RUC y razón
                    social, que el servidor vuelve a validar. */}
                <Divider />
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  sx={{ gap: 1.5, alignItems: { md: 'flex-start' } }}
                  data-checkout-invoice={watched.invoiceType ?? 'receipt'}
                >
                  <Stack sx={{ gap: 0.5, flexShrink: 0 }}>
                    <Typography component="h3" sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--muted)' }}>
                      {t('store.checkout.invoiceTitle')}
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={watched.invoiceType ?? 'receipt'}
                      aria-label={t('store.checkout.invoiceTitle')}
                      onChange={(_, next: 'receipt' | 'invoice' | null) => next && setValue('invoiceType', next)}
                      sx={{ alignSelf: 'flex-start', '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 2 } }}
                    >
                      <ToggleButton value="receipt">{t('store.checkout.invoiceReceipt')}</ToggleButton>
                      <ToggleButton value="invoice">{t('store.checkout.invoiceInvoice')}</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  {watched.invoiceType === 'invoice' && (
                    <>
                      <TextField
                        label={t('store.checkout.taxId')}
                        required
                        autoComplete="off"
                        sx={{ width: { md: 180 }, flexShrink: 0 }}
                        error={Boolean(errors.taxId)}
                        helperText={errors.taxId ? t(errors.taxId.message as MessageKey) : undefined}
                        slotProps={{ htmlInput: { maxLength: 20, inputMode: 'numeric', style: { fontFamily: 'monospace' } } }}
                        {...register('taxId')}
                      />
                      <TextField
                        label={t('store.checkout.legalName')}
                        required
                        fullWidth
                        autoComplete="organization"
                        error={Boolean(errors.legalName)}
                        helperText={errors.legalName ? t(errors.legalName.message as MessageKey) : undefined}
                        slotProps={{ htmlInput: { maxLength: 200 } }}
                        {...register('legalName')}
                      />
                    </>
                  )}
                </Stack>

                {/* Orden de compra y centro de costo, lado a lado. N05 · la OC solo
                    si la cuenta la EXIGE; el centro de costo solo para empresa. */}
                {(ordenDeCompraObligatoria || contextoComercial) && (
                <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5 }}>
                {ordenDeCompraObligatoria && (
                  <TextField
                    id="checkout-purchase-order"
                    label={t('store.checkout.purchaseOrder')}
                    required
                    fullWidth
                    autoComplete="off"
                    placeholder="OC-2026-00125"
                    error={Boolean(errors.purchaseOrderNumber) || errorKey === 'store.checkout.error.purchaseOrderRequired'}
                    helperText={
                      errors.purchaseOrderNumber
                        ? t(errors.purchaseOrderNumber.message as MessageKey)
                        : t('store.checkout.purchaseOrderHelp')
                    }
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                    {...register('purchaseOrderNumber')}
                  />
                )}
                  {contextoComercial && (
                    <TextField
                      label={t('store.checkout.costCenter')}
                      fullWidth
                      autoComplete="off"
                      error={Boolean(errors.costCenter)}
                      helperText={
                        errors.costCenter
                          ? t(errors.costCenter.message as MessageKey)
                          : t('store.checkout.costCenterHelp')
                      }
                      slotProps={{ htmlInput: { maxLength: 60 } }}
                      {...register('costCenter')}
                    />
                  )}
                </Stack>
                )}

                {/* P10 · el cupón, en el paso de pago y con su botón al lado. Lo
                    que se manda es TEXTO: si descuenta y cuánto lo decide el
                    servidor. «Aplicar» cotiza AHORA: quien teclea un código
                    quiere ver si descuenta antes de confirmar. */}
                {/* Sin texto de ayuda fijo: el botón se estira al alto del campo
                    y quedan alineados, como en el diseño. El error sí se dice. */}
                <Stack direction="row" sx={{ gap: 1, alignItems: 'stretch' }}>
                  <TextField
                    fullWidth
                    label={t('store.checkout.coupon')}
                    placeholder={t('store.checkout.couponPlaceholder')}
                    error={Boolean(errors.couponCode)}
                    {...(errors.couponCode ? { helperText: t(errors.couponCode.message as MessageKey) } : {})}
                    inputProps={{ style: { textTransform: 'uppercase' } }}
                    {...register('couponCode')}
                  />
                  <Button
                    type="button"
                    variant="outlined"
                    onClick={() => {
                      const cupon = (getValues('couponCode') ?? '').trim()
                      setCuponCotizado(cupon === '' ? SIN_CUPONES : [cupon])
                    }}
                    sx={{ fontWeight: 800, flexShrink: 0, px: 2.5 }}
                  >
                    {t('store.checkout.couponApply')}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>

          {/* El aviso vive junto a los botones y no en el resumen: casi todos
              estos errores («elige cómo quieres recibirlo») señalan un campo de
              ESTE paso, y leerlos en la otra columna obliga a buscar dónde. */}
          {errorKey && (
            <Alert severity="error" sx={{ mt: 2 }} role="alert" tabIndex={-1} ref={alertRef}>
              {t(errorKey)}
              {stageKey && (
                <Typography component="span" sx={{ display: 'block', fontSize: TS.label, mt: 0.5 }}>
                  {t(stageKey)}
                </Typography>
              )}
            </Alert>
          )}

          {/* La acción de avanzar está SIEMPRE en el mismo sitio: «Siguiente»,
              «Siguiente», «Confirmar pedido». Mover el botón de compromiso a la
              otra columna en el último paso obligaría a buscarlo justo en el
              momento en el que menos hay que hacer dudar a nadie. */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mt: 2.5 }}>
            {paso > 0 && (
              <Button
                type="button"
                variant="text"
                onClick={() => void irA(paso - 1)}
                startIcon={<ArrowBackRoundedIcon />}
                sx={{ color: 'var(--accent-deep)' }}
              >
                {t('store.checkout.back')}
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            {/* NINGUNO de los dos es `type="submit"`, y esto no es un descuido.
                Ocupan el mismo sitio, asi que React reutiliza el nodo y le
                cambiaba el `type` al cambiar de paso; como validar es asincrono,
                ese cambio caia en el microtask que se drena ANTES de que el
                navegador ejecutara la accion por defecto del clic, y el
                «Siguiente» que te llevaba al paso 3 enviaba el formulario el
                solo. Con un solo medio de pago —que se preselecciona— ese envio
                fantasma no daba ningun error: registraba el pedido.

                Verificado en un navegador de verdad, no en jsdom: alli el
                encadenamiento de microtasks no se reproduce y el fallo no se ve.
                Un boton sin accion por defecto no puede tener ese eco. */}
            {enUltimo ? (
              <Button
                type="button"
                variant="contained"
                disabled={mutation.isPending}
                onClick={() => void submit(false)()}
                /* Un botón gris con otro texto no se lee como «está pasando
                   algo»: se lee como «se rompió». El giro es lo que distingue
                   una espera de un bloqueo, y aquí la espera puede durar lo que
                   tarde la pasarela. */
                startIcon={
                  mutation.isPending ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <LockRoundedIcon />
                  )
                }
              >
                {mutation.isPending ? t('store.checkout.sending') : t('store.checkout.submit')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="contained"
                onClick={() => void irA(paso + 1)}
                endIcon={<ArrowForwardRoundedIcon />}
              >
                {t('store.checkout.next')}
              </Button>
            )}
          </Stack>

          {/* Confirmar el precio nuevo reintenta con la MISMA clave: es la misma
              compra, no una segunda. */}
          {priceChanged && !mutation.isPending && (
            <Button
              type="button"
              variant="outlined"
              fullWidth
              sx={{ mt: 1.5 }}
              onClick={() => void submit(true)()}
            >
              {t('store.checkout.acceptPrices')}
            </Button>
          )}
        </Card>

        {/* Los pasos que FALTAN, plegados: se ve cuánto queda. */}
        {PASOS.slice(paso + 1).map((definicion, desplazamiento) => (
          <CheckoutStepRow
            key={definicion.id}
            numero={paso + desplazamiento + 2}
            titulo={t(definicion.tituloKey)}
            resumen={t(`store.checkout.pendingHint.${definicion.id}` as MessageKey)}
            estado="pendiente"
          />
        ))}
        </Stack>

        <CheckoutSummary
          lines={cart.lines}
          quoted={quoted}
          subtotalLocal={Number(subtotal)}
          currencyLocal={currency}
          envio={
            selectedDelivery?.available
              ? { amount: shippingAmount, currency: selectedDelivery.currency }
              : null
          }
          estado={
            quote.isFetching
              ? 'pidiendo'
              : quoted
                ? 'confirmada'
                : quote.isError
                  ? 'fallida'
                  : 'sinPedir'
          }
          acciones={
            <>
              {priceChanged && (
                <Chip
                  size="small"
                  color="warning"
                  label={t('store.cart.priceChanged')}
                  sx={{ mt: 1 }}
                />
              )}
              {/* Crédito y aprobación, al lado del total: es donde se decide. */}
              <Box sx={{ mt: 1.5 }}>
                <BuyerTermsNotice
                  storeSlug={storeSlug}
                  total={quoted?.grossTotal ?? null}
                  currency={quoted?.currency ?? currency}
                  compact
                />
              </Box>
              {/* Lo que se promete cambia con el medio elegido. Dejar «todavía no
                  cobramos en línea» debajo de un formulario de tarjeta que SÍ
                  cobra es la clase de frase que se descubre cuando ya no toca. */}
              <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 0.75, mt: 1.5 }}>
                <LockRoundedIcon
                  aria-hidden
                  sx={{ fontSize: 14, color: 'var(--accent-deep)', mt: '2px', flexShrink: 0 }}
                />
                <Typography sx={{ fontSize: TS.micro, color: 'var(--muted)' }}>
                  {pideTarjeta ? t('store.checkout.securePay') : t('store.checkout.noPayment')}
                </Typography>
              </Stack>
            </>
          }
        />
      </Box>
    </>
  )
}
