import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import { zodResolver } from '@hookform/resolvers/zod'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  FormControlLabel,
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
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CatalogError } from '../api/errors'
import { BrandLogoField } from './BrandLogoField'
import { BrandMonogram } from './BrandMonogram'
import { useBrandLogoUrls, useBrands, useFamilies, useSaveBrand, useSaveFamily } from './hooks'
import {
  brandFormSchema,
  brandToForm,
  catalogEntryFormSchema,
  catalogEntryToForm,
  type Brand,
  type BrandFormValues,
  type CatalogEntryFormValues,
  type ProductFamily,
} from './types'

/**
 * Marcas y familias: dos catálogos de la sociedad con casi la misma forma y la
 * misma pantalla.
 *
 * ## Qué cambió en Storefront V2 · P02, y por qué importa
 *
 * Antes eran exactamente iguales —código, nombre, activo— y compartían tipo:
 * `productFamilySchema = brandSchema`. Cómodo, y correcto mientras lo fueran.
 *
 * Ya no lo son: la MARCA tiene logo y la familia no. La marca se enseña al
 * comprador en la portada; la familia es clasificación interna del catálogo y no
 * tiene dónde pintarse. Mantener el tipo compartido significaba ofrecer «subir
 * logo» a una clasificación interna y estrellarse contra una columna que no
 * existe.
 *
 * Así que ahora hay dos esquemas —`brandFormSchema` extiende a
 * `catalogEntryFormSchema`— y UNA pantalla, con la diferencia declarada en un
 * solo sitio (`kind`). Dos copias de esta pantalla se separarían el día que una
 * de las dos arregle un detalle de accesibilidad.
 */
type EntryKind = 'brands' | 'families'

const COPY: Record<EntryKind, { help: MessageKey; empty: MessageKey; create: MessageKey }> = {
  brands: { help: 'pim.brands.help', empty: 'pim.brands.empty', create: 'pim.brands.new' },
  families: {
    help: 'pim.families.help',
    empty: 'pim.families.empty',
    create: 'pim.families.new',
  },
}

