import { RowActions } from '@/shared/ui/RowActions'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import { FilterBar } from '@/shared/ui/FilterBar'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Tabs,
  TextField,
  MenuItem,
  LinearProgress,
} from '@mui/material'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { ConfirmDeleteDialog } from '@/shared/ui/ConfirmDeleteDialog'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import {
  DEFAULT_PRODUCT_SORT,
  PRODUCTS_PAGE_SIZE,
  type ProductSort,
  type ProductSortColumn,
  type ProductStatusFilter,
} from './api/products'
import { CatalogError } from './api/errors'
import { ProductDrawer } from './ProductDrawer'
import { downloadCsv, productsToCsv } from './exportCsv'
import { categoryDescendants, categoryTree } from './types'
import type { Product, ProductKind, ProductStatus } from './types'
import { CategoryPicker } from './CategoryPicker'
import { useCategories } from './useCategories'
import { useBrands } from './pim/hooks'
import { useDeleteProduct, useProductUsage, useProducts, useSetProductStatus } from './useProducts'

const STATUS_LABEL: Record<ProductStatus, MessageKey> = {
  draft: 'catalog.status.draft',
  published: 'catalog.status.published',
  archived: 'catalog.status.archived',
}

const STATUS_COLOR: Record<ProductStatus, 'default' | 'success' | 'warning'> = {
  draft: 'warning',
  published: 'success',
  archived: 'default',
}

const KIND_LABEL: Record<ProductKind, MessageKey> = {
  simple: 'catalog.kind.simple',
  variant: 'catalog.kind.variant',
  bundle: 'catalog.kind.bundle',
}

const TABS: Array<{ value: ProductStatusFilter; label: MessageKey }> = [
  { value: 'all', label: 'common.all' },
  { value: 'draft', label: 'catalog.status.draft' },
  { value: 'published', label: 'catalog.status.published' },
  { value: 'archived', label: 'catalog.status.archived' },
]

function errorKeyOf(error: unknown): MessageKey {
  return error instanceof CatalogError ? error.key : 'catalog.error.generic'
}

/**
 * Listado de productos del backoffice.
 *
 * ## La excepción a la regla del buscador único
 *
 * La regla de suite es «un buscador general + tabs de estado, sin paneles de
 * filtros multi-campo» (contrato §8), y esta pantalla la incumple a propósito
 * y por encargo del operador: categoría, marca y stock mínimo son
 * DESPLEGABLES, no texto.
 *
 * El motivo de la regla es que seis cajas obligan a adivinar cuál rellenar
 * antes de saber si lo que buscas existe. Aquí ese motivo no aplica: las dos
 * primeras son listas cerradas —se elige de lo que hay, no se teclea a
 * ciegas— y el catálogo es la pantalla donde de verdad se cruzan dos
 * criterios («qué de esta marca me queda por debajo de diez»). Ninguna otra
 * pantalla hereda esta excepción.
 *
 * Nada consulta hasta pulsar **Filtrar**: con tres filtros que se combinan, lo
 * que se espera es elegir los tres y buscar una vez, no tres búsquedas
 * mientras se elige.
 *
 * La pantalla no toca Supabase: todo pasa por los hooks de
 * `useProducts`/`useCategories`/`useBrands`.
 */

/**
 * Lo que acota la tabla. Todo texto, que es lo que devuelven los controles; la
 * conversión a número vive en un solo sitio, al construir la consulta.
 */
interface Filtros {
  search: string
  categoryId: string
  brandId: string
  minStock: string
}

const SIN_FILTROS: Filtros = { search: '', categoryId: '', brandId: '', minStock: '' }

/** El formulario de filtros, para que el botón de fuera pueda enviarlo. */
const FORM_FILTROS = 'filtros-productos'

