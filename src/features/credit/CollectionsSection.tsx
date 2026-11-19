import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  Button,
  Card,
  IconButton,
  Link,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { FilterBar } from '@/shared/ui/FilterBar'
import { MetricCard } from '@/shared/ui/MetricCard'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { ReceiptDrawer } from './ReceiptDrawer'
import { CreditCustomerAiDrawer } from './ai/CreditAiSection'
import { useArDocuments } from './hooks'
import { daysOverdue, type ArDocument } from './types'

/**
 * Cobranza: quién debe, cuánto y desde cuándo.
 *
 * 2026-11-17 · Las deudas de los pedidos a crédito nacen solas (al confirmar
 * el pedido), se saldan con «Cobrar» —y el pedido pasa a pagado— y se anulan
 * si el pedido se cancela. Esta pantalla enseña ese ciclo entero:
 *
 *   · arriba, cuatro cifras para saber de un vistazo cuánto falta y qué urge;
 *   · pestañas por estado (pendiente, vencido, pagado, anulado) en vez de un
 *     botón «ver todo» que mezclaba lo cobrado con lo que se debe;
 *   · cada deuda enlaza a su pedido, y «Cobrar» es un botón con texto.
 *
 * El tramo se calcula al pintar: «vencido hace 45 días» es una propiedad del
 * día en que se mira, no del documento.
 */
type Estado = 'open' | 'overdue' | 'paid' | 'voided' | 'all'
const ESTADOS: readonly Estado[] = ['open', 'overdue', 'paid', 'voided', 'all']

function estadoDe(doc: ArDocument): Exclude<Estado, 'open' | 'all'> | 'current' {
  if (doc.voided_at) return 'voided'
  if (Number(doc.balance) <= 0) return 'paid'
  return daysOverdue(doc.due_at) > 0 ? 'overdue' : 'current'
}

