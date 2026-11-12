import {
  Alert,
  Box,
  Button,
  Card,
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
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDateTime, formatRelative } from '@/shared/lib/format'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import { IntegrationsError, isForbidden, isMissingModule } from '../errors'
import { FeedDialog } from './FeedDialog'
import { useDeleteFeed, useDeleteSource, useFeeds, useRunFeedNow, useSources } from './hooks'
import { RunsDialog } from './RunsDialog'
import { RUN_TONE } from './rules'
import { SourceDialog } from './SourceDialog'
import type { ConnectorFeed, ConnectorSource } from './types'

/**
 * Fuentes de lectura: eCommerce va a buscar datos a la API del ERP.
 *
 * Es la otra dirección de la pestaña «API»: allí el ERP nos llama; aquí lo
 * llamamos nosotros, cada cierto tiempo, con el formato del Estándar de
 * integración ERP §11. Ver y administrar exige owner/admin; crear, además, el
 * módulo `integrations.enterprise` (la base lo comprueba igual).
 *
 * Lo que de verdad importa a quien mira es «¿está entrando?»: por eso cada
 * flujo enseña su último resultado, cuándo fue y cuándo toca el siguiente, y
 * el historial con los registros que no entraron y por qué.
 */

type Confirm =
  | { kind: 'source'; item: ConnectorSource }
  | { kind: 'feed'; item: ConnectorFeed }

