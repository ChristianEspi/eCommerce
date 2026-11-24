import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded'
import { AppIcon } from '@/shared/ui/AppIcon'
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
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
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
import { SelectField } from '@/shared/ui/SelectField'

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

/** Tonos suaves por severidad (texto + icono siempre acompañan al color). */
const SEVERITY_SOFT: Record<'high' | 'medium' | 'low', { bg: string; bar: string }> = {
  high: { bg: 'var(--red-soft)', bar: 'var(--red)' },
  medium: { bg: 'var(--amber-soft)', bar: 'var(--amber)' },
  low: { bg: 'var(--blue-soft)', bar: 'var(--blue)' },
}

/**
 * Tono de una cifra del sistema. Solo decora: la cifra y su etiqueta dicen lo
 * mismo sin color. Cero ⇒ apagada; una cifra «de alerta» distinta de cero ⇒
 * ámbar o rojo según la gravedad que su nombre declara.
 */
const METRIC_DANGER = /(over_90|blocked|dead|failed|failure)/
const METRIC_WARNING = /(overdue|61_90|31_60|1_30|unapplied|late|stuck|error|incident|watch|due_soon|pending)/
type MetricTone = 'hero' | 'danger' | 'warning' | 'zero' | 'plain'

function metricTone(key: string, value: unknown, kind: string, index: number): MetricTone {
  const n = typeof value === 'number' ? value : Number(value)
  const isZero = kind !== 'datetime' && Number.isFinite(n) && n === 0
  if (index === 0 && !isZero) return 'hero'
  if (isZero) return 'zero'
  const suffix = metricSuffix(key)
  if (METRIC_DANGER.test(suffix)) return 'danger'
  if (METRIC_WARNING.test(suffix)) return 'warning'
  return 'plain'
}

const METRIC_STYLE: Record<MetricTone, { bg: string; bar: string; fg: string }> = {
  hero: { bg: 'var(--accent-soft)', bar: 'var(--accent)', fg: 'var(--accent-deep)' },
  danger: { bg: 'var(--red-soft)', bar: 'var(--red)', fg: 'var(--red)' },
  warning: { bg: 'var(--amber-soft)', bar: 'var(--amber)', fg: 'var(--amber)' },
  zero: { bg: 'transparent', bar: 'var(--border)', fg: 'var(--muted)' },
  plain: { bg: 'var(--card)', bar: 'var(--border)', fg: 'var(--text)' },
}

/** Cifra numérica de una métrica (null si es fecha o no es número). */
function metricNumber(metric: ExplainContext['metrics'][string] | undefined): number | null {
  if (!metric || metric.kind === 'datetime') return null
  const n = typeof metric.value === 'number' ? metric.value : Number(metric.value)
  return Number.isFinite(n) ? n : null
}

/** Título de grupo: mayúsculas pequeñas + cuántos hay. */
function GroupTitle({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <Typography
      id={id}
      component="h4"
      sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', mb: 1 }}
    >
      {title}
      {count !== undefined && (
        <Box component="span" className="tnum" sx={{ color: 'var(--text)' }}>
          {` · ${count}`}
        </Box>
      )}
    </Typography>
  )
}

/**
 * Cifras del sistema (2026-11-24). Antes: una tarjeta por cifra, la mayoría en
 * cero, ocupando dos filas para decir «nada». Ahora: tarjetas SOLO para lo que
 * no es cero (se reparten el ancho) y los ceros en una línea «Sin novedad en».
 */
