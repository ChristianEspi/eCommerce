import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { PaymentIntentAiToggle } from './ai/PaymentsAiSection'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDateTime, formatMoney } from '@/shared/lib/format'
import { codeLabel, eventLabel } from '@/shared/i18n/codeLabels'
import { DetailFacts, DetailSection, DetailTimeline } from '@/shared/ui/DetailBlocks'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { PaymentsError } from './errors'
import { canConfirmOffline } from './api'
import {
  useConfirmOfflinePayment,
  usePaymentAttempts,
  usePaymentEvents,
  usePaymentIntents,
  usePaymentsOf,
  useRefundsOf,
  useRequestRefund,
} from './hooks'
import { INTENT_STATUSES, newIdempotencyKey, type PaymentIntent } from './types'
import { SelectField } from '@/shared/ui/SelectField'

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  open: 'default',
  processing: 'info',
  requires_action: 'warning',
  authorized: 'info',
  captured: 'success',
  failed: 'error',
  cancelled: 'default',
  expired: 'default',
}

/**
 * Los cobros: estado, intentos, fallos, referencia y devolución.
 *
 * Es la pantalla que el criterio 10 de la fase describe punto por punto, y cada
 * columna existe por una pregunta concreta que alguien hace un lunes:
 *
 *   estado           «¿cobró o no?»
 *   intentos/fallos  «¿se intentó una vez o cinco?»
 *   referencia       «¿qué número le doy al banco?»
 *   código de error  el del proveedor, SIN traducir: es el que ellos entienden
 *
 * Lo que NO sale: ni un secreto, ni el sobre crudo del proveedor, ni un token.
 * Un cobro de PASARELA no se mueve a mano. Uno sin pasarela (Yape,
 * transferencia) sí: «Confirmar cobro» llama a `payment_confirm_offline`, que
 * escribe el cobro con quién lo confirmó y pone el pedido en pagado.
 *
 * La devolución es lo único que se puede pedir desde aquí, con su clave de
 * idempotencia generada en el navegador: pulsar dos veces devuelve una vez.
 */
