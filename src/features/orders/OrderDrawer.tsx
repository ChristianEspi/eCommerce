import { useCopilotEntity } from '@/features/ai/copilot/copilot-context'
import { StatusChip } from '@/shared/ui/StatusChip'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatDateTime, formatMoney, formatTime } from '@/shared/lib/format'
import { isSafeExternalUrl } from '@/domain/href'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useAiFeature } from '@/features/ai/hooks'
import { OrderAiPanel } from './ai/OrderAiPanel'
import type { OrderDrawerTab } from './ai/ordersAi'
import { OrderError } from './errors'
import {
  APPROVAL_COLOR,
  APPROVAL_LABEL,
  AXIS_LABEL,
  EVENT_SCOPE_LABEL,
  EVENT_SOURCE_LABEL,
  EVENT_TYPE_LABEL,
  FULFILLMENT_COLOR,
  FULFILLMENT_LABEL,
  PAYMENT_COLOR,
  PAYMENT_LABEL,
  SOURCE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  factMove,
  valueLabel,
} from './status'
import { ORDER_AXES, nextForAxis, type Order, type OrderAxis } from './types'
import {
  useAddOrderExternalRef,
  useAddOrderNote,
  useAddOrderTag,
  useDecideApproval,
  useDeleteOrderExternalRef,
  useDeleteOrderNote,
  useDeleteOrderTag,
  useOrder,
  useOrderEvents,
  useOrderExternalRefs,
  useOrderItems,
  useOrderNotes,
  useOrderTags,
  useTransitionOrder,
} from './useOrders'

function errorKeyOf(error: unknown): MessageKey {
  return error instanceof OrderError ? error.key : 'orders.error.generic'
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography
        component="h3"
        sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: 'var(--muted)', mb: hint ? 0.25 : 1 }}
      >
        {title}
      </Typography>
      {hint && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', mb: 1.25 }}>{hint}</Typography>
      )}
      {children}
    </Box>
  )
}

/**
 * Rótulo de un bloque DENTRO de una sección.
 *
 * El panel de estados era una pila plana: un atajo, dos desplegables, una nota y
 * un botón, todos con el mismo peso visual y sin nada que dijera cuáles van
 * juntos. Agrupar es lo que convierte esa lista en tres decisiones —lo de
 * siempre, lo demás, lo irreversible— en vez de siete controles.
 */
function Bloque({
  title,
  hint,
  tone = 'muted',
  children,
}: {
  /**
   * Sin título cuando el bloque va SOLO: el rótulo existe para separar de los
   * de al lado, y «Cualquier otro cambio» sin nada delante nombra un contraste
   * que no está en la pantalla.
   */
  title?: string
  hint?: string
  tone?: 'muted' | 'danger'
  children: ReactNode
}) {
  return (
    <Box>
      {title && (
        <Typography
          component="h4"
          sx={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: tone === 'danger' ? 'var(--red)' : 'var(--muted)',
            mb: hint ? 0.25 : 1,
          }}
        >
          {title}
        </Typography>
      )}
      {hint && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', mb: 1.25 }}>{hint}</Typography>
      )}
      {children}
    </Box>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', py: 0.4 }}>
      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value}</Typography>
    </Stack>
  )
}

/**
 * Detalle del pedido en panel lateral: el listado sigue detrás, así que quien
 * revisa un pedido no pierde la búsqueda ni la pestaña de estado (mismo criterio
 * que el alta de producto en P04).
 *
 * **Ningún camino de escritura pasa por un `update`.** Los tres ejes de estado
 * se mueven con `public.order_transition`, que además de la máquina de estados
 * escribe la línea de tiempo y publica el hecho de dominio; la decisión B2B, con
 * `public.order_approval_decide`. Las transiciones que ofrece el desplegable
 * salen de la copia local de la máquina, pero quien decide sigue siendo el
 * trigger: si las dos se separaran, el servidor responde con su código y aquí se
 * ve el motivo.
 *
 * Pestañas locales y NO `SectionTabs`: ese componente escribe el `#hash` de la
 * URL para que la pestaña sea compartible, y un panel lateral no es una ruta —
 * el hash se quedaría pegado al cerrar el panel.
 */
