import AddShoppingCartRoundedIcon from '@mui/icons-material/AddShoppingCartRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useContext, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate } from '@/shared/lib/format'
import { StatusChip, type StatusTone } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { addLinesToCart } from '../cart/addLinesToCart'
import { MAX_LINE_QUANTITY } from '../cart/cart'
import { CartContext } from '../cart/cart-context'
import {
  archiveMyOrderSchedule,
  dismissMyOrderScheduleRun,
  fetchMyOrderSchedules,
  mapScheduleCode,
  myOrderSchedulesKey,
  saveMyOrderSchedule,
  scheduleErrorCode,
  setMyOrderScheduleStatus,
  takeMyOrderScheduleRun,
  type ScheduleStatus,
  type ScheduledTemplate,
} from '../scheduledOrders'
import { ScheduleDialog, type ScheduleFormValues } from './ScheduleDialog'

const STATUS_TONE: Record<ScheduleStatus, StatusTone> = {
  active: 'success',
  paused: 'warning',
  finished: 'default',
}

const STATUS_LABEL: Record<ScheduleStatus, MessageKey> = {
  active: 'account.schedules.status.active',
  paused: 'account.schedules.status.paused',
  finished: 'account.schedules.status.finished',
}

/**
 * Los pedidos programados de la empresa del comprador en esta tienda (cierre,
 * item 4). `programados` es el ancla del aviso «tu pedido programado está listo».
 *
 * ## Qué pasa cuando vence
 *
 * El servidor deja una PROPUESTA y avisa. «Pasar al carrito» manda las líneas al
 * carrito como si se añadieran hoy —precio y stock de hoy— y el comprador
 * confirma en el checkout de siempre. «Pedir ahora» hace lo mismo sin esperar a
 * la fecha. Nada de esta pantalla crea un pedido.
 *
 * ## Lo que no entra al carrito
 *
 * Un artículo despublicado desde que se programó se marca en la tabla y no entra,
 * y una cantidad mayor que la que admite el carrito por línea se avisa ANTES:
 * recortarla en silencio sería pedir menos de lo programado sin decirlo.
 */
