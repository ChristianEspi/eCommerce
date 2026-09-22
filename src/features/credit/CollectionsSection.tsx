import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import {
  Box,
  Button,
  Card,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useAiFeature } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { FilterBar } from '@/shared/ui/FilterBar'
import { RowActions } from '@/shared/ui/RowActions'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { ReceiptDrawer } from './ReceiptDrawer'
import { CreditCustomerAiDrawer } from './ai/CreditAiSection'
import { useArDocuments } from './hooks'
import { agingBucket, daysOverdue, type ArDocument } from './types'

/**
 * Cobranza: quién debe, cuánto y desde cuándo.
 *
 * ## Lo pendiente primero, y por defecto
 *
 * Quien abre esta pantalla viene a cobrar, no a leer el histórico de lo ya
 * pagado. El filtro arranca en «solo pendiente» y el histórico está a un clic —
 * al revés, la lista útil quedaría enterrada bajo años de facturas saldadas.
 *
 * ## El tramo se calcula al pintar, no se guarda
 *
 * «Vencido hace 45 días» no es una propiedad del documento: es una propiedad
 * del día en que se mira. Guardarlo exigiría un proceso nocturno que
 * actualizara filas, y ese proceso es exactamente el que falla un fin de semana
 * largo y deja a todo el mundo mirando cifras de hace tres días.
 */
export function CollectionsSection() {
  const { t, locale } = useI18n()
  const { tenant, activeCompanyId, can } = useTenant()
  const canWrite = can('orders.write')

  const [search, setSearch] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [cobrando, setCobrando] = useState<string | null>(null)
  // Fase 08: «Asistente de cobranza» por cliente, solo para los roles de la
  // funcionalidad `credit`. Solo lee y prepara borradores.
  const { availability } = useAiFeature('credit')
  const conIA = availability !== 'forbidden' && availability !== 'loading'
  const [asistiendo, setAsistiendo] = useState<{ id: string; name: string | null } | null>(null)

  const query = useArDocuments(onlyOpen)

  const documentos = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (doc) =>
        doc.document_number.toLowerCase().includes(term) ||
        (doc.customer_name ?? '').toLowerCase().includes(term) ||
        (doc.customer_code ?? '').toLowerCase().includes(term),
    )
  }, [query.data, search])

  /** Los documentos abiertos del cliente para el que se está cobrando. */
  const delCliente = useMemo(
    () =>
      cobrando
        ? (query.data ?? []).filter(
            (doc) => doc.customer_id === cobrando && Number(doc.balance) > 0,
          )
        : [],
    [query.data, cobrando],
  )

  const isEmpty = !query.isPending && !query.isError && documentos.length === 0
  const pager = usePagedRows(documentos)

  function tono(doc: ArDocument) {
    const tramo = agingBucket(doc.due_at)
    if (tramo === 'current') return 'default' as const
    if (tramo === '1-30') return 'warning' as const
    return 'error' as const
  }

  function etiqueta(doc: ArDocument) {
    const dias = daysOverdue(doc.due_at)
    if (dias <= 0) return t('credit.aging.current')
    return t('credit.aging.overdue').replace('{n}', String(dias))
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('credit.collections.help')}</Typography>

      <FilterBar
        actions={
          <Button onClick={() => setOnlyOpen((previo) => !previo)}>
            {onlyOpen ? t('credit.filter.showAll') : t('credit.filter.onlyOpen')}
          </Button>
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 300 } }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('credit.collections.search')}
            ariaLabel={t('credit.collections.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={6} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('credit.noResults') : t('credit.collections.empty')}
            description={search ? undefined : t('credit.collections.emptyBody')}
            icon={<PaymentsRoundedIcon fontSize="small" />}
          />
        )}

        {!query.isPending && !query.isError && documentos.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('credit.field.document')}</TableCell>
                <TableCell>{t('credit.field.customer')}</TableCell>
                <TableCell>{t('credit.field.dueAt')}</TableCell>
                <TableCell align="right">{t('credit.field.amount')}</TableCell>
                <TableCell align="right">{t('credit.field.balance')}</TableCell>
                <TableCell>{t('credit.field.aging')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((doc) => (
                <TableRow key={doc.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{doc.document_number}</TableCell>
                  <TableCell>
                    <Box>
                      <Typography sx={{ fontSize: 13 }}>{doc.customer_name ?? '—'}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                        {doc.customer_code ?? ''}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{doc.due_at}</TableCell>
                  {/* El texto es el TRANSPORTE; el `Number` solo aquí, en el
                      último milímetro antes de pintar. */}
                  <TableCell align="right">
                    {formatMoney(Number(doc.amount), doc.currency, locale)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>
                    {formatMoney(Number(doc.balance), doc.currency, locale)}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={tono(doc)} label={etiqueta(doc)} />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: 'receipt',
                          icon: <PaymentsRoundedIcon fontSize="small" />,
                          label: `${t('credit.receipt.new')}: ${doc.document_number}`,
                          tone: 'accent',
                          disabled: !canWrite || Number(doc.balance) <= 0,
                          onClick: () => setCobrando(doc.customer_id),
                        },
                        ...(conIA
                          ? [
                              {
                                id: 'ai',
                                icon: <AutoAwesomeRoundedIcon fontSize="small" />,
                                label: `${t('aiCredit.rowAction')}: ${doc.customer_name ?? doc.document_number}`,
                                onClick: () => setAsistiendo({ id: doc.customer_id, name: doc.customer_name }),
                              },
                            ]
                          : []),
                      ]}
                    />
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

      <ReceiptDrawer
        open={cobrando !== null}
        documents={delCliente}
        canWrite={canWrite}
        scope={
          tenant && activeCompanyId
            ? { organizationId: tenant.organization_id, companyId: activeCompanyId }
            : null
        }
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
