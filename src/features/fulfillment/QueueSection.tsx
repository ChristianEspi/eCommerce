import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import {
  Box,
  Button,
  Card,
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
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import { FulfillmentError } from './errors'
import { FulfillmentDrawer } from './FulfillmentDrawer'
import { useFulfillments, useTransitionFulfillment } from './hooks'
import { siguientePaso, type FulfillmentRow, type FulfillmentState } from './types'

/**
 * Los estados que la cola ofrece como pestaña.
 *
 * NO son los nueve del enum. Un filtro por cada estado posible es una fila de
 * pestañas que nadie lee; estos cuatro son las preguntas que una persona de
 * operaciones se hace de verdad al abrir la pantalla: qué hay sin preparar, qué
 * está listo, qué va en camino y qué salió mal.
 */
const TABS: ReadonlyArray<{ id: string; label: MessageKey }> = [
  { id: '', label: 'fulfillment.tab.all' },
  { id: 'pending', label: 'fulfillment.state.pending' },
  { id: 'ready', label: 'fulfillment.state.ready' },
  { id: 'in_transit', label: 'fulfillment.state.in_transit' },
  { id: 'failed', label: 'fulfillment.state.failed' },
]

const TONE: Record<FulfillmentState, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  pending: 'default',
  allocated: 'info',
  picking: 'info',
  packed: 'info',
  ready: 'warning',
  in_transit: 'info',
  delivered: 'success',
  failed: 'error',
  cancelled: 'default',
}

/**
 * La cola de preparación: qué hay que despachar y en qué punto está.
 *
 * Un solo buscador general y pestañas de estado (regla de suite §8): ni panel
 * de filtros multi-campo, ni un selector por columna. El buscador cubre las
 * tres cosas por las que se busca una entrega —número de pedido, correo del
 * comprador y guía— y lo hace en el SERVIDOR, no filtrando en memoria una
 * página que ya vino recortada.
 *
 * ## La acción del paso siguiente vive en la FILA
 *
 * Antes no: todas estaban en el detalle, con el argumento de que un botón
 * «entregar» al final de una tabla es la forma más rápida de entregarlo en la
 * fila equivocada. El argumento sigue siendo bueno para las acciones que
 * DECIDEN algo —anular, marcar incidencia, abrir guía— y esas siguen dentro.
 *
 * Lo que se movió fuera es lo que no decide nada: el paso siguiente, que es
 * uno solo y lo dice la máquina. Recorrer una entrega de recojo costaba cinco
 * veces «abrir, elegir en un desplegable de seis destinos, pulsar Mover,
 * cerrar», y ese desplegable no protegía de nada: seguía siendo la fila en la
 * que se hizo clic. El botón dice el paso por su nombre —«Marcar lista»— en vez
 * de obligar a traducir un estado a una acción.
 */