export function CollectionsSection() {
  const { t, locale } = useI18n()
  const { can } = useTenant()
  const canWrite = can('orders.write')

  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<Estado>('open')
  const [cobrando, setCobrando] = useState<ArDocument | null>(null)
  const { availability } = useAiFeature('credit')
  const conIA = availability !== 'forbidden' && availability !== 'loading'
  const [asistiendo, setAsistiendo] = useState<{ id: string; name: string | null } | null>(null)

  // Todo el histórico: las pestañas filtran aquí, y las cifras de arriba
  // necesitan lo pendiente aunque se esté mirando lo pagado.
  const query = useArDocuments(false)
  const todos = useMemo(() => query.data ?? [], [query.data])

  const cifras = useMemo(() => {
    const abiertos = todos.filter((doc) => !doc.voided_at && Number(doc.balance) > 0)
    const moneda = abiertos[0]?.currency ?? todos[0]?.currency ?? 'PEN'
    const suma = (docs: ArDocument[]) => docs.reduce((total, doc) => total + Math.round(Number(doc.balance) * 100), 0) / 100
    const vencidos = abiertos.filter((doc) => daysOverdue(doc.due_at) > 0)
    const proximos = abiertos.filter((doc) => {
      const dias = daysOverdue(doc.due_at)
      return dias <= 0 && dias >= -7
    })
    return {
      moneda,
      total: suma(abiertos),
      abiertos: abiertos.length,
      vencido: suma(vencidos),
      vencidos: vencidos.length,
      proximo: suma(proximos),
      proximos: proximos.length,
      clientes: new Set(abiertos.map((doc) => doc.customer_id)).size,
    }
  }, [todos])

  const documentos = useMemo(() => {
    const term = search.trim().toLowerCase()
    return todos.filter((doc) => {
      const e = estadoDe(doc)
      const enPestana =
        estado === 'all' ||
        (estado === 'open' && (e === 'current' || e === 'overdue')) ||
        e === estado
      if (!enPestana) return false
      if (!term) return true
      return (
        doc.document_number.toLowerCase().includes(term) ||
        (doc.customer_name ?? '').toLowerCase().includes(term) ||
        (doc.customer_code ?? '').toLowerCase().includes(term)
      )
    })
  }, [todos, search, estado])

  /** Los documentos abiertos del cliente al que se le cobra. */
  const delCliente = useMemo(
    () =>
      cobrando
        ? todos.filter(
            (doc) => doc.customer_id === cobrando.customer_id && !doc.voided_at && Number(doc.balance) > 0,
          )
        : [],
    [todos, cobrando],
  )

  const isEmpty = !query.isPending && !query.isError && documentos.length === 0
  const pager = usePagedRows(documentos)
  const dinero = (valor: number) => formatMoney(valor, cifras.moneda, locale)

  function chip(doc: ArDocument) {
    const e = estadoDe(doc)
    const dias = daysOverdue(doc.due_at)
    if (e === 'voided') return <StatusChip label={t('credit.state.voided')} />
    if (e === 'paid') return <StatusChip tone="success" label={t('credit.state.paid')} />
    if (e === 'overdue') {
      return (
        <StatusChip
          tone={dias > 30 ? 'error' : 'warning'}
          label={t('credit.aging.overdue').replace('{n}', String(dias))}
        />
      )
    }
    if (dias === 0) return <StatusChip tone="warning" label={t('credit.aging.today')} />
    return <StatusChip label={t('credit.aging.dueIn').replace('{n}', String(-dias))} />
  }

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
        }}
      >
        <MetricCard
          label={t('credit.kpi.receivable')}
          value={dinero(cifras.total)}
          hint={t('credit.kpi.documents').replace('{n}', String(cifras.abiertos))}
          icon={<ReceiptLongRoundedIcon fontSize="small" />}
          emphasis
        />
        <MetricCard
          label={t('credit.kpi.overdue')}
          value={dinero(cifras.vencido)}
          hint={t('credit.kpi.documents').replace('{n}', String(cifras.vencidos))}
          icon={<WarningAmberRoundedIcon fontSize="small" />}
          tone={cifras.vencidos > 0 ? 'danger' : 'neutral'}
        />
        <MetricCard
          label={t('credit.kpi.dueSoon')}
          value={dinero(cifras.proximo)}
          hint={t('credit.kpi.documents').replace('{n}', String(cifras.proximos))}
          icon={<EventRoundedIcon fontSize="small" />}
          tone={cifras.proximos > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label={t('credit.kpi.customers')}
          value={String(cifras.clientes)}
          hint={t('credit.kpi.customersHint')}
          icon={<GroupsRoundedIcon fontSize="small" />}
        />
      </Box>

      <Tabs
        value={estado}
        onChange={(_, next: Estado) => setEstado(next)}
        variant="scrollable"
        allowScrollButtonsMobile
        aria-label={t('common.status')}
        sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}
      >
        {ESTADOS.map((value) => (
          <Tab key={value} value={value} label={t(`credit.tabState.${value}` as MessageKey)} />
        ))}
      </Tabs>

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 320 } }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('credit.collections.search')}
            ariaLabel={t('credit.collections.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={7} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('credit.noResults') : t('credit.collections.empty')}
            description={search ? undefined : t('credit.collections.emptyBody')}
            icon={<PaymentsRoundedIcon fontSize="small" />}
          />
        )}

        {!query.isPending && !query.isError && documentos.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('credit.field.document')}</TableCell>
                  <TableCell>{t('credit.field.customer')}</TableCell>
                  <TableCell>{t('credit.field.dueAt')}</TableCell>
                  <TableCell align="right">{t('credit.field.amount')}</TableCell>
                  <TableCell align="right">{t('credit.field.balance')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.rows.map((doc) => {
                  const abierto = !doc.voided_at && Number(doc.balance) > 0
                  return (
                    <TableRow key={doc.id} hover>
                      <TableCell>
                        <Typography sx={{ fontSize: 14, fontWeight: 800 }}>{doc.document_number}</Typography>
                        {doc.order_id ? (
                          <Link
                            component={RouterLink}
                            to={`/app/orders?order=${doc.order_id}`}
                            sx={{ fontSize: 12, color: 'var(--accent-deep)' }}
                          >
                            {t('credit.collections.viewOrder')}
                          </Link>
                        ) : (
                          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                            {t('credit.collections.manual')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{doc.customer_name ?? '—'}</Typography>
                        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{doc.customer_code ?? ''}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 13 }}>{doc.due_at}</Typography>
                        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                          {t('credit.collections.issued').replace('{date}', doc.issued_at)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" className="tnum">
                        {formatMoney(Number(doc.amount), doc.currency, locale)}
                      </TableCell>
                      <TableCell align="right" className="tnum" sx={{ fontWeight: 800 }}>
                        {formatMoney(Number(doc.balance), doc.currency, locale)}
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
                          {chip(doc)}
                          {doc.void_reason && (
                            <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{doc.void_reason}</Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                          {abierto && canWrite && (
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<PaymentsRoundedIcon fontSize="small" />}
                              onClick={() => setCobrando(doc)}
                              aria-label={`${t('credit.receipt.collect')}: ${doc.document_number}`}
                            >
                              {t('credit.receipt.collect')}
                            </Button>
                          )}
                          {conIA && (
                            <Tooltip title={t('aiCredit.rowAction')}>
                              <IconButton
                                size="small"
                                aria-label={`${t('aiCredit.rowAction')}: ${doc.customer_name ?? doc.document_number}`}
                                onClick={() => setAsistiendo({ id: doc.customer_id, name: doc.customer_name })}
                              >
                                <AutoAwesomeRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
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

      <ReceiptDrawer
        open={cobrando !== null}
        documents={delCliente}
        initialDocumentId={cobrando?.id ?? null}
        canWrite={canWrite}
        onClose={() => setCobrando(null)}
      />

      <CreditCustomerAiDrawer
        key={asistiendo?.id ?? 'none'}
        customerId={asistiendo?.id ?? null}
        customerName={asistiendo?.name ?? null}
        onClose={() => setAsistiendo(null)}
      />
    </Stack>
  )
}