export function CatalogEntrySection({ kind }: { kind: EntryKind }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, can } = useTenant()
  const canWrite = can('catalog.write')
  const copy = COPY[kind]
  const esMarca = kind === 'brands'

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ open: boolean; entry: Brand | ProductFamily | null }>({
    open: false,
    entry: null,
  })

  const brands = useBrands(esMarca)
  const families = useFamilies(!esMarca)
  const query = esMarca ? brands : families

  const saveBrand = useSaveBrand()
  const saveFamily = useSaveFamily()

  const items = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all: Array<Brand | ProductFamily> = query.data ?? []
    if (!term) return all
    return all.filter(
      (entry) =>
        entry.name.toLowerCase().includes(term) || entry.code.toLowerCase().includes(term),
    )
  }, [query.data, search])

  const isEmpty = !query.isPending && !query.isError && items.length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(items)

  /**
   * Las firmas de los logos, en UN lote y solo de la página que se ve.
   *
   * Una por fila serían cuarenta viajes en un catálogo real. Y solo de la
   * página visible porque el paginador ya recortó lo que se está mirando:
   * firmar las cuarenta para enseñar diez es pagar por adelantado lo que nadie
   * va a ver.
   */
  const logos = useBrandLogoUrls(
    esMarca ? pager.rows.map((entry) => ('logo_url' in entry ? entry.logo_url : null)) : [],
  )

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t(copy.help)}</Typography>

      <FilterBar
        actions={
          canWrite && (
            <Button variant="contained" onClick={() => setEditing({ open: true, entry: null })}>
              {t(copy.create)}
            </Button>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('pim.search')} />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={esMarca ? 4 : 3} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('pim.noResults') : t(copy.empty)}
            icon={<LocalOfferRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && items.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                {/* La columna del logo no lleva rótulo visible: la cabecera de
                    una columna de imágenes de 36 px dice más ocupando que
                    informando. El nombre accesible sí está, para quien navega
                    la tabla con lector de pantalla. */}
                {esMarca && (
                  <TableCell sx={{ width: 56 }}>
                    <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                      {t('pim.brands.logo')}
                    </Box>
                  </TableCell>
                )}
                <TableCell>{t('pim.field.code')}</TableCell>
                <TableCell>{t('pim.field.name')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((entry) => (
                <TableRow key={entry.id} hover>
                  {esMarca && (
                    <TableCell>
                      <LogoDeMarca
                        name={entry.name}
                        url={'logo_url' in entry && entry.logo_url ? logos[entry.logo_url] : undefined}
                      />
                    </TableCell>
                  )}
                  <TableCell sx={{ fontWeight: 700 }}>{entry.code}</TableCell>
                  <TableCell>{entry.name}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={entry.is_active ? 'success' : 'default'}
                      label={entry.is_active ? t('pim.field.active') : t('common.no')}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: `${t('common.edit')}: ${entry.name}`,
                          tone: 'neutral',
                          onClick: () => setEditing({ open: true, entry }),
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

      {esMarca ? (
        <BrandDrawer
          open={editing.open}
          entry={(editing.entry as Brand | null) ?? null}
          title={t(copy.create)}
          canWrite={canWrite}
          organizationId={tenant?.organization_id ?? null}
          companyId={activeCompanyId}
          onClose={() => setEditing({ open: false, entry: null })}
          onSubmit={async (values) => {
            if (!tenant || !activeCompanyId) return
            await saveBrand.mutateAsync({
              id: editing.entry?.id ?? null,
              scope: { organizationId: tenant.organization_id, companyId: activeCompanyId },
              values,
            })
            notify(t('pim.toast.saved'))
            setEditing({ open: false, entry: null })
          }}
        />
      ) : (
        <CatalogEntryDrawer
          open={editing.open}
          entry={editing.entry}
          title={t(copy.create)}
          canWrite={canWrite}
          onClose={() => setEditing({ open: false, entry: null })}
          onSubmit={async (values) => {
            if (!tenant || !activeCompanyId) return
            await saveFamily.mutateAsync({
              id: editing.entry?.id ?? null,
              scope: { organizationId: tenant.organization_id, companyId: activeCompanyId },
              values,
            })
            notify(t('pim.toast.saved'))
            setEditing({ open: false, entry: null })
          }}
        />
      )}
    </Stack>
  )
}

/**
 * El logo en la tabla: imagen real o monograma.
 *
 * Hueco de tamaño FIJO y `object-fit: contain`. Las dos cosas por el mismo
 * motivo: una tabla cuyas filas cambian de alto según la imagen que subió cada
 * quien no se recorre, y un logo apaisado recortado a cuadrado es un trozo de
 * letra — peor que no enseñarlo.
 *
 * `onError` cae al monograma: una firma caducada o un objeto borrado a mano
 * dejarían el icono roto del navegador en medio de la tabla.
 */
function LogoDeMarca({ name, url }: { name: string; url: string | undefined }) {
  const [roto, setRoto] = useState(false)

  if (!url || roto) return <BrandMonogram name={name} size={36} />

  return (
    <Box
      component="img"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setRoto(true)}
      sx={{
        width: 36,
        height: 36,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  )
}

/** Alta y edición de una MARCA: el vocabulario más su logo. */
function BrandDrawer({
  open,
  entry,
  title,
  canWrite,
  organizationId,
  companyId,
  onClose,
  onSubmit,
}: {
  open: boolean
  entry: Brand | null
  title: string
  canWrite: boolean
  organizationId: string | null
  companyId: string | null
  onClose: () => void
  onSubmit: (values: BrandFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [codeEdited, setCodeEdited] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BrandFormValues>({
    resolver: zodResolver(brandFormSchema),
    defaultValues: brandToForm(entry),
  })

  useEffect(() => {
    if (!open) return
    reset(brandToForm(entry))
    setCodeEdited(Boolean(entry))
    setServerError(null)
  }, [open, entry, reset])

  const fieldError = (key: keyof BrandFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: BrandFormValues) {
    setServerError(null)
    try {
      await onSubmit(values)
    } catch (error) {
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={entry ? entry.name : title}
      onClose={onClose}
      busy={isSubmitting}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="pim-brand-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="pim-brand-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <TextField
            label={t('pim.field.name')}
            fullWidth
            autoFocus
            disabled={!canWrite}
            error={Boolean(errors.name)}
            helperText={fieldError('name')}
            {...register('name', {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                if (!codeEdited) setValue('code', sugerirCodigo(event.target.value))
              },
            })}
          />

          <TextField
            label={t('pim.field.code')}
            fullWidth
            disabled={!canWrite}
            error={Boolean(errors.code)}
            helperText={fieldError('code')}
            inputProps={{ spellCheck: false }}
            {...register('code', { onChange: () => setCodeEdited(true) })}
          />

          {/* El logo va DESPUÉS del nombre a propósito: el monograma de reserva
              se calcula con el nombre, así que enseñarlo antes de tenerlo sería
              enseñar un «?». */}
          <BrandLogoField
            name={watch('name')}
            value={watch('logo_url')}
            organizationId={organizationId}
            companyId={companyId}
            disabled={!canWrite}
            onChange={(next) => setValue('logo_url', next, { shouldDirty: true })}
          />

          <FormControlLabel
            control={
              <Switch
                checked={watch('is_active')}
                disabled={!canWrite}
                onChange={(_, checked) => setValue('is_active', checked)}
              />
            }
            label={t('pim.field.active')}
          />
        </Stack>
      </Box>
    </FormDrawer>
  )
}

/** Alta y edición de una FAMILIA. El código se sugiere a partir del nombre. */
function CatalogEntryDrawer({
  open,
  entry,
  title,
  canWrite,
  onClose,
  onSubmit,
}: {
  open: boolean
  entry: ProductFamily | null
  title: string
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: CatalogEntryFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [codeEdited, setCodeEdited] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CatalogEntryFormValues>({
    resolver: zodResolver(catalogEntryFormSchema),
    defaultValues: catalogEntryToForm(entry),
  })

  useEffect(() => {
    if (!open) return
    reset(catalogEntryToForm(entry))
    setCodeEdited(Boolean(entry))
    setServerError(null)
  }, [open, entry, reset])

  const fieldError = (key: keyof CatalogEntryFormValues) => {
    const message = errors[key]?.message
    return message ? t(message as MessageKey) : undefined
  }

  async function submit(values: CatalogEntryFormValues) {
    setServerError(null)
    try {
      await onSubmit(values)
    } catch (error) {
      setServerError(error instanceof CatalogError ? error.key : 'catalog.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={entry ? entry.name : title}
      onClose={onClose}
      busy={isSubmitting}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="pim-entry-form"
            variant="contained"
            disabled={isSubmitting || !canWrite}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="pim-entry-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <TextField
            label={t('pim.field.name')}
            fullWidth
            autoFocus
            disabled={!canWrite}
            error={Boolean(errors.name)}
            helperText={fieldError('name')}
            {...register('name', {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                if (!codeEdited) setValue('code', sugerirCodigo(event.target.value))
              },
            })}
          />

          <TextField
            label={t('pim.field.code')}
            fullWidth
            disabled={!canWrite}
            error={Boolean(errors.code)}
            helperText={fieldError('code')}
            inputProps={{ spellCheck: false }}
            {...register('code', { onChange: () => setCodeEdited(true) })}
          />

          <FormControlLabel
            control={
              <Switch
                checked={watch('is_active')}
                disabled={!canWrite}
                onChange={(_, checked) => setValue('is_active', checked)}
              />
            }
            label={t('pim.field.active')}
          />
        </Stack>
      </Box>
    </FormDrawer>
  )
}

/**
 * El código que se propone a partir del nombre, como el slug de un producto.
 *
 * Vive fuera de los dos cajones porque es la MISMA regla —debe cumplir
 * `brands_code_fmt` y `product_families_code_fmt`, que son idénticos— y tenerla
 * dos veces es tenerla mal una de las dos.
 */
function sugerirCodigo(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41)
}
