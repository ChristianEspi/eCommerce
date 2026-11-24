import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import type { ExplainItem, ExplainSystem } from '@/features/ai/explain/explainAi'
import { metricSuffix } from '@/features/ai/explain/explainAi'
import { SeverityIcon } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import { codeLabel, termLabel } from '@/shared/i18n/codeLabels'
import type { MessageKey } from '@/shared/i18n/messages'

type Translate = (key: MessageKey) => string

function tr(t: Translate, key: string, fallback: string): string {
  const out = t(key as MessageKey)
  return out === key ? fallback : out
}

/** Gravedad del incidente (la de la base) → orden y tono del icono. */
const STATUS_ORDER = ['critical', 'error', 'warning', 'info'] as const
type Status = (typeof STATUS_ORDER)[number]
const STATUS_TONE: Readonly<Record<Status, 'high' | 'medium' | 'low'>> = {
  critical: 'high',
  error: 'high',
  warning: 'medium',
  info: 'low',
}

const SIGNAL_DANGER = /(dead|failed|stuck|critical)/

function asStatus(value: string | null): Status {
  return (STATUS_ORDER as readonly string[]).includes(value ?? '') ? (value as Status) : 'info'
}

function num(system: ExplainSystem, key: string): number | null {
  const m = system.metrics[key]
  if (!m || m.kind === 'datetime') return null
  const n = Number(m.value)
  return Number.isFinite(n) ? n : null
}

/** «hace 4 min» · «hace 3 h» · «hace 77 días»: los minutos crudos (110 711) no se leen. */
function agoLabel(t: Translate, minutes: number): string {
  if (minutes < 60) return t('aiOps.ago.minutes').replace('{n}', String(Math.max(0, Math.round(minutes))))
  if (minutes < 60 * 24) return t('aiOps.ago.hours').replace('{n}', String(Math.round(minutes / 60)))
  return t('aiOps.ago.days').replace('{n}', String(Math.round(minutes / (60 * 24))))
}

/** `integration_failed · INTEGRACION_FALLIDA` → tipo y código por separado. */
function splitLabel(label: string): { kind: string; code: string } {
  const cut = label.indexOf(' · ')
  return cut < 0 ? { kind: '', code: label } : { kind: label.slice(0, cut), code: label.slice(cut + 3) }
}

function GroupTitle({ children, id, count }: { children: string; id: string; count: number }) {
  return (
    <Typography
      id={id}
      component="h4"
      sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', mb: 1 }}
    >
      {children}{' '}
      <Box component="span" className="tnum" sx={{ color: 'var(--text)' }}>
        · {count}
      </Box>
    </Typography>
  )
}

