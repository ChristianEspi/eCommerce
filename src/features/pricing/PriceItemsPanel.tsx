import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { RowActions } from '@/shared/ui/RowActions'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
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
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { IMPORT_ACCEPT, WorkbookReadError, downloadWorkbook, readImportText } from '@/shared/lib/excel'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { R } from '@/theme/tokens'
import { PricingError } from './errors'
import {
  useDeletePriceItem,
  useImportPriceItems,
  usePriceItems,
  usePricingCatalog,
  useProductSearch,
  useProductUoms,
  useProductVariants,
  useSavePriceItem,
} from './hooks'
import {
  parsePriceCsv,
  resolvePriceCsv,
  type CsvIssue,
  type ResolvedPriceRow,
} from './importCsv'
import { priceImportColumns, priceTemplateBook } from './priceTemplate'
import type { PriceList, PriceListItem, PricedProduct } from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Los precios de una lista.
 *
 * Dos caminos de carga, y los dos hacen falta:
 *
 *  · **Fila a fila**, para corregir tres precios. El selector de producto busca
 *    EN EL SERVIDOR con límite: traerse el catálogo entero para filtrarlo en
 *    memoria rompe justo en el cliente que más SKU tiene.
 *  · **CSV**, para cargar un acuerdo entero. Se resuelve por SKU y se enseña el
 *    resultado ANTES de escribir: una importación que no se puede revisar es
 *    una importación que nadie se atreve a aprobar.
 */
