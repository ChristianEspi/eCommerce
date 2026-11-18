import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { codeLabel, termLabel } from '@/shared/i18n/codeLabels'
import { formatDateTime } from '@/shared/lib/format'
import { SearchField } from '@/shared/ui/SearchField'
import { EmptyState, ErrorState, UnauthorizedState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { Field } from '@/shared/ui/Field'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { isForbidden } from './errors'
import { useIncidents, useResolveIncident } from './hooks'
import type { Incident } from './types'

/**
 * Incidentes operativos: checkout, cobro e integración fallidos, hechos no
 * entregados, webhooks rechazados y operaciones lentas.
 *
 * Un buscador general único y tabs de estado (regla de suite §8): nada de
 * paneles de filtros multi-campo. Lo que se busca es un código, una operación o
 * —el caso que importa— un correlation id: el que un comprador pegó en un
 * correo de queja.
 *
 * ## Atender exige un motivo
 *
 * `ops_resolve_event` rechaza una nota vacía. Cerrar un incidente sin decir qué
 * se hizo con él produce el tablero en el que todo está resuelto y nadie sabe
 * por qué; la nota es lo que convierte «lo cerré» en «se arregló».
 */

function severityColor(severity: string): 'error' | 'warning' | 'default' {
  if (severity === 'critical' || severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  return 'default'
}

export function IncidentsSection({ onTrace }: { onTrace: (correlationId: string) => void }) {
  const { t, locale } = useI18n()
  const [status, setStatus] = useState<'open' | 'resolved' | ''>('open')
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const [target, setTarget] = useState<Incident | null>(null)
  const [note, setNote] = useState('')

  const incidents = useIncidents({ status, term: debounced })
  const resolve = useResolveIncident()

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows((incidents.data ?? []))

  if (isForbidden(incidents.error)) {
    return <UnauthorizedState title={t('ops.error.forbidden')} description={t('ops.forbiddenBody')} />
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <Tabs
        value={status}
        onChange={(_, value: 'open' | 'resolved' | '') => setStatus(value)}
        aria-label={t('ops.incidents.filter')}
      >
        <Tab value="open" label={t('ops.incidents.open')} />
        <Tab value="resolved" label={t('ops.incidents.resolved')} />
        <Tab value="" label={t('ops.incidents.all')} />
      </Tabs>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('ops.incidents.search')}
            ariaLabel={t('ops.incidents.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {incidents.isPending ? (
          <TableSkeleton columns={5} />
        ) : incidents.isError ? (
          <ErrorState error={incidents.error} onRetry={() => void incidents.refetch()} />
        ) : (incidents.data ?? []).length === 0 ? (
          <EmptyState
            title={t('ops.incidents.empty')}
            description={t('ops.incidents.emptyBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.date')}</TableCell>
                <TableCell>{t('ops.incidents.kind')}</TableCell>
                <TableCell>{t('ops.incidents.code')}</TableCell>
                <TableCell>{t('ops.incidents.correlation')}</TableCell>
                <TableCell align="right">{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.occurred_at, locale)}</TableCell>
                  <TableCell>
                    <StatusChip tone={severityColor(row.severity)} label={termLabel(t, 'kind', row.kind)} />
                    {row.repeats > 1 && (
                      <Chip
                        size="small"
                        variant="outlined"
                        sx={{ ml: 0.5 }}
                        label={`×${row.repeats}`}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{codeLabel(t, row.code)}</Typography>
                    {row.message && (
                      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                        {row.message}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.correlation_id ? (
                      // Del incidente al RASTRO en un clic. Es el camino que la
                      // Definition of Done describe: se ve que algo falló y se
                      // reconstruye qué pasó antes y después.
                      <Button size="small" onClick={() => onTrace(row.correlation_id as string)}>
                        {t('ops.incidents.trace')}
                      </Button>
                    ) : (
                      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {row.is_open ? (
                      <Button
                        size="small"
                        onClick={() => {
                          setTarget(row)
                          setNote('')
                        }}
                      >
                        {t('ops.incidents.resolve')}
                      </Button>
                    ) : (
                      <StatusChip label={t('ops.incidents.resolved')} />
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

      <Dialog open={target !== null} onClose={() => setTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('ops.incidents.resolveTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'var(--muted)', mb: 2 }}>
            {t('ops.incidents.resolveBody')}
          </Typography>
          <Field
            autoFocus
            fullWidth
            multiline
            minRows={2}
            rule="longText"
            maxLength={1000}
            label={t('ops.incidents.note')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={note.trim().length < 3 || resolve.isPending}
            onClick={() => {
              if (!target) return
              resolve.mutate(
                { id: target.id, note: note.trim() },
                { onSuccess: () => setTarget(null) },
              )
            }}
          >
            {t('ops.incidents.resolve')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