export function QueueSection() {
  const { t, locale } = useI18n()
  const { activeStore } = useTenant()
  const [state, setState] = useState('')
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  /**
   * Se guarda el ID, no la fila.
   *
   * Guardar el objeto lo congelaba: al mover una entrega, la lista se
   * refrescaba y el cajón abierto seguía enseñando el estado viejo y ofreciendo
   * las acciones del estado viejo. El operador movía, no veía cambiar nada y
   * volvía a pulsar. Derivarlo de la lista hace que el cajón se actualice con
   * ella, que es lo que cualquiera espera de una pantalla que acaba de actuar.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filter = { storeId: activeStore?.id ?? null, state, term: debounced }
  const queue = useFulfillments(filter)
  const list = queue.data ?? []
  const selected = list.find((row) => row.fulfillment_id === selectedId) ?? null
  const isEmpty = !queue.isPending && !queue.isError && list.length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('fulfillment.queue.help')}</Typography>

      <Tabs
        value={state}
        onChange={(_event, next: string) => setState(next)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={t('fulfillment.queue.filter')}
      >
        {TABS.map((tab) => (
          <Tab key={tab.id || 'todas'} value={tab.id} label={t(tab.label)} />
        ))}
      </Tabs>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder={t('fulfillment.queue.search')}
            ariaLabel={t('fulfillment.queue.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {queue.isPending && <TableSkeleton columns={6} />}
        {queue.isError && <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />}
        {isEmpty && (
          /* El título nombra la TIENDA activa. Sin eso, mirar la tienda
             equivocada se lee como «nadie ha comprado todavía», que es una
             conclusión distinta y falsa. */
          <EmptyState
            title={
              activeStore
                ? `${t('fulfillment.queue.emptyIn')} ${activeStore.name}`
                : t('fulfillment.queue.empty')
            }
            description={t('fulfillment.queue.emptyBody')}
            icon={<LocalShippingRoundedIcon fontSize="small" />}
          />
        )}
        {!queue.isPending && !queue.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('fulfillment.field.order')}</TableCell>
                <TableCell>{t('fulfillment.field.method')}</TableCell>
                <TableCell>{t('fulfillment.field.origin')}</TableCell>
                <TableCell align="right">{t('fulfillment.field.units')}</TableCell>
                <TableCell align="right">{t('fulfillment.field.shippingCost')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow
                  key={row.fulfillment_id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setSelectedId(row.fulfillment_id)}
                >
                  <TableCell>
                    <Stack>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {row.order_number}
                        {row.sequence > 1 ? ` · ${row.sequence}` : ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                        {row.customer_email}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack>
                      <Typography variant="body2">{row.method_name}</Typography>
                      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                        {t(`fulfillment.strategy.${row.strategy}` as MessageKey)}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {row.pickup_point_name ?? row.warehouse_code ?? (
                      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                        {t('fulfillment.field.noOrigin')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{row.unit_count}</TableCell>
                  <TableCell align="right">
                    {formatMoney(Number(row.shipping_cost), row.currency, locale)}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <StatusChip
                        tone={TONE[row.state]}
                        label={t(`fulfillment.state.${row.state}` as MessageKey)}
                      />
                      {/* Se llegó tarde. Lo calcula la vista comparando la
                          promesa con hoy: dos fechas que viven juntas en la
                          entrega, no una resta hecha en el navegador. */}
                      {row.is_late && (
                        <StatusChip tone="error" label={t('fulfillment.field.late')} />
                      )}
                      {/* Solo cuando FALTA cobrar. Un «Cobrado» en cada fila es
                          ruido; lo que cambia lo que se hace con el paquete es
                          lo contrario, y por eso solo aparece eso. */}
                      {row.payment_status !== 'paid' && (
                        <StatusChip tone="warning" label={t('fulfillment.detail.unpaid')} />
                      )}
                    </Stack>
                  </TableCell>
                  {/* El clic de la acción NO abre el cajón: son dos intenciones
                      distintas sobre la misma fila. */}
                  <TableCell align="right" onClick={(evento) => evento.stopPropagation()}>
                    <PasoSiguiente row={row} />
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

      <FulfillmentDrawer fulfillment={selected} onClose={() => setSelectedId(null)} />
    </Stack>
  )
}

/**
 * El paso siguiente de una entrega, como un botón que lo dice por su nombre.
 *
 * Solo aparece cuando hay UN paso obvio: en `failed` y en los estados
 * terminales devuelve `null` y la celda queda vacía, porque una incidencia se
 * resuelve mirándola y no avanzándola a ciegas.
 *
 * La transición la sigue validando el trigger de la base. Que el botón ofrezca
 * el paso correcto es una comodidad, igual que el desplegable del detalle.
 */
function PasoSiguiente({ row }: { row: FulfillmentRow }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { can } = useTenant()
  const transition = useTransitionFulfillment()

  const destino = siguientePaso(row.state, row.strategy)
  if (!destino || !can('orders.write')) return null

  return (
    <Button
      size="small"
      variant="outlined"
      disabled={transition.isPending}
      onClick={() => {
        void transition
          .mutateAsync({ fulfillmentId: row.fulfillment_id, to: destino, reason: '' })
          .then(() => notify(t('fulfillment.action.moved'), 'success'))
          .catch((error: unknown) => {
            const key: MessageKey =
              error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic'
            notify(t(key), 'error')
          })
      }}
    >
      {t(`fulfillment.next.${destino}` as MessageKey)}
    </Button>
  )
}
