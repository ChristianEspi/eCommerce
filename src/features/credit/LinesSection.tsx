import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import {
  Box,
  Card,
  LinearProgress,
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
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useCreditLines } from './hooks'
import type { CreditLine } from './types'

/**
 * Líneas de crédito (2026-11-17): por cada cuenta empresa, cuánto se le fía,
 * cuánto está usando, cuánto le queda y cuánto tiene vencido.
 *
 * Es la misma cuenta que hace el checkout para aceptar o rechazar una compra a
 * crédito (`ebim.credit_line`), así que lo que se ve aquí es exactamente lo
 * que decide si el comprador puede pagar a crédito.
 */
export function LinesSection({ currency }: { currency: string }) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const query = useCreditLines()

  const lineas = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (line) =>
        line.account_name.toLowerCase().includes(term) || (line.account_code ?? '').toLowerCase().includes(term),
    )
  }, [query.data, search])

  const dinero = (valor: number | null) => (valor === null ? '—' : formatMoney(valor, currency, locale))

  function uso(line: CreditLine) {
    if (!line.limit) return 0
    return Math.min(100, Math.round((line.used / line.limit) * 100))
  }

  function tono(line: CreditLine) {
    if (line.status === 'blocked') return 'error' as const
    if (line.status === 'watch' || line.overdue > 0) return 'warning' as const
    return 'success' as const
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('credit.lines.help')}</Typography>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 320 } }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('credit.lines.search')}
            ariaLabel={t('credit.lines.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={6} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {!query.isPending && !query.isError && lineas.length === 0 && (
          <EmptyState
            title={search ? t('credit.noResults') : t('credit.lines.empty')}
            description={search ? undefined : t('credit.lines.emptyBody')}
            icon={<AccountBalanceWalletRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && lineas.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('credit.lines.account')}</TableCell>
                  <TableCell sx={{ minWidth: 220 }}>{t('credit.lines.usage')}</TableCell>
                  <TableCell align="right">{t('credit.lines.limit')}</TableCell>
                  <TableCell align="right">{t('credit.lines.available')}</TableCell>
                  <TableCell align="right">{t('credit.kpi.overdue')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lineas.map((line) => (
                  <TableRow key={line.account_id} hover>
                    <TableCell>
                      <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{line.account_name}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                        {[line.account_code, t('credit.lines.terms').replace('{n}', String(line.terms_days))]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <LinearProgress
                          variant="determinate"
                          value={uso(line)}
                          aria-label={t('credit.lines.usage')}
                          color={uso(line) >= 90 ? 'error' : uso(line) >= 70 ? 'warning' : 'primary'}
                          sx={{ height: 8, borderRadius: 4 }}
                        />
                        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                          {t('credit.lines.used')
                            .replace('{used}', dinero(line.used))
                            .replace('{pct}', String(uso(line)))}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right" className="tnum">{dinero(line.limit)}</TableCell>
                    <TableCell align="right" className="tnum" sx={{ fontWeight: 800 }}>
                      {dinero(line.available)}
                    </TableCell>
                    <TableCell
                      align="right"
                      className="tnum"
                      sx={{ color: line.overdue > 0 ? 'var(--red)' : undefined, fontWeight: line.overdue > 0 ? 700 : 400 }}
                    >
                      {dinero(line.overdue)}
                    </TableCell>
                    <TableCell>
                      <StatusChip tone={tono(line)} label={t(`credit.lineStatus.${line.status}` as MessageKey)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Card>
    </Stack>
  )
}
