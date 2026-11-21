import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PriceRequest } from '@/domain'
import { serverPricing } from '@/features/pricing/serverPricing'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { Field } from '@/shared/ui/Field'
import { SelectField } from '@/shared/ui/SelectField'
import { TS } from '@/theme/tokens'
import { markAiAttribution } from '../aiAttribution'
import { useCommerceContext } from '../commerce/context'
import { mapQuoteRequestCode, myQuotesKey, newRequestKey, quoteErrorCode, requestQuote } from '../quotes'
import {
  compare,
  competitorGross,
  improvementNote,
  ourGrossUnits,
  taxRates,
  type ComparableLine,
} from './competitorQuote'
import {
  INTAKE_ACCEPT,
  INTAKE_MAX_TEXT,
  IntakeError,
  checkIntakeFile,
  fileToBase64,
  intakeMotivoKey,
  preselected,
  readIntake,
  type IntakeFileIssue,
  type IntakeLine,
  type IntakeProduct,
} from './intake'
import type { IntakeAcceptedLine } from './IntakePanel'

interface Choice {
  readonly checked: boolean
  readonly sku: string | null
  readonly quantity: string
}

/** IGV de Perú: solo si la tienda no devolvió la tasa del producto. */
const DEFAULT_TAX_RATE = 0.18

function errorKey(error: unknown): MessageKey {
  const code = error instanceof IntakeError ? error.code : ''
  if (code === 'RATE_LIMITED') return 'store.intake.error.rateLimited'
  if (code === 'ARCHIVO_DEMASIADO_GRANDE') return 'store.intake.file.ARCHIVO_DEMASIADO_GRANDE'
  if (code === 'TIPO_NO_ADMITIDO' || code === 'ARCHIVO_ILEGIBLE') return 'store.intake.file.TIPO_NO_ADMITIDO'
  return 'store.intake.error.generic'
}

function optionsOf(line: IntakeLine): IntakeProduct[] {
  return [line.coincidencia, ...line.alternativas].filter(
    (p): p is IntakeProduct => Boolean(p && p.sku && p.kind !== 'variant'),
  )
}

/**
 * «Mejora esta cotización» (2026-11-20).
 *
 * El comprador sube la cotización que le hizo otro proveedor y ve, línea a
 * línea, cuánto le costaría aquí con SU precio (el del carrito: lista, convenio
 * y escala), en la misma base de impuesto. Desde ahí:
 *
 *  · pasa lo que le convenga al pedido rápido, que lo valida como siempre;
 *  · si compra para una empresa y alguna línea sale más cara, pide al vendedor
 *    un precio mejor con la referencia de la otra cotización en la nota.
 *
 * La IA solo LEE el papel. Ningún precio de esta tienda pasa por el modelo.
 */
