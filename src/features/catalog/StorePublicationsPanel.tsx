import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatMoneyOrDash } from '@/shared/lib/format'
import { slugify } from '@/shared/lib/slug'
import { StatusChip, type StatusTone } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { ErrorState } from '@/shared/ui/states'
import { CatalogError } from './api/errors'
import { CategoryPicker } from './CategoryPicker'
import {
  categoryTree,
  PRODUCT_STATUSES,
  publicationFormSchema,
  publicationToForm,
  type ProductPublication,
  type ProductStatus,
  type PublicationFormValues,
} from './types'
import { useCategories } from './useCategories'
import {
  useProductPublications,
  usePublishProduct,
  useUnpublishProduct,
  useUpdatePublication,
} from './useProducts'

const STATUS_LABEL: Record<ProductStatus, MessageKey> = {
  draft: 'catalog.status.draft',
  published: 'catalog.status.published',
  archived: 'catalog.status.archived',
}

const STATUS_TONE: Record<ProductStatus, StatusTone> = {
  draft: 'warning',
  published: 'success',
  archived: 'default',
}

function errorKeyOf(error: unknown): MessageKey {
  return error instanceof CatalogError ? error.key : 'catalog.error.generic'
}

/**
 * Pestaña «Tiendas» del cajón de producto (ADR 018).
 *
 * Una tarjeta por cada tienda de la sociedad con el estado del producto EN ESA
 * tienda: publicado o no, dirección, categoría, estado y precio. Editar una no
 * toca las demás ni el maestro.
 *
 * Se edita una tienda a la vez: con dos formularios abiertos habría dos campos
 * «Precio» en la misma pantalla y ni un lector de pantalla ni una persona
 * sabrían cuál es cuál. Y cada tienda carga SUS categorías solo al abrirse: un
 * único selector con las de todas mezclaría «Ofertas» de la tienda A con
 * «Ofertas» de la B.
 */
export function StorePublicationsPanel({
  productId,
  productName,
  canWrite,
}: {
  /** Null = alta todavía sin guardar. */
  productId: string | null
  productName: string
  canWrite: boolean
}) {
  const { t } = useI18n()
  const publications = useProductPublications(productId)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    setEditing(null)
  }, [productId])

  if (!productId) {
    return <Alert severity="info">{t('catalog.publications.saveFirst')}</Alert>
  }

  if (publications.isPending) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
        <CircularProgress size={24} aria-label={t('common.loading')} />
      </Box>
    )
  }

  if (publications.isError) {
    return <ErrorState error={publications.error} onRetry={() => void publications.refetch()} />
  }

  const rows = publications.data ?? []
  const publishedIn = rows.filter((row) => row.publication_id !== null).length

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
        {t('catalog.publications.help')}
      </Typography>
      <Typography sx={{ fontWeight: 700 }}>
        {t('catalog.publications.summary')
          .replace('{n}', String(publishedIn))
          .replace('{total}', String(rows.length))}
      </Typography>

      {rows.map((row) => (
        <PublicationCard
          key={row.store_id}
          productId={productId}
          productName={productName}
          publication={row}
          canWrite={canWrite}
          open={editing === row.store_id}
          onOpen={() => setEditing(row.store_id)}
          onClose={() => setEditing(null)}
        />
      ))}
    </Stack>
  )
}

