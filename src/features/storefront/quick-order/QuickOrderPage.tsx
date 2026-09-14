import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AddShoppingCartRoundedIcon from '@mui/icons-material/AddShoppingCartRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useContext, useRef, useState, type ChangeEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { isAppError } from '@/domain/errors'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { downloadCsv } from '@/shared/lib/csv'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { EmptyState, LoadingState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { CartContext } from '../cart/cart-context'
import { useStorefront } from '../hooks'
import { privateMeta } from '../seo'
import { resolveOrderLines } from './api'
import { importIntoCart, type CartImportResult } from './importToCart'
import {
  QUICK_ORDER_MAX_ROWS,
  buildReport,
  checkLines,
  draftsFromEditor,
  parseOrderCsv,
  parsePastedLines,
  quickOrderCsvTemplate,
  type AcceptedLine,
  type FileIssue,
  type ParsedLines,
  type ReportLine,
} from './lines'

/**
 * Pedido rápido (`/s/:storeSlug/pedido-rapido`).
 *
 * Dos formas de decir lo mismo —«estos SKU, estas cantidades»— y un solo
 * final: el CARRITO de siempre. Aquí no se crea ningún pedido; el precio, la
 * existencia, el crédito, la orden de compra y la aprobación los aplica el
 * checkout oficial cuando el comprador confirma.
 *
 * Exige sesión porque el SKU no es público (ver la migración 20260914120000);
 * sin ella se invita a entrar y se vuelve aquí.
 */
export function QuickOrderPage() {
  const { t, locale } = useI18n()
  const { store, storeSlug } = useStorefront()
  const { status } = useSessionContext()
  const location = useLocation()

  useDocumentMeta(
    privateMeta(
      { store, storeSlug, locale, pathname: `/s/${storeSlug}` },
      t('store.quickOrder.title'),
      '/pedido-rapido',
    ),
  )

  if (status === 'loading') return <LoadingState />

  if (status !== 'authenticated') {
    return (
      <EmptyState
        title={t('store.quickOrder.signedOut')}
        description={t('store.quickOrder.signedOutBody')}
        icon={<BoltRoundedIcon fontSize="small" />}
        action={
          <Button component={Link} to="/login" state={{ from: location.pathname }} variant="contained" size="small">
            {t('auth.submit')}
          </Button>
        }
      />
    )
  }

  return <QuickOrderView storeId={store.store_id} storeSlug={storeSlug} />
}

interface EditorRow {
  readonly id: number
  readonly sku: string
  readonly quantity: string
  /** Vino pegada con columnas de más. Se limpia en cuanto se edita la fila. */
  readonly malformed?: boolean
}

const EMPTY_ROWS = 5

/**
 * El texto de un archivo con `FileReader` y no con `Blob.text()`: hace lo
 * mismo, y además existe en todos los navegadores que la vitrina soporta y en
 * el entorno de pruebas.
 */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('LECTURA_FALLIDA'))
    reader.readAsText(file)
  })
}

/** Clave de i18n de un código de error del servidor. Nunca su texto. */
function errorKey(error: unknown): MessageKey {
  if (isAppError(error) && error.kind === 'rate_limited') return 'store.quickOrder.error.rateLimited'
  return 'store.quickOrder.error.generic'
}

/**
 * La pantalla, sin depender del `<Outlet>` de la vitrina: así se prueba sola.
 */
