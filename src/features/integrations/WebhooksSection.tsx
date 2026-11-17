import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { eventLabel, termLabel } from '@/shared/i18n/codeLabels'
import { formatDateTime } from '@/shared/lib/format'
import { SearchField } from '@/shared/ui/SearchField'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { ReasonDialog } from './ReasonDialog'
import { IntegrationsError, isForbidden, isMissingModule } from './errors'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import {
  useCreateEndpoint,
  useDeliveries,
  useEndpoints,
  useReplayDelivery,
  useSetEndpointActive,
  useSubscriptions,
} from './hooks'

/**
 * Webhooks: a quién avisamos, de qué, y qué pasó con cada aviso.
 *
 * ## Los eventos que se ofrecen son una lista, no una caja de texto
 *
 * Suscribirse a `order.creted` con una errata produce un endpoint que nunca
 * recibe nada y una tarde de diagnóstico. Los tipos de hecho canónicos son un
 * vocabulario cerrado del producto —los mismos que publica `domain_events`— así
 * que se eligen, no se escriben. El comodín de dominio (`order.*`) entra en la
 * lista porque es la suscripción que de verdad quiere una integración de ERP:
 * todo lo que le pase a un pedido.
 *
 * ## El secreto NO se escribe aquí
 *
 * Se escribe el NOMBRE de la variable del vault (`secret_ref`). El valor lo
 * resuelve el despliegue y no pasa nunca por el navegador ni por la base. Es la
 * misma decisión que `tenant_integrations.secret_ref` desde P12: una tabla con
 * secretos dentro es una filtración esperando a que alguien haga un select.
 *
 * ## Reproducir conserva la identidad del evento
 *
 * `webhook_replay` reenvía con el MISMO `event_id`. El receptor que deduplica
 * bien lo descarta; el que perdió el aviso lo procesa. Las dos son la respuesta
 * correcta y ninguna depende de nosotros — que es justo por lo que se puede
 * ofrecer el botón sin miedo a duplicar pedidos en el sistema del cliente.
 */

/** Espejo del vocabulario de hechos que publica el dominio. Cerrado a propósito. */
const EVENT_TYPES = [
  // 2026-11-12 · Solo lo que `domain_events` publica de verdad (comprobado en
  // QAS). Antes ofrecía `shipment.dispatched` y `shipment.delivered`, que no se
  // emiten nunca: un destino suscrito a ellos no recibía nada y nadie sabía por qué.
  'order.*',
  'order.created',
  'order.status_changed',
  'order.payment_status_changed',
  'order.fulfillment_status_changed',
  'order.approval_requested',
  'order.approval_decided',
  'payment.*',
  'payment.captured',
  'payment.failed',
  'fulfillment.*',
  'fulfillment.created',
  'fulfillment.delivered',
  'return.*',
  'return.requested',
  'return.approved',
  'return.completed',
  'quote.*',
  'quote.requested',
  'quote.accepted',
  'quote.converted',
] as const

function NewEndpointDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const create = useCreateEndpoint()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<string[]>([])

  const nameOk = /^[a-z0-9][a-z0-9_-]{1,60}$/.test(name.trim().toLowerCase())
  // Mismo prefijo que exige el CHECK de la base. Un botón habilitado para algo
  // que el servidor va a rechazar enseña a desconfiar de los botones.
  const urlOk = /^https:\/\/\S{6,}$/.test(url.trim())
  const secretOk = /^[A-Z][A-Z0-9_]{2,80}$/.test(secretRef.trim().toUpperCase())

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('integrations.webhooks.newTitle')}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {create.isError && (
            <Alert severity="error">
              {t(create.error instanceof IntegrationsError ? create.error.key : 'integrations.error.generic')}
            </Alert>
          )}
          <TextField
            label={t('integrations.webhooks.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            helperText={t('integrations.webhooks.nameHelp')}
            fullWidth
          />
          <TextField
            label={t('integrations.webhooks.url')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            helperText={t('integrations.webhooks.urlHelp')}
            fullWidth
          />
          <TextField
            label={t('integrations.webhooks.secretRef')}
            value={secretRef}
            onChange={(event) => setSecretRef(event.target.value)}
            helperText={t('integrations.webhooks.secretRefHelp')}
            fullWidth
          />
          <TextField
            label={t('integrations.webhooks.description')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            fullWidth
          />
          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
            {t('integrations.webhooks.events')}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
            {EVENT_TYPES.map((eventType) => (
              <FormControlLabel
                key={eventType}
                control={
                  <Checkbox
                    size="small"
                    checked={events.includes(eventType)}
                    onChange={(_, checked) =>
                      setEvents((current) =>
                        checked
                          ? [...current, eventType]
                          : current.filter((item) => item !== eventType),
                      )
                    }
                  />
                }
                label={
                  <span>
                    {eventLabel(t, eventType)}
                    <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)', ml: 0.75 }}>
                      {eventType}
                    </Typography>
                  </span>
                }
              />
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!nameOk || !urlOk || !secretOk || events.length === 0 || create.isPending}
          onClick={() =>
            create.mutate(
              {
                name,
                url,
                secretRef,
                description,
                eventTypes: events,
              },
              {
                onSuccess: () => {
                  setName('')
                  setUrl('')
                  setSecretRef('')
                  setDescription('')
                  setEvents([])
                  onClose()
                },
              },
            )
          }
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function WebhooksSection() {
  const { t, locale } = useI18n()
  const endpoints = useEndpoints()
  const subscriptions = useSubscriptions()
  const setActive = useSetEndpointActive()
  const replay = useReplayDelivery()
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const deliveries = useDeliveries(debounced)
  const [creating, setCreating] = useState(false)
  const [replayId, setReplayId] = useState<string | null>(null)
  // Mismo criterio que la pestaña API: leer no exige el módulo, publicar sí.
  const { has } = useCapabilities()
  const contratado = has('integrations.enterprise')

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows((endpoints.data ?? []))

  if (isForbidden(endpoints.error)) {
    return (
      <UnauthorizedState
        title={t('integrations.error.forbidden')}
        description={t('integrations.forbiddenBody')}
      />
    )
  }
  if (isMissingModule(endpoints.error)) {
    return (
      <EmptyState
        title={t('integrations.error.noModule')}
        description={t('integrations.noModuleBody')}
      />
    )
  }

  const byEndpoint = new Map<string, string[]>()
  for (const subscription of subscriptions.data ?? []) {
    const list = byEndpoint.get(subscription.endpoint_id) ?? []
    list.push(subscription.event_type)
    byEndpoint.set(subscription.endpoint_id, list)
  }

  return (
    <Stack sx={{ gap: 2 }}>
      {contratado ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={() => setCreating(true)}>
            {t('integrations.webhooks.new')}
          </Button>
        </Stack>
      ) : (
        <Alert severity="warning">
          <strong>{t('integrations.error.noModule')}.</strong> {t('integrations.noModuleBody')}
        </Alert>
      )}

      <Card>
        {endpoints.isPending ? (
          <TableSkeleton columns={4} />
        ) : endpoints.isError ? (
          <ErrorState error={endpoints.error} onRetry={() => void endpoints.refetch()} />
        ) : (endpoints.data ?? []).length === 0 ? (
          <EmptyState
            title={t('integrations.webhooks.empty')}
            description={t('integrations.webhooks.emptyBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('integrations.webhooks.name')}</TableCell>
                <TableCell>{t('integrations.webhooks.url')}</TableCell>
                <TableCell>{t('integrations.webhooks.events')}</TableCell>
                <TableCell align="right">{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((endpoint) => (
                <TableRow key={endpoint.id}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{endpoint.name}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {endpoint.secret_ref} · {endpoint.api_version}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ wordBreak: 'break-all', fontSize: 12 }}>{endpoint.url}</TableCell>
                  <TableCell>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                      {(byEndpoint.get(endpoint.id) ?? []).map((eventType) => (
                        <StatusChip key={eventType} label={eventLabel(t, eventType)} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() =>
                        setActive.mutate({ id: endpoint.id, isActive: !endpoint.is_active })
                      }
                    >
                      {endpoint.is_active
                        ? t('integrations.webhooks.disable')
                        : t('integrations.webhooks.enable')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {/* El paginador solo aparece cuando hay algo que paginar: un
            "0-0 de 0" bajo un estado vacio es ruido que contradice al
            propio estado vacio. */}
        {pager.total > 0 && (
          <TablePager
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
          />
        )}
      </Card>

      <Typography sx={{ fontWeight: 700 }}>{t('integrations.webhooks.deliveries')}</Typography>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('integrations.webhooks.search')}
            ariaLabel={t('integrations.webhooks.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {deliveries.isPending ? (
          <TableSkeleton columns={5} />
        ) : deliveries.isError ? (
          <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
        ) : (deliveries.data ?? []).length === 0 ? (
          <EmptyState
            title={t('integrations.webhooks.noDeliveries')}
            description={t('integrations.webhooks.noDeliveriesBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.date')}</TableCell>
                <TableCell>{t('integrations.webhooks.event')}</TableCell>
                <TableCell>{t('integrations.webhooks.name')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(deliveries.data ?? []).map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{formatDateTime(delivery.created_at, locale)}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13 }}>{eventLabel(t, delivery.event_type)}</Typography>
                    {delivery.is_replay && (
                      <StatusChip tone="warning" label={t('integrations.webhooks.replayed')} />
                    )}
                  </TableCell>
                  <TableCell>{delivery.endpoint_name}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={
                        delivery.status === 'succeeded'
                          ? 'success'
                          : delivery.status === 'dead'
                            ? 'error'
                            : 'default'
                      }
                      label={
                        delivery.last_status_code !== null && delivery.last_status_code !== undefined
                          ? `HTTP ${delivery.last_status_code}`
                          : termLabel(t, 'status', delivery.status)
                      }
                    />
                    {delivery.last_error && (
                      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                        {delivery.last_error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setReplayId(delivery.id)}>
                      {t('integrations.webhooks.replay')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <NewEndpointDialog open={creating} onClose={() => setCreating(false)} />

      <ReasonDialog
        open={replayId !== null}
        title={t('integrations.webhooks.replayTitle')}
        body={t('integrations.webhooks.replayBody')}
        confirmLabel={t('integrations.webhooks.replay')}
        pending={replay.isPending}
        onCancel={() => setReplayId(null)}
        onConfirm={(reason) => {
          if (!replayId) return
          replay.mutate({ id: replayId, reason }, { onSuccess: () => setReplayId(null) })
        }}
      />
    </Stack>
  )
}
