import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
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
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { CustomersImportButton } from './import/CustomersImportDialog'
import { useI18n } from '@/shared/i18n/i18n-context'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { BusinessAccountDrawer } from './BusinessAccountDrawer'
import { useBusinessAccounts } from './hooks'
import type { BusinessAccount } from './types'

/**
 * Cuentas B2B.
 *
 * La cuenta es la ACTIVACIÓN del portal sobre un cliente empresa: no se crea
 * desde cero, se elige a qué cliente se le abre. Por eso el alta pide un
 * cliente existente de tipo empresa en vez de duplicar aquí razón social, RUC y
 * direcciones — que es exactamente el fork de ficha que el principio 2 del
 * contrato prohíbe.
 */
export function BusinessAccountsSection() {
  const { t } = useI18n()
  const { tenant, activeCompanyId, can } = useTenant()
  const canWrite = can('tenant.manage')

  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState<{ open: boolean; account: BusinessAccount | null }>({
    open: false,
    account: null,
  })

  const query = useBusinessAccounts()

  const accounts = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (account) =>
        account.name.toLowerCase().includes(term) || account.code.toLowerCase().includes(term),
    )
  }, [query.data, search])

  const isEmpty = !query.isPending && !query.isError && accounts.length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(accounts)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.accounts.help')}</Typography>

      <FilterBar
        actions={
          canWrite && (
            <Stack direction="row" spacing={1}>
              <CustomersImportButton
                target={{ kind: 'accountUsers', account: null }}
                label="customersImport.action.users"
              />
              <Button variant="contained" onClick={() => setDrawer({ open: true, account: null })}>
                {t('customers.accounts.new')}
              </Button>
            </Stack>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('customers.accounts.search')} />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={5} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('customers.noResults') : t('customers.accounts.empty')}
            description={search ? undefined : t('customers.accounts.emptyBody')}
            icon={<ApartmentRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && accounts.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('customers.field.code')}</TableCell>
                <TableCell>{t('customers.field.name')}</TableCell>
                <TableCell>{t('customers.field.approval')}</TableCell>
                <TableCell>{t('customers.field.purchaseOrder')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((account) => (
                <TableRow key={account.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{account.code}</TableCell>
                  <TableCell>{account.name}</TableCell>
                  <TableCell>
                    {account.requires_approval
                      ? (account.approval_threshold ?? t('customers.approval.always'))
                      : t('common.no')}
                  </TableCell>
                  <TableCell>{account.purchase_order_required ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={account.is_active ? 'success' : 'default'}
                      label={account.is_active ? t('customers.field.active') : t('common.no')}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: `${t('common.edit')}: ${account.name}`,
                          tone: 'neutral',
                          onClick: () => setDrawer({ open: true, account }),
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

      <BusinessAccountDrawer
        open={drawer.open}
        account={drawer.account}
        canWrite={canWrite}
        scope={
          tenant && activeCompanyId
            ? { organizationId: tenant.organization_id, companyId: activeCompanyId }
            : null
        }
        onClose={() => setDrawer({ open: false, account: null })}
        onCreated={(created) => setDrawer({ open: true, account: created })}
      />
    </Stack>
  )
}
