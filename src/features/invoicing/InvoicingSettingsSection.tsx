import { Alert, Box, Button, Chip, FormControlLabel, MenuItem, Stack, Switch, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { Field } from '@/shared/ui/Field'
import { SelectField } from '@/shared/ui/SelectField'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'
import {
  useInvoicingOverview,
  useSaveInvoicingSettings,
  useSaveNubefact,
  useTestNubefact,
  type InvoicingError,
} from './api'

/**
 * Configuración › Facturación (fase 3, 2026-11-20).
 *
 * El emisor (Nubefact) y los datos de los comprobantes de ESTA tienda. La
 * base valida todo otra vez (series, tasa, correlativo que no retrocede, rol);
 * aquí se avisa antes y se explica.
 *
 * El token se escribe y no se vuelve a ver: el campo queda vacío y dice qué
 * hay guardado (`…5677`). Vacío al guardar = conservar el que estaba.
 */

const ERROR_KEY: Record<string, MessageKey> = {
  RUTA_NO_VALIDA: 'invoicing.error.ruta',
  TOKEN_NO_VALIDO: 'invoicing.error.token',
  TOKEN_REQUERIDO: 'invoicing.error.tokenRequired',
  SERIE_INVALIDA: 'invoicing.error.series',
  TASA_INVALIDA: 'invoicing.error.rate',
  CORRELATIVO_NO_RETROCEDE: 'invoicing.error.backwards',
  CORRELATIVO_INVALIDO: 'invoicing.error.number',
  FORMATO_PDF_INVALIDO: 'invoicing.error.pdfFormat',
  SIN_PERMISO: 'invoicing.error.permission',
  OPERADOR_NO_ES_ACTOR: 'invoicing.error.permission',
}

const TEST_KEY: Record<string, MessageKey> = {
  SIN_CREDENCIALES: 'invoicing.test.noCredentials',
  NUBEFACT_10: 'invoicing.test.token',
  NUBEFACT_11: 'invoicing.test.ruta',
  NUBEFACT_50: 'invoicing.test.suspended',
  NUBEFACT_51: 'invoicing.test.suspended',
  NUBEFACT_SIN_RED: 'invoicing.test.network',
}

const RUTA = /^https:\/\/(api\.nubefact\.com|[a-z0-9-]+\.pse\.pe)\/api\/v1\/[A-Za-z0-9-]{8,80}$/
const SERIE_B = /^B[A-Z0-9]{3}$/
const SERIE_F = /^F[A-Z0-9]{3}$/

export function InvoicingSettingsSection({ storeId }: { storeId: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const overview = useInvoicingOverview(storeId)
  const saveSettings = useSaveInvoicingSettings(storeId)
  const saveNubefact = useSaveNubefact(storeId)
  const test = useTestNubefact()

  const [ruta, setRuta] = useState('')
  const [token, setToken] = useState('')
  const [active, setActive] = useState(false)

  const [receipt, setReceipt] = useState('B001')
  const [invoice, setInvoice] = useState('F001')
  const [noteReceipt, setNoteReceipt] = useState('BC01')
  const [noteInvoice, setNoteInvoice] = useState('FC01')
  const [receiptLast, setReceiptLast] = useState('')
  const [invoiceLast, setInvoiceLast] = useState('')
  const [shippingPct, setShippingPct] = useState('18')
  const [zero, setZero] = useState<'exonerado' | 'inafecto'>('exonerado')
  const [autoIssue, setAutoIssue] = useState(false)
  const [pdfFormat, setPdfFormat] = useState<'' | 'A4' | 'A5' | 'TICKET'>('')

  useEffect(() => {
    const d = overview.data
    if (!d) return
    setActive(d.nubefact.active)
    setReceipt(d.settings.receipt_series)
    setInvoice(d.settings.invoice_series)
    setNoteReceipt(d.settings.credit_note_receipt_series)
    setNoteInvoice(d.settings.credit_note_invoice_series)
    setShippingPct(String(Math.round(Number(d.settings.shipping_tax_rate) * 10000) / 100))
    setZero(d.settings.zero_rate_affectation)
    setAutoIssue(d.settings.auto_issue)
    setPdfFormat(d.settings.pdf_format ?? '')
    setReceiptLast('')
    setInvoiceLast('')
  }, [overview.data])

  if (!storeId) return null
  if (overview.isPending) return <LoadingState />
  if (overview.isError || !overview.data) return <Alert severity="error">{t('invoicing.error.load')}</Alert>

  const { nubefact, sequences } = overview.data
  const errorText = (e: InvoicingError | null) => (e ? t(ERROR_KEY[e.code] ?? 'invoicing.error.generic') : null)

  const rutaOk = RUTA.test(ruta.trim())
  const tokenOk = token.trim() === '' ? nubefact.configured : /^[A-Za-z0-9._-]{20,200}$/.test(token.trim())
  const canSaveNubefact = rutaOk && tokenOk && !saveNubefact.isPending

  const pct = Number(shippingPct)
  const lastOf = (value: string) => (value.trim() === '' ? null : Number(value))
  // La nota puede usar la misma serie que su comprobante (FFF1/BBB1 en Nubefact):
  // el correlativo es por serie y TIPO.
  const seriesOk =
    SERIE_B.test(receipt) && SERIE_F.test(invoice) && SERIE_B.test(noteReceipt) && SERIE_F.test(noteInvoice)
  const pctOk = Number.isFinite(pct) && pct >= 0 && pct < 100
  const lastOk = [receiptLast, invoiceLast].every((v) => v.trim() === '' || /^\d{1,8}$/.test(v.trim()))
  const canSaveSettings = seriesOk && pctOk && lastOk && !saveSettings.isPending

  const onSaveNubefact = () =>
    saveNubefact.mutate(
      { ruta: ruta.trim(), token: token.trim(), active },
      {
        onSuccess: () => {
          setToken('')
          notify(t('invoicing.nubefact.saved'))
        },
      },
    )

  const onSaveSettings = () =>
    saveSettings.mutate(
      {
        receipt_series: receipt,
        invoice_series: invoice,
        credit_note_receipt_series: noteReceipt,
        credit_note_invoice_series: noteInvoice,
        shipping_tax_rate: String(pct / 100),
        zero_rate_affectation: zero,
        auto_issue: autoIssue,
        pdf_format: pdfFormat === '' ? null : pdfFormat,
        receipt_last_number: lastOf(receiptLast),
        invoice_last_number: lastOf(invoiceLast),
      },
      { onSuccess: () => notify(t('invoicing.settings.saved')) },
    )

  const statusChip = nubefact.active ? (
    <Chip size="small" color="success" label={t('invoicing.nubefact.active')} />
  ) : nubefact.configured ? (
    <Chip size="small" variant="outlined" label={t('invoicing.nubefact.inactive')} />
  ) : (
    <Chip size="small" variant="outlined" color="warning" label={t('invoicing.nubefact.missing')} />
  )

  return (
    <Stack spacing={3}>
      {/* ---- Emisor ---- */}
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography component="h3" sx={{ fontWeight: 700 }}>
            {t('invoicing.nubefact.title')}
          </Typography>
          {statusChip}
        </Stack>
        <Typography sx={{ color: 'var(--muted)' }}>{t('invoicing.nubefact.help')}</Typography>
        {nubefact.configured && (
          <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
            {t('invoicing.nubefact.saved_hint')
              .replace('{ruta}', nubefact.rutaHint ?? '—')
              .replace('{token}', nubefact.tokenHint ?? '—')}
          </Typography>
        )}
        <Field
          label={t('invoicing.nubefact.ruta')}
          placeholder="https://api.nubefact.com/api/v1/…"
          value={ruta}
          onChange={(e) => setRuta(e.target.value)}
          maxLength={200}
          fullWidth
          error={ruta.trim() !== '' && !rutaOk}
          helperText={t('invoicing.nubefact.rutaHelp')}
        />
        <Field
          label={t('invoicing.nubefact.token')}
          type="password"
          autoComplete="off"
          placeholder={nubefact.tokenHint ? t('invoicing.nubefact.tokenKeep').replace('{hint}', nubefact.tokenHint) : ''}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          maxLength={200}
          fullWidth
          error={token.trim() !== '' && !tokenOk}
        />
        <FormControlLabel
          control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
          label={t('invoicing.nubefact.activeLabel')}
        />
        {saveNubefact.isError && <Alert severity="error">{errorText(saveNubefact.error)}</Alert>}
        {test.data && (
          <Alert severity={test.data.ok ? 'success' : 'error'}>
            {test.data.ok ? t('invoicing.test.ok') : t(TEST_KEY[test.data.code ?? ''] ?? 'invoicing.test.generic')}
          </Alert>
        )}
        {test.isError && <Alert severity="error">{t('invoicing.test.generic')}</Alert>}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="contained" onClick={onSaveNubefact} disabled={!canSaveNubefact}>
            {t('invoicing.nubefact.save')}
          </Button>
          <Button variant="outlined" onClick={() => test.mutate()} disabled={!nubefact.configured || test.isPending}>
            {test.isPending ? t('invoicing.test.running') : t('invoicing.test.button')}
          </Button>
        </Stack>
      </Stack>

      {/* ---- Comprobantes ---- */}
      <Stack spacing={1.5}>
        <Typography component="h3" sx={{ fontWeight: 700 }}>
          {t('invoicing.settings.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)' }}>{t('invoicing.settings.help')}</Typography>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <Field
            label={t('invoicing.settings.receiptSeries')}
            value={receipt}
            onChange={(e) => setReceipt(e.target.value.toUpperCase())}
            maxLength={4}
            error={!SERIE_B.test(receipt)}
            helperText={t('invoicing.settings.current').replace('{n}', String(sequences[receipt] ?? 0))}
          />
          <Field
            label={t('invoicing.settings.invoiceSeries')}
            value={invoice}
            onChange={(e) => setInvoice(e.target.value.toUpperCase())}
            maxLength={4}
            error={!SERIE_F.test(invoice)}
            helperText={t('invoicing.settings.current').replace('{n}', String(sequences[invoice] ?? 0))}
          />
          <Field
            label={t('invoicing.settings.noteReceiptSeries')}
            value={noteReceipt}
            onChange={(e) => setNoteReceipt(e.target.value.toUpperCase())}
            maxLength={4}
            error={!SERIE_B.test(noteReceipt)}
            helperText={t('invoicing.settings.current').replace('{n}', String(sequences[noteReceipt] ?? 0))}
          />
          <Field
            label={t('invoicing.settings.noteInvoiceSeries')}
            value={noteInvoice}
            onChange={(e) => setNoteInvoice(e.target.value.toUpperCase())}
            maxLength={4}
            error={!SERIE_F.test(noteInvoice)}
            helperText={t('invoicing.settings.current').replace('{n}', String(sequences[noteInvoice] ?? 0))}
          />
          <Field
            label={t('invoicing.settings.receiptLast')}
            value={receiptLast}
            onChange={(e) => setReceiptLast(e.target.value)}
            maxLength={8}
            inputMode="numeric"
            helperText={t('invoicing.settings.lastHelp')}
          />
          <Field
            label={t('invoicing.settings.invoiceLast')}
            value={invoiceLast}
            onChange={(e) => setInvoiceLast(e.target.value)}
            maxLength={8}
            inputMode="numeric"
            helperText={t('invoicing.settings.lastHelp')}
          />
          <Field
            label={t('invoicing.settings.shippingRate')}
            value={shippingPct}
            onChange={(e) => setShippingPct(e.target.value)}
            maxLength={5}
            inputMode="decimal"
            error={!pctOk}
            helperText={t('invoicing.settings.shippingHelp')}
          />
          <SelectField
            label={t('invoicing.settings.zero')}
            value={zero}
            onChange={(e) => setZero(e.target.value as 'exonerado' | 'inafecto')}
          >
            <MenuItem value="exonerado">{t('invoicing.settings.zero.exonerado')}</MenuItem>
            <MenuItem value="inafecto">{t('invoicing.settings.zero.inafecto')}</MenuItem>
          </SelectField>
          <SelectField
            label={t('invoicing.settings.pdfFormat')}
            value={pdfFormat}
            onChange={(e) => setPdfFormat(e.target.value as '' | 'A4' | 'A5' | 'TICKET')}
            helperText={t('invoicing.settings.pdfFormatHelp')}
          >
            <MenuItem value="">{t('invoicing.settings.pdfFormat.default')}</MenuItem>
            <MenuItem value="A4">A4</MenuItem>
            <MenuItem value="A5">A5</MenuItem>
            <MenuItem value="TICKET">{t('invoicing.settings.pdfFormat.ticket')}</MenuItem>
          </SelectField>
        </Box>
        <FormControlLabel
          control={<Switch checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} />}
          label={t('invoicing.settings.autoIssue')}
        />
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          {t('invoicing.settings.autoIssueHelp')}
        </Typography>
        {saveSettings.isError && <Alert severity="error">{errorText(saveSettings.error)}</Alert>}
        <Button variant="contained" onClick={onSaveSettings} disabled={!canSaveSettings} sx={{ alignSelf: 'flex-start' }}>
          {t('invoicing.settings.save')}
        </Button>
      </Stack>
    </Stack>
  )
}
