import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  LinearProgress,
  Pagination,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import {
  BODY_MAX,
  ReviewError,
  TITLE_MAX,
  validateReviewDraft,
  type OwnReview,
  type PublicReview,
  type ReviewDraft,
  type ReviewDraftErrors,
} from './api'
import { useMyReview, useProductReviews, useSubmitReview } from './hooks'

const CARD_SX = {
  p: { xs: 2, md: 3 },
  borderRadius: 'var(--sf-radius)',
  border: '1px solid var(--sf-line)',
  boxShadow: 'var(--sf-shadow)',
} as const

/**
 * Opiniones de la ficha: resumen, lista paginada y el formulario del comprador.
 *
 * Todo lo que se ve aquí YA pasó por moderación: la lista y la media salen de
 * `product_reviews_for_slug`, que solo cuenta las publicadas. Lo único que se
 * pinta sin publicar es la reseña PROPIA, y se dice en qué estado está.
 *
 * El texto se pinta como texto: React lo escapa, y la base además rechaza el
 * marcado al guardar.
 */
export function ProductReviews({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const headingId = useId()
  const reviews = useProductReviews(storeSlug, productId, page)

  // Cambiar de producto (una relacionada) vuelve a la primera página.
  useEffect(() => setPage(1), [productId])

  const data = reviews.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <Card component="section" aria-labelledby={headingId} sx={CARD_SX}>
      <Typography
        id={headingId}
        component="h2"
        sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 800, letterSpacing: '-0.02em', mb: 2 }}
      >
        {t('store.reviews.title')}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 3, md: 4 },
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.6fr)' },
          alignItems: 'start',
        }}
      >
        <Stack sx={{ gap: 3 }}>
          {data && data.summary.count > 0 && <Summary summary={data.summary} />}
          <ReviewForm storeSlug={storeSlug} productId={productId} />
        </Stack>

        <Stack sx={{ gap: 2 }}>
          {reviews.isPending ? (
            <Stack role="status" aria-live="polite" sx={{ alignItems: 'center', py: 3, gap: 1 }}>
              <CircularProgress size={24} aria-hidden />
              <Typography sx={{ color: 'var(--muted)' }}>{t('common.loading')}</Typography>
            </Stack>
          ) : reviews.isError ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void reviews.refetch()}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t('store.reviews.error')}
            </Alert>
          ) : data && data.reviews.length === 0 ? (
            <Typography sx={{ color: 'var(--muted)' }}>{t('store.reviews.empty')}</Typography>
          ) : (
            <>
              <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 2 }}>
                {data?.reviews.map((review) => <ReviewItem key={review.review_id} review={review} />)}
              </Stack>
              {pages > 1 && (
                <Pagination
                  count={pages}
                  page={page}
                  onChange={(_, next) => setPage(next)}
                  aria-label={t('store.reviews.pages')}
                  sx={{ alignSelf: 'center' }}
                />
              )}
            </>
          )}
        </Stack>
      </Box>
    </Card>
  )
}

function Summary({
  summary,
}: {
  summary: { count: number; average: string | null; distribution: Record<string, number> }
}) {
  const { t, locale } = useI18n()
  // La media llega como texto con dos decimales; se enseña con uno y en el
  // formato del idioma («4,5» en español).
  const average = summary.average === null ? 0 : Number(summary.average)
  const shown = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(average)
  const label = t('store.reviews.average').replace('{average}', shown)

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 34, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {shown}
        </Typography>
        <Stack>
          <Rating value={average} precision={0.1} readOnly getLabelText={() => label} />
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {summary.count === 1
              ? t('store.reviews.countOne')
              : t('store.reviews.count').replace('{count}', String(summary.count))}
          </Typography>
        </Stack>
      </Stack>

      <Stack component="dl" aria-label={t('store.reviews.distribution')} sx={{ m: 0, gap: 0.5 }}>
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = summary.distribution[String(stars)] ?? 0
          const percent = summary.count > 0 ? Math.round((count / summary.count) * 100) : 0
          return (
            <Stack
              key={stars}
              direction="row"
              sx={{ alignItems: 'center', gap: 1 }}
              title={t('store.reviews.distributionRow')
                .replace('{n}', String(stars))
                .replace('{count}', String(count))}
            >
              <Typography component="dt" sx={{ fontSize: TS.label, width: 20, color: 'var(--muted)' }}>
                {stars}★
              </Typography>
              <Box component="dd" sx={{ m: 0, flex: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={percent}
                  aria-hidden
                  sx={{ height: 8, borderRadius: 4, bgcolor: 'var(--neutral-soft)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' } }}
                />
              </Box>
              <Typography sx={{ fontSize: TS.label, width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {count}
              </Typography>
            </Stack>
          )
        })}
      </Stack>
    </Stack>
  )
}

function ReviewItem({ review }: { review: PublicReview }) {
  const { t, locale } = useI18n()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(review.published_at))
  return (
    <Box component="li" sx={{ borderBottom: '1px solid var(--border)', pb: 2, '&:last-of-type': { borderBottom: 0 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Rating
          value={review.rating}
          readOnly
          size="small"
          getLabelText={() => t('store.reviews.starsLabel').replace('{n}', String(review.rating))}
        />
        {review.title && <Typography sx={{ fontWeight: 800 }}>{review.title}</Typography>}
      </Stack>
      <Typography sx={{ whiteSpace: 'pre-line', mt: 0.75, lineHeight: 1.6 }}>{review.body}</Typography>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: TS.label, fontWeight: 700 }}>
          {review.display_name ?? t('store.reviews.anonymous')}
        </Typography>
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{date}</Typography>
        {review.verified_purchase && <VerifiedBadge />}
      </Stack>
    </Box>
  )
}

