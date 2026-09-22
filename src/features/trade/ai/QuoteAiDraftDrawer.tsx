import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { useCustomerOptions } from '@/features/customers/hooks'
import { MarkerText, MotivoNotice } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoneyOrDash } from '@/shared/lib/format'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { StatusChip } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { TradeError } from '../errors'
import {
  MAX_ASSORTMENT_QUESTION,
  MAX_DRAFT_LINES,
  MAX_INSTRUCTION,
  linesFromResolution,
  newRequestKey,
  parseQuantity,
  pendingLines,
  readyLines,
  validUntilFrom,
  type AssortmentCandidate,
  type AssortmentSystem,
  type DraftLineState,
  type DraftPreview,
  type ProductCandidate,
} from './quotesAi'
import {
  useAssortmentSignals,
  useAssortmentSuggestions,
  useCreateQuoteFromDraft,
  useDraftPreview,
  useQuoteDraft,
} from './useQuotesAi'

/** Ejemplos de instrucción (se escriben en el campo; no gastan nada). */
const EXAMPLES = ['example1', 'example2'] as const

interface ChosenCustomer {
  readonly id: string
  readonly name: string
  readonly code: string | null
}

function Block({ title, help, children, id }: { title: string; help?: string; children: ReactNode; id: string }) {
  return (
    <Card variant="outlined" component="section" aria-labelledby={id}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography id={id} component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
          {title}
        </Typography>
        {help && <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{help}</Typography>}
        {children}
      </CardContent>
    </Card>
  )
}

function defaultQuoteNumber(today = new Date()): string {
  const d = today.toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `COT-${d}-${suffix}`
}

function candidateFromSuggestion(c: AssortmentCandidate): ProductCandidate {
  return {
    product_id: c.product_id,
    sku: c.sku ?? '',
    name: c.name,
    kind: c.product_kind,
    match: 'name',
    matched_variant_id: null,
    in_assortment: true,
    variants: [],
  }
}

/**
 * Borrador de cotización con IA (fase 07).
 *
 * PROPONER → CONFIRMAR → VALIDAR → EJECUTAR:
 *  1. La persona escribe la instrucción; la IA la interpreta y el SISTEMA la
 *     resuelve contra clientes y productos reales. Con duda hay candidatos y
 *     elige la persona (nunca se elige por ella).
 *  2. «Precio del sistema»: el motor precia cada línea, dice su impuesto, su
 *     disponibilidad y si está en el surtido del cliente. La IA no interviene.
 *  3. Sugerencias de surtido (del sistema; la IA solo prioriza y explica).
 *  4. Confirmación explícita y «Crear borrador»: el servidor re-precia y crea
 *     la cotización en `draft`. Nada se guarda antes.
 *
 * Se monta al abrir y se desmonta al cerrar (`QuotesPage`): un borrador a
 * medias no sobrevive a cerrar el cajón ni se guarda en ningún sitio.
 */
