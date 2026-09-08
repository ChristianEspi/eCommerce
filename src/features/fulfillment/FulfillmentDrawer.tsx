import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Alert,
  Button,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useOrderItems } from '@/features/orders/useOrders'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDateTime, formatMoney } from '@/shared/lib/format'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { FulfillmentError } from './errors'
import {
  useAssignFulfillment,
  useNoteTracking,
  useOpenShipment,
  useOrderFacts,
  useShipments,
  useTrackingEvents,
  useTransitionFulfillment,
  useWarehouses,
} from './hooks'
import {
  FULFILLMENT_NEXT,
  TRACKING_STATUSES,
  newIdempotencyKey,
  type FulfillmentRow,
} from './types'

/**
 * De la clave de un hecho a su nombre.
 *
 * La línea de tiempo pintaba `fact.event_type` en crudo: en pantalla se leía
 * «fulfillment.state_changed», que es el nombre que le puso un programador, no
 * lo que pasó. Pedidos ya resolvía esto con su propia tabla; esta pantalla
 * seguía sin usarla porque sus hechos son otros —los de logística—.
 *
 * Sin entrada en la tabla se cae a la clave cruda, que se lee feo pero se lee:
 * un hecho nuevo en la base no deja una fila en blanco.
 */
/**
 * A qué estado llevó un cambio.
 *
 * Está en `payload.to` y NO en `to_value`: esa columna es de los ejes del
 * pedido, y un hecho de logística la deja nula. Sin esto, cinco pasos seguidos
 * se leían como cinco «Cambio de estado» idénticos — una línea de tiempo que
 * dice cuándo pero no a qué no responde la única pregunta que se le hace.
 */
function destinoDe(fact: { to_value: string | null; payload: Record<string, unknown> }) {
  const destino = fact.to_value ?? fact.payload.to
  if (typeof destino !== 'string') return null
  return `fulfillment.state.${destino}` as MessageKey
}

const HECHO: Record<string, MessageKey> = {
  'fulfillment.created': 'fulfillment.event.created',
  'fulfillment.assigned': 'fulfillment.event.assigned',
  'fulfillment.state_changed': 'fulfillment.event.stateChanged',
  'fulfillment.delivered': 'fulfillment.event.delivered',
  'shipment.opened': 'fulfillment.event.shipmentOpened',
  'shipment.updated': 'fulfillment.event.shipmentUpdated',
  'shipment.tracking': 'fulfillment.event.shipmentTracking',
}

/**
 * El detalle de una entrega: de dónde sale, a dónde va, qué bultos tiene y qué
 * le ha pasado.
 *
 * Tres decisiones de pantalla que vienen del dominio:
 *
 *  1. **Las acciones son las que la máquina permite** y ninguna más. La lista
 *     sale de `FULFILLMENT_NEXT`, que es copia de `ebim.fulfillment_allowed_next`.
 *     No es la autoridad —quien decide es el trigger— pero ofrecer un botón que
 *     se sabe que va a fallar es enseñar un error evitable.
 *  2. **Cancelar exige motivo**, aquí y en la base. El campo aparece al elegir
 *     `cancelled` y el botón se bloquea hasta que hay texto.
 *  3. **La guía se pide con una clave de idempotencia** que genera el navegador.
 *     Pulsar dos veces devuelve el mismo envío en vez de pagar dos guías; el
 *     botón deshabilitado es cortesía, no la garantía.
 *
 * La línea de tiempo mezcla los hechos del PEDIDO con los del seguimiento, en
 * un solo hilo ordenado: la pregunta real de quien abre esto nunca es «¿qué
 * dijo el operador?», es «¿qué pasó, y en qué orden?».
 */
