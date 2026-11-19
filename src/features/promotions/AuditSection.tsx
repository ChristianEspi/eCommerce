import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import {
  Card,  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDateTime } from '@/shared/lib/format'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { usePromotionEvents } from './hooks'

/** Los campos que de verdad se miran cuando algo salió mal. El `before/after`
 *  completo está en la fila; enseñarlo entero llenaría la pantalla de ruido. */
const WATCHED = [
  'status',
  'value_percent',
  'value_amount',
  'priority',
  'valid_from',
  'valid_to',
  'usage_limit',
  'is_exclusive',
  'is_active',
] as const

/** Qué cambió, en una línea. Devuelve `null` si nada de lo que se vigila cambió. */
function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string | null {
  if (!before || !after) return null
  const changes = WATCHED.filter(
    (field) => String(before[field] ?? '') !== String(after[field] ?? ''),
  ).map((field) => `${field}: ${String(before[field] ?? '—')} → ${String(after[field] ?? '—')}`)
  return changes.length > 0 ? changes.join(' · ') : null
}

/**
 * La bitácora (regla 8 del encargo: «cambios en una promoción activa deben ser
 * auditables»).
 *
 * Lo que hace que sirva es la columna de ESTADO: no es lo mismo retocar un
 * borrador que subir el porcentaje de algo que se está cobrando ahora mismo, y
 * una bitácora que no distingue las dos cosas obliga a leerla entera.
 *
 * Los datos salen de `promotion_events`, que se escribe **solo por trigger
 * `SECURITY DEFINER`**: no hay policy de INSERT para nadie y tampoco GRANT, así
 * que una fila de aquí no se puede fabricar ni borrar desde el navegador. Esta
 * pantalla solo lee.
 */
export function AuditSection() {
  const { t, locale } = useI18n()
  const { activeStore } = useTenant()
  const events = usePromotionEvents(activeStore?.id ?? null)

  const list = events.data ?? []
  const isEmpty = !events.isPending && !events.isError && list.length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('promotions.audit.help')}</Typography>

      <Card>
        {events.isPending && <TableSkeleton columns={5} />}
        {events.isError && (
          <ErrorState error={events.error} onRetry={() => void events.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={t('promotions.audit.empty')}
            description={t('promotions.audit.emptyBody')}
            icon={<HistoryRoundedIcon fontSize="small" />}
          />
        )}
        {!events.isPending && !events.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.date')}</TableCell>
                <TableCell>{t('promotions.audit.entity')}</TableCell>
                <TableCell>{t('promotions.audit.action')}</TableCell>
                <TableCell>{t('promotions.audit.wasLive')}</TableCell>
                <TableCell>{t('promotions.audit.change')}</TableCell>
                <TableCell>{t('promotions.audit.actor')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{formatDateTime(event.occurred_at, locale)}</TableCell>
                  <TableCell>{t(`promotions.entity.${event.entity}` as MessageKey)}</TableCell>
                  <TableCell>{t(`promotions.auditAction.${event.action}` as MessageKey)}</TableCell>
                  <TableCell>
                    {event.promotion_status === 'active' ? (
                      <StatusChip tone="warning" label={t('promotions.audit.live')} />
                    ) : (
                      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                        {event.promotion_status
                          ? t(`promotions.status.${event.promotion_status}` as MessageKey)
                          : '—'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: 'var(--muted)' }}>
                    {diff(event.before_state, event.after_state) ?? '—'}
                  </TableCell>
                  <TableCell>{event.actor_email ?? t('promotions.audit.server')}</TableCell>
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
