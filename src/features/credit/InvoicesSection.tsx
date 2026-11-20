import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import ReceiptRoundedIcon from '@mui/icons-material/ReceiptRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { fetchInvoicePdf } from '@/shared/lib/invoicePdf'
import { FilterBar } from '@/shared/ui/FilterBar'
import { PdfPreviewDialog } from '@/shared/ui/PdfPreviewDialog'
import { RowActions, type RowAction } from '@/shared/ui/RowActions'
import { SearchField } from '@/shared/ui/SearchField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TablePager } from '@/shared/ui/TablePager'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { usePagedRows } from '@/shared/ui/usePagedRows'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CreditError } from './errors'
import {
  useCreateInvoiceForOrder,
  useRequestCreditNote,
  useInvoiceIssueStatuses,
  useInvoices,
  useRequestInvoiceIssue,
} from './hooks'
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
  // 2026-11-17 · Generar el comprobante de un pedido (con sus líneas).
  const crear = useCreateInvoiceForOrder()
  const [generando, setGenerando] = useState(false)
  const [numeroPedido, setNumeroPedido] = useState('')
  const [errorGenerar, setErrorGenerar] = useState<MessageKey | null>(null)

  async function generar() {
    setErrorGenerar(null)
    try {
      await crear.mutateAsync(numeroPedido)
      notify(t('credit.invoices.created').replace('{order}', numeroPedido.trim().toUpperCase()), 'success')
      setGenerando(false)
      setNumeroPedido('')
    } catch (error) {
      setErrorGenerar(error instanceof CreditError ? error.key : 'credit.error.generic')
    }
  }

  // 2026-11-20 · Facturación fase 5: anular con nota de crédito.
  const requestCreditNote = useRequestCreditNote()
  const [anulando, setAnulando] = useState<Invoice | null>(null)
  const [pdfInvoice, setPdfInvoice] = useState<Invoice | null>(null)
  const [motivo, setMotivo] = useState('')
  const [errorAnular, setErrorAnular] = useState<MessageKey | null>(null)
  const byId = useMemo(() => new Map((query.data ?? []).map((i) => [i.id, i])), [query.data])
  const conNota = useMemo(
    () =>
      new Set(
        (query.data ?? [])
          .filter((i) => i.document_type === 'credit_note' && i.status !== 'rejected' && i.status !== 'cancelled')
          .map((i) => i.reference_invoice_id),
      ),
    [query.data],
  )
  const anulable = (invoice: Invoice) =>
    canIssue &&
    invoice.document_type !== 'credit_note' &&
    (invoice.status === 'issued' || invoice.status === 'accepted') &&
    Boolean(invoice.number) &&
    !conNota.has(invoice.id)

  const puedeEmitir = (invoice: Invoice, issue: InvoiceIssueStatus | undefined) =>
    canIssue && puedeEmitirBase(invoice, issue)

  async function anular() {
    if (!anulando) return
    setErrorAnular(null)
    try {
      const result = await requestCreditNote.mutateAsync({ invoiceId: anulando.id, reason: motivo.trim() })
      notify(
        t(result.state === 'enqueued' ? 'credit.toast.creditNoteQueued' : 'credit.toast.issuePendingConfig'),
        result.state === 'enqueued' ? 'success' : 'warning',
      )
      setAnulando(null)
      setMotivo('')
    } catch (error) {
      setErrorAnular(error instanceof CreditError ? error.key : 'credit.error.generic')
    }
  }

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
      <Typography sx={{ color: 'var(--muted)' }}>
        {t('credit.invoices.help')} {t('credit.invoices.issueHelp')}
      </Typography>
      {serverError && (
        <Alert severity="error" onClose={() => setServerError(null)}>
          {t(serverError)}
        </Alert>
      )}

      <FilterBar
        actions={
          canIssue ? (
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setGenerando(true)}>
              {t('credit.invoices.new')}
            </Button>
          ) : undefined
        }
      >
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
        {query.isPending && <TableSkeleton columns={6} />}
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
                <TableCell>{t('credit.field.document')}</TableCell>
                <TableCell>{t('credit.field.customer')}</TableCell>
                <TableCell>{t('credit.field.issuedAt')}</TableCell>
                <TableCell align="right">{t('credit.field.gross')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>
                  <Box component="span" sx={visuallyHidden}>
                    {t('common.actions')}
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((invoice) => {
                const docType = docTypeOf(invoice)
                const ref =
                  invoice.document_type === 'credit_note' && invoice.reference_invoice_id
                    ? byId.get(invoice.reference_invoice_id)
                    : undefined
                const actions: RowAction[] = []
                if (invoice.pdf_url) {
                  actions.push({
                    id: 'pdf',
                    icon: <PictureAsPdfRoundedIcon fontSize="small" />,
                    label: t('credit.invoices.viewPdf').replace('{doc}', docLabel(invoice)),
                    onClick: () => setPdfInvoice(invoice),
                  })
                }
                if (puedeEmitir(invoice, issueByInvoice.get(invoice.id))) {
                  actions.push({
                    id: 'issue',
                    icon: <SendRoundedIcon fontSize="small" />,
                    label: t('credit.invoices.issueAria').replace('{series}', invoice.series),
                    tone: 'accent',
                    disabled: requestIssue.isPending,
                    onClick: () => void emitir(invoice),
                  })
                }
                if (anulable(invoice)) {
                  actions.push({
                    id: 'void',
                    icon: <BlockRoundedIcon fontSize="small" />,
                    label: t('credit.invoices.void'),
                    tone: 'danger',
                    onClick: () => {
                      setErrorAnular(null)
                      setMotivo('')
                      setAnulando(invoice)
                    },
                  })
                }
                return (
                  <TableRow key={invoice.id} hover>
                    <TableCell>
                      <Typography sx={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.2 }}>
                        {t(`credit.docType.${docType}` as MessageKey)}
                      </Typography>
                      {/* Sin número todavía: lo asigna la emisión. */}
                      <Typography sx={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
                        {docLabel(invoice)}
                      </Typography>
                      {!invoice.number && (
                        <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                          {t('credit.invoices.unnumbered')}
                        </Typography>
                      )}
                      {invoice.document_type === 'credit_note' && (
                        <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                          {t('credit.invoices.creditNoteOf').replace('{ref}', ref ? docLabel(ref) : '—')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography sx={{ fontSize: 14 }} noWrap title={invoice.customer_name}>
                        {invoice.customer_name}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{invoice.issued_at.slice(0, 10)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                        {formatMoney(Number(invoice.gross_total), invoice.currency, locale)}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                        {`${t('credit.field.tax')} ${formatMoney(Number(invoice.tax_total), invoice.currency, locale)}`}
                      </Typography>
                    </TableCell>
                    {/* Ancho tope: un motivo de rechazo largo no estruja los importes. */}
                    <TableCell sx={{ maxWidth: 260 }}>
                      <StatusLines invoice={invoice} issue={issueByInvoice.get(invoice.id)} tone={tono(invoice.status)} />
                    </TableCell>
                    <TableCell align="right">{actions.length > 0 && <RowActions actions={actions} />}</TableCell>
                  </TableRow>
                )
              })}
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

      <Dialog open={generando} onClose={() => setGenerando(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('credit.invoices.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography sx={{ fontSize: 14, color: 'var(--muted)' }}>{t('credit.invoices.newHelp')}</Typography>
            {errorGenerar && <Alert severity="error">{t(errorGenerar)}</Alert>}
            <Field
              autoFocus
              fullWidth
              rule="code"
              help={t('help.credit.orderNumber')}
              label={t('credit.invoices.orderNumber')}
              placeholder="EC-20261117-00046"
              value={numeroPedido}
              onChange={(event) => setNumeroPedido(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && numeroPedido.trim() !== '') void generar()
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerando(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={crear.isPending || numeroPedido.trim() === ''}
            onClick={() => void generar()}
          >
            {t('credit.invoices.generate')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 2026-11-20 · El PDF del comprobante, dentro de la web. */}
      <PdfPreviewDialog
        open={pdfInvoice !== null}
        title={pdfInvoice ? `${t(`credit.docType.${docTypeOf(pdfInvoice)}` as MessageKey)} ${docLabel(pdfInvoice)}` : ''}
        load={() => fetchInvoicePdf(pdfInvoice?.id ?? '')}
        onClose={() => setPdfInvoice(null)}
      />

      {/* 2026-11-20 · Facturación fase 5: anular con nota de crédito. */}
      <Dialog open={anulando !== null} onClose={() => setAnulando(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {t('credit.invoices.voidTitle').replace(
            '{doc}',
            anulando ? `${anulando.series}-${anulando.number ?? ''}` : '',
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography sx={{ fontSize: 14, color: 'var(--muted)' }}>{t('credit.invoices.voidHelp')}</Typography>
            {errorAnular && <Alert severity="error">{t(errorAnular)}</Alert>}
            <Field
              autoFocus
              fullWidth
              multiline
              minRows={2}
              maxLength={250}
              label={t('credit.invoices.voidReason')}
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnulando(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={requestCreditNote.isPending || motivo.trim().length < 3}
            onClick={() => void anular()}
          >
            {t('credit.invoices.voidConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

/** «B001-00000012», o solo la serie mientras no tiene número. */
function docLabel(invoice: Invoice): string {
  return invoice.number ? `${invoice.series}-${invoice.number}` : invoice.series
}

function docTypeOf(invoice: Invoice): 'receipt' | 'invoice' | 'credit_note' {
  return invoice.document_type ?? (invoice.series.startsWith('F') ? 'invoice' : 'receipt')
}

function issueStateOf(issue: InvoiceIssueStatus | undefined) {
  return issue?.issue_state ?? 'not_requested'
}

/**
 * Se ofrece pedir la emisión mientras no haya mensaje en la cola: sin
 * solicitar, o solicitada y a la espera de proveedor (repetir es idempotente).
 */
function puedeEmitirBase(invoice: Invoice, issue: InvoiceIssueStatus | undefined): boolean {
  const state = issueStateOf(issue)
  return (
    invoice.item_count > 0 &&
    invoice.status === 'pending' &&
    (state === 'not_requested' || state === 'pending_configuration')
  )
}

/**
 * El estado en dos niveles: el FISCAL en chip (lo que importa), y debajo, en
 * pequeño, la emisión, el bloqueo, lo que dijo SUNAT o el motivo del rechazo.
 */
function StatusLines({
  invoice,
  issue,
  tone,
}: {
  invoice: Invoice
  issue: InvoiceIssueStatus | undefined
  tone: 'success' | 'error' | 'info' | 'default'
}) {
  const { t } = useI18n()
  const state = issueStateOf(issue)
  const issueColor =
    state === 'dead' || state === 'failed'
      ? 'var(--red)'
      : state === 'pending_configuration'
        ? 'var(--amber, #a15c00)'
        : 'var(--muted)'
  // Solo los códigos que la base declara tienen frase; uno nuevo no pinta la clave.
  const blockedKey: MessageKey | null =
    state === 'pending_configuration' &&
    (issue?.blocked_code === 'FACTURADOR_NO_CONFIGURADO' || issue?.blocked_code === 'FACTURADOR_AMBIGUO')
      ? `credit.issueBlocked.${issue.blocked_code}`
      : null
  const small = { fontSize: 11, lineHeight: 1.35 } as const
  return (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
      <StatusChip tone={tone} label={t(`credit.invoiceStatus.${invoice.status}` as MessageKey)} />
      <Typography sx={{ ...small, color: issueColor }}>{t(`credit.issueState.${state}` as MessageKey)}</Typography>
      {invoice.item_count === 0 && invoice.status === 'pending' && (
        <Typography sx={{ ...small, color: 'var(--red)' }}>{t('credit.invoices.noLines')}</Typography>
      )}
      {blockedKey && <Typography sx={{ ...small, color: 'var(--muted)' }}>{t(blockedKey)}</Typography>}
      {/* El motivo del rechazo es lo único accionable de un comprobante rechazado. */}
      {invoice.reject_reason && (
        <Typography sx={{ ...small, color: 'var(--red)' }} title={invoice.reject_reason}>
          {invoice.reject_reason}
        </Typography>
      )}
      {invoice.sunat_description && !invoice.reject_reason && (
        <Typography sx={{ ...small, color: 'var(--muted)' }} noWrap title={invoice.sunat_description}>
          {`${t('credit.invoice.sunat')}: ${invoice.sunat_description}`}
        </Typography>
      )}
    </Stack>
  )
}
