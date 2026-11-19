import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import {
  Box,
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
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { FilterBar } from '@/shared/ui/FilterBar'
import { SearchField } from '@/shared/ui/SearchField'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useArReceipts } from './hooks'

/**
 * Cobros (2026-11-17): lo que ya entró, del más reciente al más antiguo. Los
 * «PED-…» los creó el sistema al marcar un pedido como pagado en Pedidos.
 */
export function ReceiptsSection() {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const query = useArReceipts()

  const recibos = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (r) =>
        r.receipt_number.toLowerCase().includes(term) ||
        (r.customer_name ?? '').toLowerCase().includes(term) ||
        (r.reference ?? '').toLowerCase().includes(term),
    )
  }, [query.data, search])
  const pager = usePagedRows(recibos)

  const metodo = (value: string | null) => {
    if (!value) return '—'
    const key = `credit.method.${value}`
    const out = t(key as MessageKey)
    return out === key ? value : out
  }

  return (
    <Stack spacing={2}>
      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 320 } }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('credit.receipts.search')}
            ariaLabel={t('credit.receipts.search')}
          />
        </Box>
      </FilterBar>
      <Card>
        {query.isPending && <TableSkeleton columns={5} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {!query.isPending && !query.isError && recibos.length === 0 && (
          <EmptyState
            title={search ? t('credit.noResults') : t('credit.receipts.empty')}
            description={search ? undefined : t('credit.receipts.emptyBody')}
            icon={<PaymentsRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && recibos.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('credit.field.receiptNumber')}</TableCell>
                  <TableCell>{t('credit.field.customer')}</TableCell>
                  <TableCell>{t('credit.field.receivedAt')}</TableCell>
                  <TableCell>{t('credit.field.method')}</TableCell>
                  <TableCell align="right">{t('credit.field.amount')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{r.receipt_number}</Typography>
                      {r.reference && (
                        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{r.reference}</Typography>
                      )}
                    </TableCell>
                    <TableCell>{r.customer_name ?? '—'}</TableCell>
                    <TableCell>{r.received_at}</TableCell>
                    <TableCell>{metodo(r.method)}</TableCell>
                    <TableCell align="right" className="tnum" sx={{ fontWeight: 800 }}>
                      {formatMoney(Number(r.amount), r.currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
        {pager.total > 0 && (
          <TablePager page={pager.page} pageSize={pager.pageSize} total={pager.total} onPageChange={pager.setPage} />
        )}
      </Card>
    </Stack>
  )
}