/** Cifras de la sociedad: solo las que no son cero; los ceros, en una línea. */
function Figures({ system }: { system: ExplainSystem }) {
  const { t, locale } = useI18n()
  const tag = locale === 'en' ? 'en-US' : 'es-PE'
  const shown = system.highlights.filter((k) => num(system, k) !== null)
  const nonZero = shown.filter((k) => num(system, k) !== 0)
  const zero = shown.filter((k) => num(system, k) === 0)
  const label = (k: string) => tr(t, `aiOps.metric.${metricSuffix(k)}`, metricSuffix(k))
  if (shown.length === 0) return null
  return (
    <Stack spacing={1}>
      {nonZero.length > 0 && (
        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gap: 1,
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(150px, 1fr))' },
          }}
        >
          {nonZero.map((k) => {
            const danger = /(critical|dead|failed|stuck)/.test(k)
            const warning = /(error|warning|slow)/.test(k)
            const fg = danger ? 'var(--red)' : warning ? 'var(--amber)' : 'var(--text)'
            return (
              <Box
                key={k}
                sx={{
                  minWidth: 0,
                  px: 1.5,
                  py: 1,
                  borderRadius: 0.67,
                  border: '1px solid var(--border)',
                  borderLeft: `4px solid ${danger ? 'var(--red)' : warning ? 'var(--amber)' : 'var(--border)'}`,
                  bgcolor: 'var(--card)',
                }}
              >
                <Typography
                  component="dt"
                  sx={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={label(k)}
                >
                  {label(k)}
                </Typography>
                <Typography component="dd" className="tnum" sx={{ m: 0, fontSize: 20, lineHeight: 1.2, fontWeight: 800, color: fg }}>
                  {(num(system, k) ?? 0).toLocaleString(tag)}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
      {zero.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'var(--muted)' }}>
          <CheckCircleOutlineRoundedIcon sx={{ fontSize: 16, mt: '1px', color: 'var(--accent-deep)' }} />
          <Typography sx={{ fontSize: 12.5 }}>
            {t('aiOps.zeroFigures')} {zero.map(label).join(' · ')}
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}

/** Señales de la sociedad (no de un grupo): chips con tono, no píldoras a lo ancho. */
function CompanySignals({ system }: { system: ExplainSystem }) {
  const { t } = useI18n()
  const signals = system.signals.filter((s) => s.ref === null)
  if (signals.length === 0) return null
  return (
    <Box component="section" aria-labelledby="ai-ops-signals">
      <GroupTitle id="ai-ops-signals" count={signals.length}>
        {t('aiExplain.system.signals')}
      </GroupTitle>
      <Stack component="ul" direction="row" useFlexGap spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none', flexWrap: 'wrap' }}>
        {signals.map((s) => {
          const high = s.severity === 'high' || SIGNAL_DANGER.test(s.code)
          return (
            <Box
              component="li"
              key={s.code}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.5,
                borderRadius: 0.67,
                fontSize: 12.5,
                fontWeight: 700,
                bgcolor: high ? 'var(--red-soft)' : s.severity === 'medium' ? 'var(--amber-soft)' : 'var(--blue-soft)',
                color: 'var(--text)',
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: high ? 'var(--red)' : s.severity === 'medium' ? 'var(--amber)' : 'var(--blue)',
                }}
              />
              {tr(t, `aiOps.signal.${s.code}`, s.code)}
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}

function IncidentRow({
  system,
  row,
  item,
  first,
  onOpenItem,
}: {
  system: ExplainSystem
  row: ExplainSystem['rows'][number]
  item: ExplainItem | undefined
  first: boolean
  onOpenItem?: (item: ExplainItem) => void
}) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const tag = locale === 'en' ? 'en-US' : 'es-PE'
  const { kind, code } = splitLabel(row.label)
  const title = kind ? `${termLabel(t, 'kind', kind)} · ${codeLabel(t, code)}` : codeLabel(t, code)
  const ref = row.ref ?? ''
  const open = num(system, `${ref}_open`)
  const repeats = num(system, `${ref}_repeats`)
  const fresh = num(system, `${ref}_new_24h`)
  const lastSeen = num(system, `${ref}_last_seen_minutes`)
  const figure = (label: string, value: string) => (
    <Typography component="span" sx={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
      {label}{' '}
      <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
        {value}
      </Box>
    </Typography>
  )
  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, 1fr) auto' },
        columnGap: 1.5,
        rowGap: 1,
        alignItems: 'center',
        px: 1.5,
        py: 1.25,
        borderTop: first ? 'none' : '1px solid var(--border)',
      }}
    >
      <SeverityIcon severity={STATUS_TONE[asStatus(row.status)]} />
      <Stack spacing={0.4} sx={{ minWidth: 0 }}>
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{title}</Typography>
          <Typography className="tnum" sx={{ fontSize: 11, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            {row.label}
          </Typography>
        </Stack>
        <Stack direction="row" useFlexGap spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {open !== null && figure(t('aiOps.figure.open'), open.toLocaleString(tag))}
          {repeats !== null && figure(t('aiOps.figure.repeats'), repeats.toLocaleString(tag))}
          {fresh !== null && fresh > 0 && figure(t('aiOps.figure.new24h'), fresh.toLocaleString(tag))}
          {lastSeen !== null && figure(t('aiOps.figure.lastSeen'), agoLabel(t, lastSeen))}
          {item?.signals
            .filter((s) => s !== 'critical_open' && s !== 'error_open')
            .map((s) => (
              <Chip key={s} size="small" variant="outlined" label={tr(t, `aiOps.signal.${s}`, s)} sx={{ height: 22, fontSize: 11.5 }} />
            ))}
        </Stack>
        {row.note && (
          <Tooltip title={row.note}>
            <Typography sx={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }} noWrap>
              {row.note}
            </Typography>
          </Tooltip>
        )}
      </Stack>
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ gridColumn: { xs: '2', md: 'auto' }, justifyContent: { md: 'flex-end' }, flexWrap: 'wrap' }}
      >
        {item && onOpenItem && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoAwesomeRoundedIcon />}
            onClick={() => onOpenItem(item)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('aiExplain.analyze')}
          </Button>
        )}
        <Button
          size="small"
          endIcon={<ArrowForwardRoundedIcon />}
          title={t('aiOps.seeIncidentsHint')}
          sx={{ whiteSpace: 'nowrap' }}
          onClick={() => {
            // Incidentes se abre filtrada por ESTE código. SectionTabs escucha
            // `hashchange`: cambiar el hash ES cambiar de pestaña.
            navigate({ search: `?codigo=${encodeURIComponent(code)}` })
            window.location.hash = 'incidentes'
          }}
        >
          {t('aiOps.seeIncidents')}
        </Button>
      </Stack>
    </Box>
  )
}

