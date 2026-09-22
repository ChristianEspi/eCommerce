import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import {
  Box,
  Button,
  Card,
  Chip,
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
import { useMemo, useState } from 'react'
import { CONTENT_PAGE_KINDS, CONTENT_STATUSES } from '@/domain/content'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate } from '@/shared/lib/format'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { ContentAiAssistant } from './ai/ContentAiAssistant'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { ContentError } from './errors'
import { useDeletePage, usePages, useSavePage } from './hooks'
import { pageFormSchema, type ContentPageRow, type PageFormValues } from './types'

/** Estados EFECTIVOS que la vista deriva del reloj. Son tabs, no un panel. */
const STATUS_TABS = ['all', 'live', 'scheduled', 'expired', 'draft', 'archived'] as const

function emptyForm(): PageFormValues {
  return {
    slug: '',
    title: '',
    kind: 'landing',
    status: 'draft',
    channel_id: null,
    priority: 0,
    // El local del navegador, recortado al minuto: es lo que espera un
    // `datetime-local`. La base guarda `timestamptz` y convierte.
    publish_from: new Date().toISOString().slice(0, 16),
    publish_to: '',
    show_in_nav: false,
    nav_position: 0,
    seo_title: '',
    seo_description: '',
    og_image_url: null,
  }
}

function toForm(row: ContentPageRow): PageFormValues {
  return {
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    status: row.status,
    channel_id: row.channel_id,
    priority: row.priority,
    publish_from: row.publish_from.slice(0, 16),
    publish_to: row.publish_to ? row.publish_to.slice(0, 16) : '',
    show_in_nav: row.show_in_nav,
    nav_position: row.nav_position,
    seo_title: row.seo_title ?? '',
    seo_description: row.seo_description ?? '',
    og_image_url: row.og_image_url,
  }
}

/**
 * Páginas de la vitrina: la portada, las de campaña y las legales.
 *
 * Lo que esta pantalla enseña y casi ninguna enseña: el **estado efectivo**. Una
 * página `published` con fecha de mañana está `scheduled`, y una caducada está
 * `expired` aunque nadie haya pasado a cambiarla. Sale de
 * `content_page_overview`, que lo deriva del reloj — la misma pregunta que
 * responde `ebim.content_pick_page` al servir la vitrina. Dos respuestas
 * distintas a «¿esto se está viendo?» es lo que hace que nadie se fíe.
 *
 * `live_block_count` es la otra cifra que evita el error caro: publicar una
 * página cuyos bloques están todos fuera de vigencia — una portada en blanco.
 */
