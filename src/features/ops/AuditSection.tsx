import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
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
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { entityLabel, eventLabel, roleLabel, termLabel } from '@/shared/i18n/codeLabels'
import { formatDateTime } from '@/shared/lib/format'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { SearchField } from '@/shared/ui/SearchField'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { isForbidden } from './errors'
import { useAuditLog } from './hooks'

/**
 * Auditoría: quién hizo qué, cuándo y con qué hilo.
 *
 * Solo lectura, y no por decisión de esta pantalla: `audit_log` rechaza UPDATE y
 * DELETE con un trigger, incluso para `service_role`. No hay botón de editar
 * porque no hay operación que ese botón pudiera invocar.
 *
 * La lista es de `owner` y `admin` —la policy lo impone— porque lleva dentro el
 * correo de cada operador y el rastro de las decisiones comerciales.
 *
 * ## La columna que casi nunca tendrá nada
 *
 * `cross_tenant` marca a quien actuó con un JWT de OTRA organización. Hoy ningún
 * camino de esta aplicación lo permite, así que la columna estará vacía siempre;
 * se pinta igualmente, y en rojo, porque el día que aparezca una fila marcada es
 * el día en que hay que mirarla.
 */
export function AuditSection() {
  const { t, locale } = useI18n()
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const entries = useAuditLog(debounced)

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows((entries.data ?? []))

  if (isForbidden(entries.error)) {
    return <UnauthorizedState title={t('ops.error.forbidden')} description={t('ops.forbiddenBody')} />
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('ops.audit.search')}
            ariaLabel={t('ops.audit.search')}
          />
        </Box>
      </FilterBar>
      <Card>
        {entries.isPending ? (
          <TableSkeleton columns={4} />
        ) : entries.isError ? (
          <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
        ) : (entries.data ?? []).length === 0 ? (
          <EmptyState title={t('ops.audit.empty')} description={t('ops.audit.emptyBody')} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.date')}</TableCell>
                <TableCell>{t('ops.audit.actor')}</TableCell>
                <TableCell>{t('ops.audit.action')}</TableCell>
                <TableCell>{t('ops.audit.entity')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.occurred_at, locale)}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13 }}>{row.actor_email ?? '—'}</Typography>
                    <Stack direction="row" sx={{ gap: 0.5, mt: 0.5 }}>
                      <StatusChip label={termLabel(t, 'actor', row.actor_kind)} />
                      {row.actor_role && (
                        <StatusChip label={roleLabel(t, row.actor_role)} />
                      )}
                      {row.cross_tenant && (
                        <StatusChip tone="error" label={t('ops.audit.crossTenant')} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{eventLabel(t, row.action)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13 }}>{row.entity_label ?? entityLabel(t, row.entity_type)}</Typography>
                    {row.correlation_id && (
                      <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                        {row.correlation_id}
                      </Typography>
                    )}
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
  )
}