export function CompetitorQuotePanel({
  storeSlug,
  currency,
  onAccept,
}: {
  storeSlug: string
  currency: string
  onAccept: (lines: readonly IntakeAcceptedLine[]) => void
}) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const { context } = useCommerceContext(storeSlug, true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileIssue, setFileIssue] = useState<IntakeFileIssue | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])
  const [includesTax, setIncludesTax] = useState(false)
  const [requested, setRequested] = useState<string | null>(null)
  const requestKey = useRef('')

  const read = useMutation({
    mutationFn: async () => {
      const payload = file ? { mediaType: file.type, data: await fileToBase64(file) } : null
      return readIntake({ storeSlug, locale: locale === 'en' ? 'en' : 'es', text, file: payload, purpose: 'quote' })
    },
    onSuccess: (result) => {
      setRequested(null)
      requestKey.current = newRequestKey()
      // Sin dato, se asume SIN IGV: es como suele cotizar un proveedor en Perú,
      // y la pantalla lo dice para que la persona lo confirme.
      setIncludesTax(result.data?.cotizacion?.incluye_igv ?? false)
      setChoices(
        (result.data?.lineas ?? []).map((line) => ({
          checked: preselected(line),
          sku: line.sku_propuesto,
          quantity: String(line.cantidad),
        })),
      )
    },
  })

  const lines = useMemo<readonly IntakeLine[]>(() => read.data?.data?.lineas ?? [], [read.data])
  const quoteInfo = read.data?.data?.cotizacion
  const motivo = read.data?.motivo ?? null
  const otherCurrency = quoteInfo?.moneda && quoteInfo.moneda !== currency.toUpperCase() ? quoteInfo.moneda : null

  /** Cada línea marcada con su producto y cantidad, lista para cotizar. */
  const selected = useMemo(
    () =>
      choices.flatMap((choice, index) => {
        const line = lines[index]
        const quantity = Number.parseInt(choice.quantity, 10)
        if (!line || !choice.checked || !choice.sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
          return []
        }
        const product = optionsOf(line).find((p) => p.sku === choice.sku) ?? null
        return [{ index, line, sku: choice.sku, quantity, product }]
      }),
    [choices, lines],
  )

  const requests = useMemo<PriceRequest[]>(
    () =>
      selected
        .filter((s) => s.product)
        .map((s) => ({ productId: s.product!.product_id, variantId: null, uomCode: null, quantity: s.quantity })),
    [selected],
  )

  // El precio de ESTA tienda para este comprador: el mismo cálculo que cobra el carrito.
  const prices = useQuery({
    queryKey: ['pricing', 'competitor-compare', storeSlug, requests],
    queryFn: () => serverPricing.quote({ storeSlug, currency }, requests),
    enabled: requests.length > 0,
    retry: false,
    staleTime: 30_000,
  })

  const ours = useMemo(() => (prices.data ? ourGrossUnits(prices.data) : new Map<string, number>()), [prices.data])
  const rates = useMemo(() => (prices.data ? taxRates(prices.data) : new Map<string, number>()), [prices.data])

  const rows: ComparableLine[] = selected.map((s) => {
    const productId = s.product?.product_id ?? null
    const theirsRaw = s.line.precio_competencia ?? null
    const rate = (productId ? rates.get(productId) : undefined) ?? DEFAULT_TAX_RATE
    return {
      index: s.index,
      quantity: s.quantity,
      theirs: theirsRaw === null || otherCurrency ? null : competitorGross(theirsRaw, includesTax, rate),
      ours: productId ? (ours.get(productId) ?? null) : null,
    }
  })
  const byIndex = new Map(rows.map((r) => [r.index, r]))
  const result = compare(rows)
  const money = (n: number) => formatMoney(n, currency, locale)

  const askBetter = useMutation({
    mutationFn: () => {
      const pricier = selected.filter((s) => result.pricier.includes(s.index) && s.product)
      return requestQuote({
        storeSlug,
        lines: pricier.map((s) => ({ product_id: s.product!.product_id, quantity: s.quantity })),
        notes: improvementNote({
          header: t('store.compareQuote.requestNote'),
          currency,
          lines: pricier.map((s) => ({ text: s.line.texto, quantity: s.quantity, theirs: byIndex.get(s.index)?.theirs ?? 0 })),
        }),
        requestKey: requestKey.current,
      })
    },
    onSuccess: (created) => {
      setRequested(created.quote_number)
      void queryClient.invalidateQueries({ queryKey: myQuotesKey(storeSlug) })
    },
  })

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    event.target.value = ''
    read.reset()
    if (!chosen) return
    const issue = checkIntakeFile(chosen)
    setFileIssue(issue)
    setFile(issue ? null : chosen)
  }

  function update(index: number, patch: Partial<Choice>) {
    setChoices((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function acceptAll() {
    markAiAttribution(
      storeSlug,
      selected.flatMap((s) => (s.product ? [s.product.product_id] : [])),
      'intake',
    )
    onAccept(selected.map(({ sku, quantity }) => ({ sku, quantity })))
  }

  const canRead = !read.isPending && (Boolean(file) || text.trim().length >= 3)

  return (
    <Stack spacing={2} data-competitor-quote>
      <Typography sx={{ color: 'var(--muted)', fontSize: TS.body }}>{t('store.compareQuote.help')}</Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadFileRoundedIcon />}
          onClick={() => fileRef.current?.click()}
          disabled={read.isPending}
        >
          {t('store.compareQuote.file')}
        </Button>
        <input ref={fileRef} type="file" accept={INTAKE_ACCEPT} hidden aria-label={t('store.compareQuote.file')} onChange={onFile} />
        {file && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              {t('store.intake.file.chosen').replace('{name}', file.name)}
            </Typography>
            <Button size="small" onClick={() => setFile(null)}>
              {t('store.intake.file.remove')}
            </Button>
          </Stack>
        )}
      </Stack>
      {fileIssue && <Alert severity="warning">{t(`store.intake.file.${fileIssue}`)}</Alert>}

      <Field
        label={t('store.compareQuote.text')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rule="longText"
        maxLength={INTAKE_MAX_TEXT}
        multiline
        minRows={3}
        placeholder={t('store.compareQuote.placeholder')}
      />

      <Button
        variant="contained"
        startIcon={read.isPending ? <CircularProgress size={16} aria-hidden /> : <CompareArrowsRoundedIcon />}
        onClick={() => read.mutate()}
        disabled={!canRead}
        sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
      >
        {read.isPending ? t('store.intake.reading') : t('store.compareQuote.read')}
      </Button>

      <Box aria-live="polite">
        {read.isError && <Alert severity="error">{t(errorKey(read.error))}</Alert>}
        {read.isSuccess && motivo && (
          <Alert severity={motivo === 'vacia' ? 'info' : 'warning'}>
            {t(motivo === 'vacia' ? 'store.compareQuote.empty' : intakeMotivoKey(motivo))}
          </Alert>
        )}

        {lines.length > 0 && (
          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
              {t('store.compareQuote.title')}
            </Typography>

            {otherCurrency ? (
              <Alert severity="warning">
                {t('store.compareQuote.otherCurrency').replace('{currency}', otherCurrency)}
              </Alert>
            ) : (
              <Stack spacing={0.5}>
                <FormControlLabel
                  control={<Switch checked={includesTax} onChange={(event) => setIncludesTax(event.target.checked)} />}
                  label={t('store.compareQuote.includesTax')}
                />
                {quoteInfo?.incluye_igv == null && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('store.compareQuote.taxUnknown')}
                  </Typography>
                )}
              </Stack>
            )}
            {read.data?.data?.notas && <Alert severity="warning">{read.data.data.notas}</Alert>}
            {prices.isError && <Alert severity="warning">{t('store.compareQuote.pricesError')}</Alert>}

            {result.compared > 0 && (
              <Alert
                severity={result.saving > 0 ? 'success' : 'info'}
                data-compare-summary
                sx={{ '& .MuiAlert-message': { width: '100%' } }}
              >
                <Typography sx={{ fontWeight: 800 }}>
                  {result.saving > 0
                    ? t('store.compareQuote.saving')
                        .replace('{amount}', money(result.saving))
                        .replace('{pct}', String(result.savingPct))
                    : t('store.compareQuote.noSaving')}
                </Typography>
                <Typography sx={{ fontSize: TS.label }}>
                  {t('store.compareQuote.totals')
                    .replace('{theirs}', money(result.theirsTotal))
                    .replace('{ours}', money(result.oursTotal))
                    .replace('{count}', String(result.compared))}
                </Typography>
              </Alert>
            )}

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Box component="span" sx={visuallyHidden}>{t('store.intake.review.include')}</Box>
                    </TableCell>
                    <TableCell>{t('store.compareQuote.col.read')}</TableCell>
                    <TableCell>{t('store.intake.review.product')}</TableCell>
                    <TableCell align="right">{t('store.quickOrder.field.quantity')}</TableCell>
                    <TableCell align="right">{t('store.compareQuote.col.theirs')}</TableCell>
                    <TableCell align="right">{t('store.compareQuote.col.ours')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((line, index) => {
                    const choice = choices[index]
                    if (!choice) return null
                    const options = optionsOf(line)
                    const label = t('store.intake.review.lineLabel').replace('{n}', String(index + 1))
                    const row = byIndex.get(index)
                    const pricier = row && row.ours !== null && row.theirs !== null && row.ours > row.theirs
                    const cheaper = row && row.ours !== null && row.theirs !== null && row.ours < row.theirs
                    return (
                      <TableRow key={line.indice} sx={{ verticalAlign: 'top' }} data-compare-line={index}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={choice.checked}
                            disabled={!choice.sku}
                            onChange={(event) => update(index, { checked: event.target.checked })}
                            slotProps={{ input: { 'aria-label': `${t('store.intake.review.include')} · ${label}` } }}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 160 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {line.texto}
                          </Typography>
                          <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                            {line.unidad && <Chip size="small" variant="outlined" label={line.unidad} />}
                            {!line.legible && <Chip size="small" variant="outlined" label={t('store.intake.flag.unclear')} />}
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ minWidth: 200 }}>
                          {line.confianza === 'variante' && line.coincidencia ? (
                            <Button size="small" component={Link} to={`/s/${storeSlug}/product/${line.coincidencia.slug}`}>
                              {t('store.intake.review.chooseVariant').replace('{name}', line.coincidencia.name)}
                            </Button>
                          ) : options.length > 0 ? (
                            <SelectField
                              size="small"
                              label={t('store.intake.review.product')}
                              value={choice.sku ?? ''}
                              onChange={(event) => update(index, { sku: event.target.value || null })}
                              fullWidth
                            >
                              {options.map((p) => (
                                <MenuItem key={p.product_id} value={p.sku ?? ''}>
                                  {p.name}
                                  {p.sku ? ` · ${p.sku}` : ''}
                                </MenuItem>
                              ))}
                            </SelectField>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                              {t('store.intake.review.noMatch')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ width: 100 }}>
                          <Field
                            size="small"
                            label={t('store.quickOrder.field.quantity')}
                            value={choice.quantity}
                            onChange={(event) => update(index, { quantity: event.target.value })}
                            rule="integer"
                            maxLength={4}
                            slotProps={{ htmlInput: { 'aria-label': `${t('store.quickOrder.field.quantity')} · ${label}` } }}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {row?.theirs != null ? money(row.theirs) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {row?.ours != null ? (
                            <Stack sx={{ alignItems: 'flex-end' }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{money(row.ours)}</Typography>
                              {cheaper && <Chip size="small" color="success" label={t('store.compareQuote.cheaper')} />}
                              {pricier && <Chip size="small" color="warning" label={t('store.compareQuote.pricier')} />}
                            </Stack>
                          ) : prices.isFetching && choice.checked ? (
                            <CircularProgress size={14} aria-label={t('common.loading')} />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.compareQuote.footnote')}</Typography>

            {requested && (
              <Alert severity="success">
                {t('store.compareQuote.requested').replace('{number}', requested)}{' '}
                <Link to={`/s/${storeSlug}/account#cotizaciones`}>{t('store.cart.requestQuote.seeQuotes')}</Link>
              </Alert>
            )}
            {askBetter.isError && <Alert severity="error">{t(mapQuoteRequestCode(quoteErrorCode(askBetter.error)))}</Alert>}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
              {context !== null && result.pricier.length > 0 && !requested && (
                <Button variant="outlined" onClick={() => askBetter.mutate()} disabled={askBetter.isPending}>
                  {t('store.compareQuote.askBetter').replace('{count}', String(result.pricier.length))}
                </Button>
              )}
              <Button variant="contained" onClick={acceptAll} disabled={selected.length === 0}>
                {t('store.intake.review.accept').replace('{count}', String(selected.length))}
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
