import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { MessageKey } from '@/shared/i18n/messages'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDateTime } from '@/shared/lib/format'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useRejects, useRuns } from './hooks'
import { RUN_TONE } from './rules'
import type { ConnectorRun } from './types'

function Rejects({ run }: { run: ConnectorRun }) {
  const { t } = useI18n()
  const rejects = useRejects(run.id)
  if (rejects.isPending) return <TableSkeleton columns={3} />
  if (rejects.isError) return <ErrorState error={rejects.error} onRetry={() => void rejects.refetch()} />
  return (
    <Stack sx={{ gap: 1 }}>
      {run.rejected > (rejects.data ?? []).length && (
        <Alert severity="info">
          {t('integrations.sources.runs.rejectsCapped').replace('{n}', String(run.rejected))}
        </Alert>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>SKU</TableCell>
            <TableCell>{t('integrations.sources.runs.reason')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(rejects.data ?? []).map((reject) => (
            <TableRow key={reject.id}>
              <TableCell>{reject.row_index}</TableCell>
              <TableCell>{reject.sku ?? '—'}</TableCell>
              <TableCell>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{reject.reason}</Typography>
                {reject.detail && (
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-word' }}>
                    {reject.detail}
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}

export function RunsDialog({ feedId, onClose }: { feedId: string | null; onClose: () => void }) {
  const { t, locale } = useI18n()
  const runs = useRuns(feedId)
  const [selected, setSelected] = useState<ConnectorRun | null>(null)

  return (
    <Dialog
      open={feedId !== null}
      onClose={() => {
        setSelected(null)
        onClose()
      }}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>
        {selected
          ? t('integrations.sources.runs.rejectsTitle').replace('{date}', formatDateTime(selected.started_at, locale))
          : t('integrations.sources.runs.title')}
      </DialogTitle>
      <DialogContent>
        {selected ? (
          <Rejects run={selected} />
        ) : runs.isPending ? (
          <TableSkeleton columns={5} />
        ) : runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : (runs.data ?? []).length === 0 ? (
          <EmptyState
            title={t('integrations.sources.runs.empty')}
            description={t('integrations.sources.runs.emptyBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('integrations.sources.runs.when')}</TableCell>
                <TableCell>{t('integrations.sources.runs.status')}</TableCell>
                <TableCell align="right">{t('integrations.sources.runs.received')}</TableCell>
                <TableCell align="right">{t('integrations.sources.runs.applied')}</TableCell>
                <TableCell align="right">{t('integrations.sources.runs.unchanged')}</TableCell>
                <TableCell align="right">{t('integrations.sources.runs.rejected')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(runs.data ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    {formatDateTime(run.started_at, locale)}
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {t(`integrations.sources.trigger.${run.trigger}` as MessageKey)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      tone={RUN_TONE[run.status]}
                      label={t(`integrations.sources.status.${run.status}` as MessageKey)}
                    />
                    {run.error_code && (
                      <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 0.5, wordBreak: 'break-word' }}>
                        {run.error_code}
                        {run.error_message ? ` · ${run.error_message}` : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{run.received}</TableCell>
                  <TableCell align="right">{run.applied}</TableCell>
                  <TableCell align="right">{run.unchanged}</TableCell>
                  <TableCell align="right">
                    {run.rejected > 0 ? (
                      <Button size="small" onClick={() => setSelected(run)}>
                        {run.rejected}
                      </Button>
                    ) : (
                      0
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        {selected && <Button onClick={() => setSelected(null)}>{t('integrations.sources.runs.back')}</Button>}
        <Button
          onClick={() => {
            setSelected(null)
            onClose()
          }}
        >
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