function PublicationCard({
  productId,
  productName,
  publication,
  canWrite,
  open,
  onOpen,
  onClose,
}: {
  productId: string
  productName: string
  publication: ProductPublication
  canWrite: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const publish = usePublishProduct()
  const update = useUpdatePublication()
  const unpublish = useUnpublishProduct()

  const published = publication.publication_id !== null
  const storeName = publication.store_name
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [values, setValues] = useState<PublicationFormValues>(() => publicationToForm(publication))
  const [errors, setErrors] = useState<Partial<Record<keyof PublicationFormValues, MessageKey>>>({})

  // Las categorías de ESTA tienda, y solo cuando se edita.
  const categories = useCategories(open ? publication.store_id : null)
  const arbol = useMemo(() => categoryTree(categories.data ?? []), [categories.data])

  // Se reinicia al ABRIR, no en cada refresco de la consulta: un refetch en
  // segundo plano no puede borrar lo que alguien está escribiendo.
  const latest = useRef({ publication, published, productName })
  latest.current = { publication, published, productName }
  useEffect(() => {
    if (!open) return
    const current = latest.current
    const initial = publicationToForm(current.publication)
    // Al publicar por primera vez se sugiere la dirección desde el nombre.
    if (!current.published) initial.slug = slugify(current.productName)
    setValues(initial)
    setErrors({})
    setServerError(null)
  }, [open])

  const busy = publish.isPending || update.isPending || unpublish.isPending
  const status = publication.status

  function change<K extends keyof PublicationFormValues>(field: K, value: PublicationFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  async function onSubmit() {
    const parsed = publicationFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: Partial<Record<keyof PublicationFormValues, MessageKey>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof PublicationFormValues
        next[field] = issue.message as MessageKey
      }
      setErrors(next)
      return
    }
    setErrors({})
    setServerError(null)
    try {
      if (published) {
        await update.mutateAsync({
          productId,
          storeId: publication.store_id,
          current: publication,
          values: parsed.data,
        })
      } else {
        await publish.mutateAsync({ productId, storeId: publication.store_id, values: parsed.data })
      }
      notify(t('catalog.publications.saved'))
      onClose()
    } catch (error) {
      setServerError(errorKeyOf(error))
    }
  }

  async function onRemove() {
    try {
      await unpublish.mutateAsync({ productId, storeId: publication.store_id })
      notify(t('catalog.publications.removed'))
      setConfirmRemove(false)
      onClose()
    } catch (error) {
      setConfirmRemove(false)
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  const titleId = `publication-${publication.store_id}`

  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 2 }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography id={titleId} component="h3" sx={{ fontWeight: 700, fontSize: 15 }}>
            {storeName}
          </Typography>
          {status ? (
            <StatusChip tone={STATUS_TONE[status]} label={t(STATUS_LABEL[status])} />
          ) : (
            <StatusChip tone="default" label={t('catalog.publications.notPublished')} />
          )}
          {publication.store_status !== 'active' && (
            <StatusChip tone="info" label={t('catalog.publications.storeInactive')} />
          )}
        </Stack>

        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {published && status === 'published' && publication.store_status === 'active' && publication.slug && (
            <Button
              size="small"
              component="a"
              href={`/s/${publication.store_slug}/product/${publication.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<OpenInNewRoundedIcon fontSize="small" />}
              aria-label={`${t('catalog.publications.view')}: ${storeName}`}
            >
              {t('catalog.publications.view')}
            </Button>
          )}
          {canWrite && !open && (
            <Button
              size="small"
              variant={published ? 'outlined' : 'contained'}
              onClick={onOpen}
              aria-label={`${published ? t('catalog.publications.edit') : t('catalog.publications.publish')}: ${storeName}`}
            >
              {published ? t('catalog.publications.edit') : t('catalog.publications.publish')}
            </Button>
          )}
          {canWrite && published && (
            <Button
              size="small"
              color="error"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              aria-label={`${t('catalog.publications.remove')}: ${storeName}`}
            >
              {t('catalog.publications.remove')}
            </Button>
          )}
        </Stack>
      </Stack>

      {published && !open && (
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 1,
            m: 0,
            mt: 1.5,
            '& dt': { fontSize: 12, color: 'var(--muted)' },
            '& dd': { m: 0, fontSize: 14 },
          }}
        >
          <div>
            <dt>{t('catalog.field.slug')}</dt>
            <dd>/{publication.slug}</dd>
          </div>
          <div>
            <dt>{t('catalog.field.category')}</dt>
            <dd>{publication.category_name ?? t('common.none')}</dd>
          </div>
          <div>
            <dt>{t('catalog.field.price')}</dt>
            <dd className="tnum">
              {formatMoneyOrDash(publication.price, publication.currency ?? publication.store_currency, locale)}
            </dd>
          </div>
          <div>
            <dt>{t('catalog.publications.publishedAt')}</dt>
            <dd>{publication.published_at ? formatDate(publication.published_at, locale) : '—'}</dd>
          </div>
        </Box>
      )}

      <Collapse in={open} unmountOnExit>
        <Stack
          component="form"
          spacing={2}
          sx={{ mt: 2 }}
          noValidate
          aria-label={`${published ? t('catalog.publications.edit') : t('catalog.publications.publish')}: ${storeName}`}
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <TextField
            label={t('catalog.field.slug')}
            fullWidth
            value={values.slug}
            onChange={(event) => change('slug', event.target.value)}
            error={Boolean(errors.slug)}
            helperText={errors.slug ? t(errors.slug) : t('catalog.field.slug.help')}
            inputProps={{ spellCheck: false }}
          />

          <CategoryPicker
            label={t('catalog.field.category')}
            nodes={arbol}
            value={values.category_id}
            onChange={(next) => change('category_id', next)}
            noneLabel={t('common.none')}
            helperText={t('catalog.publications.categoryHelp')}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('catalog.field.price')}
              fullWidth
              value={values.price}
              onChange={(event) => change('price', event.target.value)}
              error={Boolean(errors.price)}
              helperText={errors.price ? t(errors.price) : undefined}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">{publication.store_currency}</InputAdornment>
                ),
              }}
              inputProps={{ inputMode: 'decimal' }}
            />
            <TextField
              select
              label={t('catalog.field.status')}
              fullWidth
              value={values.status}
              onChange={(event) => change('status', event.target.value as ProductStatus)}
            >
              {PRODUCT_STATUSES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(STATUS_LABEL[value])}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
            <Button onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t('common.saving') : published ? t('common.save') : t('catalog.action.publish')}
            </Button>
          </Stack>
        </Stack>
      </Collapse>

      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)}>
        <DialogTitle>{t('catalog.publications.removeTitle').replace('{store}', storeName)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('catalog.publications.removeBody')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button color="error" variant="contained" onClick={() => void onRemove()} disabled={busy}>
            {t('catalog.publications.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
