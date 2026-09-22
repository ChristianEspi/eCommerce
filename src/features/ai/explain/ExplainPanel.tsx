import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { formatMetric } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import type { AiFeature } from '@/features/ai/features'
import { useAiFeature } from '@/features/ai/hooks'
import { AiBlock } from '@/features/customers/ai/CustomerAiPanel'
import { MarkerText, MotivoNotice, SeverityIcon } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import {
  DRAFT_TONES,
  MAX_DRAFT_NOTES,
  MAX_EXPLAIN_QUESTION,
  draftToPlainText,
  metricSuffix,
  type DraftTone,
  type ExplainAction,
  type ExplainClient,
  type ExplainContext,
  type ExplainDraft,
  type ExplainInsight,
  type ExplainItem,
  type ExplainSystem,
} from './explainAi'
import { useExplainDraft, useExplainInsight, useExplainSignals } from './useExplain'

/** Namespace i18n de cada superficie (claves `<ns>.signal.*`, `<ns>.metric.*`…). */
export type ExplainNamespace = 'aiCredit' | 'aiPayments' | 'aiFulfillment' | 'aiOps' | 'aiIntegrations'

type Translate = (key: MessageKey) => string

/** Traducción con respaldo: una clave que no existe no se pinta cruda. */
function tr(t: Translate, key: string, fallback: string): string {
  const out = t(key as MessageKey)
  return out === key ? fallback : out
}

// ---------------------------------------------------------------------------
// CÁLCULO DEL SISTEMA
// ---------------------------------------------------------------------------

