import ReceiptRoundedIcon from '@mui/icons-material/ReceiptRounded'
import {
  Alert,
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
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { FilterBar } from '@/shared/ui/FilterBar'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CreditError } from './errors'
import { useInvoiceIssueStatuses, useInvoices, useRequestInvoiceIssue } from './hooks'
import type { Invoice, InvoiceIssueStatus, InvoiceStatus } from './types'

/**
 * Comprobantes emitidos.
 *
 * ## Es una pantalla de LECTURA, y lo dice
 *
 * Un comprobante no se edita: la base lo impide en cuanto la autoridad lo
 * acepta, y se corrige con una nota. Poner aquí un botón de editar sería
 * ofrecer algo que va a fallar.
 *
 * ## La única acción: pedir la emisión
 *
 * «Emitir» encola `invoice.issue` en el outbox de integraciones
 * (`invoice_request_issue`, migración 20260914170000). Sin proveedor fiscal no
 * es un error: la columna de emisión lo dice («Falta proveedor») y el pedido
 * queda registrado. El botón solo se ofrece a quien puede administrar la
 * sociedad y en comprobantes pendientes; la autoridad sigue siendo la base.
 */
export function InvoicesSection() {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')

  const query = useInvoices()
  const issueQuery = useInvoiceIssueStatuses()
  const requestIssue = useRequestInvoiceIssue()
  const { can } = useTenant()
  const { notify } = useFeedback()
  const canIssue = can('tenant.manage')
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const issueByInvoice = useMemo(() => {
    const map = new Map<string, InvoiceIssueStatus>()
    for (const row of issueQuery.data ?? []) map.set(row.invoice_id, row)
    return map
  }, [issueQuery.data])

  async function emitir(invoice: Invoice) {
    setServerError(null)
    try {
      const result = await requestIssue.mutateAsync(invoice.id)
      notify(
        t(result.state === 'enqueued' ? 'credit.toast.issueQueued' : 'credit.toast.issuePendingConfig'),
        result.state === 'enqueued' ? 'success' : 'warning',
      )
    } catch (error) {
      setServerError(error instanceof CreditError ? error.key : 'credit.error.generic')
    }
  }

  const invoices = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (invoice) =>
        (invoice.number ?? '').toLowerCase().includes(term) ||
        invoice.series.toLowerCase().includes(term) ||
        invoice.customer_name.toLowerCase().includes(term),
    )
  }, [query.data, search])

  const isEmpty = !query.isPending && !query.isError && invoices.length === 0
  const pager = usePagedRows(invoices)

  const tono = (status: InvoiceStatus) => {
    if (status === 'accepted') return 'success' as const
    if (status === 'rejected' || status === 'cancelled') return 'error' as const
    if (status === 'issued') return 'info' as const
    return 'default' as const
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('credit.invoices.help')}</Typography>

      <Alert severity="info">{t('credit.invoices.issueHelp')}</Alert>
      {serverError && (
        <Alert severity="error" onClose={() => setServerError(null)}>
          {t(serverError)}
        </Alert>
      )}

      <FilterBar>
        <Box sx={{ minWidth: { xs: '100%', sm: 300 } }}>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('credit.invoices.search')}
            ariaLabel={t('credit.invoices.search')}
          />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={8} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('credit.noResults') : t('credit.invoices.empty')}
            description={search ? undefined : t('credit.invoices.emptyBody')}
            icon={<ReceiptRoundedIcon fontSize="small" />}
          />
        )}

        {!query.isPending && !query.isError && invoices.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('credit.field.series')}</TableCell>
                <TableCell>{t('credit.field.customer')}</TableCell>
                <TableCell>{t('credit.field.issuedAt')}</TableCell>
                <TableCell align="right">{t('credit.field.net')}</TableCell>
                <TableCell align="right">{t('credit.field.tax')}</TableCell>
                <TableCell align="right">{t('credit.field.gross')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell>{t('credit.field.issue')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((invoice) => (
                <TableRow key={invoice.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>
                    {/* Sin número todavía: la autoridad no ha contestado. Un
                        guion es más honesto que inventar un correlativo. */}
                    {invoice.number ? `${invoice.series}-${invoice.number}` : invoice.series}
                  </TableCell>
                  <TableCell>{invoice.customer_name}</TableCell>
                  <TableCell>{invoice.issued_at.slice(0, 10)}</TableCell>
                  <TableCell align="right">
                    {formatMoney(Number(invoice.net_total), invoice.currency, locale)}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(Number(invoice.tax_total), invoice.currency, locale)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>
                    {formatMoney(Number(invoice.gross_total), invoice.currency, locale)}
                  </TableCell>
                  {/* Ancho tope: sin el, un motivo de rechazo largo estira la
                      columna y estruja las de importes, que son las que se
                      comparan de un vistazo. */}
                  <TableCell sx={{ maxWidth: 260 }}>
                    {/* `flex-start`: en columna, un Stack estira a sus hijos a
                        todo el ancho, y el chip pasaba de etiqueta a barra. */}
                    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
                      <StatusChip
                        tone={tono(invoice.status)}
                        label={t(`credit.invoiceStatus.${invoice.status}` as MessageKey)}
                      />
                      {/* El motivo del rechazo es lo único accionable de una
                          factura rechazada: sin él nadie sabe qué corregir. */}
                      {invoice.reject_reason && (
                        <Typography sx={{ fontSize: 11, color: 'var(--red)' }}>
                          {invoice.reject_reason}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <IssueCell
                      invoice={invoice}
                      issue={issueByInvoice.get(invoice.id)}
                      canIssue={canIssue}
                      busy={requestIssue.isPending}
                      onIssue={() => void emitir(invoice)}
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
    </Stack>
  )
}

function IssueCell({
  invoice,
  issue,
  canIssue,
  busy,
  onIssue,
}: {
  invoice: Invoice
  issue: InvoiceIssueStatus | undefined
  canIssue: boolean
  busy: boolean
  onIssue: () => void
}) {
  const { t } = useI18n()
  const state = issue?.issue_state ?? 'not_requested'
  const tone =
    state === 'succeeded'
      ? ('success' as const)
      : state === 'dead' || state === 'failed'
        ? ('error' as const)
        : state === 'pending_configuration'
          ? ('warning' as const)
          : state === 'not_requested'
            ? ('default' as const)
            : ('info' as const)
  // Solo los códigos que la base declara tienen frase; uno nuevo no pinta la clave.
  const blockedKey: MessageKey | null =
    state === 'pending_configuration' &&
    (issue?.blocked_code === 'FACTURADOR_NO_CONFIGURADO' || issue?.blocked_code === 'FACTURADOR_AMBIGUO')
      ? `credit.issueBlocked.${issue.blocked_code}`
      : null
  // Se ofrece pedirla mientras no haya mensaje en la cola: sin solicitar, o
  // solicitada y a la espera de proveedor (volver a pedirla es idempotente).
  const offer =
    canIssue &&
    invoice.status === 'pending' &&
    (state === 'not_requested' || state === 'pending_configuration')

  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <StatusChip tone={tone} label={t(`credit.issueState.${state}` as MessageKey)} />
      {blockedKey && (
        <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{t(blockedKey)}</Typography>
      )}
      {offer && (
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={onIssue}
          aria-label={t('credit.invoices.issueAria').replace('{series}', invoice.series)}
        >
          {t('credit.invoices.issue')}
        </Button>
      )}
    </Stack>
  )
}
