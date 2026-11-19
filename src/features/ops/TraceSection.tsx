import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
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
import { useI18n } from '@/shared/i18n/i18n-context'
import { entityLabel, summaryLabel, termLabel } from '@/shared/i18n/codeLabels'
import { formatDateTime } from '@/shared/lib/format'
import { SearchField } from '@/shared/ui/SearchField'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { isForbidden } from './errors'
import { useTrace } from './hooks'

/**
 * El RASTRO: todo lo que ocurrió bajo un mismo hilo, en orden.
 *
 * Esta pestaña es la Definition of Done de la fase escrita como pantalla: «un
 * incidente de checkout/integración puede rastrearse end-to-end con correlation
 * id». Se pega el identificador —el que la Edge Function devolvió en la
 * cabecera `x-correlation-id`, el que el comprador tiene en su correo de queja,
 * o el del incidente— y sale la línea de tiempo completa: intento de compra,
 * pedido, cobro, evento de pasarela, entrega, hechos publicados, mensajes al
 * exterior, auditoría, analítica e incidentes.
 *
 * Once tablas y siete dominios en UNA consulta, porque `trace_by_correlation`
 * las une en el servidor. Encadenarlas desde el navegador daría un orden que
 * depende de cuál conteste antes, que es exactamente lo que no se puede
 * permitir cuando lo que se está reconstruyendo es qué pasó primero.
 */

function severityColor(severity: string | null): 'error' | 'warning' | 'default' {
  if (severity === 'critical' || severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  return 'default'
}

export function TraceSection({
  correlationId,
  onCorrelationChange,
}: {
  correlationId: string
  onCorrelationChange: (next: string) => void
}) {
  const { t, locale } = useI18n()
  const trace = useTrace(correlationId)

  if (isForbidden(trace.error)) {
    return <UnauthorizedState title={t('ops.error.forbidden')} description={t('ops.forbiddenBody')} />
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={correlationId}
            onChange={onCorrelationChange}
            placeholder={t('ops.trace.search')}
            ariaLabel={t('ops.trace.search')}
          />
        </Box>
      </FilterBar>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('ops.trace.help')}</Typography>

      <Card>
        {correlationId.trim().length < 8 ? (
          <EmptyState title={t('ops.trace.idle')} description={t('ops.trace.idleBody')} />
        ) : trace.isPending ? (
          <TableSkeleton columns={4} />
        ) : trace.isError ? (
          <ErrorState error={trace.error} onRetry={() => void trace.refetch()} />
        ) : (trace.data ?? []).length === 0 ? (
          <EmptyState title={t('ops.trace.empty')} description={t('ops.trace.emptyBody')} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.date')}</TableCell>
                <TableCell>{t('ops.trace.domain')}</TableCell>
                <TableCell>{t('ops.trace.what')}</TableCell>
                <TableCell align="right">{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(trace.data ?? []).map((step, index) => (
                <TableRow key={`${step.entity_id ?? 'x'}-${index}`}>
                  <TableCell>{formatDateTime(step.occurred_at, locale)}</TableCell>
                  <TableCell>
                    <StatusChip label={termLabel(t, 'domain', step.domain)} />
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                      {entityLabel(t, step.entity_type)}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {summaryLabel(t, step.summary)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {step.status ? (
                      <StatusChip
                        tone={severityColor(step.severity)}
                        label={termLabel(t, 'status', step.status)}
                      />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Stack>
  )
}