export function FulfillmentDrawer({
  fulfillment,
  onClose,
}: {
  fulfillment: FulfillmentRow | null
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { can } = useTenant()
  const canOperate = can('orders.write')

  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [serviceCode, setServiceCode] = useState('')
  const [noteStatus, setNoteStatus] = useState('in_transit')
  const [noteText, setNoteText] = useState('')

  const id = fulfillment?.fulfillment_id ?? null
  const shipments = useShipments(id)
  const shipmentIds = useMemo(
    () => (shipments.data ?? []).map((entry) => entry.id),
    [shipments.data],
  )
  const tracking = useTrackingEvents(shipmentIds)
  const facts = useOrderFacts(fulfillment?.order_id ?? null)
  // Qué hay que preparar. Una pantalla de preparación que dice «Unidades: 2»
  // pero no QUÉ dos obliga a abrir el pedido en otra pestaña para hacer el
  // trabajo que esta pantalla pide.
  const items = useOrderItems(fulfillment?.order_id ?? null)
  const warehouses = useWarehouses()

  const transition = useTransitionFulfillment()
  const assign = useAssignFulfillment()
  const open = useOpenShipment()
  const note = useNoteTracking()

  const next = fulfillment ? FULFILLMENT_NEXT[fulfillment.state] : []
  const needsReason = target === 'cancelled'
  const lastShipment = (shipments.data ?? []).at(-1) ?? null

  function report(error: unknown) {
    const key: MessageKey =
      error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic'
    notify(t(key), 'error')
  }

  function close() {
    setTarget('')
    setReason('')
    setServiceCode('')
    setNoteText('')
    onClose()
  }

  async function move() {
    if (!fulfillment || target === '') return
    try {
      await transition.mutateAsync({
        fulfillmentId: fulfillment.fulfillment_id,
        to: target,
        reason,
      })
      notify(t('fulfillment.action.moved'), 'success')
      setTarget('')
      setReason('')
    } catch (error) {
      report(error)
    }
  }

  return (
    <FormDrawer
      open={fulfillment !== null}
      title={
        fulfillment
          ? `${fulfillment.order_number} · ${t('fulfillment.detail.title')} ${fulfillment.sequence}`
          : ''
      }
      subtitle={fulfillment?.method_name}
      width={640}
      busy={transition.isPending || open.isPending}
      onClose={close}
      actions={<Button onClick={close}>{t('common.close')}</Button>}
    >
      {fulfillment && (
        <Stack spacing={3}>
          {/* ---- Resumen ------------------------------------------------- */}
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <StatusChip
                label={t(`fulfillment.state.${fulfillment.state}` as MessageKey)}
              />
              <StatusChip
                label={t(`fulfillment.strategy.${fulfillment.strategy}` as MessageKey)}
              />
              {fulfillment.provider_code && (
                <StatusChip label={fulfillment.provider_code} />
              )}
              {fulfillment.is_late && (
                <StatusChip tone="error" label={t('fulfillment.field.late')} />
              )}
              {/* Solo cuando falta cobrar: es lo único que cambia lo que se
                  hace con el paquete. Un «Cobrado» permanente sería adorno. */}
              {fulfillment.payment_status !== 'paid' && (
                <StatusChip tone="warning" label={t('fulfillment.detail.unpaid')} />
              )}
            </Stack>

            {fulfillment.payment_status !== 'paid' && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t('fulfillment.detail.unpaidHelp')}
              </Alert>
            )}

            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
              {t('fulfillment.field.units')}: {fulfillment.unit_count} ·{' '}
              {t('fulfillment.field.shippingCost')}:{' '}
              {formatMoney(Number(fulfillment.shipping_cost), fulfillment.currency, locale)}
            </Typography>

            {fulfillment.promised_from && (
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                {t('fulfillment.field.promised')}: {fulfillment.promised_from} →{' '}
                {fulfillment.promised_to}
              </Typography>
            )}

            {fulfillment.pickup_point_name && (
              <Typography variant="body2">
                {t('fulfillment.field.pickupPoint')}: {fulfillment.pickup_point_name}
              </Typography>
            )}

            <Typography variant="body2">
              {String(fulfillment.address.address ?? '')}
              {fulfillment.address.city ? ` · ${String(fulfillment.address.city)}` : ''}
            </Typography>
          </Stack>

          <Divider />

          {/* ---- Acciones ------------------------------------------------ */}
          <Stack spacing={2}>
            <Typography variant="subtitle2">{t('fulfillment.detail.actions')}</Typography>

            {!canOperate && <Alert severity="info">{t('fulfillment.detail.readOnly')}</Alert>}

            {next.length === 0 ? (
              <Alert severity="info">{t('fulfillment.detail.terminal')}</Alert>
            ) : (
              <Stack spacing={1}>
                <TextField
                  select
                  size="small"
                  label={t('fulfillment.field.moveTo')}
                  value={target}
                  disabled={!canOperate}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <MenuItem value="">{t('fulfillment.field.noMove')}</MenuItem>
                  {next.map((state) => (
                    <MenuItem key={state} value={state}>
                      {t(`fulfillment.state.${state}` as MessageKey)}
                    </MenuItem>
                  ))}
                </TextField>
                {needsReason && (
                  <TextField
                    size="small"
                    label={t('fulfillment.field.reason')}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    helperText={t('fulfillment.field.reasonHelp')}
                  />
                )}
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    variant="contained"
                    size="small"
                    disabled={
                      !canOperate ||
                      target === '' ||
                      transition.isPending ||
                      (needsReason && reason.trim() === '')
                    }
                    onClick={() => void move()}
                  >
                    {t('fulfillment.action.move')}
                  </Button>
                </Stack>
              </Stack>
            )}

            {fulfillment.warehouse_id === null && (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('fulfillment.field.warehouse')}
                  value=""
                  disabled={!canOperate}
                  onChange={async (event) => {
                    try {
                      await assign.mutateAsync({
                        fulfillmentId: fulfillment.fulfillment_id,
                        warehouseId: event.target.value === '' ? null : event.target.value,
                      })
                      notify(t('fulfillment.action.assigned'), 'success')
                    } catch (error) {
                      report(error)
                    }
                  }}
                  helperText={t('fulfillment.field.warehouseHelp')}
                >
                  {/* Vacío = que decida la regla del método. Es la opción por
                      defecto y no un hueco: acierta casi siempre. */}
                  <MenuItem value="">{t('fulfillment.field.warehouseAuto')}</MenuItem>
                  {(warehouses.data ?? []).map((warehouse) => (
                    <MenuItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} · {warehouse.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}

            {fulfillment.strategy === 'ship' && (
              <Stack spacing={1}>
                <TextField
                  size="small"
                  label={t('fulfillment.field.serviceCode')}
                  value={serviceCode}
                  disabled={!canOperate}
                  onChange={(event) => setServiceCode(event.target.value)}
                  helperText={t('fulfillment.field.serviceCodeHelp')}
                />
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    size="small"
                    disabled={!canOperate || open.isPending}
                    onClick={async () => {
                      try {
                        await open.mutateAsync({
                          fulfillmentId: fulfillment.fulfillment_id,
                          idempotencyKey: newIdempotencyKey('shp'),
                          serviceCode,
                        })
                        notify(t('fulfillment.action.shipmentOpened'), 'success')
                        setServiceCode('')
                      } catch (error) {
                        report(error)
                      }
                    }}
                  >
                    {t('fulfillment.action.openShipment')}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Stack>

          <Divider />

          {/* ---- Bultos --------------------------------------------------- */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">{t('fulfillment.detail.shipments')}</Typography>
            {(shipments.data ?? []).length === 0 ? (
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                {t('fulfillment.detail.noShipments')}
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('fulfillment.field.tracking')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('fulfillment.field.carrierCost')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(shipments.data ?? []).map((shipment) => (
                    <TableRow key={shipment.id}>
                      <TableCell>
                        {shipment.tracking_number ?? (
                          <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                            {t('fulfillment.field.noTracking')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {t(`fulfillment.shipment.${shipment.state}` as MessageKey)}
                      </TableCell>
                      <TableCell align="right">
                        {shipment.cost === null || shipment.currency === null
                          ? '—'
                          : formatMoney(Number(shipment.cost), shipment.currency, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {lastShipment && (
              <Stack spacing={1}>
                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                  {t('fulfillment.detail.noteHelp')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    select
                    size="small"
                    label={t('fulfillment.field.trackingStatus')}
                    value={noteStatus}
                    disabled={!canOperate}
                    onChange={(event) => setNoteStatus(event.target.value)}
                    sx={{ minWidth: 200 }}
                  >
                    {TRACKING_STATUSES.map((status) => (
                      <MenuItem key={status} value={status}>
                        {t(`fulfillment.tracking.${status}` as MessageKey)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    fullWidth
                    label={t('fulfillment.field.trackingNote')}
                    value={noteText}
                    disabled={!canOperate}
                    onChange={(event) => setNoteText(event.target.value)}
                  />
                  <Button
                    size="small"
                    disabled={!canOperate || note.isPending}
                    onClick={async () => {
                      try {
                        await note.mutateAsync({
                          shipmentId: lastShipment.id,
                          status: noteStatus,
                          description: noteText,
                        })
                        notify(t('fulfillment.action.noted'), 'success')
                        setNoteText('')
                      } catch (error) {
                        report(error)
                      }
                    }}
                  >
                    {t('fulfillment.action.note')}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Stack>

          <Divider />

          {/* ---- Qué hay que preparar ------------------------------------- */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">{t('fulfillment.detail.items')}</Typography>
            {(items.data ?? []).length === 0 ? (
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                {t('fulfillment.detail.noItems')}
              </Typography>
            ) : (
              <Table size="small">
                <TableBody>
                  {(items.data ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell sx={{ pl: 0 }}>
                        <Typography variant="body2">{item.name}</Typography>
                        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                          {item.sku}
                          {item.variant_label ? ` · ${item.variant_label}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ pr: 0, fontWeight: 700 }}>
                        ×{item.quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>

          {/* ---- Línea de tiempo ------------------------------------------ */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">{t('fulfillment.detail.timeline')}</Typography>
            {(facts.data ?? []).map((fact) => (
              <Stack key={fact.id} direction="row" spacing={1} alignItems="baseline">
                <Typography variant="caption" sx={{ color: 'var(--muted)', minWidth: 132 }}>
                  {formatDateTime(fact.created_at, locale)}
                </Typography>
                <Typography variant="body2">
                  {HECHO[fact.event_type] ? t(HECHO[fact.event_type]!) : fact.event_type}
                  {destinoDe(fact) ? ` → ${t(destinoDe(fact)!)}` : ''}
                  {fact.note ? ` · ${fact.note}` : ''}
                </Typography>
              </Stack>
            ))}
            {(tracking.data ?? []).map((event) => (
              <Stack key={event.id} direction="row" spacing={1} alignItems="baseline">
                <Typography variant="caption" sx={{ color: 'var(--muted)', minWidth: 132 }}>
                  {formatDateTime(event.occurred_at, locale)}
                </Typography>
                <Typography variant="body2">
                  {t(`fulfillment.tracking.${event.status}` as MessageKey)}
                  {/* El estado del operador, SIN traducir. Es lo que hace falta
                      para llamarles citando su propio vocabulario. */}
                  {event.provider_status ? ` · ${event.provider_status}` : ''}
                  {event.description ? ` · ${event.description}` : ''}
                </Typography>
                {!event.signature_verified && (
                  <StatusChip label={t('fulfillment.field.unsigned')} />
                )}
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
    </FormDrawer>
  )
}
