import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
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
import { useMemo } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useInventoryAlerts } from './hooks'
import { compareAlerts, formatQuantity, type AlertKind } from './types'

/**
 * Los avisos, ordenados por lo que de verdad urge.
 *
 * El orden NO es alfabético ni cronológico: un saldo negativo es un descuadre
 * que ya ocurrió y una referencia publicada sin existencia registrada es una
 * venta que no se puede cerrar; las dos pesan más que un umbral que alguien
 * puso por prudencia. La regla vive en `types.ts` como función pura y tiene su
 * propio test, porque una lista de avisos que entierra lo grave debajo de lo
 * leve es peor que no tener lista.
 *
 * `unmapped` es el aviso de la transición: aparece cuando la sociedad ya tiene
 * almacenes y una referencia publicada todavía no tiene fila de existencia en
 * ninguno. Es exactamente el estado en el que una tienda recién migrada dejaría
 * de vender sin que nadie entendiera por qué.
 */
export function AlertsSection() {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const query = useInventoryAlerts(activeStore?.id ?? null)

  const alerts = useMemo(() => [...(query.data ?? [])].sort(compareAlerts), [query.data])
  const isEmpty = !query.isPending && !query.isError && alerts.length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(alerts)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('inventory.alerts.help')}</Typography>

      <Card>
        {query.isPending && <TableSkeleton columns={4} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={t('inventory.alerts.empty')}
            description={t('inventory.alerts.emptyBody')}
            icon={<CheckCircleRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && alerts.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('inventory.field.alert')}</TableCell>
                <TableCell>SKU</TableCell>
                <TableCell>{t('inventory.field.warehouse')}</TableCell>
                <TableCell align="right">{t('inventory.field.available')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((alert) => (
                <TableRow key={`${alert.kind}-${alert.product_id}-${alert.variant_id ?? ''}-${alert.warehouse_id ?? ''}`} hover>
                  <TableCell>
                    <StatusChip
                      tone={severityColor(alert.kind)}
                      label={t(`inventory.alert.${alert.kind}` as MessageKey)}
                    />
                  </TableCell>
                  <TableCell>
                    <Stack>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{alert.sku}</Typography>
                      <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>{alert.name}</Typography>
                      {alert.limiting_component && (
                        <Typography sx={{ color: 'var(--amber)', fontSize: 12 }}>
                          {t('inventory.alert.bundleLimitedBy').replace('{component}', alert.limiting_component)}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{alert.warehouse_code ?? '—'}</TableCell>
                  <TableCell align="right">
                    {alert.available_qty == null ? '—' : formatQuantity(alert.available_qty)}
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

function severityColor(kind: AlertKind): 'error' | 'warning' | 'info' {
  if (kind === 'negative' || kind === 'unmapped') return 'error'
  if (kind === 'stale') return 'info'
  return 'warning'
}