function VerifiedBadge() {
  const { t } = useI18n()
  return (
    <Chip
      size="small"
      icon={<VerifiedRoundedIcon aria-hidden />}
      label={t('store.reviews.verified')}
      sx={{ bgcolor: 'var(--accent-soft)', color: 'var(--accent-deep)', fontWeight: 700, '& .MuiChip-icon': { color: 'var(--accent-deep)' } }}
    />
  )
}

const EMPTY_DRAFT: ReviewDraft = { rating: null, title: '', body: '', displayName: '' }

/**
 * El formulario. Sin sesión invita a entrar y vuelve aquí; con sesión enseña
 * la reseña propia y su estado, y deja escribirla o editarla.
 */
function ReviewForm({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const { t } = useI18n()
  const { status, session } = useSessionContext()
  const location = useLocation()
  const userId = session?.user.id ?? null
  const mine = useMyReview(storeSlug, productId, status === 'authenticated' ? userId : null)
  const submit = useSubmitReview(storeSlug, productId, userId)

  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<ReviewDraftErrors>({})
  const [serverError, setServerError] = useState<ReviewError | null>(null)
  const [sent, setSent] = useState(false)
  const formId = useId()

  // La propia llega después de montar: se vuelca al formulario una vez.
  const own = mine.data ?? null
  useEffect(() => {
    if (!own) return
    setDraft({
      rating: own.rating,
      title: own.title ?? '',
      body: own.body,
      displayName: own.display_name ?? '',
    })
  }, [own])

  if (status === 'loading') return null

  if (status !== 'authenticated') {
    return (
      <Stack sx={{ gap: 1, alignItems: 'flex-start' }}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('store.reviews.form.signIn')}</Typography>
        <Button component={Link} to="/login" state={{ from: location.pathname }} variant="outlined" size="small">
          {t('auth.submit')}
        </Button>
      </Stack>
    )
  }

  function update<K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setSent(false)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setServerError(null)
    const found = validateReviewDraft(draft)
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    try {
      await submit.mutateAsync({ storeSlug, productId, draft })
      setSent(true)
    } catch (caught) {
      setServerError(caught instanceof ReviewError ? caught : new ReviewError('ERROR_INTERNO'))
    }
  }

  return (
    <Stack component="form" id={formId} noValidate onSubmit={(event) => void onSubmit(event)} sx={{ gap: 1.5 }}>
      <Typography component="h3" sx={{ fontWeight: 800 }}>
        {t('store.reviews.form.title')}
      </Typography>

      {own && <OwnStatus review={own} />}

      <Box>
        <Typography id={`${formId}-rating`} sx={{ fontSize: TS.label, fontWeight: 700, mb: 0.5 }}>
          {t('store.reviews.form.rating')}
        </Typography>
        <Rating
          name={`${formId}-rating-input`}
          value={draft.rating}
          onChange={(_, value) => update('rating', value)}
          getLabelText={(value) => t('store.reviews.starsLabel').replace('{n}', String(value))}
          aria-labelledby={`${formId}-rating`}
        />
        {errors.rating && (
          <Typography role="alert" sx={{ fontSize: TS.label, color: 'error.main' }}>
            {t(errors.rating)}
          </Typography>
        )}
      </Box>

      <TextField
        size="small"
        label={t('store.reviews.form.headline')}
        value={draft.title}
        onChange={(event) => update('title', event.target.value)}
        error={Boolean(errors.title)}
        helperText={errors.title ? t(errors.title) : undefined}
        inputProps={{ maxLength: TITLE_MAX }}
      />
      <TextField
        size="small"
        multiline
        minRows={3}
        label={t('store.reviews.form.body')}
        value={draft.body}
        onChange={(event) => update('body', event.target.value)}
        error={Boolean(errors.body)}
        helperText={errors.body ? t(errors.body) : `${draft.body.trim().length}/${BODY_MAX}`}
        inputProps={{ maxLength: BODY_MAX }}
        required
      />
      <TextField
        size="small"
        label={t('store.reviews.form.displayName')}
        value={draft.displayName}
        onChange={(event) => update('displayName', event.target.value)}
        error={Boolean(errors.displayName)}
        helperText={errors.displayName ? t(errors.displayName) : t('store.reviews.form.displayNameHelp')}
        inputProps={{ maxLength: 40 }}
      />

      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.reviews.form.moderation')}</Typography>

      {serverError && <Alert severity="error">{t(serverError.key)}</Alert>}
      {sent && (
        <Alert severity="success" role="status">
          {t('store.reviews.form.sent')}
        </Alert>
      )}

      <Button
        type="submit"
        variant="contained"
        disabled={submit.isPending}
        startIcon={submit.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
        sx={{ alignSelf: 'flex-start' }}
      >
        {own ? t('store.reviews.form.update') : t('store.reviews.form.submit')}
      </Button>
    </Stack>
  )
}

function OwnStatus({ review }: { review: OwnReview }) {
  const { t } = useI18n()
  const label =
    review.status === 'published'
      ? t('store.reviews.status.published')
      : review.status === 'rejected'
        ? t('store.reviews.status.rejected')
        : t('store.reviews.status.pending')
  return (
    <Stack sx={{ gap: 0.75, alignItems: 'flex-start' }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label={label}
          color={review.status === 'published' ? 'success' : review.status === 'rejected' ? 'warning' : 'default'}
          sx={{ fontWeight: 700 }}
        />
        {review.verified_purchase && <VerifiedBadge />}
      </Stack>
      {review.status === 'rejected' && review.rejection_reason && (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {t('store.reviews.rejectedReason').replace('{reason}', review.rejection_reason)}
        </Typography>
      )}
    </Stack>
  )
}