export function IntentsSection() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, can } = useTenant()
  const canRefund = can('orders.write')

  const [status, setStatus] = useState('')
  const [term, setTerm] = useState('')
  const [selected, setSelected] = useState<PaymentIntent | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [refundKey, setRefundKey] = useState('')
  const [confirmReference, setConfirmReference] = useState('')
  const [confirmNote, setConfirmNote] = useState('')

  const intents = usePaymentIntents({ storeId: activeStore?.id ?? null, status, term })
  const attempts = usePaymentAttempts(selected?.intent_id ?? null)
  const events = usePaymentEvents(selected?.intent_id ?? null)
  const payments = usePaymentsOf(selected?.intent_id ?? null)
  const paymentIds = useMemo(() => (payments.data ?? []).map((p) => p.id), [payments.data])
  const refunds = useRefundsOf(paymentIds)
  const requestRefund = useRequestRefund()
  const confirmOffline = useConfirmOfflinePayment()

  const list = intents.data ?? []
  const isEmpty = !intents.isPending && !intents.isError && list.length === 0
  const refundable = (payments.data ?? []).find((p) => p.status !== 'refunded') ?? null

  function open(intent: PaymentIntent) {
    setSelected(intent)
    setRefundAmount('')
    setRefundReason('')
    setConfirmReference('')
    setConfirmNote('')
    // Una clave por apertura del panel: es lo que ancla ESTA devolución.
    setRefundKey(newIdempotencyKey('refund'))
  }

  async function submitRefund() {
    if (!refundable) return
    try {
      await requestRefund.mutateAsync({
        paymentId: refundable.id,
        amount: refundAmount.trim(),
        reason: refundReason,
        idempotencyKey: refundKey,
      })
      notify(t('payments.refund.created'), 'success')
      setRefundAmount('')
      setRefundReason('')
    } catch (error) {
      const key: MessageKey =
        error instanceof PaymentsError ? error.key : 'payments.error.generic'
      notify(t(key), 'error')
    }
  }

  async function submitConfirm() {
    if (!selected) return
    try {
      await confirmOffline.mutateAsync({
        intentId: selected.intent_id,
        reference: confirmReference,
        note: confirmNote,
      })
      notify(t('payments.confirm.done'), 'success')
      setSelected({
        ...selected,
        status: 'captured',
        amount_captured: selected.amount,
        provider_reference: confirmReference.trim() || selected.provider_reference,
      })
    } catch (error) {
      const key: MessageKey =
        error instanceof PaymentsError ? error.key : 'payments.error.generic'
      notify(t(key), 'error')
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('payments.intents.help')}</Typography>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('payments.intents.search')}
          />
        </Box>
        <SelectField
          size="small"
          label={t('common.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 200 }}
          SelectProps={{ native: true }}
        >
          <option value="">{t('payments.status.all')}</option>
          {INTENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`payments.status.${value}` as MessageKey)}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      <Card>
        {intents.isPending && <TableSkeleton columns={6} />}
        {intents.isError && (
          <ErrorState error={intents.error} onRetry={() => void intents.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={t('payments.intents.empty')}
            description={t('payments.intents.emptyBody')}
            icon={<PaymentsRoundedIcon fontSize="small" />}
          />
        )}
        {!intents.isPending && !intents.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.date')}</TableCell>
                <TableCell>{t('payments.field.order')}</TableCell>
                <TableCell>{t('payments.field.method')}</TableCell>
                <TableCell align="right">{t('payments.field.amount')}</TableCell>
                <TableCell align="right">{t('payments.field.attempts')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((intent) => (
                <TableRow
                  key={intent.intent_id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => open(intent)}
                >
                  <TableCell>{formatDateTime(intent.created_at, locale)}</TableCell>
                  <TableCell>
                    {intent.order_number ?? (
                      <StatusChip label={t('payments.intents.noOrder')} />
                    )}
                  </TableCell>
                  <TableCell>{intent.method_name}</TableCell>
                  <TableCell align="right">
                    {intent.amount} {intent.currency}
                  </TableCell>
                  <TableCell align="right">
                    {intent.attempt_count}
                    {intent.failed_attempt_count > 0 && (
                      <Chip
                        size="small"
                        color="error"
                        sx={{ ml: 1 }}
                        label={intent.failed_attempt_count}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      tone={STATUS_COLOR[intent.status] ?? 'default'}
                      label={t(`payments.status.${intent.status}` as MessageKey)}
                    />
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

      <FormDrawer
        open={selected !== null}
        title={t('payments.detail.title')}
        subtitle={selected?.order_number ?? selected?.method_name}
        width={640}
        onClose={() => setSelected(null)}
        actions={<Button onClick={() => setSelected(null)}>{t('common.close')}</Button>}
      >
        {selected && (
          <Stack spacing={3}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              <Typography sx={{ fontSize: 28, fontWeight: 800 }} className="tnum">
                {formatMoney(Number(selected.amount), selected.currency, locale)}
              </Typography>
              <StatusChip
                tone={STATUS_COLOR[selected.status] ?? 'default'}
                label={t(`payments.status.${selected.status}` as MessageKey)}
              />
            </Stack>

            <DetailFacts
              facts={[
                { label: t('payments.field.method'), value: selected.method_name },
                { label: t('payments.field.order'), value: selected.order_number ?? t('payments.intents.noOrder') },
                {
                  label: t('payments.detail.captured'),
                  value: formatMoney(Number(selected.amount_captured), selected.currency, locale),
                },
                { label: t('payments.field.reference'), value: selected.provider_reference ?? '—' },
                ...(selected.customer_email
                  ? [{ label: t('payments.detail.customer'), value: selected.customer_email }]
                  : []),
                { label: t('payments.detail.created'), value: formatDateTime(selected.created_at, locale) },
              ]}
            />

            {selected.last_error_code && (
              <Alert severity="warning">
                {t('payments.detail.lastError')}: {codeLabel(t, selected.last_error_code)}
              </Alert>
            )}

            {canConfirmOffline(selected) && (
              <DetailSection title={t('payments.confirm.title')}>
                <Stack spacing={1.5} data-confirm-offline>
                  <Alert severity="info">
                    {t('payments.confirm.help')
                      .replace('{amount}', formatMoney(Number(selected.amount), selected.currency, locale))
                      .replace('{method}', selected.method_name ?? '')}
                  </Alert>
                  {canRefund ? (
                    <>
                      <Box
                        sx={{
                          display: 'grid',
                          gap: 1.5,
                          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                        }}
                      >
                        <Field
                          label={t('payments.confirm.reference')}
                          rule="text"
                          maxLength={120}
                          help={t('help.payments.confirmReference')}
                          value={confirmReference}
                          onChange={(event) => setConfirmReference(event.target.value)}
                          size="small"
                        />
                        <Field
                          label={t('payments.confirm.note')}
                          rule="longText"
                          maxLength={500}
                          value={confirmNote}
                          onChange={(event) => setConfirmNote(event.target.value)}
                          size="small"
                        />
                      </Box>
                      <Box>
                        <Button
                          variant="contained"
                          disabled={confirmOffline.isPending}
                          onClick={() => void submitConfirm()}
                        >
                          {t('payments.confirm.action')}
                        </Button>
                      </Box>
                    </>
                  ) : (
                    <Typography sx={{ color: 'var(--muted)' }}>
                      {t('payments.confirm.noPermission')}
                    </Typography>
                  )}
                </Stack>
              </DetailSection>
            )}

            <DetailSection title={t('payments.detail.attempts')}>
              <DetailTimeline
                empty={t('payments.detail.none')}
                entries={(attempts.data ?? []).map((attempt) => ({
                  id: attempt.id,
                  title: `${attempt.attempt_no}. ${eventLabel(t, attempt.operation)}`,
                  tone: attempt.status === 'succeeded' ? 'success' : attempt.status === 'pending' ? 'default' : 'error',
                  when: formatDateTime(attempt.created_at, locale),
                  meta: [
                    t(`payments.attempt.${attempt.status}` as MessageKey),
                    attempt.provider_result_code ?? (attempt.error_code ? codeLabel(t, attempt.error_code) : null),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                }))}
              />
            </DetailSection>

            <DetailSection title={t('payments.detail.timeline')}>
              <DetailTimeline
                empty={t('payments.detail.none')}
                entries={(events.data ?? []).map((event) => ({
                  id: event.id,
                  title: eventLabel(t, event.event_type),
                  tone: /(failed|expired|cancelled)$/.test(event.event_type)
                    ? 'error'
                    : /(captured|succeeded)$/.test(event.event_type)
                      ? 'success'
                      : 'default',
                  when: formatDateTime(event.created_at, locale),
                  meta: [
                    t(`payments.source.${event.source}` as MessageKey),
                    event.source === 'provider_webhook'
                      ? t(event.signature_verified ? 'payments.detail.signed' : 'payments.detail.unsigned')
                      : null,
                    event.note,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                }))}
              />
            </DetailSection>

            <DetailSection title={t('payments.detail.refunds')}>
              {(refunds.data ?? []).map((refund) => (
                <Stack key={refund.id} direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {formatMoney(Number(refund.amount), refund.currency, locale)}
                  </Typography>
                  <StatusChip
                    label={t(`payments.refund.${refund.status}` as MessageKey)}
                  />
                  <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                    {refund.requested_email ?? ''}
                  </Typography>
                </Stack>
              ))}
              {(refunds.data ?? []).length === 0 && !refundable && (
                <Typography sx={{ color: 'var(--muted)', fontSize: 14 }}>
                  {t('payments.detail.noRefunds')}
                </Typography>
              )}

              {refundable && canRefund && (
                <Stack spacing={1.5}>
                  <Alert severity="info">
                    {t(selected.provider_code ? 'payments.refund.help' : 'payments.refund.helpOffline')}
                  </Alert>
                  <Field
                    label={t('payments.field.refundAmount')}
                    rule="money"
                    help={t('help.payments.refundAmount')}
                    value={refundAmount}
                    onChange={(event) => setRefundAmount(event.target.value)}
                    placeholder={refundable.amount}
                    size="small"
                  />
                  <Field
                    label={t('payments.field.refundReason')}
                    rule="text"
                    maxLength={1000}
                    value={refundReason}
                    onChange={(event) => setRefundReason(event.target.value)}
                    size="small"
                  />
                  <Button
                    variant="outlined"
                    color="error"
                    disabled={requestRefund.isPending || refundAmount.trim() === ''}
                    onClick={() => void submitRefund()}
                  >
                    {t('payments.refund.request')}
                  </Button>
                </Stack>
              )}
              {!canRefund && (
                <Typography sx={{ color: 'var(--muted)' }}>
                  {t('payments.refund.noPermission')}
                </Typography>
              )}
            </DetailSection>

            {/* Fase 08: explicar el cobro con IA. Solo lee; se monta al pulsar. */}
            <PaymentIntentAiToggle
              key={selected.intent_id}
              storeId={activeStore?.id ?? null}
              intentId={selected.intent_id}
              onNavigate={() => setSelected(null)}
            />
          </Stack>
        )}
      </FormDrawer>
    </Stack>
  )
}