export function OrderDrawer({
  order,
  open,
  canWrite,
  onClose,
  initialTab,
}: {
  order: Order | null
  open: boolean
  canWrite: boolean
  onClose: () => void
  /**
   * Pestaña con la que se abre. La usa la IA del listado: su acción sugerida
   * lleva a la pestaña del flujo normal (p. ej. «Operación» para el cobro).
   */
  initialTab?: OrderDrawerTab
}) {
  const { t, locale } = useI18n()
  // La pestaña de IA solo existe para los roles de la funcionalidad `orders`.
  const { availability: aiAvailability } = useAiFeature('orders')
  const showAi = aiAvailability !== 'forbidden' && aiAvailability !== 'loading'
  const { notify } = useFeedback()
  const orderId = order?.id ?? null
  // El Copilot sabe qué pedido está abierto (tipo + id; la RLS decide).
  useCopilotEntity('order', open ? orderId : null)

  // El pedido se relee: la fila del listado se queda vieja en cuanto cambia un
  // eje, y al lado se estaría pintando una línea de tiempo que sí está al día.
  const detail = useOrder(open ? orderId : null, order ?? undefined)
  const items = useOrderItems(open ? orderId : null)
  const events = useOrderEvents(open ? orderId : null)
  const notes = useOrderNotes(open ? orderId : null)
  const tags = useOrderTags(open ? orderId : null)
  const refs = useOrderExternalRefs(open ? orderId : null)

  const transition = useTransitionOrder()
  const decide = useDecideApproval()
  const addNote = useAddOrderNote()
  const removeNote = useDeleteOrderNote()
  const addTag = useAddOrderTag()
  const removeTag = useDeleteOrderTag()
  const addRef = useAddOrderExternalRef()
  const removeRef = useDeleteOrderExternalRef()

  const [tab, setTab] = useState<string>(initialTab ?? 'summary')
  const [axis, setAxis] = useState<OrderAxis>('order_status')
  const [nextValue, setNextValue] = useState('')
  const [reason, setReason] = useState('')
  const [approvalReason, setApprovalReason] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [refSystem, setRefSystem] = useState('')
  const [refType, setRefType] = useState('invoice')
  const [refValue, setRefValue] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  // Al abrir otro pedido el formulario arranca limpio: arrastrar el motivo del
  // anterior lo pegaría en la línea de tiempo del nuevo.
  useEffect(() => {
    setTab(initialTab ?? 'summary')
    setAxis('order_status')
    setNextValue('')
    setReason('')
    setApprovalReason('')
    setNoteBody('')
    setTagInput('')
    setRefSystem('')
    setRefType('invoice')
    setRefValue('')
  }, [orderId, initialTab])

  const current = detail.data ?? order
  // Al cambiar de eje el destino elegido deja de tener sentido.
  useEffect(() => {
    setNextValue('')
  }, [axis])

  if (!current) return null

  /**
   * El pedido está cobrado y entregado, y su eje comercial sigue abierto.
   *
   * Es el único cruce de los cuatro ejes en el que la pantalla puede decir algo
   * útil sin decidir nada: quedan las dos mitades hechas y falta cerrar la
   * carpeta.
   */
  const cerrable =
    current.payment_status === 'paid' &&
    current.fulfillment_status === 'fulfilled' &&
    (current.status === 'pending' || current.status === 'paid')

  /**
   * La venta ya está cerrada: lo único que queda es deshacerla.
   *
   * Desde `fulfilled` los tres ejes solo ofrecen marcha atrás —`refunded` en el
   * comercial, `refunded`/`partially_refunded` en el pago, `returned` en la
   * entrega—. No es un caso raro: es la mitad de la vida de un pedido, y llamar
   * a eso «Cambiar de estado» hace que el operador abra el desplegable para
   * averiguar si todavía puede avanzarlo.
   */
  const postVenta = current.status === 'fulfilled'

  /**
   * Los atajos con nombre.
   *
   * No son transiciones nuevas: son las MISMAS que ofrece el desplegable, con la
   * etiqueta que usaría una persona. Solo aparecen si la máquina las permite
   * desde donde está el pedido, así que la lista se vacía sola en los estados
   * terminales en vez de ofrecer botones que fallan.
   *
   * Son dos y no diez a propósito. Un atajo por transición sería el desplegable
   * otra vez, en horizontal: lo que hace útil esta fila es que solo estén las
   * que se piden a diario, y que lo raro siga estando —completo— debajo.
   */
  const atajos: Array<{
    key: MessageKey
    axis: OrderAxis
    to: string
    primary?: boolean
    destructive?: boolean
    /** Pide confirmación y motivo antes de ejecutar. Solo lo irreversible. */
    confirm?: boolean
  }> = []
  if (nextForAxis('payment_status', current.payment_status).includes('paid')) {
    atajos.push({ key: 'orders.quick.markPaid', axis: 'payment_status', to: 'paid', primary: true })
  }
  if (nextForAxis('order_status', current.status).includes('cancelled')) {
    atajos.push({
      key: 'orders.quick.cancel',
      axis: 'order_status',
      to: 'cancelled',
      destructive: true,
      confirm: true,
    })
  }

  /**
   * Los atajos, separados por lo que cuesta deshacerlos.
   *
   * Mezclados en una fila, «Marcar como cobrado» y «Cancelar pedido» pesan lo
   * mismo y están a un centímetro. Y cuando el pedido ya está cobrado el único
   * atajo que queda es el rojo: el panel se abría con lo irreversible como
   * primer botón de la pantalla.
   */
  const frecuentes = atajos.filter((atajo) => !atajo.destructive)
  const peligrosos = atajos.filter((atajo) => atajo.destructive)

  /**
   * Cerrar el ciclo comercial, que son DOS tramos y no uno.
   *
   * `pending → fulfilled` no existe: la máquina obliga a pasar por `paid`. Se
   * recorren los dos porque el pedido pasó por los dos de verdad —está cobrado—
   * y la línea de tiempo tiene que contarlo igual que si alguien los hubiera
   * pulsado a mano. Saltárselo sería inventar un camino que la base rechaza,
   * que es exactamente lo que pasó la primera vez que escribí esto.
   */
  async function cerrarPedido() {
    if (current!.status === 'pending') {
      await transition.mutateAsync({
        orderId: orderRef,
        axis: 'order_status',
        to: 'paid',
        reason: '',
      })
    }
    await transition.mutateAsync({
      orderId: orderRef,
      axis: 'order_status',
      to: 'fulfilled',
      reason: '',
    })
  }

  const busy =
    transition.isPending ||
    decide.isPending ||
    addNote.isPending ||
    removeNote.isPending ||
    addTag.isPending ||
    removeTag.isPending ||
    addRef.isPending ||
    removeRef.isPending

  const money = (value: string) => formatMoney(Number(value), current.currency, locale)
  const orderRef = current.id
  const currentOf: Record<OrderAxis, string> = {
    order_status: current.status,
    payment_status: current.payment_status,
    fulfillment_status: current.fulfillment_status,
  }
  const allowed = nextForAxis(axis, currentOf[axis])
  /** El valor ACTUAL del eje elegido, para poder enseñar de dónde sale. */
  const valorActual = currentOf[axis]
  const awaitingApproval = current.approval_status === 'pending'
  /**
   * «Cualquier otro cambio» solo tiene sentido si ARRIBA hay algo de lo que ser
   * el otro. Sin la fila de atajos frecuentes, el cambio manual es la sección
   * entera y su rótulo nombra un contraste que no está en la pantalla.
   */
  const hayAtajos = frecuentes.length > 0 && !awaitingApproval

  async function run(action: () => Promise<unknown>, toast: MessageKey, after?: () => void) {
    try {
      await action()
      notify(t(toast))
      after?.()
    } catch (error) {
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  const summary = (
    <Stack spacing={3} divider={<Divider flexItem />}>
      <Section title={t('common.status')}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
            <StatusChip
              tone={STATUS_COLOR[current.status]}
              label={t(STATUS_LABEL[current.status])}
            />
            <StatusChip
              tone={PAYMENT_COLOR[current.payment_status]}
              label={t(PAYMENT_LABEL[current.payment_status])}
            />
            <StatusChip
              tone={FULFILLMENT_COLOR[current.fulfillment_status]}
              label={t(FULFILLMENT_LABEL[current.fulfillment_status])}
            />
            {current.approval_status !== 'not_required' && (
              <StatusChip
                tone={APPROVAL_COLOR[current.approval_status]}
                label={t(APPROVAL_LABEL[current.approval_status])}
              />
            )}
          </Stack>
          <Field label={t('orders.source')} value={t(SOURCE_LABEL[current.source_channel])} />
        </Stack>
      </Section>

      {current.approval_status !== 'not_required' && (
        <Section title={t('orders.approval')}>
          <Stack spacing={1.5}>
            {awaitingApproval ? (
              <Alert severity="warning">{t('orders.approval.blocked')}</Alert>
            ) : (
              <Field
                label={t('orders.approval.decidedBy')}
                value={current.approval_decided_email ?? '—'}
              />
            )}
            {current.approval_reason && (
              <Field label={t('orders.approval.reason')} value={current.approval_reason} />
            )}
            {awaitingApproval && canWrite && (
              <>
                <TextField
                  size="small"
                  label={t('orders.approval.reasonField')}
                  helperText={t('orders.approval.reasonHelp')}
                  value={approvalReason}
                  onChange={(event) => setApprovalReason(event.target.value)}
                  inputProps={{ maxLength: 1000 }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          decide.mutateAsync({
                            orderId: orderRef,
                            approve: true,
                            reason: approvalReason,
                          }),
                        'orders.toast.approved',
                        () => setApprovalReason(''),
                      )
                    }
                  >
                    {t('orders.approval.approve')}
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    disabled={busy || approvalReason.trim() === ''}
                    onClick={() =>
                      void run(
                        () =>
                          decide.mutateAsync({
                            orderId: orderRef,
                            approve: false,
                            reason: approvalReason,
                          }),
                        'orders.toast.rejected',
                        () => setApprovalReason(''),
                      )
                    }
                  >
                    {t('orders.approval.reject')}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Section>
      )}

      <Section title={t('common.customer')}>
        <Field
          label={t('orders.customer.name')}
          value={current.customer_snapshot?.name ?? current.customer_name ?? '—'}
        />
        <Field
          label={t('orders.customer.email')}
          value={current.customer_snapshot?.email ?? current.customer_email}
        />
        <Field
          label={t('orders.customer.phone')}
          value={current.customer_snapshot?.phone ?? current.customer_phone ?? '—'}
        />
        {current.customer_snapshot?.account_name && (
          <Field
            label={t('orders.customer.account')}
            value={current.customer_snapshot.account_name}
          />
        )}
        {current.customer_snapshot?.tax_id && (
          <Field label={t('orders.customer.taxId')} value={current.customer_snapshot.tax_id} />
        )}
        {current.purchase_order_number && (
          <Field label={t('orders.customer.purchaseOrder')} value={current.purchase_order_number} />
        )}
      </Section>

      <Section title={t('orders.delivery')}>
        <Field
          label={t('orders.delivery.address')}
          value={current.shipping_address?.address || '—'}
        />
        <Field
          label={t('orders.delivery.reference')}
          value={current.shipping_address?.reference || '—'}
        />
        <Field
          label={t('orders.billing.address')}
          value={current.billing_address?.address || '—'}
        />
      </Section>

      <Section title={t('orders.items')}>
        {items.isPending && <LoadingState />}
        {items.isError && <ErrorState error={items.error} onRetry={() => void items.refetch()} />}
        {items.isSuccess && items.data.length === 0 && (
          <EmptyState title={t('orders.items.empty')} />
        )}
        {items.isSuccess && items.data.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('orders.item.name')}</TableCell>
                <TableCell align="right">{t('orders.item.qty')}</TableCell>
                <TableCell align="right">{t('orders.item.unit')}</TableCell>
                <TableCell align="right">{t('orders.item.tax')}</TableCell>
                <TableCell align="right">{t('common.total')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                      {[item.sku, item.uom_code, item.price_list_code].filter(Boolean).join(' · ')}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {item.quantity}
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {money(item.unit_price)}
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {/* `null` no es cero: es una línea anterior a P08, en la
                        que el impuesto por línea no se registró. */}
                    {item.tax_amount === null ? '—' : money(item.tax_amount)}
                  </TableCell>
                  <TableCell align="right" className="tnum">
                    {money(item.line_total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={t('orders.totals')}>
        <Field label={t('orders.totals.subtotal')} value={money(current.subtotal)} />
        <Field label={t('orders.totals.tax')} value={money(current.tax_total)} />
        <Field label={t('orders.totals.shipping')} value={money(current.shipping_total)} />
        <Field label={t('orders.totals.discount')} value={money(current.discount_total)} />
        <Divider sx={{ my: 1 }} />
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 800 }}>{t('common.total')}</Typography>
          <Typography sx={{ fontWeight: 800 }} className="tnum">
            {money(current.grand_total)}
          </Typography>
        </Stack>
        {current.tax_inclusive && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 1 }}>
            {t('orders.totals.taxInclusive')}
          </Typography>
        )}
      </Section>
    </Stack>
  )

  const operation = (
    <Stack spacing={3} divider={<Divider flexItem />}>
      {/* Con la venta cerrada, «Cambiar de estado» sugiere que el pedido todavía
          puede avanzar. No puede: desde «Entregado» los tres ejes solo ofrecen
          marcha atrás —reembolsar, reembolsar en parte, devolver—. La sección se
          llama por lo que de verdad hace, y lo dice antes de que alguien abra el
          desplegable a ver qué hay. */}
      <Section
        title={t(postVenta ? 'orders.transitionAfter' : 'orders.transition')}
        hint={postVenta ? t('orders.transitionAfterHelp') : undefined}
      >
        <Stack spacing={2.5}>
          {/* Cobrado, entregado… y el ciclo comercial sigue en «pendiente».
              Los cuatro ejes son independientes a propósito, pero eso deja un
              hueco real: nadie mueve el comercial y el pedido se queda años
              listado bajo la pestaña «Pendiente». No se decide por nadie —eso
              sería inventar una regla de negocio en la interfaz— pero deja de
              ser invisible, y cerrarlo es un clic. */}
          {canWrite && cerrable && (
            <Alert
              severity="info"
              action={
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => void run(cerrarPedido, 'orders.toast.updated')}
                >
                  {t('orders.closeNow')}
                </Button>
              }
            >
              {t('orders.closeHint')}
            </Alert>
          )}
          {!canWrite && <Alert severity="info">{t('orders.status.readOnly')}</Alert>}
          {canWrite && awaitingApproval && (
            <Alert severity="warning">{t('orders.approval.blocked')}</Alert>
          )}

          {/* Lo que se hace todos los días, con su nombre.
              El desplegable de abajo sigue siendo la puerta completa —los tres
              ejes, todos sus destinos— pero obliga a traducir «ya me pagaron» a
              «eje Pago, estado Pagado», que es vocabulario de quien programó
              esto y no de quien lo usa. Estas son las dos transiciones que se
              piden a diario; el resto sigue una línea más abajo. */}
          {canWrite && !awaitingApproval && frecuentes.length > 0 && (
            <Bloque title={t('orders.quick.title')}>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                {frecuentes.map((atajo) => (
                  <Button
                    key={atajo.key}
                    size="small"
                    variant={atajo.primary ? 'contained' : 'outlined'}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          transition.mutateAsync({
                            orderId: orderRef,
                            axis: atajo.axis,
                            to: atajo.to,
                            reason: '',
                          }),
                        'orders.toast.updated',
                      )
                    }
                  >
                    {t(atajo.key)}
                  </Button>
                ))}
              </Stack>
            </Bloque>
          )}

          {canWrite && (
            <Bloque
              title={hayAtajos ? t('orders.manual.title') : undefined}
              hint={t('orders.manual.help')}
            >
              <Stack spacing={1.5}>
                {/* Los dos desplegables son UNA frase —«mueve la Entrega a
                    Empaquetado»— y en dos filas separadas no lo parecían: entre
                    el primero y el segundo cabía la duda de si el de abajo
                    dependía del de arriba. En fila, y con el estado actual
                    debajo del primero, la dependencia se ve. */}
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  sx={{ '& > .MuiFormControl-root': { flex: 1, minWidth: 0 } }}
                >
                  {/* De dónde SALE, no solo a dónde va.
                      Elegir un destino sin ver el origen convierte «Nuevo
                      estado» en una lista sin contexto: los valores cambian al
                      cambiar de eje —cada uno tiene su vocabulario— y sin el
                      punto de partida no hay forma de saber por qué. */}
                  <TextField
                    select
                    size="small"
                    label={t('orders.axis')}
                    value={axis}
                    onChange={(event) => setAxis(event.target.value as OrderAxis)}
                    helperText={`${t('orders.axisNow')}: ${t(valueLabel(axis, valorActual) as MessageKey)}`}
                  >
                    {ORDER_AXES.map((value) => (
                      <MenuItem key={value} value={value}>
                        {t(AXIS_LABEL[value])}
                      </MenuItem>
                    ))}
                  </TextField>

                  {allowed.length > 0 && (
                    <TextField
                      select
                      size="small"
                      label={t('orders.newStatus')}
                      value={nextValue}
                      onChange={(event) => setNextValue(event.target.value)}
                      helperText={t('orders.newStatusHelp')}
                    >
                      {allowed.map((value) => (
                        <MenuItem key={value} value={value}>
                          {t(valueLabel(axis, value) as MessageKey)}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </Stack>

                {allowed.length === 0 ? (
                  <Alert severity="info">{t('orders.status.final')}</Alert>
                ) : (
                  <>
                    <TextField
                      size="small"
                      label={t('orders.note')}
                      helperText={t('orders.noteHelp')}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      multiline
                      minRows={2}
                      inputProps={{ maxLength: 1000 }}
                    />
                    <Box>
                      <Button
                        variant="contained"
                        disabled={busy || nextValue === ''}
                        onClick={() =>
                          void run(
                            () =>
                              transition.mutateAsync({
                                orderId: orderRef,
                                axis,
                                to: nextValue,
                                reason,
                              }),
                            'orders.toast.updated',
                            () => {
                              setNextValue('')
                              setReason('')
                            },
                          )
                        }
                      >
                        {t('orders.applyStatus')}
                      </Button>
                    </Box>
                  </>
                )}
              </Stack>
            </Bloque>
          )}

          {/* Lo irreversible, al final y separado.
              Estaba ARRIBA del todo: al abrir un pedido ya cobrado, el primer
              —y a veces único— botón del panel era «Cancelar pedido» en rojo.
              Lo que se hace todos los días va primero; lo que no se deshace, al
              fondo, detrás de una línea y con su propio rótulo. */}
          {canWrite && !awaitingApproval && peligrosos.length > 0 && (
            <>
              <Divider flexItem />
              <Bloque title={t('orders.danger.title')} hint={t('orders.danger.help')} tone="danger">
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  {peligrosos.map((atajo) => (
                    <Button
                      key={atajo.key}
                      size="small"
                      variant="outlined"
                      color="error"
                      disabled={busy}
                      onClick={() => {
                        // Cancelar es TERMINAL: el pedido no vuelve a moverse.
                        if (atajo.confirm) {
                          setCancelReason('')
                          setCancelOpen(true)
                          return
                        }
                        void run(
                          () =>
                            transition.mutateAsync({
                              orderId: orderRef,
                              axis: atajo.axis,
                              to: atajo.to,
                              reason: '',
                            }),
                          'orders.toast.updated',
                        )
                      }}
                    >
                      {t(atajo.key)}
                    </Button>
                  ))}
                </Stack>
              </Bloque>
            </>
          )}
        </Stack>
      </Section>

      <Section title={t('orders.tags')}>
        <Stack spacing={1.5}>
          {tags.isSuccess && tags.data.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
              {t('orders.tags.empty')}
            </Typography>
          )}
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
            {(tags.data ?? []).map((tag) => (
              <Chip
                key={tag.id}
                size="small"
                label={tag.tag}
                onDelete={
                  canWrite
                    ? () => void run(() => removeTag.mutateAsync(tag.id), 'orders.toast.tagRemoved')
                    : undefined
                }
              />
            ))}
          </Stack>
          {canWrite && (
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label={t('orders.tags.add')}
                helperText={t('orders.tags.help')}
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                inputProps={{ maxLength: 40 }}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                disabled={busy || tagInput.trim() === ''}
                onClick={() =>
                  void run(
                    () => addTag.mutateAsync({ orderId: orderRef, tag: tagInput }),
                    'orders.toast.tagAdded',
                    () => setTagInput(''),
                  )
                }
              >
                {t('common.add')}
              </Button>
            </Stack>
          )}
        </Stack>
      </Section>

      <Section title={t('orders.notes')}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('orders.notes.help')}
          </Typography>
          {current.notes && (
            <Alert severity="info" icon={false}>
              <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
                {t('orders.notes.fromBuyer')}
              </Typography>
              <Typography sx={{ fontSize: 13 }}>{current.notes}</Typography>
            </Alert>
          )}
          {notes.isPending && <LoadingState />}
          {notes.isSuccess && notes.data.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
              {t('orders.notes.empty')}
            </Typography>
          )}
          {(notes.data ?? []).map((note) => (
            <Stack
              key={note.id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
            >
              <Box>
                <Typography sx={{ fontSize: 13 }}>{note.body}</Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                  {[note.author_email, formatDateTime(note.created_at, locale)]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
              {canWrite && (
                <IconButton
                  size="small"
                  aria-label={t('orders.notes.delete')}
                  disabled={busy}
                  onClick={() =>
                    void run(() => removeNote.mutateAsync(note.id), 'orders.toast.noteRemoved')
                  }
                >
                  <DeleteRoundedIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          ))}
          {canWrite && (
            <>
              <TextField
                size="small"
                label={t('orders.notes.add')}
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                multiline
                minRows={2}
                inputProps={{ maxLength: 4000 }}
              />
              <Box>
                <Button
                  variant="outlined"
                  disabled={busy || noteBody.trim() === ''}
                  onClick={() =>
                    void run(
                      () => addNote.mutateAsync({ orderId: orderRef, body: noteBody }),
                      'orders.toast.noteAdded',
                      () => setNoteBody(''),
                    )
                  }
                >
                  {t('common.add')}
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </Section>

      <Section title={t('orders.externalRefs')}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('orders.externalRefs.help')}
          </Typography>
          {refs.isSuccess && refs.data.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
              {t('orders.externalRefs.empty')}
            </Typography>
          )}
          {(refs.data ?? []).map((ref) => (
            <Stack
              key={ref.id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{ref.external_id}</Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                  {`${ref.system_code} · ${ref.ref_type}`}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5}>
                {/* El destino lo escribe quien registra la referencia. Se
                    comprueba en el borde por el que entra al DOM: un `http(s)`
                    de verdad, sin barra invertida ni caracteres de control
                    (P16-SaaS). Lo que no vale, no se pinta. */}
                {isSafeExternalUrl(ref.external_url) && (
                  <IconButton
                    size="small"
                    aria-label={t('orders.externalRefs.open')}
                    component="a"
                    href={ref.external_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <OpenInNewRoundedIcon fontSize="small" />
                  </IconButton>
                )}
                {canWrite && (
                  <IconButton
                    size="small"
                    aria-label={t('orders.externalRefs.delete')}
                    disabled={busy}
                    onClick={() =>
                      void run(() => removeRef.mutateAsync(ref.id), 'orders.toast.refRemoved')
                    }
                  >
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </Stack>
          ))}
          {canWrite && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                size="small"
                label={t('orders.externalRefs.system')}
                value={refSystem}
                onChange={(event) => setRefSystem(event.target.value)}
                inputProps={{ maxLength: 41 }}
              />
              <TextField
                size="small"
                label={t('orders.externalRefs.type')}
                value={refType}
                onChange={(event) => setRefType(event.target.value)}
                inputProps={{ maxLength: 41 }}
              />
              <TextField
                size="small"
                label={t('orders.externalRefs.value')}
                value={refValue}
                onChange={(event) => setRefValue(event.target.value)}
                inputProps={{ maxLength: 120 }}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                disabled={busy || refSystem.trim() === '' || refValue.trim() === ''}
                onClick={() =>
                  void run(
                    () =>
                      addRef.mutateAsync({
                        orderId: orderRef,
                        systemCode: refSystem,
                        refType,
                        externalId: refValue,
                      }),
                    'orders.toast.refAdded',
                    () => {
                      setRefSystem('')
                      setRefValue('')
                    },
                  )
                }
              >
                {t('common.add')}
              </Button>
            </Stack>
          )}
        </Stack>
      </Section>
    </Stack>
  )

  /**
   * La línea de tiempo, que ahora se lee en una dirección declarada.
   *
   * Venía ordenada de la más antigua a la más reciente y no lo decía en ninguna
   * parte: cuatro bloques iguales con una fecha cada uno, y el lector tenía que
   * comparar horas para deducir hacia dónde avanza el relato. Tres cosas lo
   * resuelven sin cambiar el orden —que es el bueno, porque un pedido se cuenta
   * desde que nace—:
   *
   *  1. **Se dice.** «Se lee de arriba abajo» encima de la lista.
   *  2. **Se ve.** Un raíl vertical une los puntos: una secuencia, no cuatro
   *     párrafos sueltos. El último punto va en acento y con su etiqueta.
   *  3. **La fecha deja de repetirse.** Solo aparece cuando cambia el día; el
   *     resto de filas llevan la hora. Tres «7 set. 2026» seguidos no informan
   *     de nada y ocupan el sitio del titular.
   */
  const history = (
    <Section title={t('orders.history')} hint={t('orders.history.order')}>
      {events.isPending && <LoadingState />}
      {events.isError && <ErrorState error={events.error} onRetry={() => void events.refetch()} />}
      {events.isSuccess && events.data.length === 0 && (
        <EmptyState title={t('orders.history.empty')} description={t('orders.history.emptyBody')} />
      )}
      {events.isSuccess && events.data.length > 0 && (
        <Stack component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {events.data.map((event, indice) => {
            const ultimo = indice === events.data.length - 1
            const previo = indice > 0 ? events.data[indice - 1] : null
            const diaNuevo =
              !previo || formatDate(previo.created_at, locale) !== formatDate(event.created_at, locale)

            // El movimiento: de los ejes sale de las columnas; el de la entrega
            // viaja en `payload` porque no es un eje del pedido.
            const salto = factMove(event.event_type, event.payload ?? {})
            const titular = event.axis
              ? `${event.from_value ? `${t(valueLabel(event.axis, event.from_value) as MessageKey)} → ` : ''}${t(valueLabel(event.axis, event.to_value) as MessageKey)}`
              : salto
                ? `${salto.from ? `${t(salto.from)} → ` : ''}${t(salto.to)}`
                : t(EVENT_TYPE_LABEL[event.event_type] ?? 'orders.history.other')
            const ambito = event.axis
              ? AXIS_LABEL_ANY[event.axis]
              : EVENT_SCOPE_LABEL[event.event_type]

            return (
              <Box
                component="li"
                key={event.id}
                sx={{ display: 'grid', gridTemplateColumns: '14px 1fr', columnGap: 1.5 }}
              >
                {/* El raíl es decorativo: el orden ya lo lleva el `<ol>` y la
                    fecha de cada fila. Un lector de pantalla no gana nada
                    oyendo «punto, línea, punto». */}
                <Box
                  aria-hidden
                  sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}
                >
                  {!ultimo && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 14,
                        bottom: 0,
                        width: '2px',
                        bgcolor: 'var(--border)',
                      }}
                    />
                  )}
                  <Box
                    sx={{
                      position: 'relative',
                      mt: '5px',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      border: '2px solid',
                      bgcolor: ultimo ? 'var(--accent)' : 'var(--card)',
                      borderColor: ultimo ? 'var(--accent)' : 'var(--border)',
                    }}
                  />
                </Box>

                <Stack spacing={0.25} sx={{ pb: ultimo ? 0 : 2 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
                  >
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                      {event.event_type === 'order.created' ? t('orders.history.created') : titular}
                    </Typography>
                    {ambito && <StatusChip label={t(ambito)} />}
                    {ultimo && <StatusChip tone="success" label={t('orders.history.last')} />}
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                    {diaNuevo
                      ? formatDateTime(event.created_at, locale)
                      : formatTime(event.created_at, locale)}
                    {' · '}
                    {event.actor_email ?? t(EVENT_SOURCE_LABEL[event.source])}
                  </Typography>
                  {event.note && <Typography sx={{ fontSize: 13 }}>{event.note}</Typography>}
                </Stack>
              </Box>
            )
          })}
        </Stack>
      )}
    </Section>
  )

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      busy={busy}
      width={680}
      title={current.order_number}
      subtitle={formatDateTime(current.placed_at, locale)}
      actions={
        <Button variant="text" onClick={onClose} disabled={busy}>
          {t('common.close')}
        </Button>
      }
    >
      <Stack spacing={3}>
        <Tabs
          value={tab}
          onChange={(_, next: string) => setTab(next)}
          variant="fullWidth"
          aria-label={t('admin.orders.title')}
          sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
        >
          <Tab value="summary" label={t('orders.tab.summary')} />
          <Tab value="operation" label={t('orders.tab.operation')} />
          <Tab value="history" label={t('orders.tab.history')} />
          {showAi && <Tab value="ai" label={t('aiOrders.tab')} />}
        </Tabs>
        {tab === 'summary' && summary}
        {tab === 'operation' && operation}
        {tab === 'history' && history}
        {/* La IA explica; la acción sugerida solo cambia de pestaña y la
            persona actúa con los controles de siempre. */}
        {tab === 'ai' && showAi && <OrderAiPanel orderId={orderRef} onNavigate={(next) => setTab(next)} />}
      </Stack>

      {/* Cancelar es terminal, y hasta ahora era un clic sin preguntar.
          El motivo lo exige esta pantalla y no la base —`order_transition` lo
          acepta vacío— porque el hueco es real: la entrega SÍ obliga a decir por
          qué se anula, y el pedido no. Mientras esa asimetría siga en la base,
          al menos no se cuela por aquí. */}
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('orders.cancel.title')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'var(--muted)', mb: 2 }}>
            {t('orders.cancel.body')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            size="small"
            label={t('orders.cancel.reason')}
            helperText={t('orders.cancel.reasonHelp')}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelOpen(false)} disabled={busy}>
            {t('common.close')}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy || cancelReason.trim() === ''}
            onClick={() =>
              void run(
                () =>
                  transition.mutateAsync({
                    orderId: orderRef,
                    axis: 'order_status',
                    to: 'cancelled',
                    reason: cancelReason,
                  }),
                'orders.toast.updated',
                () => setCancelOpen(false),
              )
            }
          >
            {t('orders.cancel.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </FormDrawer>
  )
}

/**
 * Etiqueta del eje para la línea de tiempo, que también pinta `approval_status`
 * —un eje que el comando de transición no mueve y que por eso no está en
 * `AXIS_LABEL`—.
 */
const AXIS_LABEL_ANY: Record<string, MessageKey> = {
  ...AXIS_LABEL,
  approval_status: 'orders.axis.approval',
}
