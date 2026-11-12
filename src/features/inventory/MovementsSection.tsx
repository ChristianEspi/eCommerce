import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import {
  Box,
  Button,
  Card,
  MenuItem,
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
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDateTime } from '@/shared/lib/format'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import {
  useCommitReservation,
  useMovements,
  useReleaseReservation,
  useReservations,
  useWarehouses,
} from './hooks'
import { formatQuantity } from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * El libro mayor y lo comprometido, uno debajo del otro.
 *
 * Van juntos porque responden a la misma pregunta desde dos lados: «¿por qué
 * tengo esta cifra?» la contesta el movimiento, y «¿por qué no puedo vender lo
 * que veo?» la contesta la reserva. Separarlos deja al operador saltando entre
 * pestañas para reconstruir un mismo día.
 *
 * Los movimientos NO se editan ni se borran: no hay botón porque no hay policy.
 * Una corrección es un asiento nuevo.
 */
export function MovementsSection() {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, can } = useTenant()
  const canWrite = can('orders.write')

  const [warehouseId, setWarehouseId] = useState('')

  const warehouses = useWarehouses()
  const query = useMovements(activeStore?.id ?? null, warehouseId || null)
  const reservations = useReservations(activeStore?.id ?? null)
  const release = useReleaseReservation()
  const commit = useCommitReservation()

  const warehouseCode = useMemo(
    () => new Map((warehouses.data ?? []).map((w) => [w.id, w.code])),
    [warehouses.data],
  )

  const isEmpty = !query.isPending && !query.isError && (query.data ?? []).length === 0
  const held = (reservations.data ?? []).filter((r) => r.status === 'held')

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows((query.data ?? []))

  return (
    <Stack spacing={3}>
      <Stack spacing={2}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('inventory.movements.help')}</Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Box sx={{ flex: 1 }} />
          <SelectField
            size="small"
            label={t('inventory.field.warehouse')}
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{t('inventory.field.allWarehouses')}</MenuItem>
            {(warehouses.data ?? []).map((warehouse) => (
              <MenuItem key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </MenuItem>
            ))}
          </SelectField>
        </Stack>

        <Card>
          {query.isPending && <TableSkeleton columns={5} />}
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          {isEmpty && (
            <EmptyState
              title={t('inventory.movements.empty')}
              description={t('inventory.movements.emptyBody')}
              icon={<HistoryRoundedIcon fontSize="small" />}
            />
          )}
          {!query.isPending && !query.isError && (query.data ?? []).length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.date')}</TableCell>
                  <TableCell>{t('inventory.field.warehouse')}</TableCell>
                  <TableCell>{t('inventory.field.movementKind')}</TableCell>
                  <TableCell align="right">{t('inventory.field.quantity')}</TableCell>
                  <TableCell align="right">{t('inventory.field.onHandAfter')}</TableCell>
                  <TableCell>{t('inventory.field.reason')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.rows.map((movement) => (
                  <TableRow key={movement.id} hover>
                    <TableCell>{formatDateTime(movement.occurred_at, locale)}</TableCell>
                    <TableCell>{warehouseCode.get(movement.warehouse_id) ?? '—'}</TableCell>
                    <TableCell>
                      <StatusChip
                        label={t(`inventory.movement.${movement.kind}` as MessageKey)}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {movement.quantity > 0 ? '+' : ''}
                      {formatQuantity(movement.quantity)}
                    </TableCell>
                    <TableCell align="right">{formatQuantity(movement.on_hand_after)}</TableCell>
                    <TableCell sx={{ color: 'var(--muted)', fontSize: 12 }}>
                      {movement.reason ??
                        (movement.reference_kind
                          ? t(`inventory.reference.${movement.reference_kind}` as MessageKey)
                          : '—')}
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

      <Stack spacing={2}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800 }}>
          {t('inventory.reservations.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)' }}>{t('inventory.reservations.help')}</Typography>

        <Card>
          {reservations.isPending && <TableSkeleton columns={4} />}
          {!reservations.isPending && held.length === 0 && (
            <EmptyState title={t('inventory.reservations.empty')} />
          )}
          {held.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.field.reference')}</TableCell>
                  <TableCell>{t('inventory.field.expires')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {held.map((reservation) => (
                  <TableRow key={reservation.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{reservation.reference_key}</TableCell>
                    <TableCell>{formatDateTime(reservation.expires_at, locale)}</TableCell>
                    <TableCell>
                      <StatusChip
                        tone="warning"
                        label={t(`inventory.reservation.${reservation.status}` as MessageKey)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          disabled={!canWrite}
                          onClick={async () => {
                            await release.mutateAsync({ id: reservation.id })
                            notify(t('inventory.toast.released'))
                          }}
                          aria-label={`${t('inventory.reservations.release')}: ${reservation.reference_key}`}
                        >
                          {t('inventory.reservations.release')}
                        </Button>
                        <Button
                          size="small"
                          disabled={!canWrite}
                          onClick={async () => {
                            await commit.mutateAsync({ id: reservation.id })
                            notify(t('inventory.toast.committed'))
                          }}
                          aria-label={`${t('inventory.reservations.commit')}: ${reservation.reference_key}`}
                        >
                          {t('inventory.reservations.commit')}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </Stack>
    </Stack>
  )
}
