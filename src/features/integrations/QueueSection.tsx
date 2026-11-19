import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
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
import { isForbidden } from './errors'
import { useMessageDetail, useQueue, useRetryMessage } from './hooks'
import type { QueueMessage } from './types'

/**
 * La COLA: qué está esperando salir, qué se está reintentando y qué murió.
 *
 * Un solo buscador general y pestañas de estado (regla de suite §8). Lo que se
 * busca es un proveedor, una operación, un destino o —el caso que importa— un
 * correlation id: el que alguien pegó en una incidencia.
 *
 * ## Por qué el detalle se abre y no se pinta en la fila
 *
 * Porque abrirlo ESCRIBE en la bitácora: `integration_message_detail` registra
 * quién miró el contenido de un mensaje. Pintarlo en el listado convertiría
 * abrir la pantalla en cien entradas de auditoría y dejaría de distinguir
 * «alguien consultó este mensaje» de «alguien pasó por aquí».
 *
 * Y lo que se ve está redactado dos veces por la base —tarjeta y datos
 * personales— y la URL del destino llega sin cadena de consulta. Esta pantalla
 * no filtra nada: un filtro de navegador se salta abriendo la pestaña de red.
 */

function statusColor(row: QueueMessage): 'error' | 'warning' | 'success' | 'default' {
  if (row.is_dead) return 'error'
  if (row.is_retrying) return 'warning'
  if (row.status === 'succeeded') return 'success'
  return 'default'
}

function DetailDialog({ outboxId, onClose }: { outboxId: string | null; onClose: () => void }) {
  const { t, locale } = useI18n()
  const detail = useMessageDetail(outboxId)

  return (
    <Dialog open={outboxId !== null} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('integrations.queue.detailTitle')}</DialogTitle>
      <DialogContent>
        {detail.isPending ? (
          <TableSkeleton columns={3} />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <Stack sx={{ gap: 2 }}>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('integrations.queue.sanitized')}
            </Typography>
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              <StatusChip label={`${detail.data.provider_code} · ${eventLabel(t, detail.data.operation)}`} />
              <StatusChip label={termLabel(t, 'status', detail.data.status)} />
              <StatusChip
                label={`${detail.data.attempts}/${detail.data.max_attempts}`}
              />
              {detail.data.target_label && (
                <StatusChip label={detail.data.target_label} />
              )}
            </Stack>
            {detail.data.target_url && (
              <Typography sx={{ fontSize: 12, wordBreak: 'break-all' }}>
                {detail.data.target_url}
              </Typography>
            )}
            {detail.data.last_error && (
              <Typography sx={{ fontSize: 13, color: 'var(--danger, #b3261e)' }}>
                {detail.data.last_error}
              </Typography>
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('integrations.queue.attempt')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell>{t('integrations.queue.latency')}</TableCell>
                  <TableCell>{t('common.date')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {detail.data.attempts_log.map((attempt) => (
                  <TableRow key={`${attempt.attempt}-${attempt.at}`}>
                    <TableCell>{attempt.attempt}</TableCell>
                    <TableCell>
                      <StatusChip
                        tone={attempt.succeeded ? 'success' : 'error'}
                        label={String(attempt.status_code ?? (attempt.succeeded ? 'ok' : '—'))}
                      />
                      {attempt.error && (
                        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                          {attempt.error}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{attempt.latency_ms === null ? '—' : `${attempt.latency_ms} ms`}</TableCell>
                    <TableCell>{formatDateTime(attempt.at, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Typography
              component="pre"
              sx={{
                fontSize: 12,
                p: 1.5,
                m: 0,
                borderRadius: 1,
                background: 'var(--surface-2, rgba(0,0,0,0.04))',
                overflowX: 'auto',
              }}
            >
              {JSON.stringify(detail.data.payload, null, 2)}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
      </DialogActions>
    </Dialog>
  )
}

export function QueueSection() {
  const { t, locale } = useI18n()
  const [status, setStatus] = useState<'open' | 'dead' | 'succeeded' | ''>('open')
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<string | null>(null)

  const queue = useQueue({ status, term: debounced })
  const retry = useRetryMessage()

  if (isForbidden(queue.error)) {
    return (
      <UnauthorizedState
        title={t('integrations.error.forbidden')}
        description={t('integrations.forbiddenBody')}
      />
    )
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <Tabs
        value={status}
        onChange={(_, value: 'open' | 'dead' | 'succeeded' | '') => setStatus(value)}
        aria-label={t('integrations.queue.filter')}
      >
        <Tab value="open" label={t('integrations.queue.open')} />
        <Tab value="dead" label={t('integrations.queue.dead')} />
        <Tab value="succeeded" label={t('integrations.queue.succeeded')} />
        <Tab value="" label={t('integrations.queue.all')} />
      </Tabs>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('integrations.queue.search')}
            ariaLabel={t('integrations.queue.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {queue.isPending ? (
          <TableSkeleton columns={6} />
        ) : queue.isError ? (
          <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
        ) : (queue.data ?? []).length === 0 ? (
          <EmptyState
            title={t('integrations.queue.empty')}
            description={t('integrations.queue.emptyBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('integrations.queue.operation')}</TableCell>
                <TableCell>{t('integrations.queue.target')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell>{t('integrations.queue.nextRetry')}</TableCell>
                <TableCell>{t('integrations.queue.correlation')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(queue.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{eventLabel(t, row.operation)}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {row.provider_name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13 }}>{row.target_label}</Typography>
                    {row.circuit_state !== 'closed' && (
                      <StatusChip tone="error" label={termLabel(t, 'status', row.circuit_state)} />
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={statusColor(row)} label={termLabel(t, 'status', row.status)} />
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {t('integrations.queue.attempt')} {row.attempts}/{row.max_attempts}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {row.is_open && row.next_retry_at
                      ? formatDateTime(row.next_retry_at, locale)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {row.correlation_id ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setDetailId(row.id)}>
                      {t('integrations.queue.detail')}
                    </Button>
                    {row.status !== 'succeeded' && row.status !== 'in_flight' && (
                      <Button size="small" onClick={() => setRetryId(row.id)}>
                        {t('integrations.queue.retry')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <DetailDialog outboxId={detailId} onClose={() => setDetailId(null)} />

      <ReasonDialog
        open={retryId !== null}
        title={t('integrations.queue.retryTitle')}
        body={t('integrations.queue.retryBody')}
        confirmLabel={t('integrations.queue.retry')}
        pending={retry.isPending}
        onCancel={() => setRetryId(null)}
        onConfirm={(reason) => {
          if (!retryId) return
          retry.mutate({ id: retryId, reason }, { onSuccess: () => setRetryId(null) })
        }}
      />
    </Stack>
  )
}
