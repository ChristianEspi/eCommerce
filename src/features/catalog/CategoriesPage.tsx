import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import ToggleOnRoundedIcon from '@mui/icons-material/ToggleOnRounded'
import ToggleOffRoundedIcon from '@mui/icons-material/ToggleOffRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Box,
  Button,
  Card,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { categoryTree } from './types'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { ConfirmDeleteDialog } from '@/shared/ui/ConfirmDeleteDialog'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CatalogError } from './api/errors'
import { CategoryDrawer } from './CategoryDrawer'
import { CatalogImportAction } from './import/CatalogImportAction'
import type { Category } from './types'
import {
  useCategories,
  useCategoryUsage,
  useDeleteCategory,
  useSetCategoryActive,
} from './useCategories'

function errorKeyOf(error: unknown): MessageKey {
  return error instanceof CatalogError ? error.key : 'catalog.error.generic'
}

/**
 * Categorías del catálogo — CRUD mínimo.
 *
 * El buscador filtra en memoria: son decenas de filas, no miles, y pedirle a
 * PostgREST una consulta por letra para eso es gasto sin beneficio.
 */
export function CategoriesPage() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, activeCompanyId, tenant, status: tenantStatus, can } = useTenant()
  const canWrite = can('catalog.write')

  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState<{ open: boolean; category: Category | null }>({
    open: false,
    category: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  const storeId = activeStore?.id ?? null
  const categories = useCategories(storeId)
  const usage = useCategoryUsage(deleteTarget?.id ?? null)
  const toggleActive = useSetCategoryActive()
  const removeCategory = useDeleteCategory()

  /**
   * El listado, en orden de ÁRBOL: cada madre seguida de su descendencia.
   *
   * Al buscar se sale del árbol a propósito y se enseña una lista plana con la
   * RUTA de cada resultado: filtrar un árbol o esconde a las madres —y entonces
   * las hijas aparecen sin contexto— o las conserva vacías, que es peor. Una
   * ruta completa dice dónde está cada coincidencia sin dibujar el árbol.
   */
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const nodes = categoryTree(categories.data ?? [])
    if (!term) return nodes
    return nodes
      .filter(
        (node) =>
          node.category.name.toLowerCase().includes(term) || node.category.slug.includes(term),
      )
      .map((node) => ({ ...node, depth: 0 }))
  }, [categories.data, search])

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(visible)

  if (tenantStatus === 'loading') {
    return (
      <>
        <PageHeader icon={<CategoryRoundedIcon />} title={t('catalog.categories.title')} />
        <Card>
          <TableSkeleton columns={4} />
        </Card>
      </>
    )
  }

  if (!storeId || !activeCompanyId || !tenant) {
    return (
      <>
        <PageHeader icon={<CategoryRoundedIcon />} title={t('catalog.categories.title')} />
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

  async function onToggleActive(category: Category) {
    try {
      await toggleActive.mutateAsync({ categoryId: category.id, isActive: !category.is_active })
      notify(t(category.is_active ? 'catalog.toast.categoryInactive' : 'catalog.toast.categoryActive'))
    } catch (error) {
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await removeCategory.mutateAsync(deleteTarget.id)
      notify(t('catalog.toast.categoryDeleted'))
      setDeleteTarget(null)
    } catch (error) {
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  const isEmpty = !categories.isPending && !categories.isError && visible.length === 0

  return (
    <>
      <PageHeader
        icon={<CategoryRoundedIcon />}
        title={t('catalog.categories.title')}
        subtitle={activeStore?.name}
        actions={
          canWrite ? (
            <>
              <CatalogImportAction kind="categories" storeId={storeId} />
              <Button variant="contained" onClick={() => setDrawer({ open: true, category: null })}>
                {t('catalog.categories.new')}
              </Button>
            </>
          ) : undefined
        }
      />

      <Stack spacing={2}>
        <FilterBar>
          <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={t('catalog.categories.search')}
            />
          </Box>
        </FilterBar>

        <Card>
          {categories.isPending && <TableSkeleton columns={4} />}

          {categories.isError && (
            <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
          )}

          {isEmpty && (
            <EmptyState
              title={t('catalog.categories.empty')}
              icon={<CategoryRoundedIcon fontSize="small" />}
              action={
                canWrite && !search ? (
                  <Button
                    variant="contained"
                    onClick={() => setDrawer({ open: true, category: null })}
                  >
                    {t('catalog.categories.new')}
                  </Button>
                ) : undefined
              }
            />
          )}

          {!categories.isPending && !categories.isError && visible.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('catalog.field.name')}</TableCell>
                  <TableCell>{t('catalog.field.slug')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.rows.map(({ category, depth, path }) => (
                  <TableRow key={category.id} hover>
                    <TableCell sx={{ fontWeight: depth === 0 ? 700 : 600 }}>
                      {/* La sangría es el árbol. Se hace con relleno y no con
                          guiones en el texto: un nombre con prefijos deja de
                          poder buscarse y de poder copiarse. */}
                      <Box
                        sx={{
                          pl: depth * 3,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                          minWidth: 0,
                        }}
                      >
                        {depth > 0 && (
                          <SubdirectoryArrowRightRoundedIcon
                            aria-hidden
                            sx={{ fontSize: 16, color: 'var(--muted)', flexShrink: 0 }}
                          />
                        )}
                        <span title={path}>{category.name}</span>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: 'var(--muted)' }}>{category.slug}</TableCell>
                    <TableCell>
                      <StatusChip
                        tone={category.is_active ? 'success' : 'default'}
                        label={t(
                          category.is_active
                            ? 'catalog.categories.active'
                            : 'catalog.categories.inactive',
                        )}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <RowActions
                        actions={[
                          {
                            id: '0',
                            icon: <EditRoundedIcon fontSize="small" />,
                            label: t('common.edit'),
                            tone: 'neutral',
                            onClick: () => setDrawer({ open: true, category }),
                          },
                          {
                            id: '1',
                            icon: category.is_active ? <ToggleOffRoundedIcon fontSize="small" /> : <ToggleOnRoundedIcon fontSize="small" />,
                            label: t(
                                category.is_active
                                  ? 'catalog.categories.deactivate'
                                  : 'catalog.categories.activate',
                              ),
                            tone: category.is_active ? 'danger' : 'accent',
                            disabled: !(canWrite) || toggleActive.isPending,
                            onClick: () => void onToggleActive(category),
                          },
                          {
                            id: '2',
                            icon: <DeleteRoundedIcon fontSize="small" />,
                            label: t('common.delete'),
                            tone: 'danger',
                            disabled: !(canWrite),
                            onClick: () => setDeleteTarget(category),
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
      </Stack>

      <CategoryDrawer
        open={drawer.open}
        category={drawer.category}
        categories={categories.data ?? []}
        organizationId={tenant.organization_id}
        companyId={activeCompanyId}
        storeId={storeId}
        canWrite={canWrite}
        onClose={() => setDrawer({ open: false, category: null })}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        title={t('catalog.delete.title')}
        entityName={deleteTarget?.name ?? ''}
        isLoadingUsage={usage.isPending && Boolean(deleteTarget)}
        usageError={usage.isError ? t(errorKeyOf(usage.error)) : null}
        usage={[
          { label: t('catalog.delete.usage.products'), count: usage.data?.products ?? 0 },
          { label: t('catalog.delete.usage.children'), count: usage.data?.children ?? 0 },
        ]}
        safeActionLabel={
          deleteTarget?.is_active ? t('catalog.categories.deactivate') : undefined
        }
        safeActionHint={t('catalog.delete.deactivateHint')}
        onSafeAction={() => {
          if (!deleteTarget) return
          void onToggleActive(deleteTarget)
          setDeleteTarget(null)
        }}
        onDelete={() => void onDelete()}
        onClose={() => setDeleteTarget(null)}
        isBusy={removeCategory.isPending || toggleActive.isPending}
      />
    </>
  )
}