export function PagesSection({
  selectedPageId,
  onSelectPage,
}: {
  selectedPageId: string | null
  onSelectPage: (id: string | null) => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId, can } = useTenant()
  const canManage = can('store.manage')

  const [status, setStatus] = useState<string>('all')
  const [term, setTerm] = useState('')
  const [editing, setEditing] = useState<ContentPageRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<PageFormValues>(emptyForm)

  const pages = usePages({ storeId: activeStore?.id ?? null, status, term })

  const scope = useMemo(
    () =>
      tenant && activeCompanyId && activeStore
        ? {
            organizationId: tenant.organization_id,
            companyId: activeCompanyId,
            storeId: activeStore.id,
          }
        : null,
    [tenant, activeCompanyId, activeStore],
  )

  const save = useSavePage(scope)
  const remove = useDeletePage()

  const list = pages.data ?? []
  const isEmpty = !pages.isPending && !pages.isError && list.length === 0
  const parsed = pageFormSchema.safeParse(form)
  const firstIssue = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'content.error.generic')

  function openCreate() {
    setForm(emptyForm())
    setEditing(null)
    setCreating(true)
  }

  function openEdit(row: ContentPageRow) {
    setForm(toForm(row))
    setEditing(row)
    setCreating(true)
  }

  async function submit() {
    if (!parsed.success) return
    try {
      const id = await save.mutateAsync({ id: editing?.id ?? null, values: parsed.data })
      notify(t(editing ? 'content.pages.updated' : 'content.pages.created'), 'success')
      setCreating(false)
      if (!editing) onSelectPage(id)
    } catch (error) {
      const key: MessageKey = error instanceof ContentError ? error.key : 'content.error.generic'
      notify(t(key), 'error')
    }
  }

  async function drop(row: ContentPageRow) {
    try {
      await remove.mutateAsync(row.id)
      if (selectedPageId === row.id) onSelectPage(null)
      notify(t('content.pages.deleted'), 'success')
    } catch (error) {
      const key: MessageKey = error instanceof ContentError ? error.key : 'content.error.generic'
      notify(t(key), 'error')
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  if (!canManage) {
    return (
      <UnauthorizedState
        title={t('content.forbidden.title')}
        description={t('content.forbidden.body')}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('content.pages.help')}</Typography>

      <FilterBar
        actions={
          <Button variant="contained" onClick={openCreate}>
            {t('content.pages.new')}
          </Button>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('content.pages.search')}
            ariaLabel={t('content.pages.search')}
          />
        </Box>
      </FilterBar>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('content.pages.status')}>
        {STATUS_TABS.map((value) => (
          <Chip
            key={value}
            label={t(`content.status.${value}` as MessageKey)}
            clickable
            size="small"
            color={status === value ? 'primary' : 'default'}
            onClick={() => setStatus(value)}
          />
        ))}
      </Stack>

      <Card>
        {pages.isPending && <TableSkeleton columns={6} />}
        {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={t('content.pages.emptyTitle')}
            description={t('content.pages.emptyBody')}
            icon={<ArticleRoundedIcon fontSize="small" />}
            action={
              <Button variant="contained" onClick={openCreate}>
                {t('content.pages.new')}
              </Button>
            }
          />
        )}
        {list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('content.pages.title')}</TableCell>
                <TableCell>{t('content.pages.kind')}</TableCell>
                <TableCell>{t('content.pages.state')}</TableCell>
                <TableCell>{t('content.pages.channel')}</TableCell>
                <TableCell align="right">{t('content.pages.blocks')}</TableCell>
                <TableCell align="right">{t('content.pages.updated')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  selected={row.id === selectedPageId}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => onSelectPage(row.id)}
                >
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }}>{row.title}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>/{row.slug}</Typography>
                  </TableCell>
                  <TableCell>{t(`content.kind.${row.kind}` as MessageKey)}</TableCell>
                  <TableCell>
                    <StatusChip
                      label={t(`content.status.${row.effective_status}` as MessageKey)}
                      tone={row.effective_status === 'live' ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell>{row.channel_name ?? t('content.pages.allChannels')}</TableCell>
                  <TableCell align="right">
                    {`${row.live_block_count} / ${row.block_count}`}
                  </TableCell>
                  <TableCell align="right">{formatDate(row.updated_at, locale)}</TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: t('common.edit'),
                          tone: 'neutral',
                          onClick: () => {
                            openEdit(row)
                          },
                        },
                        {
                          id: '1',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: t('common.delete'),
                          tone: 'danger',
                          onClick: () => {
                            void drop(row)
                          },
                        },
                      ]}
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
        open={creating}
        title={editing ? t('content.pages.edit') : t('content.pages.new')}
        subtitle={activeStore?.name}
        onClose={() => setCreating(false)}
        busy={save.isPending}
        actions={
          <>
            <Button onClick={() => setCreating(false)} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void submit()}
              disabled={!parsed.success || save.isPending}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <TextField
            label={t('content.pages.title')}
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            required
          />
          <TextField
            label={t('content.pages.slug')}
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
            helperText={t('content.pages.slugHelp')}
            required
          />
          <TextField
            select
            label={t('content.pages.kind')}
            value={form.kind}
            onChange={(event) =>
              setForm({ ...form, kind: event.target.value as PageFormValues['kind'] })
            }
          >
            {CONTENT_PAGE_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {t(`content.kind.${kind}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('content.pages.statusField')}
            value={form.status}
            onChange={(event) =>
              setForm({ ...form, status: event.target.value as PageFormValues['status'] })
            }
          >
            {CONTENT_STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`content.status.${value}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="datetime-local"
            label={t('content.pages.from')}
            value={form.publish_from}
            onChange={(event) => setForm({ ...form, publish_from: event.target.value })}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            type="datetime-local"
            label={t('content.pages.to')}
            value={form.publish_to}
            onChange={(event) => setForm({ ...form, publish_to: event.target.value })}
            InputLabelProps={{ shrink: true }}
            helperText={t('content.pages.toHelp')}
          />
          <TextField
            type="number"
            label={t('content.pages.priority')}
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}
            helperText={t('content.pages.priorityHelp')}
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Switch
              checked={form.show_in_nav}
              onChange={(event) => setForm({ ...form, show_in_nav: event.target.checked })}
              inputProps={{ 'aria-label': t('content.pages.nav') }}
            />
            <Typography sx={{ fontWeight: 700 }}>{t('content.pages.nav')}</Typography>
          </Stack>
          <TextField
            label={t('content.pages.seoTitle')}
            value={form.seo_title}
            onChange={(event) => setForm({ ...form, seo_title: event.target.value })}
          />
          <TextField
            label={t('content.pages.seoDescription')}
            value={form.seo_description}
            onChange={(event) => setForm({ ...form, seo_description: event.target.value })}
            multiline
            minRows={2}
          />
          {/* Fase 09: título y SEO con IA sobre lo que ya está escrito. Aplicar
              escribe en este formulario; se guarda con «Guardar». Nunca publica. */}
          <ContentAiAssistant
            target="page"
            pageId={editing?.id ?? null}
            current={{ title: form.title, seo_title: form.seo_title, seo_description: form.seo_description }}
            applicable={['title', 'seo_title', 'seo_description']}
            onApply={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          />
          {firstIssue && (
            <Typography sx={{ color: 'var(--red)', fontWeight: 700, fontSize: 12 }}>
              {t(firstIssue as MessageKey)}
            </Typography>
          )}
        </Stack>
      </FormDrawer>
    </Stack>
  )
}