export function MyScheduledOrdersSection({ storeSlug, storeId }: { storeSlug: string; storeId: string | null }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const cart = useContext(CartContext)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ScheduledTemplate | null>(null)
  const [archiving, setArchiving] = useState<ScheduledTemplate | null>(null)

  const query = useQuery({
    queryKey: myOrderSchedulesKey(storeSlug),
    queryFn: () => fetchMyOrderSchedules(storeSlug),
    enabled: storeSlug !== '',
  })

  const refresh = () => void queryClient.invalidateQueries({ queryKey: myOrderSchedulesKey(storeSlug) })
  const onError = (error: unknown) => notify(t(mapScheduleCode(scheduleErrorCode(error))), 'error')

  const toCart = useMutation({
    mutationFn: async (input: { template: ScheduledTemplate; runId: string | null }) => {
      const lines = input.runId
        ? (await takeMyOrderScheduleRun(storeSlug, input.runId)).lines
        : input.template.items.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            quantity: item.quantity,
          }))
      if (!cart || !storeId) return { added: 0, skipped: lines.length }
      return addLinesToCart(cart, storeId, lines)
    },
    onSuccess: ({ added, skipped }) => {
      notify(
        skipped > 0
          ? t('account.schedules.addedPartial').replace('{added}', String(added)).replace('{skipped}', String(skipped))
          : t('account.schedules.added'),
        skipped > 0 ? 'warning' : 'success',
      )
      if (added > 0) cart?.openCart()
    },
    onError,
    onSettled: refresh,
  })

  const dismiss = useMutation({
    mutationFn: (runId: string) => dismissMyOrderScheduleRun(storeSlug, runId),
    onSuccess: () => notify(t('account.schedules.dismissed')),
    onError,
    onSettled: refresh,
  })

  const toggle = useMutation({
    mutationFn: (template: ScheduledTemplate) =>
      setMyOrderScheduleStatus(storeSlug, template.id, template.schedule?.status === 'active' ? 'paused' : 'active'),
    onSuccess: (result) =>
      notify(t(result.schedule?.status === 'paused' ? 'account.schedules.pausedDone' : 'account.schedules.resumedDone')),
    onError,
    onSettled: refresh,
  })

  const edit = useMutation({
    mutationFn: (input: { template: ScheduledTemplate; values: ScheduleFormValues }) =>
      saveMyOrderSchedule({
        storeSlug,
        templateId: input.template.id,
        name: input.values.name,
        lines: null,
        intervalDays: input.values.intervalDays,
        nextRunOn: input.values.nextRunOn,
        endsOn: input.values.endsOn,
        requestKey: null,
      }),
    onSuccess: () => {
      setEditing(null)
      notify(t('account.schedules.saved'), 'success')
    },
    onError,
    onSettled: refresh,
  })

  const archive = useMutation({
    mutationFn: (template: ScheduledTemplate) => archiveMyOrderSchedule(storeSlug, template.id),
    onSuccess: () => {
      setArchiving(null)
      notify(t('account.schedules.archived'))
    },
    onError,
    onSettled: refresh,
  })

  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const data = query.data
  if (!data.has_account) {
    return <EmptyState title={t('account.schedules.noAccount')} description={t('account.schedules.noAccountBody')} />
  }
  if (data.templates.length === 0) {
    return (
      <EmptyState
        title={t('account.schedules.empty')}
        description={t(data.entitled ? 'account.schedules.emptyBody' : 'account.schedules.unavailable')}
      />
    )
  }

  const busy = toCart.isPending || dismiss.isPending || toggle.isPending || archive.isPending
  const canBuy = data.can_manage && data.entitled && Boolean(cart) && Boolean(storeId)

  return (
    <Stack spacing={2}>
      {!data.entitled && <Alert severity="info">{t('account.schedules.unavailable')}</Alert>}
      {data.templates.map((template) => {
        const schedule = template.schedule
        const run = template.pending_run
        const tooLarge = template.items.some((item) => item.quantity > MAX_LINE_QUANTITY)
        return (
          <Card key={template.id} variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)' }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>{template.name}</Typography>
                    {schedule && (
                      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                        {t('account.schedules.every').replace('{days}', String(schedule.interval_days))}
                        {schedule.status === 'active' &&
                          ` · ${t('account.schedules.next').replace('{date}', formatDate(schedule.next_run_on, locale))}`}
                        {schedule.ends_on &&
                          ` · ${t('account.schedules.until').replace('{date}', formatDate(schedule.ends_on, locale))}`}
                      </Typography>
                    )}
                  </Box>
                  {schedule && (
                    <StatusChip label={t(STATUS_LABEL[schedule.status])} tone={STATUS_TONE[schedule.status]} />
                  )}
                </Stack>

                {run && (
                  <Alert
                    severity="success"
                    action={
                      canBuy && !tooLarge ? (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button color="inherit" size="small" onClick={() => dismiss.mutate(run.id)} disabled={busy}>
                            {t('account.schedules.dismiss')}
                          </Button>
                          <Button
                            color="inherit"
                            size="small"
                            variant="outlined"
                            startIcon={<AddShoppingCartRoundedIcon />}
                            onClick={() => toCart.mutate({ template, runId: run.id })}
                            disabled={busy}
                          >
                            {t('account.schedules.take')}
                          </Button>
                        </Stack>
                      ) : undefined
                    }
                  >
                    {t('account.schedules.ready').replace('{date}', formatDate(run.run_on, locale))}
                  </Alert>
                )}

                {tooLarge && <Alert severity="info">{t('account.schedules.tooLarge')}</Alert>}

                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('account.schedules.product')}</TableCell>
                        <TableCell align="right">{t('account.schedules.quantity')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {template.items.map((item) => (
                        <TableRow key={`${item.product_id}|${item.variant_id ?? ''}`}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {item.name}
                            </Typography>
                            {item.variant_name && (
                              <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block' }}>
                                {item.variant_name}
                              </Typography>
                            )}
                            {!item.available && (
                              <Typography variant="caption" sx={{ color: 'var(--danger, #b3261e)', display: 'block' }}>
                                {t('account.schedules.itemUnavailable')}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right" className="tnum">
                            {item.quantity}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>

                {data.can_manage && (
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}
                  >
                    <Button color="error" onClick={() => setArchiving(template)} disabled={busy}>
                      {t('account.schedules.archive')}
                    </Button>
                    {schedule && schedule.status !== 'finished' && data.entitled && (
                      <>
                        <Button onClick={() => setEditing(template)} disabled={busy}>
                          {t('account.schedules.edit')}
                        </Button>
                        <Button onClick={() => toggle.mutate(template)} disabled={busy}>
                          {t(schedule.status === 'active' ? 'account.schedules.pause' : 'account.schedules.resume')}
                        </Button>
                      </>
                    )}
                    {canBuy && !tooLarge && (
                      <Button
                        variant={run ? 'outlined' : 'contained'}
                        startIcon={<AddShoppingCartRoundedIcon />}
                        onClick={() => toCart.mutate({ template, runId: null })}
                        disabled={busy}
                      >
                        {t('account.schedules.orderNow')}
                      </Button>
                    )}
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        )
      })}
      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
        {t('account.schedules.hint')}
      </Typography>

      {editing && editing.schedule && (
        <ScheduleDialog
          open
          title={t('account.schedules.editTitle')}
          initial={{
            name: editing.name,
            intervalDays: editing.schedule.interval_days,
            nextRunOn: editing.schedule.next_run_on,
            endsOn: editing.schedule.ends_on,
          }}
          saving={edit.isPending}
          submitLabel={t('account.schedules.save')}
          onClose={() => setEditing(null)}
          onSubmit={(values) => edit.mutate({ template: editing, values })}
        />
      )}

      <Dialog open={archiving !== null} onClose={() => !archive.isPending && setArchiving(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('account.schedules.archiveTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('account.schedules.archiveBody').replace('{name}', archiving?.name ?? '')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiving(null)} disabled={archive.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => archiving && archive.mutate(archiving)}
            disabled={archive.isPending}
          >
            {t('account.schedules.archive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
