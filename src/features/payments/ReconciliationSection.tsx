import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { StatusChip } from '@/shared/ui/StatusChip'
import BalanceRoundedIcon from '@mui/icons-material/BalanceRounded'
import {
  Alert,
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
import { useRef, useState, type ChangeEvent } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import type { MessageKey } from '@/shared/i18n/messages'
import {
  IMPORT_ACCEPT,
  WorkbookReadError,
  downloadWorkbook,
  isCsvFile,
  readFileText,
  readImportTable,
} from '@/shared/lib/excel'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import type { StatementRow } from './api'
import { PaymentsError } from './errors'
import { useImportReconciliation, usePaymentProviders, useReconciliation } from './hooks'
import { statementImportColumns, statementTemplateBook, statementText } from './statementTemplate'
import { SelectField } from '@/shared/ui/SelectField'

const RECONCILIATION_STATUSES = ['unmatched', 'matched', 'discrepancy', 'ignored'] as const

/**
 * Conciliación: lo que el proveedor dice que liquidó, contra lo que se cobró.
 *
 * El cruce es por REFERENCIA EXTERNA y nada más. Ningún banco aparece nombrado
 * ni en el modelo ni en esta pantalla: el proveedor es una fila del catálogo y
 * el formato del extracto es lo que el operador pegue.
 *
 * La entrada es un CSV pegado y no un fichero subido, y es deliberado para
 * P09: subir ficheros exige bucket, política por tenant y antivirus, y ninguna
 * de las tres decisiones pertenece a la fase de pagos. Pegar el extracto
 * resuelve hoy el caso real —cuadrar un día— sin comprometer el diseño del día
 * que se conecte el fichero del proveedor por integración.
 *
 * Desde 2026-11-13 hay plantilla Excel y «Subir Excel», pero el archivo NO se
 * sube: se lee en el navegador y rellena el mismo cuadro. Sigue sin bucket.
 *
 * Reimportar es seguro: la clave `(tenant, proveedor, referencia)` es única y
 * la segunda carga sale como «repetidas», no como un cuadre doble.
 */
export function ReconciliationSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { can } = useTenant()
  const canImport = can('tenant.manage')

  const [status, setStatus] = useState('unmatched')
  const [providerCode, setProviderCode] = useState('')
  const [csv, setCsv] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const records = useReconciliation(status)
  const providers = usePaymentProviders()
  const load = useImportReconciliation()

  const list = records.data ?? []
  const isEmpty = !records.isPending && !records.isError && list.length === 0

  /**
   * `fecha;referencia;bruto;comision;moneda` — una línea por operación.
   *
   * El parseo vive aquí y no en la base a propósito: el formato del extracto es
   * de quien lo emite y cambia, mientras que lo que la base acepta es una lista
   * de campos con nombre. Poner el parseo en SQL obligaría a migrar cada vez
   * que un proveedor cambiara una columna de sitio.
   */
  function parseCsv(text: string): StatementRow[] {
    const rows: StatementRow[] = []
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const parts = trimmed.split(/[;\t]/).map((p) => p.trim())
      const [date, reference, gross, fee, currency] = parts
      if (!date || !reference || !gross) continue
      rows.push({
        settlement_date: date,
        external_reference: reference,
        gross_amount: gross,
        ...(fee ? { fee_amount: fee } : {}),
        currency: currency && currency !== '' ? currency.toUpperCase() : 'PEN',
      })
    }
    return rows
  }

  /**
   * Excel (o CSV) → el cuadro del extracto. No se sube nada: se lee en el
   * navegador y el operador revisa las líneas antes de cuadrar.
   */
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = isCsvFile(file)
        ? await readFileText(file)
        : statementText(await readImportTable(file, statementImportColumns(t)))
      setCsv(text)
      const count = text.split(/\r?\n/).filter((line) => line.trim() !== '').length
      notify(t('payments.reconciliation.xlsx.loaded').replace('{n}', String(count)))
    } catch (error) {
      notify(t(error instanceof WorkbookReadError ? `excel.error.${error.reason}` : 'excel.error.unreadable'), 'error')
    }
  }

  async function submit() {
    const rows = parseCsv(csv)
    if (providerCode === '' || rows.length === 0) {
      notify(t('payments.reconciliation.nothing'), 'warning')
      return
    }
    try {
      const summary = await load.mutateAsync({ providerCode, rows })
      notify(
        t('payments.reconciliation.done')
          .replace('{imported}', String(summary.imported))
          .replace('{matched}', String(summary.matched))
          .replace('{discrepancy}', String(summary.discrepancy)),
        'success',
      )
      setCsv('')
    } catch (error) {
      const key: MessageKey =
        error instanceof PaymentsError ? error.key : 'payments.error.generic'
      notify(t(key), 'error')
    }
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(list)

  return (
    <Stack spacing={3}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('payments.reconciliation.help')}</Typography>

      {canImport && (
        <Card sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">{t('payments.reconciliation.import')}</Typography>
            <SelectField
              size="small"
              label={t('payments.field.provider')}
              value={providerCode}
              onChange={(event) => setProviderCode(event.target.value)}
              sx={{ maxWidth: 320 }}
            >
              <MenuItem value="">{t('payments.reconciliation.pickProvider')}</MenuItem>
              {(providers.data ?? []).map((provider) => (
                <MenuItem key={provider.code} value={provider.code}>
                  {provider.name}
                </MenuItem>
              ))}
            </SelectField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  void downloadWorkbook(statementTemplateBook(t), t).catch(() =>
                    notify(t('excel.error.download'), 'error'),
                  )
                }
              >
                {t('excel.template')}
              </Button>
              <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()}>
                {t('payments.reconciliation.xlsx.upload')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept={IMPORT_ACCEPT}
                hidden
                aria-label={t('payments.reconciliation.xlsx.upload')}
                onChange={(event) => void onFile(event)}
              />
            </Stack>
            <Field
              label={t('payments.reconciliation.paste')}
              help={t('help.payments.reconciliationPaste')}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              multiline
              minRows={4}
              helperText={t('payments.reconciliation.format')}
            />
            <Alert severity="info">{t('payments.reconciliation.idempotent')}</Alert>
            <Box>
              {/* Sin proveedor el botón no hacía nada y no decía por qué. */}
              <Button
                variant="contained"
                disabled={load.isPending || !providerCode || csv.trim() === ''}
                onClick={() => void submit()}
              >
                {t('payments.reconciliation.run')}
              </Button>
            </Box>
          </Stack>
        </Card>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Box sx={{ flex: 1 }} />
        <SelectField
          size="small"
          label={t('common.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('payments.status.all')}</MenuItem>
          {RECONCILIATION_STATUSES.map((value) => (
            <MenuItem key={value} value={value}>
              {t(`payments.reconciliation.${value}` as MessageKey)}
            </MenuItem>
          ))}
        </SelectField>
      </Stack>

      <Card>
        {records.isPending && <TableSkeleton columns={5} />}
        {records.isError && (
          <ErrorState error={records.error} onRetry={() => void records.refetch()} />
        )}
        {isEmpty && (
          <EmptyState
            title={t('payments.reconciliation.empty')}
            description={t('payments.reconciliation.emptyBody')}
            icon={<BalanceRoundedIcon fontSize="small" />}
          />
        )}
        {!records.isPending && !records.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('payments.field.settlementDate')}</TableCell>
                <TableCell>{t('payments.field.reference')}</TableCell>
                <TableCell align="right">{t('payments.field.gross')}</TableCell>
                <TableCell align="right">{t('payments.field.fee')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((record) => (
                <TableRow key={record.id} hover>
                  <TableCell>{record.settlement_date}</TableCell>
                  <TableCell>{record.external_reference}</TableCell>
                  <TableCell align="right">
                    {record.gross_amount} {record.currency}
                  </TableCell>
                  <TableCell align="right">{record.fee_amount}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={
                        record.status === 'matched'
                          ? 'success'
                          : record.status === 'discrepancy'
                            ? 'error'
                            : 'default'
                      }
                      label={t(`payments.reconciliation.${record.status}` as MessageKey)}
                    />
                    {record.discrepancy_reason && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'var(--muted)' }}>
                        {record.discrepancy_reason}
                      </Typography>
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
    </Stack>
  )
}
