import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Alert,
  Button,
  Divider,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { eventLabel } from '@/shared/i18n/codeLabels'
import { DetailHeading, DetailTimeline } from '@/shared/ui/DetailBlocks'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDateTime, formatMoney } from '@/shared/lib/format'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { FulfillmentError } from './errors'
import {
  useCompleteReturn,
  useDecideReturn,
  useInspectReturn,
  useReceiveReturn,
  useReturnEvents,
  useReturnItems,
} from './hooks'
import {
  RETURN_CONDITIONS,
  RETURN_RESOLUTIONS,
  type ReturnCondition,
  type ReturnRow,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

interface LineDraft {
  condition: ReturnCondition
  restock: boolean
  refundAmount: string
}

/**
 * El detalle de una devolución y su ciclo: decidir, recibir, inspeccionar y
 * cerrar.
 *
 * Las cuatro acciones aparecen SOLO en el estado en el que tienen sentido, y no
 * es cosmética: la máquina de estados de la base rechaza el resto, así que un
 * botón siempre visible sería un botón que a veces produce un error de dominio.
 *
 * Dos reglas que la pantalla hace visibles porque la base también las exige:
 *
 *  · **Reponer solo lo vendible.** El interruptor se apaga solo en cuanto la
 *    unidad se marca dañada, usada o no recibida — la base lo remata con un
 *    CHECK, y sumar existencia que nadie tiene es un descuadre silencioso.
 *  · **El importe lo decide el comercio.** Se propone la suma de las líneas
 *    como DEFECTO y se puede cambiar: hay portes no reembolsables y hay
 *    acuerdos, y una cifra calculada al vuelo no se puede conciliar con nada.
 *
 * Cerrar publica el hecho canónico `return.completed` y **no abona nada**.
 * Devolver dinero es un acto autorizado de otro dominio, con su propia pantalla
 * y su propio rol: encadenarlo aquí significaría que aprobar una devolución
 * abona una tarjeta sin que nadie más lo mire.
 */
export function ReturnDrawer({
  request,
  onClose,
}: {
  request: ReturnRow | null
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { can } = useTenant()
  const canOperate = can('orders.write')

  const id = request?.return_request_id ?? null
  const items = useReturnItems(id)
  const events = useReturnEvents(id)

  const decide = useDecideReturn()
  const receive = useReceiveReturn()
  const inspect = useInspectReturn()
  const complete = useCompleteReturn()

  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState<string>('refund')
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})

  useEffect(() => {
    const next: Record<string, LineDraft> = {}
    for (const line of items.data ?? []) {
      next[line.id] = {
        condition: line.condition,
        restock: line.restock,
        refundAmount: line.refund_amount,
      }
    }
    setDrafts(next)
    setResolution(request?.resolution ?? 'refund')
  }, [items.data, request])

  function report(error: unknown) {
    const key: MessageKey =
      error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic'
    notify(t(key), 'error')
  }

  function close() {
    setNote('')
    onClose()
  }

  async function run(action: () => Promise<unknown>, message: MessageKey) {
    try {
      await action()
      notify(t(message), 'success')
      setNote('')
    } catch (error) {
      report(error)
    }
  }

  const state = request?.state
  const busy =
    decide.isPending || receive.isPending || inspect.isPending || complete.isPending

  return (
    <FormDrawer
      open={request !== null}
      title={request ? request.rma_number : ''}
      subtitle={request?.order_number}
      width={640}
      busy={busy}
      onClose={close}
      actions={<Button onClick={close}>{t('common.close')}</Button>}
    >
      {request && (
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <StatusChip label={t(`returns.state.${request.state}` as MessageKey)} />
              <StatusChip label={request.reason_label} />
              <StatusChip
                label={t(`returns.resolution.${request.resolution}` as MessageKey)}
              />
            </Stack>
            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
              {request.customer_email} ·{' '}
              {formatMoney(Number(request.refund_amount), request.currency, locale)}
            </Typography>
            {request.customer_note && (
              // Texto plano, SIEMPRE. Lo escribió un comprador y nunca se
              // convierte en marcado (regla del CMS, P11).
              <Typography variant="body2">{request.customer_note}</Typography>
            )}
            {request.decision_note && (
              <Alert severity="info">{request.decision_note}</Alert>
            )}
          </Stack>

          <Divider />

          {/* ---- Líneas --------------------------------------------------- */}
          <Stack spacing={1}>
            <DetailHeading>{t('returns.detail.lines')}</DetailHeading>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right">{t('returns.field.qty')}</TableCell>
                  <TableCell>{t('returns.field.condition')}</TableCell>
                  <TableCell>{t('returns.field.restock')}</TableCell>
                  <TableCell align="right">{t('returns.field.refund')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(items.data ?? []).map((line) => {
                  const draft = drafts[line.id] ?? {
                    condition: line.condition,
                    restock: line.restock,
                    refundAmount: line.refund_amount,
                  }
                  const editable = canOperate && state === 'received'
                  return (
                    <TableRow key={line.id}>
                      <TableCell align="right">
                        {line.received_quantity}/{line.quantity}
                      </TableCell>
                      <TableCell>
                        <SelectField
                          size="small"
                          value={draft.condition}
                          disabled={!editable}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [line.id]: {
                                ...draft,
                                condition: event.target.value as ReturnCondition,
                                // Lo que no llegó vendible NO se repone. La base
                                // lo exige con un CHECK; aquí se ve antes de
                                // guardar en vez de en el error.
                                restock:
                                  event.target.value === 'sellable' ? draft.restock : false,
                              },
                            }))
                          }
                          inputProps={{ 'aria-label': t('returns.field.condition') }}
                          sx={{ minWidth: 140 }}
                        >
                          {RETURN_CONDITIONS.map((condition) => (
                            <MenuItem key={condition} value={condition}>
                              {t(`returns.condition.${condition}` as MessageKey)}
                            </MenuItem>
                          ))}
                        </SelectField>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={draft.restock}
                          disabled={!editable || draft.condition !== 'sellable'}
                          inputProps={{ 'aria-label': t('returns.field.restock') }}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [line.id]: { ...draft, restock: event.target.checked },
                            }))
                          }
                        />
                        {line.restock_movement_id && (
                          <StatusChip label={t('returns.field.restocked')} />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          value={draft.refundAmount}
                          disabled={!editable}
                          inputProps={{
                            'aria-label': t('returns.field.refund'),
                            inputMode: 'decimal',
                          }}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [line.id]: { ...draft, refundAmount: event.target.value },
                            }))
                          }
                          sx={{ maxWidth: 120 }}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Stack>

          <Divider />

          {/* ---- Acciones, solo las que caben en este estado --------------- */}
          <Stack spacing={2}>
            <DetailHeading>{t('fulfillment.detail.actions')}</DetailHeading>
            {!canOperate && <Alert severity="info">{t('fulfillment.detail.readOnly')}</Alert>}

            {state === 'requested' && (
              <Stack spacing={1}>
                <TextField
                  size="small"
                  label={t('returns.field.decisionNote')}
                  value={note}
                  disabled={!canOperate}
                  onChange={(event) => setNote(event.target.value)}
                  helperText={t('returns.field.decisionNoteHelp')}
                />
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    size="small"
                    color="error"
                    disabled={!canOperate || busy || note.trim() === ''}
                    onClick={() =>
                      void run(
                        () =>
                          decide.mutateAsync({
                            returnId: request.return_request_id,
                            decision: 'reject',
                            note,
                          }),
                        'returns.action.rejected',
                      )
                    }
                  >
                    {t('returns.action.reject')}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!canOperate || busy}
                    onClick={() =>
                      void run(
                        () =>
                          decide.mutateAsync({
                            returnId: request.return_request_id,
                            decision: 'approve',
                            note,
                          }),
                        'returns.action.approved',
                      )
                    }
                  >
                    {t('returns.action.approve')}
                  </Button>
                </Stack>
              </Stack>
            )}

            {(state === 'approved' || state === 'in_transit') && (
              <Stack direction="row" justifyContent="flex-end">
                <Button
                  variant="contained"
                  size="small"
                  disabled={!canOperate || busy}
                  onClick={() =>
                    void run(
                      () => receive.mutateAsync(request.return_request_id),
                      'returns.action.received',
                    )
                  }
                >
                  {t('returns.action.receive')}
                </Button>
              </Stack>
            )}

            {state === 'received' && (
              <Stack direction="row" justifyContent="flex-end">
                <Button
                  variant="contained"
                  size="small"
                  disabled={!canOperate || busy}
                  onClick={() =>
                    void run(
                      () =>
                        inspect.mutateAsync({
                          returnId: request.return_request_id,
                          lines: Object.entries(drafts).map(([lineId, draft]) => ({
                            return_item_id: lineId,
                            condition: draft.condition,
                            restock: draft.restock,
                            refund_amount: draft.refundAmount.trim() === '' ? '0' : draft.refundAmount,
                          })),
                          // `null` = que la base sume las líneas. El operador
                          // puede cambiar cada importe arriba; el total no se
                          // recalcula en el navegador.
                          refundAmount: null,
                        }),
                      'returns.action.inspected',
                    )
                  }
                >
                  {t('returns.action.inspect')}
                </Button>
              </Stack>
            )}

            {state === 'inspected' && (
              <Stack spacing={1}>
                <SelectField
                  size="small"
                  label={t('returns.field.resolution')}
                  value={resolution}
                  disabled={!canOperate}
                  onChange={(event) => setResolution(event.target.value)}
                  helperText={t('returns.field.resolutionHelp')}
                >
                  {RETURN_RESOLUTIONS.map((entry) => (
                    <MenuItem key={entry} value={entry}>
                      {t(`returns.resolution.${entry}` as MessageKey)}
                    </MenuItem>
                  ))}
                </SelectField>
                <Alert severity="info">{t('returns.detail.noAutoRefund')}</Alert>
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!canOperate || busy}
                    onClick={() =>
                      void run(
                        () =>
                          complete.mutateAsync({
                            returnId: request.return_request_id,
                            resolution,
                          }),
                        'returns.action.completed',
                      )
                    }
                  >
                    {t('returns.action.complete')}
                  </Button>
                </Stack>
              </Stack>
            )}

            {(state === 'completed' || state === 'rejected' || state === 'cancelled') && (
              <Alert severity="info">{t('returns.detail.closed')}</Alert>
            )}
          </Stack>

          <Divider />

          {/* ---- Bitácora -------------------------------------------------- */}
          <Stack spacing={1}>
            <DetailHeading>{t('fulfillment.detail.timeline')}</DetailHeading>
            <DetailTimeline
              empty={t('payments.detail.none')}
              entries={(events.data ?? []).map((event) => ({
                id: event.id,
                title: event.to_state
                  ? `${eventLabel(t, event.event_type)} → ${t(`returns.state.${event.to_state}` as MessageKey)}`
                  : eventLabel(t, event.event_type),
                when: formatDateTime(event.created_at, locale),
                meta: [event.actor_email, event.note].filter(Boolean).join(' · '),
              }))}
            />
          </Stack>
        </Stack>
      )}
    </FormDrawer>
  )
}