export function QuoteAiDraftDrawer({
  open,
  storeId,
  onClose,
  onCreated,
}: {
  open: boolean
  storeId: string
  onClose: () => void
  onCreated?: (quoteId: string) => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const { availability } = useAiFeature('quotes')
  const canAsk = availability === 'available'

  const [instruction, setInstruction] = useState('')
  const draft = useQuoteDraft(locale)
  const [customer, setCustomer] = useState<ChosenCustomer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [lines, setLines] = useState<DraftLineState[]>([])
  const [quoteNumber, setQuoteNumber] = useState(() => defaultQuoteNumber())
  const [validUntil, setValidUntil] = useState(() => validUntilFrom(null))
  const [notes, setNotes] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [requestKey, setRequestKey] = useState(() => newRequestKey())
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [question, setQuestion] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const create = useCreateQuoteFromDraft()
  const suggest = useAssortmentSuggestions(locale)

  const customers = useCustomerOptions({ term: customerSearch, enabled: open && customerSearch.trim().length >= 2 })
  const customerOptions = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )

  const toPrice = useMemo(() => readyLines(lines), [lines])
  const preview = useDraftPreview(storeId, customer?.id ?? null, toPrice)
  const pending = pendingLines(lines)
  const signals = useAssortmentSignals(storeId, customer?.id ?? null, locale, open && showSuggestions)

  const interpretation = draft.data?.result.data ?? null
  const resolution = draft.data?.system ?? null

  // Una interpretación nueva reemplaza cliente, líneas, vigencia y nota.
  useEffect(() => {
    const res = draft.data
    // Sin interpretación (motivo tipado) no se toca lo que la persona ya tenía.
    if (!res?.result.data || !res.system) return
    const sys = res.system
    const elegido = sys.customer.candidates.find((c) => c.customer_id === sys.customer.selected_customer_id)
    setCustomer(elegido ? { id: elegido.customer_id, name: elegido.name, code: elegido.code } : null)
    setLines(linesFromResolution(sys))
    setValidUntil(validUntilFrom(res.result.data.validity_days))
    setNotes(res.result.data.notes)
    setReviewed(false)
    setRequestKey(newRequestKey())
  }, [draft.data])

  // Cualquier cambio en lo que se va a guardar pide revisar otra vez.
  useEffect(() => {
    setReviewed(false)
  }, [customer?.id, toPrice])

  const tooLong = instruction.trim().length > MAX_INSTRUCTION
  function interpret(event?: FormEvent) {
    event?.preventDefault()
    const text = instruction.trim()
    if (!canAsk || draft.isPending || text.length < 3 || tooLong) return
    draft.mutate({ storeId, instruction: text })
  }

  function updateLine(key: string, patch: Partial<DraftLineState>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function chooseProduct(line: DraftLineState, productId: string) {
    const cand = line.candidates.find((c) => c.product_id === productId)
    updateLine(line.key, {
      productId,
      variantId:
        cand?.kind === 'variant'
          ? (cand.matched_variant_id ?? (cand.variants.length === 1 ? cand.variants[0]!.variant_id : null))
          : null,
    })
  }

  function addSuggestion(c: AssortmentCandidate) {
    setLines((prev) => {
      if (prev.length >= MAX_DRAFT_LINES || prev.some((l) => l.productId === c.product_id)) return prev
      return [
        ...prev,
        {
          key: `s${c.product_id}`,
          query: c.name,
          status: 'suggested',
          candidates: [candidateFromSuggestion(c)],
          productId: c.product_id,
          variantId: null,
          // La cantidad la pone la persona: ni el sistema ni la IA la proponen.
          quantity: '',
        },
      ]
    })
  }

  const ready = Boolean(
    customer &&
      preview.data?.ready &&
      !preview.isFetching &&
      pending === 0 &&
      toPrice.length > 0 &&
      quoteNumber.trim() &&
      validUntil,
  )

  async function save() {
    if (!customer || !ready || !reviewed) return
    setServerError(null)
    try {
      const created = await create.mutateAsync({
        storeId,
        customerId: customer.id,
        quoteNumber,
        validUntil,
        notes,
        lines: toPrice,
        requestKey,
      })
      notify(t('aiQuotes.toast.created').replace('{n}', created.quote_number), 'success')
      onCreated?.(created.quote_id)
      onClose()
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  const result = draft.data?.result

  return (
    <FormDrawer
      open={open}
      title={t('aiQuotes.title')}
      subtitle={t('aiQuotes.subtitle')}
      onClose={onClose}
      width={760}
      busy={create.isPending}
      actions={
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={!ready || !reviewed || create.isPending}>
            {t('aiQuotes.confirm.create')}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        <Alert severity="info" icon={<AutoAwesomeRoundedIcon fontSize="small" />}>
          {t('aiQuotes.notice')}
        </Alert>

        {/* 1 · Instrucción */}
        <Block id="ai-quote-instruction" title={t('aiQuotes.instruction.title')} help={t('aiQuotes.instruction.help')}>
          {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
          {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}
          {canAsk && (
            <Box component="form" onSubmit={interpret} noValidate>
              <Stack spacing={1}>
                <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiQuotes.examples')}>
                  {EXAMPLES.map((id) => (
                    <Chip
                      key={id}
                      variant="outlined"
                      clickable
                      label={t(`aiQuotes.${id}` as MessageKey)}
                      onClick={() => setInstruction(t(`aiQuotes.${id}` as MessageKey))}
                    />
                  ))}
                </Stack>
                <TextField
                  multiline
                  minRows={3}
                  fullWidth
                  label={t('aiQuotes.instruction.label')}
                  placeholder={t('aiQuotes.instruction.placeholder')}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiQuotes.instruction.tooLong') : t('aiQuotes.costHint')}
                  inputProps={{ maxLength: MAX_INSTRUCTION + 50 }}
                />
                <Box>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<AutoAwesomeRoundedIcon />}
                    disabled={draft.isPending || instruction.trim().length < 3 || tooLong}
                  >
                    {t('aiQuotes.instruction.run')}
                  </Button>
                </Box>
              </Stack>
            </Box>
          )}
          <Box aria-live="polite" aria-busy={draft.isPending}>
            {draft.isPending && (
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiQuotes.interpreting')}</Typography>
                <Skeleton variant="rounded" height={72} />
              </Stack>
            )}
            {!draft.isPending && draft.isError && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => interpret()}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiQuotes.networkError')}
              </Alert>
            )}
            {!draft.isPending && result?.motivo && <MotivoNotice motivo={result.motivo} onRetry={() => interpret()} />}
            {!draft.isPending && interpretation && (
              <Stack spacing={1} sx={{ mt: 1 }}>
                <Typography component="h4" sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  {t('aiQuotes.interpretation.title')}
                </Typography>
                {interpretation.summary && <Typography sx={{ fontSize: 13.5 }}>{interpretation.summary}</Typography>}
                {interpretation.price_requested && (
                  <Alert severity="warning">{t('aiQuotes.interpretation.priceIgnored')}</Alert>
                )}
                {interpretation.unresolved.length > 0 && (
                  <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{t('aiQuotes.interpretation.unresolved')}</Typography>
                    <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
                      {interpretation.unresolved.map((u, i) => (
                        <Typography component="li" key={i} sx={{ fontSize: 12.5 }}>
                          {u}
                        </Typography>
                      ))}
                    </Stack>
                  </Box>
                )}
                {interpretation.discarded > 0 && (
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                    {t('aiOrders.discarded').replace('{n}', String(interpretation.discarded))}
                  </Typography>
                )}
                <AiFeedbackButtons interactionId={result?.interactionId ?? null} />
              </Stack>
            )}
          </Box>
        </Block>

        {/* 2 · Cliente */}
        <Block id="ai-quote-customer" title={t('aiQuotes.customer.title')} help={t('aiQuotes.customer.help')}>
          {resolution && resolution.customer.status !== 'resolved' && resolution.customer.status !== 'missing' && (
            <Alert severity={resolution.customer.status === 'ambiguous' ? 'warning' : 'info'}>
              {t(`aiQuotes.customer.status.${resolution.customer.status}` as MessageKey).replace(
                '{q}',
                resolution.customer.query ?? '',
              )}
            </Alert>
          )}
          {resolution && resolution.customer.candidates.length > 1 && (
            <RadioGroup
              aria-label={t('aiQuotes.customer.candidates')}
              value={customer?.id ?? ''}
              onChange={(e) => {
                const c = resolution.customer.candidates.find((x) => x.customer_id === e.target.value)
                if (c) setCustomer({ id: c.customer_id, name: c.name, code: c.code })
              }}
            >
              {resolution.customer.candidates.map((c) => (
                <FormControlLabel
                  key={c.customer_id}
                  value={c.customer_id}
                  control={<Radio size="small" />}
                  label={
                    <Typography sx={{ fontSize: 13 }}>
                      {c.name} <Box component="span" sx={{ color: 'var(--muted)' }}>{c.code ?? ''}</Box>
                    </Typography>
                  }
                />
              ))}
            </RadioGroup>
          )}
          <EntityPicker
            label={t('aiQuotes.customer.search')}
            term={customerSearch}
            onTermChange={setCustomerSearch}
            options={customerOptions}
            value={customer ? { id: customer.id, primary: customer.name, secondary: customer.code } : null}
            onPick={(o) => setCustomer({ id: o.id, name: o.primary, code: o.secondary ?? null })}
            onClear={() => setCustomer(null)}
            loading={customers.isFetching}
          />
          {resolution?.assortment?.configured && (
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('aiQuotes.customer.assortment').replace('{name}', resolution.assortment.name ?? '')}
            </Typography>
          )}
        </Block>

        {/* 3 · Líneas */}
        <Block id="ai-quote-lines" title={t('aiQuotes.lines.title')} help={t('aiQuotes.lines.help')}>
          {lines.length === 0 && <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiQuotes.lines.empty')}</Typography>}
          <Stack spacing={1.25}>
            {lines.map((line) => (
              <DraftLineEditor
                key={line.key}
                line={line}
                onChoose={(id) => chooseProduct(line, id)}
                onVariant={(variantId) => updateLine(line.key, { variantId })}
                onQuantity={(quantity) => updateLine(line.key, { quantity })}
                onRemove={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              />
            ))}
          </Stack>
          {pending > 0 && (
            <Alert severity="warning">{t('aiQuotes.lines.pending').replace('{n}', String(pending))}</Alert>
          )}
        </Block>

        {/* 4 · Sugerencias de surtido */}
        <Block id="ai-quote-assortment" title={t('aiQuotes.assortment.title')} help={t('aiQuotes.assortment.help')}>
          {!customer && <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiQuotes.assortment.needCustomer')}</Typography>}
          {customer && !showSuggestions && (
            <Box>
              <Button variant="outlined" onClick={() => setShowSuggestions(true)}>
                {t('aiQuotes.assortment.show')}
              </Button>
            </Box>
          )}
          {customer && showSuggestions && (
            <AssortmentBlock
              storeId={storeId}
              customerId={customer.id}
              signals={signals}
              canAsk={canAsk}
              question={question}
              onQuestion={setQuestion}
              suggest={suggest}
              onAdd={addSuggestion}
              addedIds={new Set(lines.map((l) => l.productId).filter((x): x is string => Boolean(x)))}
            />
          )}
        </Block>

        {/* 5 · Precio del sistema */}
        <Block id="ai-quote-price" title={t('aiQuotes.price.title')} help={t('aiQuotes.price.help')}>
          {!customer && <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiQuotes.price.needCustomer')}</Typography>}
          {customer && toPrice.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiQuotes.price.needLines')}</Typography>
          )}
          <Box aria-live="polite" aria-busy={preview.isFetching}>
            {customer && toPrice.length > 0 && preview.isPending && <Skeleton variant="rounded" height={96} />}
            {preview.isError && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void preview.refetch()}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiQuotes.price.error')}
              </Alert>
            )}
            {customer && toPrice.length > 0 && preview.data && <PreviewTable preview={preview.data} />}
            {customer && toPrice.length > 0 && preview.isSuccess && !preview.data && (
              <Alert severity="warning">{t('aiQuotes.price.customerHidden')}</Alert>
            )}
          </Box>
        </Block>

        {/* 6 · Confirmación humana */}
        <Block id="ai-quote-confirm" title={t('aiQuotes.confirm.title')} help={t('aiQuotes.confirm.help')}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              label={t('trade.field.number')}
              value={quoteNumber}
              onChange={(e) => setQuoteNumber(e.target.value)}
              inputProps={{ maxLength: 60 }}
              required
              fullWidth
            />
            <TextField
              size="small"
              type="date"
              label={t('trade.field.validUntil')}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
              fullWidth
            />
          </Stack>
          <TextField
            size="small"
            multiline
            minRows={2}
            label={t('trade.field.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            inputProps={{ maxLength: 2000 }}
            fullWidth
          />
          <FormControlLabel
            control={<Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={!ready} />}
            label={<Typography sx={{ fontSize: 13 }}>{t('aiQuotes.confirm.reviewed')}</Typography>}
          />
          {!ready && <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiQuotes.confirm.notReady')}</Typography>}
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}
        </Block>

        <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiQuotes.disclaimer')}</Typography>
      </Stack>
    </FormDrawer>
  )
}

function DraftLineEditor({
  line,
  onChoose,
  onVariant,
  onQuantity,
  onRemove,
}: {
  line: DraftLineState
  onChoose: (productId: string) => void
  onVariant: (variantId: string | null) => void
  onQuantity: (quantity: string) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const chosen = line.candidates.find((c) => c.product_id === line.productId) ?? null
  const qtyInvalid = line.quantity.trim() !== '' && parseQuantity(line.quantity) === null
  const tone =
    line.status === 'resolved' || line.status === 'suggested'
      ? ('success' as const)
      : line.status === 'ambiguous'
        ? ('warning' as const)
        : ('error' as const)

  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 1.5, p: 1.25 }} role="group" aria-label={line.query}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0 }} noWrap title={line.query}>
          «{line.query}»
        </Typography>
        <StatusChip tone={tone} label={t(`aiQuotes.line.status.${line.status}` as MessageKey)} />
        <Button size="small" color="inherit" onClick={onRemove} startIcon={<DeleteRoundedIcon fontSize="small" />}>
          {t('aiQuotes.line.remove')}
        </Button>
      </Stack>

      {line.candidates.length === 0 && (
        <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiQuotes.line.noCandidates')}</Typography>
      )}
      {line.candidates.length > 0 && (
        <RadioGroup
          aria-label={t('aiQuotes.line.candidates')}
          value={line.productId ?? ''}
          onChange={(e) => onChoose(e.target.value)}
        >
          {line.candidates.map((c) => {
            const outside = c.in_assortment === false
            return (
              <FormControlLabel
                key={c.product_id}
                value={c.product_id}
                disabled={outside}
                control={<Radio size="small" />}
                label={
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: 13 }}>{c.name}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.sku}</Typography>
                    {c.match !== 'partial' && (
                      <Chip size="small" variant="outlined" label={t(`aiQuotes.match.${c.match}` as MessageKey)} />
                    )}
                    {outside && <Chip size="small" color="warning" variant="outlined" label={t('aiQuotes.line.outsideAssortment')} />}
                  </Stack>
                }
              />
            )
          })}
        </RadioGroup>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.75 }}>
        {chosen?.kind === 'variant' && (
          <FormControl size="small" sx={{ minWidth: 200 }} error={!line.variantId}>
            <InputLabel id={`variant-${line.key}`}>{t('aiQuotes.line.variant')}</InputLabel>
            <Select
              labelId={`variant-${line.key}`}
              label={t('aiQuotes.line.variant')}
              value={line.variantId ?? ''}
              onChange={(e) => onVariant(e.target.value ? String(e.target.value) : null)}
            >
              {chosen.variants.map((v) => (
                <MenuItem key={v.variant_id} value={v.variant_id}>
                  {v.name} · {v.sku}
                </MenuItem>
              ))}
            </Select>
            {chosen.variants.length === 0 && (
              <Typography sx={{ fontSize: 11.5, color: 'var(--muted)', mt: 0.5 }}>{t('aiQuotes.line.variantUnknown')}</Typography>
            )}
          </FormControl>
        )}
        <TextField
          size="small"
          label={t('trade.field.quantity')}
          value={line.quantity}
          onChange={(e) => onQuantity(e.target.value)}
          error={qtyInvalid || line.quantity.trim() === ''}
          helperText={line.quantity.trim() === '' ? t('aiQuotes.line.quantityMissing') : qtyInvalid ? t('trade.error.quantity') : ' '}
          inputProps={{ inputMode: 'numeric', maxLength: 6 }}
          sx={{ maxWidth: 200 }}
        />
      </Stack>
    </Box>
  )
}

