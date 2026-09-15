import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import {
  Alert,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Rating,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { downloadCsv } from '@/shared/lib/csv'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CatalogError } from '../api/errors'
import {
  REASON_MAX,
  REASON_MIN,
  filterQueue,
  reviewsToCsv,
  type QueueReview,
  type ReviewStatus,
} from './api'
import { useModerateReview, useReviewQueue } from './hooks'

const TABS: Array<{ value: ReviewStatus; label: MessageKey }> = [
  { value: 'pending', label: 'admin.reviews.tab.pending' },
  { value: 'published', label: 'admin.reviews.tab.published' },
  { value: 'rejected', label: 'admin.reviews.tab.rejected' },
]

/**
 * Moderación de reseñas (cierre).
 *
 * Una cola, no un módulo: tabs de estado, un buscador general y Exportar, que
 * es la anatomía de listado de la suite. Leer la cola puede cualquier miembro
 * —la RLS decide—; publicar y rechazar exige `catalog.write` (owner, admin,
 * catalog), el mismo corte que aplica `moderate_product_review` en la base.
 * Ocultar los botones evita un 403, no lo sustituye.
 */
export function ReviewsPage() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore, status: tenantStatus, can } = useTenant()
  const canModerate = can('catalog.write')

  const [status, setStatus] = useState<ReviewStatus>('pending')
  const [term, setTerm] = useState('')
  const [rejecting, setRejecting] = useState<QueueReview | null>(null)
  const [reason, setReason] = useState('')
  const [dialogError, setDialogError] = useState<MessageKey | null>(null)

  const ready = tenantStatus !== 'loading' && Boolean(tenant && activeCompanyId)
  const queue = useReviewQueue(ready)
  const moderate = useModerateReview()

  const rows = useMemo(() => filterQueue(queue.data ?? [], status, term), [queue.data, status, term])
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale])

  const header = (
    <PageHeader
      icon={<RateReviewRoundedIcon />}
      title={t('admin.reviews.title')}
      subtitle={activeStore?.name ?? t('admin.reviews.subtitle')}
      actions={
        ready ? (
          <Button
            variant="outlined"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(`resenas-${activeStore?.slug ?? 'tienda'}.csv`, reviewsToCsv(rows))}
          >
            {t('common.export')}
          </Button>
        ) : undefined
      }
    />
  )

  if (tenantStatus === 'loading') {
    return (
      <>
        {header}
        <Card>
          <TableSkeleton columns={5} />
        </Card>
      </>
    )
  }

  if (!tenant || !activeCompanyId) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            title={t('admin.store.none')}
            description={t('admin.store.noneBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  async function publish(review: QueueReview) {
    try {
      await moderate.mutateAsync({ reviewId: review.id, decision: 'publish' })
      notify(t('admin.reviews.publishedToast'))
    } catch (caught) {
      notify(t(caught instanceof CatalogError ? caught.key : 'admin.reviews.error.generic'), 'error')
    }
  }

  function openReject(review: QueueReview) {
    setRejecting(review)
    setReason('')
    setDialogError(null)
  }

  async function confirmReject() {
    if (!rejecting) return
    const trimmed = reason.trim()
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setDialogError('admin.reviews.error.reason')
      return
    }
    try {
      await moderate.mutateAsync({ reviewId: rejecting.id, decision: 'reject', reason: trimmed })
      notify(t('admin.reviews.rejectedToast'))
      setRejecting(null)
    } catch (caught) {
      setDialogError(caught instanceof CatalogError ? caught.key : 'admin.reviews.error.generic')
    }
  }

  return (
    <>
      {header}

      <Stack spacing={2}>
        {!canModerate && <Alert severity="info">{t('admin.reviews.readOnly')}</Alert>}

        <Tabs
          value={status}
          onChange={(_, next: ReviewStatus) => setStatus(next)}
          centered
          aria-label={t('common.status')}
          sx={{
            borderBottom: '1px solid var(--border)',
            '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 44 },
          }}
        >
          {TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={t(tab.label)} />
          ))}
        </Tabs>

        <SearchField value={term} onChange={setTerm} placeholder={t('admin.reviews.search')} />

        <Card>
          {queue.isPending ? (
            <TableSkeleton columns={5} />
          ) : queue.isError ? (
            <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('admin.reviews.empty')} icon={<RateReviewRoundedIcon fontSize="small" />} />
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.reviews.col.product')}</TableCell>
                    <TableCell>{t('admin.reviews.col.rating')}</TableCell>
                    <TableCell>{t('admin.reviews.col.review')}</TableCell>
                    <TableCell>{t('admin.reviews.col.author')}</TableCell>
                    <TableCell>{t('admin.reviews.col.date')}</TableCell>
                    {canModerate && <TableCell align="right">{t('admin.reviews.col.actions')}</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((review) => (
                    <TableRow key={review.id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{review.product_name ?? '—'}</TableCell>
                      <TableCell>
                        <Rating
                          value={review.rating}
                          readOnly
                          size="small"
                          getLabelText={() => t('store.reviews.starsLabel').replace('{n}', String(review.rating))}
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 420 }}>
                        {review.title && <Typography sx={{ fontWeight: 700 }}>{review.title}</Typography>}
                        <Typography sx={{ whiteSpace: 'pre-line', color: 'var(--text)' }}>{review.body}</Typography>
                        {review.rejection_reason && (
                          <Typography sx={{ color: 'var(--muted)', fontSize: 13, mt: 0.5 }}>
                            {t('store.reviews.rejectedReason').replace('{reason}', review.rejection_reason)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack sx={{ gap: 0.5, alignItems: 'flex-start' }}>
                          <span>{review.display_name ?? t('store.reviews.anonymous')}</span>
                          {review.verified_purchase && (
                            <Chip
                              size="small"
                              icon={<VerifiedRoundedIcon aria-hidden />}
                              label={t('store.reviews.verified')}
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                        {dateFormat.format(new Date(review.created_at))}
                      </TableCell>
                      {canModerate && (
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {review.status !== 'published' && (
                            <Button
                              size="small"
                              variant="contained"
                              disabled={moderate.isPending}
                              onClick={() => void publish(review)}
                              aria-label={`${t('admin.reviews.publish')} · ${review.product_name ?? ''} · ${review.display_name ?? t('store.reviews.anonymous')}`}
                            >
                              {t('admin.reviews.publish')}
                            </Button>
                          )}
                          {review.status !== 'rejected' && (
                            <Button
                              size="small"
                              color="warning"
                              disabled={moderate.isPending}
                              onClick={() => openReject(review)}
                              sx={{ ml: 1 }}
                              aria-label={`${t('admin.reviews.reject')} · ${review.product_name ?? ''} · ${review.display_name ?? t('store.reviews.anonymous')}`}
                            >
                              {t('admin.reviews.reject')}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </Stack>

      <Dialog open={rejecting !== null} onClose={() => setRejecting(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('admin.reviews.rejectTitle')}</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            {dialogError && <Alert severity="error">{t(dialogError)}</Alert>}
            <TextField
              autoFocus
              multiline
              minRows={3}
              label={t('admin.reviews.reason')}
              helperText={t('admin.reviews.reasonHelp')}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setDialogError(null)
              }}
              inputProps={{ maxLength: REASON_MAX }}
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={moderate.isPending}
            onClick={() => void confirmReject()}
          >
            {t('admin.reviews.reject')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
