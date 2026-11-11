import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import SellRoundedIcon from '@mui/icons-material/SellRounded'
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
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDate } from '@/shared/lib/format'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { PriceListDrawer } from './PriceListDrawer'
import { usePriceLists } from './hooks'
import { validityOf, type PriceList, type Validity } from './types'

/**
 * Las listas de la tienda activa, ordenadas como las mira el motor: primero la
 * prioridad, y a igualdad el código.
 */
const VALIDITY_COLOR: Record<Validity, 'success' | 'info' | 'warning' | 'default'> = {
  active: 'success',
  scheduled: 'info',
  expired: 'warning',
  off: 'default',
}

export function PriceListsSection() {
  const { t, locale } = useI18n()
  const { activeStore, can } = useTenant()
  const canWrite = can('catalog.write')

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ open: boolean; list: PriceList | null }>({
    open: false,
    list: null,
  })

  const query = usePriceLists(activeStore?.id ?? null)

  const lists = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (list) =>
        list.name.toLowerCase().includes(term) ||
        list.code.toLowerCase().includes(term) ||
        list.currency.toLowerCase().includes(term),
    )
  }, [query.data, search])

  const isEmpty = !query.isPending && !query.isError && lists.length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(lists)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('pricing.lists.help')}</Typography>

      <FilterBar
        actions={
          canWrite && (
            <Button variant="contained" onClick={() => setEditing({ open: true, list: null })}>
              {t('pricing.lists.new')}
            </Button>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('pricing.search')} />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={5} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('pricing.noResults') : t('pricing.lists.empty')}
            description={search ? undefined : t('pricing.lists.emptyBody')}
            icon={<SellRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && lists.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('pricing.field.code')}</TableCell>
                <TableCell>{t('pricing.field.name')}</TableCell>
                <TableCell>{t('pricing.field.currency')}</TableCell>
                <TableCell align="right">{t('pricing.field.priority')}</TableCell>
                <TableCell>{t('pricing.field.validity')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((list) => {
                const validity = validityOf(list)
                return (
                  <TableRow key={list.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{list.code}</TableCell>
                    <TableCell>{list.name}</TableCell>
                    <TableCell>{list.currency}</TableCell>
                    <TableCell align="right">{list.priority}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <StatusChip
                          tone={VALIDITY_COLOR[validity]}
                          label={t(`pricing.validity.${validity}`)}
                        />
                        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                          {formatDate(list.valid_from, locale)}
                          {list.valid_to ? ` → ${formatDate(list.valid_to, locale)}` : ''}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <RowActions
                        actions={[
                          {
                            id: '0',
                            icon: <EditRoundedIcon fontSize="small" />,
                            label: `${t('common.edit')}: ${list.name}`,
                            tone: 'neutral',
                            onClick: () => setEditing({ open: true, list }),
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

      <PriceListDrawer
        open={editing.open}
        list={editing.list}
        canWrite={canWrite}
        onClose={() => setEditing({ open: false, list: null })}
        onCreated={(created) => setEditing({ open: true, list: created })}
      />
    </Stack>
  )
}