function PreviewTable({ preview }: { preview: DraftPreview }) {
  const { t, locale } = useI18n()
  const currency = preview.currency ?? 'PEN'
  return (
    <Stack spacing={1}>
      {preview.pricing_error && (
        <Alert severity="error">{t('aiQuotes.price.engineError').replace('{code}', preview.pricing_error)}</Alert>
      )}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={t('aiQuotes.price.title')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('trade.field.product')}</TableCell>
              <TableCell align="right">{t('trade.field.quantity')}</TableCell>
              <TableCell align="right">{t('trade.field.unitPrice')}</TableCell>
              <TableCell align="right">{t('aiQuotes.price.tax')}</TableCell>
              <TableCell align="right">{t('trade.field.lineTotal')}</TableCell>
              <TableCell>{t('aiQuotes.price.status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {preview.lines.map((l) => (
              <TableRow key={`${l.product_id}:${l.variant_id ?? ''}`}>
                <TableCell>
                  <Typography sx={{ fontSize: 13 }}>{l.variant_name ?? l.name ?? '—'}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                    {l.sku ?? ''}
                    {l.price_list_code ? ` · ${t('aiQuotes.price.list').replace('{code}', l.price_list_code)}` : ''}
                  </Typography>
                </TableCell>
                <TableCell align="right" className="tnum">{l.quantity}</TableCell>
                <TableCell align="right" className="tnum">{formatMoneyOrDash(l.unit_price, currency, locale)}</TableCell>
                <TableCell align="right" className="tnum">{formatMoneyOrDash(l.tax_amount, currency, locale)}</TableCell>
                <TableCell align="right" className="tnum" sx={{ fontWeight: 700 }}>
                  {formatMoneyOrDash(l.line_total, currency, locale)}
                </TableCell>
                <TableCell>
                  {l.blocked ? (
                    <StatusChip tone="error" label={t(`aiQuotes.block.${l.blocked}` as MessageKey)} />
                  ) : l.availability?.unknown ? (
                    <StatusChip tone="warning" label={t('aiQuotes.stock.unknown')} />
                  ) : l.availability?.in_stock ? (
                    <StatusChip tone="success" label={t('aiQuotes.stock.inStock')} />
                  ) : (
                    <StatusChip tone="warning" label={t('aiQuotes.stock.out')} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Stack spacing={0.25} sx={{ alignItems: 'flex-end' }}>
        <Typography sx={{ fontSize: 13 }}>
          {t('aiQuotes.price.subtotal')}: <strong className="tnum">{formatMoneyOrDash(preview.subtotal, currency, locale)}</strong>
        </Typography>
        <Typography sx={{ fontSize: 13 }}>
          {t('aiQuotes.price.taxTotal')}: <strong className="tnum">{formatMoneyOrDash(preview.tax_total, currency, locale)}</strong>
        </Typography>
        <Typography sx={{ fontSize: 14, fontWeight: 800 }}>
          {t('trade.field.grandTotal')}: <span className="tnum">{formatMoneyOrDash(preview.grand_total, currency, locale)}</span>
        </Typography>
      </Stack>
      {preview.lines.some((l) => !l.blocked && l.availability && !l.availability.in_stock && !l.availability.unknown) && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiQuotes.stock.notBlocking')}</Typography>
      )}
    </Stack>
  )
}

function AssortmentBlock({
  storeId,
  customerId,
  signals,
  canAsk,
  question,
  onQuestion,
  suggest,
  onAdd,
  addedIds,
}: {
  storeId: string
  customerId: string
  signals: ReturnType<typeof useAssortmentSignals>
  canAsk: boolean
  question: string
  onQuestion: (q: string) => void
  suggest: ReturnType<typeof useAssortmentSuggestions>
  onAdd: (c: AssortmentCandidate) => void
  addedIds: ReadonlySet<string>
}) {
  const { t } = useI18n()
  const system: AssortmentSystem | null = signals.data ?? null
  const tooLong = question.trim().length > MAX_ASSORTMENT_QUESTION
  const ai = suggest.data?.result
  const data = ai?.data ?? null
  const byRef = new Map((system?.candidates ?? []).map((c) => [c.ref, c]))

  function run() {
    if (!canAsk || suggest.isPending || tooLong) return
    suggest.mutate({ storeId, customerId, question: question.trim() || null })
  }

  function addButton(c: AssortmentCandidate) {
    const added = addedIds.has(c.product_id)
    const variant = c.product_kind === 'variant'
    return (
      <Button
        size="small"
        startIcon={<AddRoundedIcon fontSize="small" />}
        disabled={added || variant}
        onClick={() => onAdd(c)}
        title={variant ? t('aiQuotes.assortment.variantHint') : undefined}
      >
        {added ? t('aiQuotes.assortment.added') : t('aiQuotes.assortment.add')}
      </Button>
    )
  }

  return (
    <Stack spacing={1.25}>
      <Box aria-live="polite" aria-busy={signals.isPending}>
        {signals.isPending && <Skeleton variant="rounded" height={80} />}
        {signals.isError && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void signals.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiQuotes.assortment.error')}
          </Alert>
        )}
        {system && system.candidates.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiQuotes.assortment.none')}</Typography>
        )}
        {system && system.candidates.length > 0 && (
          <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {system.candidates.map((c) => (
              <Stack component="li" key={c.ref} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip size="small" variant="outlined" label={t(`aiQuotes.kind.${c.kind}` as MessageKey)} />
                <Typography sx={{ fontSize: 13, flex: 1, minWidth: 160 }}>
                  {c.name} <Box component="span" sx={{ color: 'var(--muted)', fontSize: 11.5 }}>{c.sku ?? ''}</Box>
                </Typography>
                {c.availability === 'unknown' && <Chip size="small" color="warning" variant="outlined" label={t('aiQuotes.stock.unknown')} />}
                {addButton(c)}
              </Stack>
            ))}
          </Stack>
        )}
        {system && (system.excluded.out_of_assortment > 0 || system.excluded.unavailable > 0) && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mt: 0.75 }}>
            {t('aiQuotes.assortment.excluded')
              .replace('{a}', String(system.excluded.out_of_assortment))
              .replace('{s}', String(system.excluded.unavailable))}
          </Typography>
        )}
      </Box>

      {canAsk && system && system.candidates.length > 0 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            fullWidth
            size="small"
            label={t('aiQuotes.assortment.question')}
            value={question}
            onChange={(e) => onQuestion(e.target.value)}
            error={tooLong}
            helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiQuotes.costHint')}
            inputProps={{ maxLength: MAX_ASSORTMENT_QUESTION + 50 }}
          />
          <Button
            variant="contained"
            startIcon={<AutoAwesomeRoundedIcon />}
            onClick={run}
            disabled={suggest.isPending || tooLong}
            sx={{ flexShrink: 0 }}
          >
            {t('aiQuotes.assortment.prioritize')}
          </Button>
        </Stack>
      )}

      <Box aria-live="polite" aria-busy={suggest.isPending}>
        {suggest.isPending && <Skeleton variant="rounded" height={96} />}
        {!suggest.isPending && suggest.isError && <Alert severity="error">{t('aiQuotes.networkError')}</Alert>}
        {!suggest.isPending && ai?.motivo && <MotivoNotice motivo={ai.motivo} onRetry={run} />}
        {!suggest.isPending && data && (
          <Stack spacing={1}>
            {data.answer && (
              <Typography sx={{ fontSize: 13.5 }}>
                <MarkerText text={data.answer} context={data} />
              </Typography>
            )}
            {data.overview && (
              <Typography sx={{ fontSize: 13.5 }}>
                <MarkerText text={data.overview} context={data} />
              </Typography>
            )}
            <Stack component="ol" spacing={1} sx={{ m: 0, pl: 2 }}>
              {data.suggestions.map((s) => {
                const c = byRef.get(s.ref)
                return (
                  <Box component="li" key={s.ref}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{c?.name ?? data.entities[s.ref]?.label ?? '—'}</Typography>
                      <Chip size="small" variant="outlined" label={t(`aiQuotes.kind.${s.kind}` as MessageKey)} />
                      <Chip size="small" label={t(`aiQuotes.priority.${s.priority}` as MessageKey)} />
                      {c && addButton(c)}
                    </Stack>
                    <Typography sx={{ fontSize: 13 }}>
                      <MarkerText text={s.reason} context={data} />
                    </Typography>
                  </Box>
                )
              })}
            </Stack>
            {data.discarded > 0 && (
              <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                {t('aiOrders.discarded').replace('{n}', String(data.discarded))}
              </Typography>
            )}
            <AiFeedbackButtons interactionId={ai?.interactionId ?? null} />
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