function FeedRow({
  feed,
  canEdit,
  onEdit,
  onHistory,
  onDelete,
}: {
  feed: ConnectorFeed
  canEdit: boolean
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const runNow = useRunFeedNow()
  const running = feed.lease_until !== null && Date.parse(feed.lease_until) > Date.now()
  const queued = feed.run_requested && !running

  return (
    <TableRow>
      <TableCell>
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
          {t(`integrations.sources.resource.${feed.resource}` as MessageKey)}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>{feed.path}</Typography>
      </TableCell>
      <TableCell>
        {running ? (
          <StatusChip tone="info" label={t('integrations.sources.status.running')} />
        ) : queued ? (
          <StatusChip tone="info" label={t('integrations.sources.status.queued')} />
        ) : feed.last_status ? (
          <StatusChip
            tone={RUN_TONE[feed.last_status]}
            label={t(`integrations.sources.status.${feed.last_status}` as MessageKey)}
          />
        ) : (
          <StatusChip label={t('integrations.sources.status.never')} />
        )}
        {!feed.is_active && <StatusChip label={t('integrations.sources.inactive')} />}
        {feed.last_run_at && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 0.5 }}>
            {formatRelative(feed.last_run_at, locale)}
            {feed.last_error_code ? ` · ${feed.last_error_code}` : ''}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <Typography sx={{ fontSize: 13 }}>
          {feed.interval_minutes < 60
            ? t('integrations.sources.every.minutes').replace('{n}', String(feed.interval_minutes))
            : t('integrations.sources.every.hours').replace('{n}', String(feed.interval_minutes / 60))}
        </Typography>
        {feed.is_active && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('integrations.sources.next').replace('{date}', formatDateTime(feed.next_run_at, locale))}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {canEdit && (
          <Button
            size="small"
            disabled={runNow.isPending || running || !feed.is_active}
            onClick={() =>
              runNow.mutate(
                { id: feed.id, full: false },
                { onSuccess: () => notify(t('integrations.sources.queuedNotice')) },
              )
            }
          >
            {t('integrations.sources.runNow')}
          </Button>
        )}
        <Button size="small" onClick={onHistory}>
          {t('integrations.sources.history')}
        </Button>
        {canEdit && (
          <>
            <Button
              size="small"
              disabled={runNow.isPending || running || !feed.is_active}
              onClick={() =>
                runNow.mutate(
                  { id: feed.id, full: true },
                  { onSuccess: () => notify(t('integrations.sources.queuedNotice')) },
                )
              }
            >
              {t('integrations.sources.runFull')}
            </Button>
            <Button size="small" onClick={onEdit}>
              {t('common.edit')}
            </Button>
            <Button size="small" color="error" onClick={onDelete}>
              {t('common.delete')}
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  )
}

export function SourcesSection() {
  const { t } = useI18n()
  const sources = useSources()
  const feeds = useFeeds()
  const deleteSource = useDeleteSource()
  const deleteFeed = useDeleteFeed()
  const { has } = useCapabilities()
  const contratado = has('integrations.enterprise')

  const [sourceDialog, setSourceDialog] = useState<{ source: ConnectorSource | null } | null>(null)
  const [feedDialog, setFeedDialog] = useState<{ sourceId: string; feed: ConnectorFeed | null } | null>(null)
  const [history, setHistory] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  if (isForbidden(sources.error)) {
    return (
      <UnauthorizedState title={t('integrations.error.forbidden')} description={t('integrations.forbiddenBody')} />
    )
  }
  if (isMissingModule(sources.error)) {
    return <EmptyState title={t('integrations.error.noModule')} description={t('integrations.noModuleBody')} />
  }

  const deleting = confirm?.kind === 'source' ? deleteSource : deleteFeed
  const feedsOf = (sourceId: string) => (feeds.data ?? []).filter((feed) => feed.source_id === sourceId)

  return (
    <Stack sx={{ gap: 2 }}>
      <Alert severity="info">{t('integrations.sources.intro')}</Alert>

      {contratado ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={() => setSourceDialog({ source: null })}>
            {t('integrations.sources.new')}
          </Button>
        </Stack>
      ) : (
        <Alert severity="warning">
          <strong>{t('integrations.error.noModule')}.</strong> {t('integrations.noModuleBody')}
        </Alert>
      )}

      {sources.isPending ? (
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      ) : sources.isError ? (
        <Card>
          <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
        </Card>
      ) : (sources.data ?? []).length === 0 ? (
        <Card>
          <EmptyState title={t('integrations.sources.empty')} description={t('integrations.sources.emptyBody')} />
        </Card>
      ) : (
        (sources.data ?? []).map((source) => {
          const list = feedsOf(source.id)
          return (
            <Card key={source.id} sx={{ p: { xs: 2, md: 2.5 } }} data-connector-source={source.name}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between', gap: 1.5, alignItems: { sm: 'flex-start' } }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
                    {source.name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>
                    {source.base_url}
                  </Typography>
                  <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                    <StatusChip label={t(`integrations.sources.auth.${source.auth_type}` as MessageKey)} />
                    {source.auth_type !== 'none' && (
                      <StatusChip
                        tone={source.has_secret ? 'success' : 'warning'}
                        label={t(
                          source.has_secret
                            ? 'integrations.sources.secretSaved'
                            : 'integrations.sources.secretMissing',
                        )}
                      />
                    )}
                    {!source.is_active && <StatusChip label={t('integrations.sources.inactive')} />}
                  </Stack>
                </Box>
                {contratado && (
                  <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => setFeedDialog({ sourceId: source.id, feed: null })}>
                      {t('integrations.sources.addFeed')}
                    </Button>
                    <Button size="small" onClick={() => setSourceDialog({ source })}>
                      {t('common.edit')}
                    </Button>
                    <Button size="small" color="error" onClick={() => setConfirm({ kind: 'source', item: source })}>
                      {t('common.delete')}
                    </Button>
                  </Stack>
                )}
              </Stack>

              {list.length === 0 ? (
                <Typography sx={{ fontSize: 13, color: 'var(--muted)', mt: 2 }}>
                  {t('integrations.sources.noFeeds')}
                </Typography>
              ) : (
                <Box sx={{ overflowX: 'auto', mt: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('integrations.sources.feed.resource')}</TableCell>
                        <TableCell>{t('integrations.sources.lastRun')}</TableCell>
                        <TableCell>{t('integrations.sources.feed.interval')}</TableCell>
                        <TableCell align="right" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {list.map((feed) => (
                        <FeedRow
                          key={feed.id}
                          feed={feed}
                          canEdit={contratado}
                          onEdit={() => setFeedDialog({ sourceId: source.id, feed })}
                          onHistory={() => setHistory(feed.id)}
                          onDelete={() => setConfirm({ kind: 'feed', item: feed })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Card>
          )
        })
      )}

      {sourceDialog && (
        <SourceDialog open source={sourceDialog.source} onClose={() => setSourceDialog(null)} />
      )}
      {feedDialog && (
        <FeedDialog
          open
          sourceId={feedDialog.sourceId}
          feed={feedDialog.feed}
          onClose={() => setFeedDialog(null)}
        />
      )}
      <RunsDialog feedId={history} onClose={() => setHistory(null)} />

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t(confirm?.kind === 'source' ? 'integrations.sources.deleteSource' : 'integrations.sources.deleteFeed')}
        </DialogTitle>
        <DialogContent>
          {deleting.isError && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {t(deleting.error instanceof IntegrationsError ? deleting.error.key : 'integrations.error.generic')}
            </Alert>
          )}
          <Typography sx={{ fontSize: 14 }}>
            {t(
              confirm?.kind === 'source'
                ? 'integrations.sources.deleteSourceBody'
                : 'integrations.sources.deleteFeedBody',
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={deleting.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting.isPending}
            onClick={() => {
              if (!confirm) return
              const onSuccess = () => setConfirm(null)
              if (confirm.kind === 'source') deleteSource.mutate(confirm.item.id, { onSuccess })
              else deleteFeed.mutate(confirm.item.id, { onSuccess })
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