function MetricGrid({ keys, context, ns }: { keys: readonly string[]; context: ExplainContext; ns: ExplainNamespace }) {
  const { t, locale } = useI18n()
  const shown = keys.filter((k) => context.metrics[k])
  if (shown.length === 0) return null
  return (
    <Box
      component="dl"
      sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1 }}
    >
      {shown.map((k) => (
        <Box key={k} sx={{ p: 1, border: '1px solid var(--border)', borderRadius: 1.5, minWidth: 0 }}>
          <Typography component="dt" sx={{ fontSize: 11, color: 'var(--muted)' }}>
            {tr(t, `${ns}.metric.${metricSuffix(k)}`, metricSuffix(k))}
          </Typography>
          <Typography component="dd" className="tnum" sx={{ m: 0, fontSize: 15, fontWeight: 800 }}>
            {formatMetric(context.metrics[k]!, locale, { days: t('aiOrders.unit.days') })}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

function SignalList({
  signals,
  ns,
  context,
}: {
  signals: ExplainSystem['signals']
  ns: ExplainNamespace
  context: ExplainContext
}) {
  const { t } = useI18n()
  if (signals.length === 0) {
    return <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiExplain.system.noSignals')}</Typography>
  }
  return (
    <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {signals.map((s) => (
        <Stack component="li" key={`${s.code}-${s.ref ?? ''}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <SeverityIcon severity={s.severity} />
          <Typography sx={{ fontSize: 13 }}>
            {tr(t, `${ns}.signal.${s.code}`, s.code)}
            {s.ref && context.entities[s.ref] ? (
              <Box component="span" sx={{ color: 'var(--muted)' }}>{` · ${context.entities[s.ref]!.label}`}</Box>
            ) : null}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

function ItemList({
  items,
  ns,
  onOpenItem,
}: {
  items: readonly ExplainItem[]
  ns: ExplainNamespace
  onOpenItem?: (item: ExplainItem) => void
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  return (
    <AiBlock title={t(`${ns}.items` as MessageKey)}>
      <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <Stack
            component="li"
            key={item.ref}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', borderBottom: '1px solid var(--border)', pb: 1 }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
              <SeverityIcon severity={item.severity} />
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{item.label}</Typography>
                <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                  {item.signals.map((code) => (
                    <Chip key={code} size="small" variant="outlined" label={tr(t, `${ns}.signal.${code}`, code)} />
                  ))}
                </Stack>
              </Stack>
            </Stack>
            {onOpenItem && (
              <Button size="small" onClick={() => onOpenItem(item)} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
                {t('aiExplain.analyze')}
              </Button>
            )}
          </Stack>
        ))}
      </Stack>
    </AiBlock>
  )
}

function Rows({ system, ns, noteLabel }: { system: ExplainSystem; ns: ExplainNamespace; noteLabel?: (note: string) => string }) {
  const { t, locale } = useI18n()
  const groups = [...new Set(system.rows.map((r) => r.group))]
  if (groups.length === 0) return null
  return (
    <Stack spacing={1.5}>
      {groups.map((group) => (
        <AiBlock key={group} title={tr(t, `${ns}.group.${group}`, group)}>
          <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {system.rows
              .filter((r) => r.group === group)
              .map((r, i) => (
                <Stack
                  component="li"
                  key={`${group}-${i}`}
                  direction="row"
                  useFlexGap
                  spacing={1}
                  sx={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{r.label}</Typography>
                  {r.status && <Chip size="small" label={tr(t, `${ns}.status.${r.status}`, r.status)} />}
                  {r.metrics.map((k) =>
                    system.metrics[k] ? (
                      <Typography key={k} component="span" sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
                        {tr(t, `${ns}.metric.${metricSuffix(k)}`, metricSuffix(k))}:{' '}
                        <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
                          {formatMetric(system.metrics[k]!, locale, { days: t('aiOrders.unit.days') })}
                        </Box>
                      </Typography>
                    ) : null,
                  )}
                  {r.note && (
                    <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                      {noteLabel ? noteLabel(r.note) : r.note}
                    </Typography>
                  )}
                </Stack>
              ))}
          </Stack>
        </AiBlock>
      ))}
    </Stack>
  )
}

export function ExplainSystemBlock({
  system,
  ns,
  onOpenItem,
  noteLabel,
}: {
  system: ExplainSystem
  ns: ExplainNamespace
  onOpenItem?: (item: ExplainItem) => void
  noteLabel?: (note: string) => string
}) {
  const { t } = useI18n()
  // En la vista de conjunto, las señales por fila ya salen en su fila.
  const signals = system.items.length > 0 ? system.signals.filter((s) => s.ref === null) : system.signals
  return (
    <Stack spacing={1.75}>
      <MetricGrid keys={system.highlights} context={system} ns={ns} />
      <AiBlock title={t('aiExplain.system.signals')}>
        <SignalList signals={signals} ns={ns} context={system} />
      </AiBlock>
      <ItemList items={system.items} ns={ns} onOpenItem={onOpenItem} />
      <Rows system={system} ns={ns} noteLabel={noteLabel} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// INTERPRETACIÓN IA
// ---------------------------------------------------------------------------

function ActionButton({
  action,
  ns,
  draftKind,
  onDraft,
  onNavigate,
  onOpenItem,
  items,
}: {
  action: ExplainAction
  ns: ExplainNamespace
  draftKind?: string
  onDraft?: () => void
  onNavigate?: () => void
  onOpenItem?: (item: ExplainItem) => void
  items: readonly ExplainItem[]
}) {
  const { t } = useI18n()
  const label = tr(t, `${ns}.action.${action.kind}`, action.kind)
  if (draftKind && action.kind === draftKind && onDraft) {
    return (
      <Button size="small" variant="outlined" startIcon={<EditNoteRoundedIcon />} onClick={onDraft} sx={{ alignSelf: 'flex-start' }}>
        {label}
      </Button>
    )
  }
  const item = action.target_id ? items.find((i) => i.id === action.target_id) : undefined
  if (item && onOpenItem) {
    return (
      <Button size="small" variant="outlined" endIcon={<ArrowForwardRoundedIcon />} onClick={() => onOpenItem(item)} sx={{ alignSelf: 'flex-start' }}>
        {`${label} · ${item.label}`}
      </Button>
    )
  }
  if (action.tab) {
    const tab = action.tab
    return (
      <Button
        size="small"
        variant="outlined"
        endIcon={<ArrowForwardRoundedIcon />}
        title={t('aiExplain.goToHint')}
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => {
          // SectionTabs escucha `hashchange`: cambiar el hash ES cambiar de pestaña.
          onNavigate?.()
          window.location.hash = tab
        }}
      >
        {label}
      </Button>
    )
  }
  return <Chip size="small" label={label} sx={{ alignSelf: 'flex-start' }} />
}

function InsightView({
  data,
  ns,
  items,
  draftKind,
  onDraft,
  onNavigate,
  onOpenItem,
}: {
  data: ExplainInsight
  ns: ExplainNamespace
  items: readonly ExplainItem[]
  draftKind?: string
  onDraft?: () => void
  onNavigate?: () => void
  onOpenItem?: (item: ExplainItem) => void
}) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.75}>
      {data.answer && (
        <AiBlock title={t('aiExplain.section.answer')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.answer} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.overview && (
        <AiBlock title={t('aiExplain.section.overview')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.overview} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.findings.length > 0 && (
        <AiBlock title={t('aiExplain.section.findings')}>
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {data.findings.map((f) => (
              <Stack component="li" key={`${f.signal}-${f.ref ?? ''}`} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <SeverityIcon severity={f.severity} />
                <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
                    {tr(t, `${ns}.signal.${f.signal}`, f.signal)}
                    {f.ref && data.entities[f.ref] ? ` · ${data.entities[f.ref]!.label}` : ''}
                  </Typography>
                  <Typography sx={{ fontSize: 13 }}>
                    <MarkerText text={f.text} context={data} />
                  </Typography>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </AiBlock>
      )}
      {data.actions.length > 0 && (
        <AiBlock title={t('aiExplain.section.actions')}>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mb: 1 }}>{t('aiExplain.actions.help')}</Typography>
          <Stack component="ol" spacing={1.25} sx={{ m: 0, pl: 2.5 }}>
            {data.actions.map((a) => (
              <Stack component="li" key={`${a.kind}-${a.ref ?? ''}`} spacing={0.5}>
                <Typography sx={{ fontSize: 13 }}>
                  <MarkerText text={a.text} context={data} />
                </Typography>
                <ActionButton
                  action={a}
                  ns={ns}
                  draftKind={draftKind}
                  onDraft={onDraft}
                  onNavigate={onNavigate}
                  onOpenItem={onOpenItem}
                  items={items}
                />
              </Stack>
            ))}
          </Stack>
        </AiBlock>
      )}
      {data.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiOrders.discarded').replace('{n}', String(data.discarded))}
        </Typography>
      )}
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// BORRADOR (nunca se envía)
// ---------------------------------------------------------------------------

function DraftEditor({ draft }: { draft: ExplainDraft }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const days = t('aiOrders.unit.days')
  const [subject, setSubject] = useState(() => draftToPlainText(draft.subject, draft, locale, days))
  const [body, setBody] = useState(() => draftToPlainText(draft.body, draft, locale, days))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`)
      notify(t('aiExplain.draft.copied'), 'success')
    } catch {
      notify(t('aiExplain.draft.copyError'), 'error')
    }
  }

  return (
    <Stack spacing={1.5}>
      <Alert severity="info" icon={<EditNoteRoundedIcon fontSize="small" />}>
        {t('aiExplain.draft.notice')}
      </Alert>
      <TextField fullWidth size="small" label={t('aiExplain.draft.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <TextField fullWidth multiline minRows={6} label={t('aiExplain.draft.body')} value={body} onChange={(e) => setBody(e.target.value)} />
      {draft.points.length > 0 && (
        <AiBlock title={t('aiExplain.draft.points')}>
          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
            {draft.points.map((p, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 12.5 }}>
                <MarkerText text={p} context={draft} />
              </Typography>
            ))}
          </Stack>
        </AiBlock>
      )}
      {draft.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiOrders.discarded').replace('{n}', String(draft.discarded))}
        </Typography>
      )}
      <Button variant="outlined" startIcon={<ContentCopyRoundedIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => void copy()}>
        {t('aiExplain.draft.copy')}
      </Button>
    </Stack>
  )
}

function DraftSection({
  client,
  params,
  mode,
  ns,
  canAsk,
  anchor,
}: {
  client: ExplainClient
  params: Record<string, unknown>
  mode: 'reminder' | 'message'
  ns: ExplainNamespace
  canAsk: boolean
  anchor: RefObject<HTMLDivElement>
}) {
  const { t } = useI18n()
  const draft = useExplainDraft(client, params, mode)
  const [notes, setNotes] = useState('')
  const [tone, setTone] = useState<DraftTone>('formal')
  const titleId = useId()
  const tooLong = notes.trim().length > MAX_DRAFT_NOTES
  const run = () => {
    if (!canAsk || draft.isPending || tooLong) return
    draft.mutate({ tone, notes: notes.trim() || null })
  }
  const result = draft.data?.result

  return (
    <Stack spacing={1.25} component="section" aria-labelledby={titleId} ref={anchor} tabIndex={-1} sx={{ outline: 'none' }}>
      <Typography id={titleId} component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
        {t(`${ns}.draft.title` as MessageKey)}
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t(`${ns}.draft.help` as MessageKey)}</Typography>
      {canAsk && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            select
            size="small"
            label={t('aiExplain.draft.tone')}
            value={tone}
            onChange={(e) => setTone(e.target.value as DraftTone)}
            sx={{ minWidth: 160 }}
          >
            {DRAFT_TONES.map((tn) => (
              <MenuItem key={tn} value={tn}>
                {t(`aiExplain.draft.tone.${tn}` as MessageKey)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            size="small"
            multiline
            maxRows={4}
            label={t('aiExplain.draft.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            error={tooLong}
            helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiExplain.draft.notesHelp')}
            inputProps={{ maxLength: MAX_DRAFT_NOTES + 50 }}
          />
        </Stack>
      )}
      {canAsk && (
        <Button
          variant="contained"
          startIcon={<EditNoteRoundedIcon />}
          onClick={run}
          disabled={draft.isPending || tooLong}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t(`${ns}.draft.generate` as MessageKey)}
        </Button>
      )}
      <Box aria-live="polite" aria-busy={draft.isPending}>
        {draft.isPending && <Skeleton variant="rounded" height={140} />}
        {!draft.isPending && draft.isError && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={run}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiExplain.networkError')}
          </Alert>
        )}
        {!draft.isPending && !draft.isError && result?.motivo && <MotivoNotice motivo={result.motivo} onRetry={run} />}
        {!draft.isPending && !draft.isError && result?.data && (
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {/* `key`: un borrador nuevo reinicia los campos editables. */}
              <DraftEditor key={result.interactionId ?? result.data.subject} draft={result.data} />
              <AiFeedbackButtons interactionId={result.interactionId} />
            </CardContent>
          </Card>
        )}
      </Box>
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// El panel
// ---------------------------------------------------------------------------

export interface ExplainPanelProps {
  readonly feature: Extract<AiFeature, 'credit' | 'payments' | 'fulfillment' | 'operations' | 'integrations'>
  readonly ns: ExplainNamespace
  readonly client: ExplainClient
  /** Parámetros fijos de la petición (`store_id`, `customer_id`…). */
  readonly params: Record<string, unknown>
  /** Ids de preguntas sugeridas; `summary` = explicar sin pregunta. */
  readonly questions: readonly string[]
  /** Borrador disponible en este ámbito (recordatorio / mensaje) y la acción que lo prepara. */
  readonly draft?: { readonly mode: 'reminder' | 'message'; readonly actionKind: string }
  readonly onOpenItem?: (item: ExplainItem) => void
  /** Antes de navegar a una pestaña (p. ej. cerrar el cajón). */
  readonly onNavigate?: () => void
  readonly noteLabel?: (note: string) => string
  readonly header?: ReactNode
}

/**
 * Panel «Cálculo del sistema + Interpretación IA» de la fase 08.
 *
 *  - **Cálculo del sistema** (al abrir, sin cuota): cifras, señales por regla,
 *    filas a revisar y el detalle.
 *  - **Interpretación IA** (bajo demanda, una consulta): panorama, hallazgos,
 *    acciones de seguimiento (solo navegan o preparan un borrador) y respuesta.
 *  - **Borrador** (opcional, una consulta): editable y copiable. No se envía.
 *
 * Nada aquí escribe. Sin permiso para la funcionalidad, el panel no se pinta
 * (y quien lo monta tampoco ofrece la pestaña o la acción).
 */
/**
 * Fase 12: el panel se REMONTA al cambiar de alcance (tienda, cobro, envío,
 * cliente…). Sin esto, la explicación de la tienda anterior seguía en
 * pantalla —y citando sus cifras— tras cambiar de tienda.
 */
export function ExplainPanel(props: ExplainPanelProps) {
  return <ExplainPanelBody key={`${props.client.fn}:${JSON.stringify(props.params)}`} {...props} />
}

function ExplainPanelBody({
  feature,
  ns,
  client,
  params,
  questions,
  draft,
  onOpenItem,
  onNavigate,
  noteLabel,
  header,
}: ExplainPanelProps) {
  const { t } = useI18n()
  const { availability } = useAiFeature(feature)
  const visible = availability !== 'forbidden' && availability !== 'loading'
  const signals = useExplainSignals(client, params, visible)
  const insight = useExplainInsight(client, params)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{ q: string | null } | null>(null)
  const draftAnchor = useRef<HTMLDivElement>(null)
  const systemId = useId()
  const aiId = useId()

  if (!visible) return null

  const system = signals.data ?? null
  const canAsk = availability === 'available'
  // Sin señales del sistema, solo se gasta si la persona pregunta algo.
  const nothingToExplain = system !== null && system.signals.length === 0
  const tooLong = question.trim().length > MAX_EXPLAIN_QUESTION
  const run = (q: string | null) => {
    if (!canAsk || insight.isPending) return
    setAsked({ q })
    insight.mutate(q)
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const q = question.trim()
    if (!q || tooLong) return
    run(q)
  }
  const goToDraft = () => {
    draftAnchor.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    draftAnchor.current?.focus()
  }
  const result = insight.data?.result

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>
          {t(`${ns}.title` as MessageKey)}
        </Typography>
        <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
      </Stack>
      {header}

      <Card variant="outlined" component="section" aria-labelledby={systemId}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography id={systemId} component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
            {t('aiExplain.system.title')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t(`${ns}.system.help` as MessageKey)}</Typography>
          <Box aria-live="polite" aria-busy={signals.isPending}>
            {signals.isPending && <Skeleton variant="rounded" height={96} />}
            {signals.isError && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void signals.refetch()}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiExplain.system.error')}
              </Alert>
            )}
            {signals.isSuccess && system && (
              <ExplainSystemBlock system={system} ns={ns} onOpenItem={onOpenItem} noteLabel={noteLabel} />
            )}
            {signals.isSuccess && !system && <Alert severity="warning">{t('aiExplain.system.error')}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Divider />

      <Stack spacing={1.5} component="section" aria-labelledby={aiId}>
        <Typography id={aiId} component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
          {t('aiExplain.ai.title')}
        </Typography>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}
        {canAsk && nothingToExplain && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiExplain.nothingToExplain')}</Typography>
        )}

        {canAsk && (
          <>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiOrders.suggested')}>
              {questions.map((id) => {
                const label = t(`${ns}.q.${id}` as MessageKey)
                const isSummary = id === 'summary'
                return (
                  <Chip
                    key={id}
                    label={label}
                    variant="outlined"
                    clickable
                    icon={isSummary ? <AutoAwesomeRoundedIcon fontSize="small" /> : undefined}
                    disabled={insight.isPending || (isSummary && nothingToExplain)}
                    onClick={() => run(isSummary ? null : label)}
                  />
                )
              })}
            </Stack>
            <Box component="form" onSubmit={onSubmit} noValidate>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('aiExplain.ask.label')}
                  placeholder={t(`${ns}.ask.placeholder` as MessageKey)}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiExplain.costHint')}
                  inputProps={{ maxLength: MAX_EXPLAIN_QUESTION + 50 }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  endIcon={<SendRoundedIcon />}
                  disabled={insight.isPending || !question.trim() || tooLong}
                  sx={{ flexShrink: 0 }}
                >
                  {t('aiOrders.ask.send')}
                </Button>
              </Stack>
            </Box>
          </>
        )}

        <Box aria-live="polite" aria-busy={insight.isPending}>
          {insight.isPending && (
            <Stack spacing={0.75}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiExplain.generating')}</Typography>
              <Skeleton variant="rounded" height={120} />
            </Stack>
          )}
          {!insight.isPending && insight.isError && (
            <Alert
              severity="error"
              action={
                asked ? (
                  <Button color="inherit" size="small" onClick={() => run(asked.q)}>
                    {t('common.retry')}
                  </Button>
                ) : undefined
              }
            >
              {t('aiExplain.networkError')}
            </Alert>
          )}
          {!insight.isPending && !insight.isError && result?.motivo && (
            <MotivoNotice motivo={result.motivo} onRetry={asked ? () => run(asked.q) : undefined} />
          )}
          {!insight.isPending && !insight.isError && result?.data && (
            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {asked?.q && (
                  <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic' }}>{asked.q}</Typography>
                )}
                <InsightView
                  data={result.data}
                  ns={ns}
                  items={system?.items ?? []}
                  draftKind={draft?.actionKind}
                  onDraft={draft ? goToDraft : undefined}
                  onNavigate={onNavigate}
                  onOpenItem={onOpenItem}
                />
                <AiFeedbackButtons interactionId={result.interactionId} />
              </CardContent>
            </Card>
          )}
        </Box>
      </Stack>

      {draft && (availability === 'available' || availability === 'quota_exhausted' || availability === 'not_entitled') && (
        <>
          <Divider />
          <DraftSection client={client} params={params} mode={draft.mode} ns={ns} canAsk={canAsk} anchor={draftAnchor} />
        </>
      )}

      <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t(`${ns}.disclaimer` as MessageKey)}</Typography>
    </Stack>
  )
}
