import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import ViewQuiltRoundedIcon from '@mui/icons-material/ViewQuiltRounded'
import {
  Box,
  Button,
  Card,
  Divider,
  FormControlLabel,
  MenuItem,
  Skeleton,
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
import { useEffect, useMemo, useState, Suspense } from 'react'
import { lazyPage } from '@/app/lazyPage'
import {
  CONTENT_BLOCK_TYPES,
  blockAcceptsItems,
  blockFieldRules,
  MEDIA_LAYOUTS,
  blockUsesMediaItems,
  mediaLayoutOf,
} from '@/domain/content'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { ContentAiAssistant } from './ai/ContentAiAssistant'
import { StoreAssetField } from '@/features/admin/settings/StoreAssetField'
import { useAssetUrls } from '@/features/admin/settings/useStoreSettings'
/**
 * El editor se carga cuando se abre el panel, no con la pantalla.
 *
 * TipTap y ProseMirror pesan ~138 kB gzip: mas que todo el resto de la pagina
 * de Contenido junta. Cargarlo con el listado obligaria a bajarlo tambien a
 * quien solo viene a mirar el orden de los bloques. Aqui llega con el panel de
 * edicion, que es el unico sitio donde se escribe.
 */
const RichTextEditor = lazyPage(() =>
  import('./RichTextEditor').then((module) => ({ default: module.RichTextEditor })),
)
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { ContentError } from './errors'
import {
  useAddBlockItem,
  useAdminCatalogSearch,
  useBlockItems,
  useBlocks,
  useDeleteBlock,
  useLinkablePromotions,
  useMoveBlock,
  useSaveBlock,
} from './hooks'
import {
  blockFormSchema,
  clearUnusedBlockFields,
  validateBlockForm,
  type BlockFormValues,
  type ContentBlockRow,
} from './types'
import { parseRichText } from '@/domain/content'
import { isSafeHref } from '@/domain/href'
import { useMoveBlockItem, useRemoveBlockItem } from './hooks'

/**
 * La etiqueta se sube siempre.
 *
 * Estos campos se rellenan desde el estado, y MUI decide si la etiqueta flota
 * mirando el DOM al montar: sin forzarlo, un valor que llega después queda
 * escrito DEBAJO de su propia etiqueta.
 */
const SHRINK = { inputLabel: { shrink: true } } as const

function emptyForm(): BlockFormValues {
  return {
    block_type: 'hero',
    position: 0,
    title: '',
    subtitle: '',
    body: null,
    media_url: null,
    media_alt: '',
    cta_label: '',
    cta_href: '',
    category_id: null,
    promotion_id: null,
    item_limit: 8,
    is_active: true,
    publish_from: new Date().toISOString().slice(0, 16),
    publish_to: '',
    channel_id: null,
    segment_id: null,
    columns: 4,
    descendants: false,
    layout: 'carousel',
  }
}

function toForm(row: ContentBlockRow): BlockFormValues {
  const settings = (row.settings ?? {}) as Record<string, unknown>
  return {
    block_type: row.block_type,
    position: row.position,
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    body: parseRichText(row.body),
    media_url: row.media_url,
    media_alt: row.media_alt ?? '',
    cta_label: row.cta_label ?? '',
    cta_href: row.cta_href ?? '',
    category_id: row.category_id,
    promotion_id: row.promotion_id,
    item_limit: row.item_limit,
    is_active: row.is_active,
    publish_from: row.publish_from.slice(0, 16),
    publish_to: row.publish_to ? row.publish_to.slice(0, 16) : '',
    channel_id: row.channel_id,
    segment_id: row.segment_id,
    columns: typeof settings.columns === 'number' ? settings.columns : 4,
    descendants: settings.descendants === true,
    layout: mediaLayoutOf(settings),
  }
}

/**
 * Bloques de una página: el editor.
 *
 * Dos decisiones de esta pantalla que no son de maquetación:
 *
 *  1. **El contenido enriquecido se escribe como TEXTO con marcas mínimas**
 *     (`## `, `### `, `> `, `- `), no en un editor visual. Un editor visual
 *     produce marcado y el marcado hay que sanearlo; con esto, lo que se
 *     escribe no puede contener una etiqueta — la sintaxis no la reconoce y el
 *     validador la rechaza. Es la misma decisión que hace que el documento
 *     guardado no sea HTML.
 *  2. **Los productos de una colección se BUSCAN**, no se pegan por uuid. Es el
 *     primer llamante del `SearchPort` del backoffice y cierra la deuda que P10
 *     dejó escrita al no poner buscador en el editor de alcance de campañas.
 */
export function BlocksSection({ pageId }: { pageId: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId, can } = useTenant()
  const canManage = can('store.manage')

  const [editing, setEditing] = useState<ContentBlockRow | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<BlockFormValues>(emptyForm)
  const [itemsFor, setItemsFor] = useState<ContentBlockRow | null>(null)

  const blocks = useBlocks(pageId)
  const organizationId = tenant?.organization_id ?? null
  const storeId = activeStore?.id ?? null
  // Vista previa de la imagen del bloque: el bucket es privado, asi que la
  // ruta guardada no se puede pintar sin firmar.
  const mediaUrls = useAssetUrls([form.media_url])

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

  const save = useSaveBlock(scope, pageId)
  const remove = useDeleteBlock()
  const move = useMoveBlock()
  // Solo cuando hace falta: un desplegable de campañas en un bloque de texto es
  // una consulta que nadie pidió.
  const promotions = useLinkablePromotions(
    activeStore?.id ?? null,
    open && form.block_type === 'campaign',
  )

  const list = blocks.data ?? []
  const parsed = blockFormSchema.safeParse(form)
  const issues = parsed.success ? validateBlockForm(parsed.data) : []
  const firstIssue = parsed.success
    ? (issues[0]?.key ?? null)
    : (parsed.error.issues[0]?.message ?? 'content.error.generic')
  /**
   * Que campos pinta el tipo elegido, y cual de ellos exige.
   *
   * Sale de la MISMA tabla que valida antes de guardar, asi que un campo que se
   * ve es un campo que la base admite. Ensenar los dieciseis para los ocho
   * tipos era lo que dejaba escribir el contenido de un carrusel de imagenes
   * —que la base rechaza— y recibir un aviso que decia lo contrario.
   */
  const rules = blockFieldRules(form.block_type)
  const issueOf = (field: keyof BlockFormValues): string | null =>
    issues.find((issue) => issue.field === field)?.key ?? null
  /**
   * El resumen del pie solo aparece si el aviso no tiene DONDE ponerse.
   *
   * Los campos de abajo ya lo enseñan pegados a su etiqueta; repetirlo al final
   * daba el mismo mensaje dos veces en la misma pantalla. Queda para los avisos
   * de un campo que este tipo no pinta —la red de seguridad de «este dato
   * sobra»— y para los que vienen del esquema, que no señalan campo.
   */
  const inlineFields = new Set<keyof BlockFormValues>([
    'title',
    'publish_to',
    ...(rules.body !== 'unused' ? (['body'] as const) : []),
    ...(rules.cta !== 'unused' ? (['cta_href'] as const) : []),
  ])
  const showSummary =
    firstIssue !== null && (!parsed.success || !inlineFields.has(issues[0]!.field))

  /**
   * Sube o baja UN sitio, intercambiando con la vecina.
   *
   * Dos updates y no uno: `position` no es única en la tabla, así que el
   * intercambio no necesita un valor libre de por medio. Y se intercambia en vez
   * de sumar uno porque las posiciones vienen espaciadas —5, 10, 15…—: sumar uno
   * dejaba el bloque donde estaba y obligaba a repetir el clic cinco veces.
   */
  async function intercambiar(indice: number, delta: number) {
    const uno = list[indice]
    const otro = list[indice + delta]
    if (!uno || !otro) return
    await move.mutateAsync({ id: uno.id, position: otro.position })
    await move.mutateAsync({ id: otro.id, position: uno.position })
  }

  function openCreate() {
    setForm({ ...emptyForm(), position: list.length })
    setEditing(null)
    setOpen(true)
  }

  function openEdit(row: ContentBlockRow) {
    setForm(toForm(row))
    setEditing(row)
    setOpen(true)
  }

  async function submit() {
    if (!parsed.success || issues.length > 0) return
    try {
      await save.mutateAsync({ id: editing?.id ?? null, values: parsed.data })
      notify(t(editing ? 'content.blocks.updated' : 'content.blocks.created'), 'success')
      setOpen(false)
    } catch (error) {
      const key: MessageKey = error instanceof ContentError ? error.key : 'content.error.generic'
      notify(t(key), 'error')
    }
  }

  async function drop(row: ContentBlockRow) {
    try {
      await remove.mutateAsync(row.id)
      notify(t('content.blocks.deleted'), 'success')
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

  if (!pageId) {
    return (
      <EmptyState
        title={t('content.blocks.noPageTitle')}
        description={t('content.blocks.noPageBody')}
        icon={<ViewQuiltRoundedIcon fontSize="small" />}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
        <Typography sx={{ color: 'var(--muted)' }}>{t('content.blocks.help')}</Typography>
        <Button variant="contained" onClick={openCreate}>
          {t('content.blocks.new')}
        </Button>
      </Stack>

      <Card>
        {blocks.isPending && <TableSkeleton columns={5} />}
        {blocks.isError && <ErrorState error={blocks.error} onRetry={() => void blocks.refetch()} />}
        {!blocks.isPending && !blocks.isError && list.length === 0 && (
          <EmptyState
            title={t('content.blocks.emptyTitle')}
            description={t('content.blocks.emptyBody')}
            icon={<ViewQuiltRoundedIcon fontSize="small" />}
            action={
              <Button variant="contained" onClick={openCreate}>
                {t('content.blocks.new')}
              </Button>
            }
          />
        )}
        {list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell align="right">#</TableCell>
                <TableCell>{t('content.blocks.type')}</TableCell>
                <TableCell>{t('content.blocks.title')}</TableCell>
                <TableCell>{t('content.blocks.state')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => {
                const enLista = list.findIndex((item) => item.id === row.id)
                return (
                <TableRow key={row.id} hover>
                  <TableCell align="right">
                    <PositionField
                      value={row.position}
                      busy={move.isPending}
                      label={`${t('content.blocks.position')} ${row.title ?? row.block_type}`}
                      taken={list
                        .filter((item) => item.id !== row.id)
                        .map((item) => item.position)}
                      onCommit={(position) => void move.mutateAsync({ id: row.id, position })}
                      onRejected={() => notify(t('content.blocks.positionTaken'), 'error')}
                    />
                  </TableCell>
                  <TableCell>{t(`content.block.${row.block_type}` as MessageKey)}</TableCell>
                  <TableCell>{row.title ?? '—'}</TableCell>
                  <TableCell>
                    <StatusChip
                      label={t(row.is_active ? 'content.blocks.active' : 'content.blocks.inactive')}
                      tone={row.is_active ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <ArrowUpwardRoundedIcon fontSize="small" />,
                          label: `${t('content.blocks.up')} ${row.title ?? row.block_type}`,
                          tone: 'neutral',
                          disabled: enLista === 0 || move.isPending,
                          onClick: () => void intercambiar(enLista, -1),
                        },
                        {
                          id: '1',
                          icon: <ArrowDownwardRoundedIcon fontSize="small" />,
                          label: `${t('content.blocks.down')} ${row.title ?? row.block_type}`,
                          tone: 'neutral',
                          disabled: enLista === list.length - 1 || move.isPending,
                          onClick: () => void intercambiar(enLista, 1),
                        },
                        {
                          id: '2',
                          icon: <FormatListBulletedRoundedIcon fontSize="small" />,
                          label: blockUsesMediaItems(row.block_type)
                            ? t('content.slides.manage')
                            : t('content.items.manage'),
                          tone: 'accent',
                          disabled: !(blockAcceptsItems(row.block_type)),
                          onClick: () => setItemsFor(row),
                        },
                        {
                          id: '3',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: t('common.edit'),
                          tone: 'neutral',
                          onClick: () => openEdit(row),
                        },
                        {
                          id: '4',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: t('common.delete'),
                          tone: 'danger',
                          onClick: () => void drop(row),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
                )
              })}
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
        open={open}
        title={editing ? t('content.blocks.edit') : t('content.blocks.new')}
        onClose={() => setOpen(false)}
        busy={save.isPending}
        width={620}
        actions={
          <>
            <Button onClick={() => setOpen(false)} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void submit()}
              disabled={!parsed.success || issues.length > 0 || save.isPending}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <TextField
            select
            label={t('content.blocks.type')}
            value={form.block_type}
            onChange={(event) =>
              // Al cambiar de tipo se vacía lo que el nuevo no admite. Sin esto,
              // el contenido de un hero sobreviviría escondido a un cambio a
              // carrusel y la base rechazaría el guardado sin nada que señalar.
              setForm(
                clearUnusedBlockFields({
                  ...form,
                  block_type: event.target.value as BlockFormValues['block_type'],
                }),
              )
            }
            helperText={t('content.blocks.requiredHint')}
          >
            {CONTENT_BLOCK_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {t(`content.block.${type}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>

          {blockUsesMediaItems(form.block_type) && (
            <>
              <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                {t('content.blocks.slidesHint')}
              </Typography>
              {/* Carrusel o mosaico: la MISMA lista de imágenes con otra
                  disposición. Cambiarla no obliga a volver a subir nada, por eso
                  es un ajuste del bloque y no otro tipo de bloque. */}
              <TextField
                select
                label={t('content.blocks.layout')}
                value={form.layout}
                helperText={t('content.blocks.layoutHelp')}
                onChange={(event) =>
                  setForm({ ...form, layout: event.target.value as BlockFormValues['layout'] })
                }
              >
                {MEDIA_LAYOUTS.map((layout) => (
                  <MenuItem key={layout} value={layout}>
                    {t(`content.blocks.layout.${layout}` as MessageKey)}
                  </MenuItem>
                ))}
              </TextField>
              {form.layout === 'grid' && (
                <TextField
                  type="number"
                  label={t('content.blocks.columns')}
                  helperText={t('content.blocks.columnsHelp')}
                  value={form.columns}
                  onChange={(event) => setForm({ ...form, columns: Number(event.target.value) })}
                />
              )}
            </>
          )}

          {/* Fase 09: borradores con IA sobre lo que ya está escrito. Aplicar
              escribe en este formulario; se guarda con «Guardar». Nunca publica. */}
          <ContentAiAssistant
            target="block"
            blockId={editing?.id ?? null}
            blockType={form.block_type}
            current={{
              title: form.title,
              subtitle: form.subtitle,
              cta_label: form.cta_label,
              media_alt: form.media_alt,
            }}
            applicable={[
              'title',
              ...(rules.subtitle !== 'unused' ? (['subtitle'] as const) : []),
              ...(rules.cta !== 'unused' ? (['cta_label'] as const) : []),
              ...(rules.media !== 'unused' ? (['media_alt'] as const) : []),
            ]}
            onApply={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          />

          <TextField
            label={t('content.blocks.title')}
            required={rules.title === 'required'}
            value={form.title}
            error={Boolean(issueOf('title'))}
            helperText={
              issueOf('title')
                ? t(issueOf('title') as MessageKey)
                : rules.titleOrMedia
                  ? t('content.blocks.titleOrMediaHint')
                  : undefined
            }
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
          {rules.subtitle !== 'unused' && (
            <TextField
              label={t('content.blocks.subtitle')}
              value={form.subtitle}
              onChange={(event) => setForm({ ...form, subtitle: event.target.value })}
            />
          )}
          {/* El bloque APUNTA a la campaña; la campaña no sabe que existe el
              bloque. Se enseña su estado efectivo al lado del nombre porque
              anunciar una campaña caducada es un error caro y silencioso, y el
              desplegable es donde se ve. Lo que NUNCA sale a la vitrina es el
              código del cupón: eso sería regalar el folleto. */}
          {rules.promotion !== 'unused' && (
            <TextField
              select
              label={t('content.blocks.promotion')}
              value={form.promotion_id ?? ''}
              helperText={t('content.blocks.promotionHelp')}
              onChange={(event) =>
                setForm({ ...form, promotion_id: event.target.value || null })
              }
            >
              <MenuItem value="">{t('content.blocks.promotionNone')}</MenuItem>
              {(promotions.data ?? []).map((promotion) => (
                <MenuItem key={promotion.id} value={promotion.id}>
                  {`${promotion.name} · ${t(
                    `content.status.${promotion.effective_status}` as MessageKey,
                  )}`}
                </MenuItem>
              ))}
            </TextField>
          )}
          {rules.body !== 'unused' && (
            <Suspense fallback={<Skeleton variant="rounded" height={260} />}>
              <RichTextEditor
                label={`${t('content.blocks.body')}${rules.body === 'required' ? ' *' : ''}`}
                value={form.body}
                onChange={(next) => setForm({ ...form, body: next })}
                helperText={
                  issueOf('body') ? t(issueOf('body') as MessageKey) : t('content.blocks.bodyHelp')
                }
                disabled={save.isPending}
              />
            </Suspense>
          )}
          {rules.cta !== 'unused' && (
            <>
              <TextField
                label={t('content.blocks.ctaLabel')}
                value={form.cta_label}
                onChange={(event) => setForm({ ...form, cta_label: event.target.value })}
              />
              <TextField
                label={t('content.blocks.ctaHref')}
                value={form.cta_href}
                error={Boolean(issueOf('cta_href'))}
                onChange={(event) => setForm({ ...form, cta_href: event.target.value })}
                helperText={
                  issueOf('cta_href')
                    ? t(issueOf('cta_href') as MessageKey)
                    : t('content.blocks.ctaHrefHelp')
                }
              />
            </>
          )}
          {/* P18 · La imagen del bloque.
              El circuito estaba entero —`media_url` en la fila, la vitrina la
              firma y el hero, el banner y la campaña la pintan— y faltaba la
              única pieza que lo hacía usable: por dónde se sube. Sin esto, el
              campo de texto alternativo describía una imagen que no había forma
              de poner. */}
          {rules.media !== 'unused' && (
            <>
              <StoreAssetField
                kind="content"
                ratio="16 / 6"
                label={t('content.blocks.media')}
                help={t('content.blocks.mediaHelp')}
                value={form.media_url}
                previewUrl={form.media_url ? (mediaUrls[form.media_url] ?? null) : null}
                disabled={save.isPending}
                organizationId={organizationId ?? ''}
                storeId={storeId ?? ''}
                onChange={(next) => setForm({ ...form, media_url: next })}
              />

              <TextField
                label={t('content.blocks.mediaAlt')}
                value={form.media_alt}
                onChange={(event) => setForm({ ...form, media_alt: event.target.value })}
                helperText={t('content.blocks.mediaAltHelp')}
              />
            </>
          )}
          {/* P18 · Solo dice algo en una coleccion por categoria: en un hero o
              en un texto no hay categoria de la que colgar nada. */}
          {rules.category !== 'unused' && form.category_id !== null && (
            <FormControlLabel
              control={
                <Switch
                  checked={form.descendants}
                  onChange={(event) => setForm({ ...form, descendants: event.target.checked })}
                />
              }
              label={t('content.blocks.descendants')}
            />
          )}

          {rules.columns !== 'unused' && (
            <TextField
              type="number"
              label={t('content.blocks.columns')}
              value={form.columns}
              onChange={(event) => setForm({ ...form, columns: Number(event.target.value) })}
            />
          )}
          {rules.itemLimit !== 'unused' && (
            <TextField
              type="number"
              label={t('content.blocks.itemLimit')}
              value={form.item_limit}
              onChange={(event) => setForm({ ...form, item_limit: Number(event.target.value) })}
            />
          )}
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
            error={Boolean(issueOf('publish_to'))}
            helperText={issueOf('publish_to') ? t(issueOf('publish_to') as MessageKey) : undefined}
            onChange={(event) => setForm({ ...form, publish_to: event.target.value })}
            InputLabelProps={{ shrink: true }}
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Switch
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
              inputProps={{ 'aria-label': t('content.blocks.active') }}
            />
            <Typography sx={{ fontWeight: 700 }}>{t('content.blocks.active')}</Typography>
          </Stack>
          {showSummary && (
            <Typography sx={{ color: 'var(--red)', fontWeight: 700, fontSize: 12 }}>
              {t(firstIssue as MessageKey)}
            </Typography>
          )}
        </Stack>
      </FormDrawer>

      <CollectionDrawer block={itemsFor} onClose={() => setItemsFor(null)} />
    </Stack>
  )
}

/**
 * La posición, escrita a mano.
 *
 * Las flechas sirven para mover un sitio; para llevar el último bloque al
 * principio de una portada larga, no. Aquí se escribe el número y se guarda al
 * salir del campo o con Intro.
 *
 * ## Lo que valida, y por qué antes de enviar
 *
 * **Que no se repita.** La base admite dos bloques con el mismo número —no hay
 * índice único— y entonces el orden entre ellos deja de estar definido: la
 * portada se pinta hoy de una forma y mañana de otra sin que nadie haya tocado
 * nada. Es justo la clase de fallo que no se reproduce cuando se denuncia.
 *
 * **Que esté entre 0 y 999**, que es el rango del CHECK
 * `content_blocks_position_range`. Decirlo aquí convierte un 400 genérico en un
 * campo en rojo.
 *
 * Si el número no vale, el campo VUELVE al que tenía. Dejar escrito un valor que
 * no se ha guardado es la forma más rápida de que alguien cierre la pantalla
 * convencido de haber ordenado la portada.
 */
function PositionField({
  value,
  taken,
  busy,
  label,
  onCommit,
  onRejected,
}: {
  value: number
  /** Las posiciones de los DEMÁS bloques de la página. */
  taken: number[]
  busy: boolean
  label: string
  onCommit: (position: number) => void
  onRejected: () => void
}) {
  const [draft, setDraft] = useState(String(value))

  // El valor de fuera manda cuando cambia: tras guardar, tras deshacer, y
  // cuando el intercambio de la fila vecina mueve esta.
  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    const next = Number(draft)
    if (draft.trim() === '' || !Number.isInteger(next) || next < 0 || next > 999) {
      setDraft(String(value))
      return
    }
    if (next === value) return
    if (taken.includes(next)) {
      setDraft(String(value))
      onRejected()
      return
    }
    onCommit(next)
  }

  return (
    <TextField
      type="number"
      size="small"
      value={draft}
      disabled={busy}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        // Escape deshace: es lo que espera quien se ha equivocado escribiendo.
        if (event.key === 'Escape') {
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
      slotProps={{ htmlInput: { 'aria-label': label, min: 0, max: 999, style: { textAlign: 'right' } } }}
      sx={{ width: 76 }}
    />
  )
}

/**
 * Los productos de una colección: se buscan y se añaden.
 *
 * El buscador es el `SearchPort` del backoffice, así que encuentra también lo
 * NO publicado — y lo marca. Poder añadir a la portada un producto todavía en
 * borrador es deliberado: se prepara la campaña antes de publicar el catálogo,
 * y la vitrina no lo enseñará hasta que lo esté porque la resolución lee de
 * `public_products`.
 */
function CollectionDrawer({
  block,
  onClose,
}: {
  block: ContentBlockRow | null
  onClose: () => void
}) {
  // Un carrusel de imagenes no se llena del catalogo: sus items SON imagenes.
  // Se reparte aqui y no dentro con condicionales porque son dos paneles
  // distintos de arriba abajo — buscador y resultados contra subida y alt.
  if (block && blockUsesMediaItems(block.block_type)) {
    return <SlidesDrawer block={block} onClose={onClose} />
  }
  return <ProductItemsDrawer block={block} onClose={onClose} />
}

function ProductItemsDrawer({
  block,
  onClose,
}: {
  block: ContentBlockRow | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId } = useTenant()
  const [term, setTerm] = useState('')
  const search = useDebouncedValue(term, 300)

  const items = useBlockItems(block?.id ?? null)
  const results = useAdminCatalogSearch(activeStore?.id ?? null, search, block !== null)

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

  const add = useAddBlockItem(scope)
  const drop = useRemoveBlockItem()

  const current = items.data ?? []

  async function attach(productId: string) {
    if (!block) return
    try {
      await add.mutateAsync({
        blockId: block.id,
        blockType: block.block_type,
        itemKind: block.block_type === 'category_collection' ? 'category' : 'product',
        productId: block.block_type === 'category_collection' ? null : productId,
        categoryId: block.block_type === 'category_collection' ? productId : null,
        position: current.length,
      })
      notify(t('content.items.added'), 'success')
    } catch (error) {
      const key: MessageKey = error instanceof ContentError ? error.key : 'content.error.generic'
      notify(t(key), 'error')
    }
  }

  return (
    <FormDrawer
      open={block !== null}
      title={t('content.items.title')}
      subtitle={block?.title ?? undefined}
      onClose={onClose}
      width={620}
      actions={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <Stack spacing={2}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('content.items.help')}</Typography>

        <Box>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>{t('content.items.current')}</Typography>
          {current.length === 0 ? (
            <Typography sx={{ color: 'var(--muted)' }}>{t('content.items.empty')}</Typography>
          ) : (
            <Stack spacing={0.5}>
              {current.map((item) => (
                <Stack
                  key={item.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography sx={{ fontSize: 12 }}>
                    {`${item.position}. ${item.product_id ?? item.category_id ?? ''}`}
                  </Typography>
                  <Button size="small" color="error" onClick={() => void drop.mutateAsync(item.id)}>
                    {t('common.delete')}
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        <FilterBar>
          <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder={t('content.items.search')}
              ariaLabel={t('content.items.search')}
            />
          </Box>
        </FilterBar>

        {results.data && results.data.items.length > 0 && (
          <Stack spacing={0.5}>
            {results.data.items.map((hit) => (
              <Stack
                key={hit.productId}
                direction="row"
                spacing={1}
                alignItems="center"
                justifyContent="space-between"
              >
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{hit.name}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                    {hit.published ? t('content.items.published') : t('content.items.draft')}
                  </Typography>
                </Box>
                <Button size="small" onClick={() => void attach(hit.productId)}>
                  {t('content.items.add')}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
        {results.data && results.data.mode === 'empty' && search.trim().length >= 2 && (
          <Typography sx={{ color: 'var(--muted)' }}>{t('content.items.noResults')}</Typography>
        )}
      </Stack>
    </FormDrawer>
  )
}

/**
 * Las diapositivas del carrusel de imágenes.
 *
 * Cada una es un item `media` del bloque: la ruta de la imagen en el bucket
 * privado de la tienda, su texto alternativo y, si acaso, a dónde lleva.
 *
 * ## Decisiones que este panel toma por quien lo usa
 *
 * **El alt es obligatorio.** La base lo exige (`content_block_items_media_shape`)
 * y aquí se pide antes de dejar añadir, para que el aviso salga escribiendo y no
 * al guardar. Un carrusel sin alt es un banner mudo para quien navega con lector
 * de pantalla, y suele ser justo el que anuncia la oferta.
 *
 * **El enlace se valida con la MISMA función que la vitrina** (`isSafeHref`).
 * Si aquí colara un `javascript:`, el CHECK de la base lo rechazaría con un
 * error genérico; comprobarlo antes convierte eso en una frase que se entiende.
 *
 * **El orden se edita.** En un carrusel la primera imagen es la que ve casi todo
 * el mundo, así que subir y bajar tiene que estar a mano: sin eso, la única
 * forma de recolocar sería borrar y volver a subir.
 */
function SlidesDrawer({ block, onClose }: { block: ContentBlockRow; onClose: () => void }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, tenant, activeCompanyId } = useTenant()

  const items = useBlockItems(block.id)
  const slides = useMemo(() => items.data ?? [], [items.data])

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

  const add = useAddBlockItem(scope)
  const drop = useRemoveBlockItem()
  const move = useMoveBlockItem()

  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [alt, setAlt] = useState('')
  const [href, setHref] = useState('')

  // Una sola petición de firmas para las que ya están y la que se está
  // preparando: son URLs de un bucket privado y caducan, así que pedirlas por
  // separado sería multiplicar viajes por diapositiva.
  const paths = useMemo(
    () => [...slides.map((slide) => slide.media_url), mediaUrl].filter((p): p is string => !!p),
    [slides, mediaUrl],
  )
  const urls = useAssetUrls(paths)

  const hrefLimpio = href.trim()
  const hrefValido = hrefLimpio === '' || isSafeHref(hrefLimpio)
  const puedeAnadir = mediaUrl !== null && alt.trim().length > 0 && hrefValido

  async function anadir() {
    if (!puedeAnadir) return
    try {
      await add.mutateAsync({
        blockId: block.id,
        blockType: block.block_type,
        itemKind: 'media',
        mediaUrl,
        mediaAlt: alt.trim(),
        href: hrefLimpio === '' ? null : hrefLimpio,
        position: slides.length,
      })
      setMediaUrl(null)
      setAlt('')
      setHref('')
      notify(t('content.slides.added'), 'success')
    } catch (error) {
      const key: MessageKey = error instanceof ContentError ? error.key : 'content.error.generic'
      notify(t(key), 'error')
    }
  }

  async function intercambiar(index: number, delta: number) {
    const uno = slides[index]
    const otro = slides[index + delta]
    if (!uno || !otro) return
    // Dos updates y no uno: `position` no es única, así que el intercambio no
    // necesita un valor libre de por medio.
    await move.mutateAsync({ id: uno.id, position: otro.position })
    await move.mutateAsync({ id: otro.id, position: uno.position })
  }

  return (
    <FormDrawer
      open
      title={t('content.slides.title')}
      subtitle={block.title ?? undefined}
      onClose={onClose}
      width={620}
      actions={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <Stack spacing={2}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('content.slides.help')}</Typography>

        <Box>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>{t('content.slides.current')}</Typography>
          {slides.length === 0 ? (
            <Typography sx={{ color: 'var(--muted)' }}>{t('content.slides.empty')}</Typography>
          ) : (
            <Stack spacing={1}>
              {slides.map((slide, index) => (
                <Card
                  key={slide.id}
                  variant="outlined"
                  sx={{ p: 1, display: 'flex', gap: 1.5, alignItems: 'center' }}
                >
                  <Box
                    component="img"
                    src={(slide.media_url ? urls[slide.media_url] : undefined) || undefined}
                    alt=""
                    sx={{
                      width: 96,
                      height: 40,
                      objectFit: 'cover',
                      borderRadius: 1,
                      bgcolor: 'var(--surface-2)',
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ fontWeight: 700, fontSize: 13 }}>
                      {slide.media_alt}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 11, color: 'var(--muted)' }}>
                      {slide.href ?? ''}
                    </Typography>
                  </Box>
                  <RowActions
                    actions={[
                      {
                        id: 'up',
                        icon: <ArrowUpwardRoundedIcon fontSize="small" />,
                        label: `${t('content.blocks.up')} ${slide.media_alt ?? ''}`,
                        tone: 'neutral',
                        disabled: index === 0 || move.isPending,
                        onClick: () => void intercambiar(index, -1),
                      },
                      {
                        id: 'down',
                        icon: <ArrowDownwardRoundedIcon fontSize="small" />,
                        label: `${t('content.blocks.down')} ${slide.media_alt ?? ''}`,
                        tone: 'neutral',
                        disabled: index === slides.length - 1 || move.isPending,
                        onClick: () => void intercambiar(index, 1),
                      },
                      {
                        id: 'del',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: t('common.delete'),
                        tone: 'danger',
                        onClick: () => void drop.mutateAsync(slide.id),
                      },
                    ]}
                  />
                </Card>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        {scope && (
          <StoreAssetField
            kind="content"
            label={t('content.slides.image')}
            help={t('content.slides.imageHelp')}
            value={mediaUrl}
            previewUrl={(mediaUrl ? urls[mediaUrl] : null) || null}
            disabled={add.isPending}
            organizationId={scope.organizationId}
            storeId={scope.storeId}
            onChange={setMediaUrl}
            ratio="16 / 6"
          />
        )}

        <TextField
          label={t('content.slides.alt')}
          helperText={t('content.slides.altHelp')}
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          slotProps={SHRINK}
          fullWidth
        />
        <TextField
          label={t('content.slides.href')}
          helperText={hrefValido ? t('content.slides.hrefHelp') : t('content.slides.badHref')}
          error={!hrefValido}
          value={href}
          onChange={(event) => setHref(event.target.value)}
          slotProps={SHRINK}
          fullWidth
        />

        <Button
          variant="contained"
          disabled={!puedeAnadir || add.isPending}
          onClick={() => void anadir()}
        >
          {t('content.slides.add')}
        </Button>
        {!puedeAnadir && hrefValido && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('content.slides.needImage')}
          </Typography>
        )}
      </Stack>
    </FormDrawer>
  )
}