/**
 * CÁLCULO DEL SISTEMA de Operaciones (2026-11-23).
 *
 * Antes: once tarjetas de distinto tamaño (la mitad en cero), píldoras de
 * señales a todo lo ancho y DOS listas con los mismos grupos —la segunda en
 * una línea densa con minutos crudos («110,711»)—. Ahora: solo las cifras que
 * no son cero, las señales como chips y UNA lista de incidentes agrupada por
 * gravedad, con título legible, cifras humanas y, por fila, «Analizar» (IA) y
 * «Ver incidentes» (la pestaña filtrada por ese código).
 */
export function OpsSystemView({
  system,
  onOpenItem,
}: {
  system: ExplainSystem
  onOpenItem?: (item: ExplainItem) => void
}) {
  const { t } = useI18n()
  const rows = system.rows.filter((r) => r.group === 'groups')
  const items = new Map(system.items.map((i) => [i.ref, i]))
  const grupos = STATUS_ORDER.map((status) => ({
    status,
    rows: rows.filter((r) => asStatus(r.status) === status),
  })).filter((g) => g.rows.length > 0)

  return (
    <Stack spacing={2.5}>
      <Figures system={system} />
      <CompanySignals system={system} />
      {grupos.length === 0 ? (
        <Typography sx={{ fontSize: 13 }}>{t('aiOps.noIncidents')}</Typography>
      ) : (
        grupos.map(({ status, rows: lista }) => (
          <Box component="section" key={status} aria-labelledby={`ai-ops-${status}`}>
            <GroupTitle id={`ai-ops-${status}`} count={lista.length}>
              {t(`aiOps.groupBy.${status}` as MessageKey)}
            </GroupTitle>
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', border: '1px solid var(--border)', borderRadius: 0.67, overflow: 'hidden' }}>
              {lista.map((row, index) => (
                <IncidentRow
                  key={row.ref ?? row.label}
                  system={system}
                  row={row}
                  item={row.ref ? items.get(row.ref) : undefined}
                  first={index === 0}
                  onOpenItem={onOpenItem}
                />
              ))}
            </Box>
          </Box>
        ))
      )}
    </Stack>
  )
}