export function ProductsPage() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, activeCompanyId, tenant, status: tenantStatus, can } = useTenant()
  const canWrite = can('catalog.write')

  const [status, setStatus] = useState<ProductStatusFilter>('all')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT)

  /**
   * Lo que se escribe y lo que se consulta son dos cosas distintas.
   *
   * El listado pagina en el servidor, así que mientras el término entraba
   * directo en la consulta cada tecla era un viaje de ida y vuelta a PostgREST:
   * escribir «acondicionador» eran catorce peticiones y la tabla se quedaba
   * enseñando la respuesta de la letra anterior. Con un botón de por medio no
   * sale ni una hasta que alguien lo pide, que además es lo que se espera
   * cuando hay tres filtros que se combinan: se eligen los tres y se busca una
   * vez, no tres veces mientras se elige.
   */
  const [borrador, setBorrador] = useState<Filtros>(SIN_FILTROS)
  const [aplicados, setAplicados] = useState<Filtros>(SIN_FILTROS)
  const [drawer, setDrawer] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)

  const storeId = activeStore?.id ?? null

  function cambiar(campo: keyof Filtros, valor: string) {
    setBorrador((actual) => ({ ...actual, [campo]: valor }))
  }

  function aplicar() {
    setAplicados(borrador)
    setPage(0)
  }

  function limpiar() {
    setBorrador(SIN_FILTROS)
    setAplicados(SIN_FILTROS)
    setPage(0)
  }

  const categories = useCategories(storeId)
  const brands = useBrands()

  // El mismo árbol que usa el cajón de producto: agrupado por su raíz, con la
  // ruta y buscable. Una lista plana de cuarenta nombres alfabéticos deja
  // «Cuidado de la piel» y «Cuidado del cabello» a diez filas de distancia y
  // sin decir de quién cuelgan.
  const arbolCategorias = useMemo(() => categoryTree(categories.data ?? []), [categories.data])

  /**
   * La familia entera, no solo la categoría marcada.
   *
   * Los productos cuelgan de las hojas —«Antiinfecciosos», «Hematológicos»— y
   * casi nunca de la raíz, así que filtrar por «Medicamentos» con una igualdad
   * devolvía casi nada. Se ordena para que la clave de la consulta sea la misma
   * ante la misma elección y no se pierda la caché por el orden del conjunto.
   */
  const familiaElegida = useMemo(() => {
    if (!aplicados.categoryId) return null
    return [...categoryDescendants(categories.data ?? [], aplicados.categoryId)].sort()
  }, [aplicados.categoryId, categories.data])

  const hayFiltros = Object.values(aplicados).some(Boolean)
  const sinAplicar = JSON.stringify(borrador) !== JSON.stringify(aplicados)

  // Cambiar de pestaña o de tienda vuelve a la primera página: quedarse en la
  // página 4 de un resultado que ahora tiene una sola es una tabla vacía que se
  // lee como "no hay nada". Los filtros no hacen falta aquí — `aplicar` y
  // `limpiar` ya la reinician, que es cuando de verdad cambia el resultado.
  useEffect(() => {
    setPage(0)
  }, [status, storeId])

  /**
   * Pulsar una columna la ordena; volver a pulsarla la invierte.
   *
   * Y devuelve a la primera página, porque el orden cambia QUÉ hay en cada
   * página: quedarse en la cuatro después de reordenar enseña un tramo del
   * medio de una lista que ya no es la misma, y eso no se lee bien de ninguna
   * manera.
   */
  function ordenarPor(column: ProductSortColumn) {
    setSort((actual) =>
      actual.column === column
        ? { column, direction: actual.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    )
    setPage(0)
  }

  const products = useProducts({
    storeId,
    search: aplicados.search,
    status,
    page,
    sort,
    categoryIds: familiaElegida,
    brandId: aplicados.brandId || null,
    // Vacío no es cero: dejar el campo en blanco significa «no me importa el
    // stock», y un cero significaría «solo los que tienen cero o más», que es
    // todo el catálogo dicho de una forma rara.
    minStock: aplicados.minStock === '' ? null : Number(aplicados.minStock),
  })
  /**
   * Trabajando, pero con datos en pantalla.
   *
   * `isPending` es «todavía no hay nada que enseñar» —la primera carga— y
   * `isFetching` es «hay algo, y estoy trayendo lo siguiente». Distinguirlas es
   * lo que permite no tirar la tabla cada vez que alguien filtra.
   */
  const refrescando = products.isFetching && !products.isPending

  const usage = useProductUsage(deleteTarget?.id ?? null)
  const changeStatus = useSetProductStatus()
  const removeProduct = useDeleteProduct()

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  )

  // Mientras el espacio de trabajo se resuelve NO se dice "no tienes tiendas":
  // sería afirmar algo que todavía no se sabe (mismo criterio que la sesión).
  if (tenantStatus === 'loading') {
    return (
      <>
        <PageHeader icon={<Inventory2RoundedIcon />} title={t('admin.products.title')} />
        <Card>
          <TableSkeleton columns={6} />
        </Card>
      </>
    )
  }

  if (!storeId || !activeCompanyId || !tenant) {
    return (
      <>
        <PageHeader icon={<Inventory2RoundedIcon />} title={t('admin.products.title')} />
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

  async function onChangeStatus(product: Product, next: ProductStatus, toast: MessageKey) {
    try {
      await changeStatus.mutateAsync({ productId: product.id, status: next })
      notify(t(toast))
    } catch (error) {
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await removeProduct.mutateAsync(deleteTarget.id)
      notify(t('catalog.toast.deleted'))
      setDeleteTarget(null)
    } catch (error) {
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  const list = products.data?.rows ?? []
  const total = products.data?.total ?? 0
  const isEmpty = !products.isPending && !products.isError && list.length === 0

  return (
    <>
      <PageHeader
        icon={<Inventory2RoundedIcon />}
        title={t('admin.products.title')}
        subtitle={activeStore?.name}
        actions={
          <>
            <Button
              variant="outlined"
              disabled={list.length === 0}
              onClick={() =>
                downloadCsv(
                  `productos-${activeStore?.slug ?? 'tienda'}.csv`,
                  productsToCsv(list, categories.data ?? []),
                )
              }
            >
              {t('common.export')}
            </Button>
            {canWrite && (
              <Button
                variant="contained"
                onClick={() => setDrawer({ open: true, product: null })}
              >
                {t('catalog.products.new')}
              </Button>
            )}
          </>
        }
      />

      <Stack spacing={2}>
        <Tabs
          value={status}
          onChange={(_, next: ProductStatusFilter) => setStatus(next)}
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

        {/* Un formulario de verdad: pulsar Intro en cualquiera de los campos
            filtra, que es lo que hace todo el mundo antes de buscar el botón.
            El botón vive fuera del formulario —la barra ancla las acciones a la
            derecha— y lo envía por `form`, que para eso existe el atributo. */}
        <FilterBar
          actions={
            <>
              <Button
                type="submit"
                form={FORM_FILTROS}
                variant="contained"
                size="small"
                disabled={!sinAplicar && !hayFiltros}
              >
                {t('common.filters.apply')}
              </Button>
              {(hayFiltros || sinAplicar) && (
                <Button size="small" onClick={limpiar}>
                  {t('common.filters.reset')}
                </Button>
              )}
            </>
          }
        >
          <Box
            component="form"
            id={FORM_FILTROS}
            onSubmit={(event) => {
              event.preventDefault()
              aplicar()
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              flexWrap: 'wrap',
              rowGap: 1.25,
            }}
          >
            <Box sx={{ minWidth: { xs: '100%', sm: 260 } }}>
              <SearchField
                value={borrador.search}
                onChange={(next) => cambiar('search', next)}
                placeholder={t('admin.products.search')}
              />
            </Box>

            <Box sx={{ minWidth: { xs: '100%', sm: 260 } }}>
              <CategoryPicker
                label={t('catalog.field.category')}
                nodes={arbolCategorias}
                value={borrador.categoryId}
                onChange={(next) => cambiar('categoryId', next)}
                noneLabel={t('catalog.products.filter.allCategories')}
                size="small"
              />
            </Box>

            <TextField
              select
              size="small"
              label={t('catalog.field.brand')}
              value={borrador.brandId}
              onChange={(event) => cambiar('brandId', event.target.value)}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">{t('catalog.products.filter.allBrands')}</MenuItem>
              {(brands.data ?? []).map((brand) => (
                <MenuItem key={brand.id} value={brand.id}>
                  {brand.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              type="number"
              label={t('catalog.products.filter.minStock')}
              value={borrador.minStock}
              onChange={(event) => cambiar('minStock', event.target.value)}
              inputProps={{ min: 0, step: 1 }}
              sx={{ width: 130 }}
            />
          </Box>
        </FilterBar>

        {/* El esqueleto es solo para la PRIMERA carga.
            Al filtrar o al refrescar, la tabla se queda con lo que había y se
            atenúa mientras llega lo nuevo: sustituirla por un esqueleto en cada
            búsqueda hace que la página salte de alto y que se pierda de vista
            la fila que uno estaba mirando. Lo que sí hace falta es que se NOTE
            que está trabajando, y eso lo dice la barra de arriba. */}
        <Card sx={{ position: 'relative', overflow: 'hidden' }}>
          {refrescando && (
            <LinearProgress
              aria-label={t('common.loading')}
              sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}
            />
          )}

          {products.isPending && <TableSkeleton columns={6} />}

          {products.isError && (
            <ErrorState error={products.error} onRetry={() => void products.refetch()} />
          )}

          {isEmpty && (
            <EmptyState
              title={hayFiltros ? t('catalog.products.emptySearch') : t('admin.products.empty')}
              icon={<Inventory2RoundedIcon fontSize="small" />}
              action={
                canWrite && !hayFiltros ? (
                  <Button variant="contained" onClick={() => setDrawer({ open: true, product: null })}>
                    {t('catalog.products.new')}
                  </Button>
                ) : undefined
              }
            />
          )}

          {!products.isPending && !products.isError && list.length > 0 && (
            <Box
              sx={{
                transition: 'opacity .15s ease',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                ...(refrescando
                  ? // Atenuada y sin recibir pulsaciones: lo que se ve es la
                    // respuesta ANTERIOR, y dejar pulsar «archivar» sobre una
                    // fila que está a punto de cambiar de sitio es como se
                    // archiva el producto equivocado.
                    { opacity: 0.55, pointerEvents: 'none' }
                  : {}),
              }}
            >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <Ordenable columna="sku" sort={sort} onSort={ordenarPor}>
                    {t('catalog.field.sku')}
                  </Ordenable>
                  <Ordenable columna="name" sort={sort} onSort={ordenarPor}>
                    {t('catalog.field.name')}
                  </Ordenable>
                  <Ordenable columna="category_name" sort={sort} onSort={ordenarPor}>
                    {t('catalog.field.category')}
                  </Ordenable>
                  <Ordenable columna="price" sort={sort} onSort={ordenarPor} align="right">
                    {t('common.price')}
                  </Ordenable>
                  <Ordenable columna="stock" sort={sort} onSort={ordenarPor} align="right">
                    {t('catalog.field.stock')}
                  </Ordenable>
                  <Ordenable columna="status" sort={sort} onSort={ordenarPor}>
                    {t('common.status')}
                  </Ordenable>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map((product) => (
                  <TableRow key={product.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{product.sku}</TableCell>
                    <TableCell>
                      {product.name}
                      {/* El tipo solo se anuncia cuando NO es simple: una
                          etiqueta en cada fila de un catálogo que casi todo es
                          simple deja de leerse a la tercera pantalla. */}
                      {product.kind !== 'simple' && (
                        <Chip
                          size="small"
                          variant="outlined"
                          sx={{ ml: 1 }}
                          label={t(KIND_LABEL[product.kind])}
                        />
                      )}
                    </TableCell>
                    <TableCell sx={{ color: 'var(--muted)' }}>
                      {product.category_id
                        ? (categoryName.get(product.category_id) ?? t('common.none'))
                        : t('common.none')}
                    </TableCell>
                    <TableCell align="right" className="tnum">
                      {formatMoney(Number(product.price), product.currency, locale)}
                    </TableCell>
                    <TableCell align="right" className="tnum">
                      {/* Un maestro de variantes y un kit no llevan existencia
                          propia: enseñar su cero sería afirmar que no hay. */}
                      {product.kind === 'simple' ? product.stock : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        tone={STATUS_COLOR[product.status]}
                        label={t(STATUS_LABEL[product.status])}
                      />
                    </TableCell>
                    {/* El menu de tres puntos escondia CUATRO acciones detras de
                        un icono que no dice ninguna: para saber si un producto
                        se puede despublicar habia que abrirlo. Aqui se ven, y
                        el color lo pone lo que cada una HACE.

                        Archivar va en neutro y no en rojo aunque retire el
                        producto: es reversible y conserva el registro. El rojo
                        se guarda para lo que no tiene vuelta —despublicar, que
                        lo saca de la tienda ya mismo, y borrar—, porque un rojo
                        que sale en todo deja de avisar de nada. */}
                    <TableCell align="right">
                      <RowActions
                        actions={[
                          {
                            id: 'edit',
                            icon: <EditRoundedIcon fontSize="small" />,
                            label: `${t('common.edit')}: ${product.name}`,
                            tone: 'neutral',
                            onClick: () => setDrawer({ open: true, product }),
                          },
                          {
                            id: 'publish',
                            icon:
                              product.status === 'published' ? (
                                <VisibilityOffRoundedIcon fontSize="small" />
                              ) : (
                                <VisibilityRoundedIcon fontSize="small" />
                              ),
                            label:
                              product.status === 'published'
                                ? t('catalog.action.unpublish')
                                : t('catalog.action.publish'),
                            tone: product.status === 'published' ? 'danger' : 'accent',
                            disabled: !canWrite,
                            onClick: () =>
                              product.status === 'published'
                                ? void onChangeStatus(product, 'draft', 'catalog.toast.unpublished')
                                : void onChangeStatus(product, 'published', 'catalog.toast.published'),
                          },
                          {
                            id: 'archive',
                            icon: <ArchiveRoundedIcon fontSize="small" />,
                            label: t('catalog.action.archive'),
                            tone: 'neutral',
                            disabled: !canWrite || product.status === 'archived',
                            onClick: () =>
                              void onChangeStatus(product, 'archived', 'catalog.toast.archived'),
                          },
                          {
                            id: 'delete',
                            icon: <DeleteRoundedIcon fontSize="small" />,
                            label: `${t('common.delete')}: ${product.name}`,
                            tone: 'danger',
                            disabled: !canWrite,
                            onClick: () => setDeleteTarget(product),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </Box>
          )}

          {!products.isError && total > 0 && (
            <TablePager
              page={page}
              pageSize={PRODUCTS_PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          )}
        </Card>
      </Stack>



      <ProductDrawer
        open={drawer.open}
        product={drawer.product}
        categories={categories.data ?? []}
        // El catálogo de la página en curso: es lo que las pestañas de kit y de
        // relacionados ofrecen como candidatos, sin una segunda consulta.
        products={list}
        organizationId={tenant.organization_id}
        companyId={activeCompanyId}
        storeId={storeId}
        currency={activeStore?.currency ?? 'PEN'}
        canWrite={canWrite}
        onClose={() => setDrawer({ open: false, product: null })}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        title={t('catalog.delete.title')}
        entityName={deleteTarget?.name ?? ''}
        isLoadingUsage={usage.isPending && Boolean(deleteTarget)}
        usageError={usage.isError ? t(errorKeyOf(usage.error)) : null}
        usage={[
          { label: t('catalog.delete.usage.orderLines'), count: usage.data?.order_lines ?? 0 },
          { label: t('catalog.delete.usage.images'), count: usage.data?.images ?? 0 },
          { label: t('catalog.delete.usage.variants'), count: usage.data?.variants ?? 0 },
          { label: t('catalog.delete.usage.bundles'), count: usage.data?.bundles ?? 0 },
        ]}
        safeActionLabel={
          deleteTarget?.status === 'archived' ? undefined : t('catalog.action.archive')
        }
        safeActionHint={t('catalog.delete.archiveHint')}
        onSafeAction={() => {
          if (!deleteTarget) return
          void onChangeStatus(deleteTarget, 'archived', 'catalog.toast.archived')
          setDeleteTarget(null)
        }}
        onDelete={() => void onDelete()}
        onClose={() => setDeleteTarget(null)}
        isBusy={removeProduct.isPending || changeStatus.isPending}
      />
    </>
  )
}

/**
 * Una cabecera de columna que ordena la tabla.
 *
 * `TableSortLabel` y no un botón cualquiera porque trae lo que hace falta para
 * que esto no sea solo un adorno: la flecha aparece únicamente en la columna
 * activa, y `aria-sort` sobre la celda es lo que hace que un lector de pantalla
 * anuncie por dónde está ordenada la tabla — sin eso, quien no ve la flecha no
 * tiene forma de saberlo.
 */
function Ordenable({
  columna,
  sort,
  onSort,
  align,
  children,
}: {
  columna: ProductSortColumn
  sort: ProductSort
  onSort: (columna: ProductSortColumn) => void
  align?: 'right'
  children: ReactNode
}) {
  const activa = sort.column === columna

  return (
    <TableCell
      {...(align ? { align } : {})}
      sortDirection={activa ? sort.direction : false}
      aria-sort={activa ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <TableSortLabel
        active={activa}
        direction={activa ? sort.direction : 'asc'}
        onClick={() => onSort(columna)}
      >
        {children}
      </TableSortLabel>
    </TableCell>
  )
}
