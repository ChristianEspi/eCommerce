import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded'
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { FilterBar } from '@/shared/ui/FilterBar'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useDueCustomers } from './dueCustomers'

/**
 * «Agenda»: a quién llamar hoy. Cada fila dice cada cuánto suele comprar ese
 * cliente y cuántos días lleva sin pedir: el criterio se ve, no se adivina.
 */
export function DueCustomersSection() {
  const { t, locale } = useI18n()
  const query = useDueCustomers()
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (query.data ?? []).filter((r) => !q || r.customer_name.toLowerCase().includes(q))
  }, [query.data, search])

  const days = (n: number) => t('sales.due.days').replace('{n}', n.toLocaleString(locale, { maximumFractionDigits: 0 }))

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('sales.due.help')}</Typography>
      <FilterBar disableGutter>
        <SearchField value={search} onChange={setSearch} placeholder={t('sales.due.search')} />
      </FilterBar>
      {query.isPending ? (
        <TableSkeleton columns={4} />
      ) : query.isError ? (
        <ErrorState title={t('sales.due.error')} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('sales.due.empty')} description={t('sales.due.emptyBody')} icon={<EventRepeatRoundedIcon fontSize="small" />} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('sales.due.col.customer')}</TableCell>
                <TableCell>{t('sales.due.col.pace')}</TableCell>
                <TableCell>{t('sales.due.col.since')}</TableCell>
                <TableCell>{t('sales.due.col.overdue')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.customer_id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {r.customer_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                      {t('sales.due.lastOrder').replace('{date}', new Date(r.last_order_at).toLocaleDateString(locale))}
                    </Typography>
                  </TableCell>
                  <TableCell className="tnum">{t('sales.due.every').replace('{days}', days(r.typical_days))}</TableCell>
                  <TableCell className="tnum">{days(r.days_since)}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={r.overdue_days >= r.typical_days ? 'error' : 'warning'}
                      label={t('sales.due.late').replace('{days}', days(r.overdue_days))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  )
}