export function PriceItemsPanel({ list, canWrite }: { list: PriceList; canWrite: boolean }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore } = useTenant()

  const items = usePriceItems(list.id)
  const save = useSavePriceItem()
  const remove = useDeletePriceItem()

  const [product, setProduct] = useState<PricedProduct | null>(null)
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const search = useProductSearch(activeStore?.id ?? null, debounced)
  const variants = useProductVariants(product?.id ?? null)
  const uoms = useProductUoms(product?.id ?? null)

  const [variantId, setVariantId] = useState('')
  const [uomId, setUomId] = useState('')
  const [minQuantity, setMinQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [compareAt, setCompareAt] = useState('')
  const [formError, setFormError] = useState<MessageKey | null>(null)

  /**
   * El renglón que se está corrigiendo, si es que hay alguno.
   *
   * El formulario es UNO: el de arriba da de alta y también corrige. Un segundo
   * formulario para editar sería el mismo campo dos veces con dos validaciones
   * que se van separando, y ya se sabe cómo acaba eso.
   */
  const [editando, setEditando] = useState<PriceListItem | null>(null)

  /** Qué se busca dentro de la lista, y si solo interesan los rebajados. */
  const [filtro, setFiltro] = useState('')
  const [soloRebajados, setSoloRebajados] = useState(false)

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

  /**
   * El catálogo de la tienda, para poder LEER la tabla.
   *
   * La columna de producto salía con el identificador recortado —`a3f91c02`—
   * salvo que ese producto estuviera en ese momento entre los veinte resultados
   * del buscador de arriba. Con una lista de quinientos renglones eso no es una
   * tabla, es una lista de identificadores: no se puede encontrar un producto
   * para corregirlo ni para quitarle el precio tachado.
   *
   * Es la MISMA consulta que ya usa la importación (`catalogKey`), así que abrir
   * las dos cosas en la misma pantalla no pide el catálogo dos veces.
   */
  const catalogo = usePricingCatalog(activeStore?.id ?? null, true)

  const productLabel = useMemo(() => {
    const names = new Map<string, string>()
    for (const row of catalogo.data?.products ?? []) names.set(row.id, `${row.sku} · ${row.name}`)
    for (const row of search.data ?? []) names.set(row.id, `${row.sku} · ${row.name}`)
    if (product) names.set(product.id, `${product.sku} · ${product.name}`)
    return names
  }, [catalogo.data, search.data, product])

  const DECIMAL = /^\d{1,10}(\.\d{1,6})?$/

  /** Deja el formulario como recién abierto. */
  function limpiar() {
    setEditando(null)
    setProduct(null)
    setVariantId('')
    setUomId('')
    setMinQuantity('1')
    setUnitPrice('')
    setCompareAt('')
    setFormError(null)
  }

  /**
   * Trae un renglón al formulario para corregirlo.
   *
   * Antes esto no existía y la tabla solo sabía BORRAR: quitarle el precio
   * tachado a un producto —o corregir un precio— obligaba a borrar el renglón y
   * volver a crearlo con los mismos datos, y si te equivocabas en el camino te
   * quedabas sin el precio. La API ya aceptaba `id` para actualizar; lo que
   * faltaba era la puerta.
   */
  function editar(item: PriceListItem) {
    setEditando(item)
    setProduct((catalogo.data?.products ?? []).find((row) => row.id === item.product_id) ?? null)
    setVariantId(item.variant_id ?? '')
    setUomId(item.uom_id ?? '')
    // `1.000000` en la base es `1` en el formulario: lo que se enseña para
    // corregir tiene que ser lo que uno escribiría.
    setMinQuantity(String(Number(item.min_quantity)))
    setUnitPrice(item.unit_price)
    setCompareAt(item.compare_at_price ?? '')
    setFormError(null)
  }

  async function addItem() {
    if (!scope || !product) {
      setFormError('pricing.error.product')
      return
    }
    if (!DECIMAL.test(unitPrice) || !DECIMAL.test(minQuantity) || Number(minQuantity) <= 0) {
      setFormError('pricing.error.amount')
      return
    }
    if (compareAt && !DECIMAL.test(compareAt)) {
      setFormError('pricing.error.amount')
      return
    }

    setFormError(null)
    try {
      await save.mutateAsync({
        ...(editando ? { id: editando.id } : {}),
        scope,
        listId: list.id,
        values: {
          productId: product.id,
          variantId: variantId || null,
          uomId: uomId || null,
          minQuantity,
          unitPrice,
          compareAtPrice: compareAt || null,
        },
      })
      if (editando) {
        notify(t('pricing.toast.updated'))
        limpiar()
      } else {
        notify(t('pricing.toast.saved'))
        setUnitPrice('')
        setCompareAt('')
        setMinQuantity('1')
      }
    } catch (error) {
      setFormError(error instanceof PricingError ? error.key : 'pricing.error.generic')
    }
  }

  /**
   * Lo que se enseña de la lista.
   *
   * Se filtra por la ETIQUETA del producto —`SKU · nombre`— porque es lo que se
   * ve en la tabla: buscar por algo que no está escrito en pantalla es adivinar.
   *
   * El interruptor de «solo con precio tachado» está para el trabajo concreto
   * que hoy no se podía hacer: ver de una vez qué productos están saliendo en la
   * banda de ofertas de la vitrina, que son exactamente los que tienen ese
   * campo puesto.
   */
  const filtrados = useMemo(() => {
    const aguja = filtro.trim().toLowerCase()
    return (items.data ?? []).filter((item) => {
      if (soloRebajados && !item.compare_at_price) return false
      if (!aguja) return true
      return (productLabel.get(item.product_id) ?? item.product_id).toLowerCase().includes(aguja)
    })
  }, [items.data, filtro, soloRebajados, productLabel])

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(filtrados)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('pricing.items.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {formError && <Alert severity="error">{t(formError)}</Alert>}
          {editando && (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={limpiar}>
                  {t('common.cancel')}
                </Button>
              }
            >
              {t('pricing.items.editing')}
            </Alert>
          )}

          <Autocomplete
            options={search.data ?? []}
            value={product}
            // Editando, el producto queda fijo: cambiarlo no corrige este
            // renglón, crea otro distinto contra la clave única de la tabla.
            disabled={Boolean(editando)}
            onChange={(_, next) => {
              setProduct(next)
              setVariantId('')
              setUomId('')
            }}
            onInputChange={(_, next) => setTerm(next)}
            getOptionLabel={(option) => productLabel.get(option.id) ?? option.sku}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={search.isFetching}
            noOptionsText={t('pricing.noResults')}
            renderInput={(params) => (
              <TextField {...params} label={t('pricing.field.product')} size="small" />
            )}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <SelectField
              size="small"
              fullWidth
              label={t('pricing.field.variant')}
              value={variantId}
              disabled={!product || (variants.data ?? []).length === 0}
              onChange={(event) => setVariantId(event.target.value)}
              helperText={t('pricing.field.variantHint')}
            >
              <MenuItem value="">{t('pricing.field.allVariants')}</MenuItem>
              {(variants.data ?? []).map((variant) => (
                <MenuItem key={variant.id} value={variant.id}>
                  {variant.name}
                </MenuItem>
              ))}
            </SelectField>

            <SelectField
              size="small"
              fullWidth
              label={t('pricing.field.uom')}
              value={uomId}
              disabled={!product || (uoms.data ?? []).length === 0}
              onChange={(event) => setUomId(event.target.value)}
              helperText={t('pricing.field.uomHint')}
            >
              <MenuItem value="">{t('pricing.field.baseUnit')}</MenuItem>
              {(uoms.data ?? []).map((uom) => (
                <MenuItem key={uom.uom_id} value={uom.uom_id}>
                  {uom.code} (× {uom.factor})
                </MenuItem>
              ))}
            </SelectField>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label={t('pricing.field.minQuantity')}
              value={minQuantity}
              onChange={(event) => setMinQuantity(event.target.value)}
              helperText={t('pricing.field.minQuantityHint')}
            />
            <TextField
              size="small"
              fullWidth
              label={t('pricing.field.unitPrice')}
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
            />
            <TextField
              size="small"
              fullWidth
              label={t('pricing.field.compareAt')}
              value={compareAt}
              onChange={(event) => setCompareAt(event.target.value)}
            />
            <Button variant="contained" onClick={() => void addItem()} disabled={save.isPending}>
              {editando ? t('common.save') : t('common.add')}
            </Button>
          </Stack>
        </Stack>
      )}

      <ImportPanel list={list} canWrite={canWrite} />

      {/* El buscador de la TABLA, que no es el del formulario: aquel elige un
          producto del catálogo para darlo de alta, este encuentra un renglón
          que ya está en la lista. Sin él, corregir un precio en una lista de
          quinientos renglones era pasar página por página. */}
      {(items.data ?? []).length > 0 && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <TextField
            size="small"
            fullWidth
            label={t('pricing.items.filter')}
            value={filtro}
            onChange={(event) => setFiltro(event.target.value)}
          />
          <FormControlLabel
            control={
              <Switch
                checked={soloRebajados}
                onChange={(event) => setSoloRebajados(event.target.checked)}
              />
            }
            label={t('pricing.items.onlyDiscounted')}
          />
          <Typography sx={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {t('pricing.items.count')
              .replace('{shown}', String(filtrados.length))
              .replace('{total}', String((items.data ?? []).length))}
          </Typography>
        </Stack>
      )}

      {items.isError && <ErrorState error={items.error} onRetry={() => void items.refetch()} />}
      {!items.isPending && !items.isError && (items.data ?? []).length === 0 && (
        <EmptyState title={t('pricing.items.empty')} description={t('pricing.items.emptyBody')} />
      )}

      {(items.data ?? []).length > 0 && filtrados.length === 0 && (
        <EmptyState
          title={t('pricing.items.noMatch')}
          description={t('pricing.items.noMatchBody')}
        />
      )}

      {filtrados.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('pricing.field.product')}</TableCell>
              <TableCell align="right">{t('pricing.field.minQuantity')}</TableCell>
              <TableCell align="right">{t('pricing.field.unitPrice')}</TableCell>
              <TableCell align="right">{t('pricing.field.compareAt')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((item) => (
              <TableRow key={item.id} hover>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {productLabel.get(item.product_id) ?? item.product_id.slice(0, 8)}
                  {item.variant_id ? ` · ${t('pricing.field.variant')}` : ''}
                  {item.uom_id ? ` · ${t('pricing.field.uom')}` : ''}
                </TableCell>
                <TableCell align="right">{Number(item.min_quantity)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {item.unit_price} {list.currency}
                </TableCell>
                <TableCell align="right">{item.compare_at_price ?? '—'}</TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'edit',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')} ${item.unit_price}`,
                        disabled: !canWrite,
                        onClick: () => editar(item),
                      },
                      {
                        id: 'delete',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('common.delete')} ${item.unit_price}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => {
                          void remove.mutateAsync(item.id).then(() => notify(t('pricing.toast.deleted')))
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
    </Stack>
  )
}

/**
 * Importación y plantilla.
 *
 * La plantilla se descarga con las cabeceras exactas que el lector espera: es
 * la diferencia entre «se puede importar» y «se puede importar sin llamar a
 * soporte».
 */
function ImportPanel({ list, canWrite }: { list: PriceList; canWrite: boolean }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore } = useTenant()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState<{ rows: ResolvedPriceRow[]; issues: CsvIssue[] } | null>(
    null,
  )
  const catalog = usePricingCatalog(activeStore?.id ?? null, enabled)
  const importItems = useImportPriceItems()

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setEnabled(true)
    const data = catalog.data ?? (await catalog.refetch()).data
    if (!data) return

    let text: string
    try {
      // Excel o CSV: el libro se traduce a las cabeceras técnicas y pasa por el
      // MISMO validador que el CSV de siempre.
      text = await readImportText(file, priceImportColumns(t))
    } catch (error) {
      notify(t(error instanceof WorkbookReadError ? `excel.error.${error.reason}` : 'excel.error.unreadable'), 'error')
      return
    }
    const parsed = parsePriceCsv(text)
    const resolved = resolvePriceCsv(parsed.rows, data)
    setPending({ rows: resolved.resolved, issues: [...parsed.issues, ...resolved.issues] })
  }

  async function confirm() {
    if (!pending || !tenant || !activeCompanyId || !activeStore) return
    const written = await importItems.mutateAsync({
      scope: {
        organizationId: tenant.organization_id,
        companyId: activeCompanyId,
        storeId: activeStore.id,
      },
      listId: list.id,
      rows: pending.rows,
    })
    notify(
      `${t('pricing.import.done')} — ${t('pricing.import.result')
        .replace('{inserted}', String(written.inserted))
        .replace('{updated}', String(written.updated))}`,
    )
    setPending(null)
  }

  return (
    <Box sx={{ border: '1px dashed var(--border)', borderRadius: `${R.md}px`, p: 2 }}>
      <Stack spacing={1.5}>
        <Typography sx={{ fontWeight: 700 }}>{t('pricing.import.title')}</Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('pricing.import.help')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            size="small"
            onClick={() =>
              void downloadWorkbook(priceTemplateBook(list.code, t), t).catch(() =>
                notify(t('excel.error.download'), 'error'),
              )
            }
          >
            {t('pricing.import.template')}
          </Button>
          <Button size="small" disabled={!canWrite} onClick={() => fileRef.current?.click()}>
            {t('pricing.import.choose')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            aria-label={t('pricing.import.choose')}
            onChange={(event) => void onFile(event)}
          />
        </Stack>

        {pending && (
          <Stack spacing={1}>
            <Alert severity={pending.issues.length > 0 ? 'warning' : 'success'}>
              {t('pricing.import.summary')}: {pending.rows.length} / {t('pricing.import.rejected')}:{' '}
              {pending.issues.length}
            </Alert>
            {pending.issues.slice(0, 10).map((issue) => (
              <Typography key={`${issue.line}-${issue.reason}`} sx={{ fontSize: 12, color: 'var(--muted)' }}>
                {t('pricing.import.line')} {issue.line}: {t(`pricing.import.reason.${issue.reason}`)}{' '}
                {issue.value}
              </Typography>
            ))}
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                disabled={pending.rows.length === 0 || importItems.isPending}
                onClick={() => void confirm()}
              >
                {t('pricing.import.confirm')}
              </Button>
              <Button size="small" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
