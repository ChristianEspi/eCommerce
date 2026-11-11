import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import {
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
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useSegments } from '@/features/pricing/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { ConfirmDeleteDialog } from '@/shared/ui/ConfirmDeleteDialog'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CustomerDrawer } from './CustomerDrawer'
import { fetchCustomer } from './api'
import { CustomersError } from './errors'
import { useCustomerUsage, useCustomers, useDeleteCustomer, useSaveCustomer } from './hooks'
import { customerToForm, type Customer } from './types'

const PAGE_SIZE = 25

/**
 * Cartera de clientes.
 *
 * Paginación EN EL SERVIDOR desde el primer día, como el PIM: una tienda con un
 * año abierto tiene miles de compradores, y traérselos todos para filtrarlos en
 * memoria rompe justo en el cliente que más lo necesita.
 *
 * Un solo buscador general (§8) que consulta al servidor con retardo: escribir
 * «acme» no puede disparar cuatro consultas.
 */
export function CustomersSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, can } = useTenant()
  const canWrite = can('orders.write')
  const canDelete = can('tenant.manage')

  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [drawer, setDrawer] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)

  const term = useDebouncedValue(search, 300)

  // Cambiar el filtro vuelve a la primera página: quedarse en la 4 de un
  // resultado que ahora tiene una sola es una tabla vacía que se lee como «no
  // hay nada».
  useEffect(() => {
    setPage(0)
  }, [term, activeOnly])

  const query = useCustomers({ term, page, pageSize: PAGE_SIZE, activeOnly })
  const segments = useSegments()
  const remove = useDeleteCustomer()
  const save = useSaveCustomer()
  const usage = useCustomerUsage(deleteTarget?.id ?? null)

  const segmentName = useMemo(
    () => new Map((segments.data ?? []).map((segment) => [segment.id, segment.name])),
    [segments.data],
  )

  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0
  const isEmpty = !query.isPending && !query.isError && rows.length === 0

  function notifyError(error: unknown) {
    notify(t(error instanceof CustomersError ? error.key : 'customers.error.generic'), 'error')
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await remove.mutateAsync(deleteTarget.id)
      notify(t('customers.toast.deleted'))
      setDeleteTarget(null)
    } catch (error) {
      notifyError(error)
    }
  }

  /** Desactivar conserva la ficha, sus direcciones y su historial (§4.2). */
  async function onDeactivate() {
    if (!deleteTarget || !tenant || !activeCompanyId) return
    try {
      await save.mutateAsync({
        id: deleteTarget.id,
        scope: { organizationId: tenant.organization_id, companyId: activeCompanyId },
        values: { ...customerToForm(deleteTarget), is_active: false },
      })
      notify(t('customers.toast.deactivated'))
      setDeleteTarget(null)
    } catch (error) {
      notifyError(error)
    }
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.list.help')}</Typography>

      <FilterBar
        actions={
          canWrite && (
            <Button variant="contained" onClick={() => setDrawer({ open: true, customer: null })}>
              {t('customers.new')}
            </Button>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('customers.search')} />
        </Box>
        <FormControlLabel
          control={
            <Switch checked={activeOnly} onChange={(_, checked) => setActiveOnly(checked)} />
          }
          label={t('customers.filter.activeOnly')}
        />
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={6} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('customers.noResults') : t('customers.list.empty')}
            description={search ? undefined : t('customers.list.emptyBody')}
            icon={<PeopleAltRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && rows.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('customers.field.code')}</TableCell>
                <TableCell>{t('customers.field.name')}</TableCell>
                <TableCell>{t('customers.field.kind')}</TableCell>
                <TableCell>{t('customers.field.segment')}</TableCell>
                <TableCell>{t('customers.field.email')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((customer) => (
                <TableRow key={customer.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{customer.code}</TableCell>
                  <TableCell>{customer.name}</TableCell>
                  <TableCell>
                    <StatusChip label={t(`customers.kind.${customer.kind}`)} />
                  </TableCell>
                  <TableCell>
                    {customer.segment_id ? (segmentName.get(customer.segment_id) ?? '—') : '—'}
                  </TableCell>
                  <TableCell>{customer.email ?? '—'}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={customer.is_active ? 'success' : 'default'}
                      label={customer.is_active ? t('customers.field.active') : t('common.no')}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: `${t('common.edit')}: ${customer.name}`,
                          tone: 'neutral',
                          onClick: () => setDrawer({ open: true, customer }),
                        },
                        {
                          id: '1',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: `${t('common.delete')}: ${customer.name}`,
                          tone: 'danger',
                          disabled: !(canDelete),
                          onClick: () => setDeleteTarget(customer),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!query.isError && total > 0 && (
          <TablePager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        )}
      </Card>

      <CustomerDrawer
        open={drawer.open}
        customer={drawer.customer}
        canWrite={canWrite}
        scope={
          tenant && activeCompanyId
            ? { organizationId: tenant.organization_id, companyId: activeCompanyId }
            : null
        }
        onClose={() => setDrawer({ open: false, customer: null })}
        // Antes el alta se quedaba en «Nuevo cliente», sin las pestañas de
        // contactos y direcciones que su propio subtítulo promete.
        onCreated={(id) => {
          void fetchCustomer(id)
            .then((created) => setDrawer({ open: true, customer: created }))
            .catch(() => setDrawer({ open: false, customer: null }))
        }}
      />

      {/* El conteo es REAL y sale del servidor (contrato §4.2). Los pedidos se
          cuentan y NO se borran: un pedido es un hecho contable, y saber que
          quedan cinco sin ficha detrás es justo lo que hace dudar antes de
          borrar. La alternativa segura —desactivar— es el botón primario. */}
      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        title={t('customers.delete.title')}
        entityName={deleteTarget?.name ?? ''}
        isLoadingUsage={usage.isPending && Boolean(deleteTarget)}
        usageError={usage.isError ? t('customers.error.generic') : null}
        usage={[
          { label: t('customers.tab.addresses'), count: usage.data?.addresses ?? 0 },
          { label: t('customers.tab.contacts'), count: usage.data?.contacts ?? 0 },
          { label: t('customers.tab.externalIds'), count: usage.data?.external_ids ?? 0 },
          { label: t('customers.tab.accounts'), count: usage.data?.accounts ?? 0 },
          { label: t('customers.delete.priceAssignments'), count: usage.data?.price_assignments ?? 0 },
          { label: t('customers.delete.orders'), count: usage.data?.orders ?? 0 },
        ]}
        safeActionLabel={deleteTarget?.is_active ? t('customers.delete.deactivate') : undefined}
        safeActionHint={t('customers.delete.hint')}
        onSafeAction={() => void onDeactivate()}
        onDelete={() => void onDelete()}
        onClose={() => setDeleteTarget(null)}
        isBusy={remove.isPending || save.isPending}
      />
    </Stack>
  )
}
