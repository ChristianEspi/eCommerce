import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded'
import {
  Card,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useI18n } from '@/shared/i18n/i18n-context'
import { termLabel } from '@/shared/i18n/codeLabels'
import { useForecasts } from './hooks'

/**
 * Previsión de demanda: cuánto se espera vender, por producto y periodo.
 *
 * Es una pantalla de LECTURA: la previsión la produce un modelo en el servidor,
 * no una persona escribiendo cifras. Dejar editarla convertiría la previsión en
 * un deseo, y entonces medir el error del modelo dejaría de significar nada.
 *
 * La confianza sale al lado de la cifra. Una previsión de 400 unidades con un
 * 30 % de confianza y otra con un 90 % son decisiones distintas, y sin ese
 * número las dos se leen igual.
 */
export function ForecastsSection() {
  const { t } = useI18n()
  const query = useForecasts()

  const filas = query.data ?? []
  const isEmpty = !query.isPending && !query.isError && filas.length === 0
  const pager = usePagedRows(filas)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('planning.forecasts.help')}</Typography>

      <Card>
        {query.isPending && <TableSkeleton columns={5} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={t('planning.forecasts.empty')}
            description={t('planning.forecasts.emptyBody')}
            icon={<QueryStatsRoundedIcon fontSize="small" />}
          />
        )}

        {!query.isPending && !query.isError && filas.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('planning.field.product')}</TableCell>
                <TableCell>{t('planning.field.period')}</TableCell>
                <TableCell align="right">{t('planning.field.forecast')}</TableCell>
                <TableCell align="right">{t('planning.field.confidence')}</TableCell>
                <TableCell>{t('planning.field.model')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.product_name ?? '—'}</TableCell>
                  <TableCell>{`${row.period_start} → ${row.period_end}`}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>
                    {row.forecast_quantity}
                  </TableCell>
                  {/* Sin la confianza, un 400 flojo y un 400 sólido se leen
                      igual, y son decisiones distintas. */}
                  <TableCell align="right">
                    {row.confidence === null
                      ? '—'
                      : `${(Number(row.confidence) * 100).toFixed(0)} %`}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    <span title={row.model_code}>{termLabel(t, 'model', row.model_code)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

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
  )
}