function MetricGrid({ keys, context, ns }: { keys: readonly string[]; context: ExplainContext; ns: ExplainNamespace }) {
  const { t, locale } = useI18n()
  const shown = keys.filter((k) => context.metrics[k])
  if (shown.length === 0) return null
  const label = (k: string) => tr(t, `${ns}.metric.${metricSuffix(k)}`, metricSuffix(k))
  const cards = shown.filter((k) => metricNumber(context.metrics[k]) !== 0)
  const zeros = shown.filter((k) => metricNumber(context.metrics[k]) === 0)
  return (
    <Stack spacing={1}>
      {cards.length > 0 && (
        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fit, minmax(180px, 1fr))' },
            gap: 1,
          }}
        >
          {cards.map((k, i) => {
            const metric = context.metrics[k]!
            const tone = metricTone(k, metric.value, metric.kind, i)
            const style = METRIC_STYLE[tone]
            const hero = tone === 'hero'
            return (
              <Box
                key={k}
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  minWidth: 0,
                  px: 1.75,
                  py: 1.25,
                  pl: 2.25,
                  borderRadius: 0.67,
                  bgcolor: style.bg,
                  border: '1px solid',
                  borderColor: tone === 'plain' ? 'var(--border)' : 'transparent',
                  '&::before': { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: style.bar },
                }}
              >
                <Typography
                  component="dt"
                  title={label(k)}
                  sx={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {label(k)}
                </Typography>
                <Typography
                  component="dd"
                  className="tnum"
                  sx={{ m: 0, mt: 0.25, fontSize: hero ? 26 : 22, lineHeight: 1.15, fontWeight: 800, color: style.fg, overflowWrap: 'anywhere' }}
                >
                  {formatMetric(metric, locale, { days: t('aiOrders.unit.days') })}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
      {zeros.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'var(--muted)' }}>
          <CheckCircleOutlineRoundedIcon sx={{ fontSize: 16, mt: '2px', color: 'var(--accent-deep)' }} />
          <Typography sx={{ fontSize: 12.5, lineHeight: 1.5 }}>
            <Box component="span" sx={{ fontWeight: 700, color: 'var(--text)' }}>
              {t('aiExplain.system.zeroFigures')}
            </Box>{' '}
            {zeros.map(label).join(' · ')}
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}

const SIGNAL_DOT: Record<'high' | 'medium' | 'low', string> = {
  high: 'var(--red)',
  medium: 'var(--amber)',
  low: 'var(--blue)',
}

/** Señales como chips que se acomodan en una fila, no píldoras a todo el ancho. */
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
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 1.5, py: 1, borderRadius: 0.67, bgcolor: 'var(--accent-soft)', color: 'var(--accent-deep)' }}
      >
        <CheckCircleOutlineRoundedIcon fontSize="small" />
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{t('aiExplain.system.noSignals')}</Typography>
      </Stack>
    )
  }
  return (
    <Stack component="ul" direction="row" useFlexGap spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none', flexWrap: 'wrap' }}>
      {signals.map((s) => (
        <Box
          component="li"
          key={`${s.code}-${s.ref ?? ''}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            py: 0.6,
            borderRadius: 0.67,
            fontSize: 12.5,
            fontWeight: 700,
            bgcolor: SEVERITY_SOFT[s.severity].bg,
            color: 'var(--text)',
            maxWidth: '100%',
          }}
        >
          <Box component="span" aria-hidden sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: '50%', bgcolor: SIGNAL_DOT[s.severity] }} />
          <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {tr(t, `${ns}.signal.${s.code}`, s.code)}
            {s.ref && context.entities[s.ref] ? (
              <Box component="span" sx={{ color: 'var(--muted)', fontWeight: 500 }}>{` · ${context.entities[s.ref]!.label}`}</Box>
            ) : null}
          </Box>
        </Box>
      ))}
    </Stack>
  )
}

/** Resumen de la cabecera: color solo decora, el texto dice lo mismo. */
function SummaryPill({ tone, text }: { tone: 'warning' | 'ok' | 'neutral'; text: string }) {
  const bg = tone === 'warning' ? 'var(--amber-soft)' : tone === 'ok' ? 'var(--accent-soft)' : 'var(--neutral-soft)'
  const dot = tone === 'warning' ? 'var(--amber)' : tone === 'ok' ? 'var(--accent)' : 'var(--muted)'
  return (
    <Box
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: 0.67, bgcolor: bg, fontSize: 12.5, fontWeight: 700 }}
    >
      <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot }} />
      <span className="tnum">{text}</span>
    </Box>
  )
}

type SystemRow = ExplainSystem['rows'][number]

/**
 * Una fila de la lista a revisar. Junta lo que antes salía DOS veces: la
 * tarjeta del ítem (gravedad, señales, «Analizar») y su línea de cifras
 * (estado, importe, días…). Las cifras en cero no se pintan: «Intentos
 * rechazados: 0» en cada fila es ruido.
 */
function ReviewRow({
  label,
  severity,
  signals,
  row,
  system,
  ns,
  first,
  noteLabel,
  onAnalyze,
}: {
  label: string
  severity: 'high' | 'medium' | 'low' | null
  signals: readonly string[]
  row: SystemRow | undefined
  system: ExplainSystem
  ns: ExplainNamespace
  first: boolean
  noteLabel?: (note: string) => string
  onAnalyze?: () => void
}) {
  const { t, locale } = useI18n()
  const figures = (row?.metrics ?? []).filter((k) => system.metrics[k] && metricNumber(system.metrics[k]) !== 0)
  return (
    <Box
      component="li"
      sx={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: { xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, 1fr) auto' },
        columnGap: 1.5,
        rowGap: 1,
        alignItems: 'center',
        px: 1.75,
        py: 1.25,
        borderTop: first ? 'none' : '1px solid var(--border)',
        transition: 'background-color .15s ease',
        '&:hover': { bgcolor: 'var(--neutral-soft)' },
        '&::before': severity
          ? { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: SEVERITY_SOFT[severity].bar }
          : undefined,
      }}
    >
      {severity ? (
        <SeverityIcon severity={severity} />
      ) : (
        <Box aria-hidden sx={{ width: 8, height: 8, mx: '8px', borderRadius: '50%', bgcolor: 'var(--border)' }} />
      )}
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography className="tnum" sx={{ fontSize: 13.5, fontWeight: 700 }}>
            {label}
          </Typography>
          {row?.status && (
            <Chip
              size="small"
              variant="outlined"
              label={tr(t, `${ns}.status.${row.status}`, row.status)}
              sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
            />
          )}
          {signals.map((code) => (
            <Chip
              key={code}
              size="small"
              label={tr(t, `${ns}.signal.${code}`, code)}
              sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: severity ? SEVERITY_SOFT[severity].bg : 'var(--neutral-soft)', color: 'var(--text)' }}
            />
          ))}
        </Stack>
        {(figures.length > 0 || row?.note) && (
          <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 0.25 }}>
            {figures.map((k) => (
              <Typography key={k} component="span" sx={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {tr(t, `${ns}.metric.${metricSuffix(k)}`, metricSuffix(k))}{' '}
                <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
                  {formatMetric(system.metrics[k]!, locale, { days: t('aiOrders.unit.days') })}
                </Box>
              </Typography>
            ))}
            {row?.note && (
              <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                {noteLabel ? noteLabel(row.note) : row.note}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
      {onAnalyze && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AutoAwesomeRoundedIcon />}
          onClick={onAnalyze}
          sx={{ gridColumn: { xs: '2', md: 'auto' }, justifySelf: { xs: 'start', md: 'end' }, whiteSpace: 'nowrap' }}
        >
          {t('aiExplain.analyze')}
        </Button>
      )}
    </Box>
  )
}

/** Contenedor de una lista a revisar: un solo marco con separadores, no una tarjeta por fila. */
function ReviewList({ id, title, children }: { id: string; title: string; children: ReactNode[] }) {
  return (
    <Box component="section" aria-labelledby={id}>
      <GroupTitle id={id} title={title} count={children.length} />
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', border: '1px solid var(--border)', borderRadius: 0.67, overflow: 'hidden', bgcolor: 'var(--card)' }}>
        {children}
      </Box>
    </Box>
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
  const baseId = useId()
  // En la vista de conjunto, las señales por fila ya salen en su fila.
  const signals = system.items.length > 0 ? system.signals.filter((s) => s.ref === null) : system.signals
  // Cada ítem se lleva SU fila (mismo `ref`); el resto se lista por grupo.
  const rowByRef = new Map(system.rows.filter((r) => r.ref !== null).map((r) => [r.ref as string, r]))
  const used = new Set(system.items.map((i) => i.ref))
  const rest = system.rows.filter((r) => r.ref === null || !used.has(r.ref))
  const groups = [...new Set(rest.map((r) => r.group))]
  return (
    <Stack spacing={2.25}>
      <MetricGrid keys={system.highlights} context={system} ns={ns} />
      <Box component="section" aria-labelledby={`${baseId}-signals`}>
        <GroupTitle id={`${baseId}-signals`} title={t('aiExplain.system.signals')} count={signals.length || undefined} />
        <SignalList signals={signals} ns={ns} context={system} />
      </Box>
      {system.items.length > 0 && (
        <ReviewList id={`${baseId}-items`} title={t(`${ns}.items` as MessageKey)}>
          {system.items.map((item, i) => (
            <ReviewRow
              key={item.ref}
              label={item.label}
              severity={item.severity}
              signals={item.signals}
              row={rowByRef.get(item.ref)}
              system={system}
              ns={ns}
              first={i === 0}
              noteLabel={noteLabel}
              onAnalyze={onOpenItem ? () => onOpenItem(item) : undefined}
            />
          ))}
        </ReviewList>
      )}
      {groups.map((group) => {
        const rows = rest.filter((r) => r.group === group)
        return (
          <ReviewList key={group} id={`${baseId}-${group}`} title={tr(t, `${ns}.group.${group}`, group)}>
            {rows.map((r, i) => (
              <ReviewRow
                key={`${group}-${r.ref ?? r.label}-${i}`}
                label={r.label}
                severity={null}
                signals={[]}
                row={r}
                system={system}
                ns={ns}
                first={i === 0}
                noteLabel={noteLabel}
              />
            ))}
          </ReviewList>
        )
      })}
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
    <Stack spacing={2.25}>
      {data.answer && (
        <AiBlock title={t('aiExplain.section.answer')}>
          <Box
            sx={{
              p: 1.75,
              borderRadius: 0.67,
              bgcolor: 'var(--accent-soft)',
              borderLeft: '4px solid var(--accent)',
            }}
          >
            <Typography sx={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text)' }}>
              <MarkerText text={data.answer} context={data} />
            </Typography>
          </Box>
        </AiBlock>
      )}
      {data.overview && (
        <AiBlock title={t('aiExplain.section.overview')}>
          <Typography sx={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)' }}>
            <MarkerText text={data.overview} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.findings.length > 0 && (
        <AiBlock title={t('aiExplain.section.findings')}>
          <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {data.findings.map((f) => (
              <Stack
                component="li"
                key={`${f.signal}-${f.ref ?? ''}`}
                direction="row"
                spacing={1.25}
                sx={{ alignItems: 'flex-start', p: 1.25, borderRadius: 0.67, bgcolor: SEVERITY_SOFT[f.severity].bg }}
              >
                <SeverityIcon severity={f.severity} />
                <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>
                    {tr(t, `${ns}.signal.${f.signal}`, f.signal)}
                    {f.ref && data.entities[f.ref] ? ` · ${data.entities[f.ref]!.label}` : ''}
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
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
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', mb: 1.25 }}>{t('aiExplain.actions.help')}</Typography>
          <Stack component="ol" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none', counterReset: 'paso' }}>
            {data.actions.map((a) => (
              <Stack
                component="li"
                key={`${a.kind}-${a.ref ?? ''}`}
                spacing={0.75}
                sx={{
                  position: 'relative',
                  counterIncrement: 'paso',
                  p: 1.25,
                  pl: 5.5,
                  borderRadius: 0.67,
                  border: '1px solid var(--border)',
                  '&::before': {
                    content: 'counter(paso)',
                    position: 'absolute',
                    left: 12,
                    top: 12,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12.5,
                    fontWeight: 800,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                  },
                }}
              >
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
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
      <Field fullWidth size="small" rule="text" maxLength={160} label={t('aiExplain.draft.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Field fullWidth multiline minRows={6} rule="longText" maxLength={1600} label={t('aiExplain.draft.body')} value={body} onChange={(e) => setBody(e.target.value)} />
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
          <SelectField
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
          </SelectField>
          <Field
            fullWidth
            size="small"
            rule="longText"
            maxLength={MAX_DRAFT_NOTES + 50}
            multiline
            maxRows={4}
            label={t('aiExplain.draft.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            error={tooLong}
            helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiExplain.draft.notesHelp')}
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
  /**
   * Vista propia del CÁLCULO DEL SISTEMA (2026-11-23). Sin ella se pinta la
   * genérica; Operaciones la usa para agrupar incidentes por gravedad.
   */
  readonly renderSystem?: (system: ExplainSystem) => ReactNode
  /** Con descripción, la cabecera va compacta (título + línea de ayuda). */
  readonly description?: string
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
  renderSystem,
  description,
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
    <Stack spacing={2.5}>
      {description ? (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <AppIcon tone="accent" size="sm">
            <AutoAwesomeRoundedIcon fontSize="small" />
          </AppIcon>
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>
                {t(`${ns}.title` as MessageKey)}
              </Typography>
              <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
            </Stack>
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{description}</Typography>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <AppIcon tone="accent">
            <AutoAwesomeRoundedIcon />
          </AppIcon>
          <Typography component="h3" sx={{ fontSize: 17, fontWeight: 800 }}>
            {t(`${ns}.title` as MessageKey)}
          </Typography>
          <Chip size="small" label={t('aiOrders.badge')} color="primary" sx={{ fontWeight: 800, height: 22 }} />
          {system && (
            <Stack
              direction="row"
              useFlexGap
              spacing={0.75}
              sx={{ ml: 'auto !important', flexWrap: 'wrap', justifyContent: 'flex-end', display: { xs: 'none', sm: 'flex' } }}
            >
              <SummaryPill
                tone={system.signals.length > 0 ? 'warning' : 'ok'}
                text={t('aiExplain.summary.signals').replace('{n}', String(system.signals.length))}
              />
              {system.items.length > 0 && (
                <SummaryPill tone="neutral" text={t('aiExplain.summary.items').replace('{n}', String(system.items.length))} />
              )}
            </Stack>
          )}
        </Stack>
      )}
      {header}

      <Card variant="outlined" component="section" aria-labelledby={systemId} sx={{ borderRadius: 1 }}>
        <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } }, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <AppIcon tone="neutral" size="sm">
              <CalculateOutlinedIcon />
            </AppIcon>
            <Box sx={{ minWidth: 0 }}>
              <Typography id={systemId} component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>
                {t('aiExplain.system.title')}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t(`${ns}.system.help` as MessageKey)}</Typography>
            </Box>
          </Stack>
          <Box aria-live="polite" aria-busy={signals.isPending}>
            {signals.isPending && (
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <Skeleton key={i} variant="rounded" height={62} />
                ))}
              </Box>
            )}
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
              renderSystem ? renderSystem(system) : <ExplainSystemBlock system={system} ns={ns} onOpenItem={onOpenItem} noteLabel={noteLabel} />
            )}
            {signals.isSuccess && !system && <Alert severity="warning">{t('aiExplain.system.error')}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Box
        component="section"
        aria-labelledby={aiId}
        sx={{
          p: { xs: 2, sm: 2.5 },
          borderRadius: 1,
          border: '1px solid var(--border)',
          background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--card) 70%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.75,
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <AppIcon tone="accent" size="sm">
            <AutoAwesomeRoundedIcon />
          </AppIcon>
          <Typography id={aiId} component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>
            {t('aiExplain.ai.title')}
          </Typography>
        </Stack>

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
                    variant={isSummary ? 'filled' : 'outlined'}
                    color={isSummary ? 'primary' : 'default'}
                    clickable
                    icon={isSummary ? <AutoAwesomeRoundedIcon fontSize="small" /> : undefined}
                    disabled={insight.isPending || (isSummary && nothingToExplain)}
                    onClick={() => run(isSummary ? null : label)}
                    sx={{
                      fontWeight: 600,
                      height: 32,
                      bgcolor: isSummary ? undefined : 'var(--card)',
                      '&:hover': isSummary ? undefined : { borderColor: 'var(--accent)', color: 'var(--accent-deep)' },
                    }}
                  />
                )
              })}
            </Stack>
            <Box component="form" onSubmit={onSubmit} noValidate>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <Field
                  fullWidth
                  size="small"
                  rule="longText"
                  maxLength={MAX_EXPLAIN_QUESTION + 50}
                  label={t('aiExplain.ask.label')}
                  placeholder={t(`${ns}.ask.placeholder` as MessageKey)}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiExplain.costHint')}
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
            <Card variant="outlined" sx={{ borderRadius: 1, boxShadow: '0 4px 18px rgba(0,0,0,.05)' }}>
              {asked?.q && (
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{ alignItems: 'center', px: { xs: 2, sm: 2.5 }, py: 1.5, bgcolor: 'var(--neutral-soft)', borderBottom: '1px solid var(--border)' }}
                >
                  <AppIcon tone="neutral" size="sm">
                    <PersonOutlineRoundedIcon />
                  </AppIcon>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{asked.q}</Typography>
                </Stack>
              )}
              <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <InsightView
                  data={result.data}
                  ns={ns}
                  items={system?.items ?? []}
                  draftKind={draft?.actionKind}
                  onDraft={draft ? goToDraft : undefined}
                  onNavigate={onNavigate}
                  onOpenItem={onOpenItem}
                />
                <Divider />
                <AiFeedbackButtons interactionId={result.interactionId} />
              </CardContent>
            </Card>
          )}
        </Box>
      </Box>

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