export function QuickOrderView({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const { t } = useI18n()
  const cart = useContext(CartContext)
  const nextId = useRef(EMPTY_ROWS)

  const [rows, setRows] = useState<EditorRow[]>(() =>
    Array.from({ length: EMPTY_ROWS }, (_, id) => ({ id, sku: '', quantity: '' })),
  )
  const [pasted, setPasted] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [issue, setIssue] = useState<FileIssue | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const validate = useMutation({
    mutationFn: async (parsed: ParsedLines) => {
      const { valid, rejected } = checkLines(parsed.lines)
      const resolved = await resolveOrderLines({ storeSlug, lines: valid })
      return buildReport(valid, rejected, resolved)
    },
  })

  const addToCart = useMutation({
    mutationFn: async (accepted: readonly AcceptedLine[]) => {
      if (!cart) throw new Error('CARRITO_NO_DISPONIBLE')
      return importIntoCart(cart, { storeId, storeSlug }, accepted)
    },
  })

  /**
   * Lo que cambia la entrada invalida el informe: no se añade un resultado viejo.
   * El informe y el resultado SON los datos de las dos mutaciones, sin copia en
   * un estado aparte: `reset()` suelta también una respuesta que llegue tarde,
   * y una copia la dejaría pintarse sobre una lista que ya cambió.
   */
  function resetOutcome() {
    setIssue(null)
    validate.reset()
    addToCart.reset()
  }

  function run(parsed: ParsedLines) {
    resetOutcome()
    if (parsed.fileIssue) {
      setIssue(parsed.fileIssue)
      return
    }
    validate.mutate(parsed)
  }

  function editRow(id: number, patch: Partial<Pick<EditorRow, 'sku' | 'quantity'>>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch, malformed: false } : row)))
    resetOutcome()
  }

  function addRow() {
    if (rows.length >= QUICK_ORDER_MAX_ROWS) return
    setRows((current) => [...current, { id: nextId.current++, sku: '', quantity: '' }])
  }

  function removeRow(id: number) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current))
    resetOutcome()
  }

  /**
   * Pegar pasa las líneas a las filas en vez de validarlas aparte: así hay UNA
   * sola lista que revisar y una sola numeración. Las filas vacías se
   * reutilizan; una línea con columnas de más se trae igual y la validación la
   * marca, para que se corrija donde se ve.
   */
  function applyPaste() {
    const parsed = parsePastedLines(pasted)
    resetOutcome()
    if (parsed.fileIssue) {
      setIssue(parsed.fileIssue)
      return
    }
    const filled = rows.filter((row) => row.sku.trim() || row.quantity.trim())
    if (filled.length + parsed.lines.length > QUICK_ORDER_MAX_ROWS) {
      setIssue('LIMITE_FILAS')
      return
    }
    const incoming = parsed.lines.map((line) => ({
      id: nextId.current++,
      sku: line.sku,
      quantity: line.quantityText,
      malformed: line.malformed ?? false,
    }))
    setRows([...filled, ...incoming])
    setPasted('')
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileName(file.name)
    try {
      run(parseOrderCsv(await readText(file)))
    } catch {
      // Un archivo que el navegador no puede leer es, para el comprador, un
      // archivo sin filas: se le dice eso y se deja cargar otro.
      resetOutcome()
      setIssue('ARCHIVO_VACIO')
    }
  }

  const report: ReportLine[] | null = validate.data ?? null
  const result: CartImportResult | null = addToCart.data ?? null
  const accepted = (report ?? []).filter((line): line is AcceptedLine => line.status === 'ok')
  const rejectedCount = (report ?? []).length - accepted.length
  const busy = validate.isPending || addToCart.isPending

  const linesTab = (
    <Stack spacing={2}>
      <Stack spacing={1} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {rows.map((row, index) => {
          const label = t('store.quickOrder.row.label').replace('{row}', String(index + 1))
          return (
            <Stack key={row.id} component="li" direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography
                aria-hidden
                className="tnum"
                sx={{ width: 24, flexShrink: 0, color: 'var(--muted)', fontSize: TS.label, textAlign: 'right' }}
              >
                {index + 1}
              </Typography>
              <TextField
                size="small"
                label={t('store.quickOrder.field.sku')}
                value={row.sku}
                onChange={(event) => editRow(row.id, { sku: event.target.value })}
                slotProps={{ htmlInput: { maxLength: 120, 'aria-label': `${t('store.quickOrder.field.sku')} · ${label}` } }}
                sx={{ flex: 2, minWidth: 0 }}
              />
              <TextField
                size="small"
                label={t('store.quickOrder.field.quantity')}
                value={row.quantity}
                onChange={(event) => editRow(row.id, { quantity: event.target.value })}
                slotProps={{
                  htmlInput: {
                    inputMode: 'numeric',
                    maxLength: 5,
                    'aria-label': `${t('store.quickOrder.field.quantity')} · ${label}`,
                  },
                }}
                sx={{ flex: 1, minWidth: 0, maxWidth: 120 }}
              />
              <IconButton
                aria-label={t('store.quickOrder.row.remove').replace('{row}', String(index + 1))}
                onClick={() => removeRow(row.id)}
                disabled={rows.length <= 1}
                size="small"
              >
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          )
        })}
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          onClick={addRow}
          disabled={rows.length >= QUICK_ORDER_MAX_ROWS}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}
        >
          {t('store.quickOrder.row.add')}
        </Button>
        <Button variant="contained" onClick={() => run(draftsFromEditor(rows))} disabled={busy}>
          {validate.isPending ? t('store.quickOrder.validating') : t('store.quickOrder.validate')}
        </Button>
      </Stack>

      <Box sx={{ border: '1px dashed var(--border)', borderRadius: 2, p: 2 }}>
        <Stack spacing={1.5}>
          <TextField
            label={t('store.quickOrder.paste.label')}
            helperText={t('store.quickOrder.paste.help')}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            multiline
            minRows={3}
            placeholder={'SKU-001;12\nSKU-002;4'}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={applyPaste}
            disabled={busy || pasted.trim().length === 0}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('store.quickOrder.paste.apply')}
          </Button>
        </Stack>
      </Box>
    </Stack>
  )

  const csvTab = (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)', fontSize: TS.body }}>{t('store.quickOrder.csv.help')}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => downloadCsv('plantilla-pedido-rapido.csv', quickOrderCsvTemplate())}
        >
          {t('store.quickOrder.csv.template')}
        </Button>
        <Button size="small" variant="contained" disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('store.quickOrder.csv.choose')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          aria-label={t('store.quickOrder.csv.choose')}
          onChange={(event) => void onFile(event)}
        />
      </Stack>
      {fileName && (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
          {t('store.quickOrder.csv.file').replace('{name}', fileName)}
        </Typography>
      )}
    </Stack>
  )

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800 }}>
            {t('store.quickOrder.title')}
          </Typography>
          <Typography sx={{ color: 'var(--muted)', fontSize: TS.body, mt: 0.5 }}>
            {t('store.quickOrder.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          component={Link}
          to={`/s/${storeSlug}/account`}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' }, flexShrink: 0 }}
        >
          {t('store.quickOrder.backToAccount')}
        </Button>
      </Stack>

      <SectionTabs
        ariaLabel={t('store.quickOrder.title')}
        items={[
          { id: 'lineas', label: t('store.quickOrder.tab.lines'), content: linesTab },
          { id: 'csv', label: t('store.quickOrder.tab.csv'), content: csvTab },
        ]}
      />

      <Box aria-live="polite">
        {issue && <Alert severity="warning">{t(`store.quickOrder.fileIssue.${issue}`)}</Alert>}

        {validate.isPending && (
          <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
            <CircularProgress size={18} aria-hidden />
            <Typography sx={{ fontSize: TS.body }}>{t('store.quickOrder.validating')}</Typography>
          </Stack>
        )}

        {validate.isError && <Alert severity="error">{t(errorKey(validate.error))}</Alert>}

        {report && (
          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
              {t('store.quickOrder.report.title')}
            </Typography>
            <Alert severity={rejectedCount > 0 ? 'warning' : 'success'}>
              {t('store.quickOrder.report.summary')
                .replace('{accepted}', String(accepted.length))
                .replace('{rejected}', String(rejectedCount))}
            </Alert>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('store.quickOrder.report.row')}</TableCell>
                    <TableCell>{t('store.quickOrder.field.sku')}</TableCell>
                    <TableCell>{t('store.quickOrder.report.product')}</TableCell>
                    <TableCell align="right">{t('store.quickOrder.field.quantity')}</TableCell>
                    <TableCell>{t('store.quickOrder.report.status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.map((line) => (
                    <TableRow key={line.row}>
                      <TableCell className="tnum">{line.row}</TableCell>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{line.sku || '—'}</TableCell>
                      <TableCell>
                        {line.status === 'ok' ? (
                          <>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {line.name}
                            </Typography>
                            {line.variant_name && (
                              <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                                {line.variant_name}
                              </Typography>
                            )}
                          </>
                        ) : (
                          <Typography variant="body2">{t(`store.quickOrder.reason.${line.reason}`)}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" className="tnum">
                        {line.status === 'ok' ? line.quantity : '—'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={line.status === 'ok' ? 'success' : 'warning'}
                          label={line.status === 'ok' ? t('store.quickOrder.report.ok') : t('store.quickOrder.report.rejected')}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            {accepted.length === 0 ? (
              <Typography sx={{ color: 'var(--muted)', fontSize: TS.body }}>
                {t('store.quickOrder.nothingToAdd')}
              </Typography>
            ) : (
              <Button
                variant="contained"
                startIcon={<AddShoppingCartRoundedIcon />}
                onClick={() => addToCart.mutate(accepted)}
                disabled={busy || !cart}
                sx={{ alignSelf: { xs: 'stretch', sm: 'flex-end' } }}
              >
                {addToCart.isPending
                  ? t('store.quickOrder.adding')
                  : t('store.quickOrder.addToCart').replace('{count}', String(accepted.length))}
              </Button>
            )}

            {addToCart.isError && <Alert severity="error">{t('store.quickOrder.error.addFailed')}</Alert>}

            {result && (
              <Alert
                severity={result.skipped > 0 ? 'warning' : 'success'}
                action={
                  <Button color="inherit" size="small" component={Link} to={`/s/${storeSlug}/cart`}>
                    {t('store.quickOrder.goToCart')}
                  </Button>
                }
              >
                {t('store.quickOrder.result.done')
                  .replace('{added}', String(result.added))
                  .replace('{updated}', String(result.updated))
                  .replace('{unchanged}', String(result.unchanged))}
                {result.skipped > 0 &&
                  ` ${t('store.quickOrder.result.skipped').replace('{skipped}', String(result.skipped))}`}
                <br />
                {t('store.quickOrder.result.hint')}
              </Alert>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
