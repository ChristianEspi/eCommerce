import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type FormEvent } from 'react'
import { formatMetric } from '@/features/admin/dashboard/aiAnalyst'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { MarkerText, MotivoNotice, SeverityIcon } from '@/features/orders/ai/parts'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon } from '@/shared/ui/AppIcon'
import { T } from '@/theme/tokens'
import {
  MAX_INVENTORY_QUESTION,
  type InventoryAiContext,
  type InventoryAiSignal,
  type InventoryInsight,
  type InventoryReview,
  type InventorySystem,
} from './inventoryAi'
import { useInventoryInsight, useInventorySignals } from './useInventoryAi'

/** Preguntas sugeridas. `summary` = sin pregunta (solo el análisis del lote). */
export const INVENTORY_QUESTIONS = ['summary', 'stockout', 'excess', 'atypical'] as const
type InventoryQuestion = (typeof INVENTORY_QUESTIONS)[number]

/** Las cifras de cada producto que enseña el CÁLCULO DEL SISTEMA. */
const FIGURES = ['available', 'cover_days', 'sold_30d', 'days_since_sale'] as const

function SectionTitle({ id, children }: { id?: string; children: string }) {
  return (
    <Typography id={id} component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
      {children}
    </Typography>
  )
}

/** Lleva a la pestaña donde se revisa: NO ajusta, no reserva, no compra. */
function ReviewButton({ review, variant = 'outlined' }: { review: InventoryReview; variant?: 'outlined' | 'contained' }) {
  const { t } = useI18n()
  if (!review.tab) {
    return review.kind === 'none' ? null : (
      <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t(`aiInventory.review.${review.kind}` as MessageKey)}</Typography>
    )
  }
  const tab = review.tab
  return (
    <Button
      size="small"
      variant={variant}
      endIcon={<ArrowForwardRoundedIcon />}
      sx={{ alignSelf: 'flex-start' }}
      title={t('aiInventory.reviewHint')}
      onClick={() => {
        // SectionTabs escucha `hashchange`: cambiar el hash ES cambiar de pestaña.
        window.location.hash = tab
      }}
    >
      {t(`aiInventory.review.${review.kind}` as MessageKey)}
    </Button>
  )
}

function SignalChips({ signals }: { signals: readonly InventoryAiSignal[] }) {
  const { t } = useI18n()
  return (
    <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
      {signals.map((s) => (
        <Chip key={s} size="small" variant="outlined" label={t(`aiInventory.signal.${s}` as MessageKey)} />
      ))}
    </Stack>
  )
}

/** CÁLCULO DEL SISTEMA: señales y cifras de la base, sin IA. */
function SystemBlock({ system }: { system: InventorySystem }) {
  const { t, locale } = useI18n()
  if (system.items.length === 0) {
    return <Typography sx={{ fontSize: 13 }}>{t('aiInventory.system.none')}</Typography>
  }
  const labels = { days: t('aiOrders.unit.days') }
  return (
    <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {system.items.map((item) => (
        <Stack
          component="li"
          key={item.ref}
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.25}
          sx={{ alignItems: { sm: 'flex-start' }, borderBottom: '1px solid var(--border)', pb: 1.25 }}
        >
          <SeverityIcon severity={item.severity} />
          <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
              {item.name}{' '}
              {item.sku && (
                <Box component="span" sx={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400 }}>
                  {item.sku}
                </Box>
              )}
            </Typography>
            <SignalChips signals={item.signals} />
            <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
              {FIGURES.map((f) => {
                const metric = system.metrics[`${item.ref}_${f}`]
                if (!metric) return null
                return (
                  <Typography key={f} sx={{ fontSize: 12, color: 'var(--muted)' }}>
                    {t(`aiInventory.figure.${f}` as MessageKey)}:{' '}
                    <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
                      {formatMetric(metric, locale, labels)}
                    </Box>
                  </Typography>
                )
              })}
            </Stack>
          </Stack>
          <ReviewButton review={item.system_review} />
        </Stack>
      ))}
    </Stack>
  )
}

function InsightView({ data, context }: { data: InventoryInsight; context: InventoryAiContext }) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.75}>
      {data.answer && (
        <Box component="section">
          <Typography component="h4" sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75 }}>
            {t('aiInventory.section.answer')}
          </Typography>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.answer} context={context} />
          </Typography>
        </Box>
      )}
      {data.overview && (
        <Box component="section">
          <Typography component="h4" sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75 }}>
            {t('aiInventory.section.overview')}
          </Typography>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.overview} context={context} />
          </Typography>
        </Box>
      )}
      {data.items.length > 0 && (
        <Stack component="ul" spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label={t('aiInventory.section.items')}>
          {data.items.map((item) => (
            <Stack component="li" key={item.ref} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <SeverityIcon severity={item.severity} />
              <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{item.name}</Typography>
                <Typography sx={{ fontSize: 13 }}>
                  <MarkerText text={item.explanation} context={context} />
                </Typography>
                {item.overridden && (
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiInventory.overridden')}</Typography>
                )}
                <ReviewButton review={item.suggested_review} />
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
      {data.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiOrders.discarded').replace('{n}', String(data.discarded))}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * Pestaña «Análisis IA» de Inventario (fase 05).
 *
 * Dos capas, separadas en pantalla:
 *  - **Cálculo del sistema** (al abrir, sin cuota): riesgo de quiebre, exceso,
 *    inmovilizados, alta rotación, movimientos atípicos y ERP caducado, con sus
 *    cifras de la base y la revisión que corresponde por regla.
 *  - **Interpretación IA** (bajo demanda, una consulta): por qué importa cada
 *    señal y qué revisar primero, y la respuesta a una pregunta.
 *
 * Nada aquí mueve existencias ni propone cantidades: la revisión lleva a la
 * pestaña donde la persona decide con los comandos de siempre.
 */
export function InventoryAiSection() {
  const { t, locale } = useI18n()
  const { activeStore } = useTenant()
  const storeId = activeStore?.id ?? null
  const { availability } = useAiFeature('inventory')
  const visible = availability !== 'forbidden' && availability !== 'loading'
  const signals = useInventorySignals(storeId, locale, visible)
  const insight = useInventoryInsight(locale)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{ q: string | null } | null>(null)

  if (!visible || !storeId) return null

  const canAsk = availability === 'available'
  const tooLong = question.trim().length > MAX_INVENTORY_QUESTION
  const run = (q: string | null) => {
    if (!canAsk || insight.isPending) return
    setAsked({ q })
    insight.mutate({ storeId, question: q })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const q = question.trim()
    if (!q || tooLong) return
    run(q)
  }
  const result = insight.data?.result
  const sinSenales = signals.isSuccess && signals.data !== null && signals.data.items.length === 0

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <AppIcon tone="accent" size="sm">
          <AutoAwesomeRoundedIcon fontSize="small" />
        </AppIcon>
        <Stack sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography component="h2" sx={{ fontSize: T.body, fontWeight: 800 }}>
              {t('aiInventory.title')}
            </Typography>
            <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiInventory.description')}</Typography>
        </Stack>
      </Stack>

      <Card variant="outlined" component="section" aria-labelledby="ai-inventory-system">
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <SectionTitle id="ai-inventory-system">{t('aiInventory.system.title')}</SectionTitle>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiInventory.system.help')}</Typography>
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
                {t('aiInventory.system.error')}
              </Alert>
            )}
            {signals.isSuccess && signals.data && <SystemBlock system={signals.data} />}
            {signals.isSuccess && !signals.data && <Alert severity="warning">{t('aiInventory.system.error')}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Divider />

      <Stack spacing={1.5} component="section" aria-labelledby="ai-inventory-ai">
        <SectionTitle id="ai-inventory-ai">{t('aiInventory.ai.title')}</SectionTitle>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

        {canAsk && !sinSenales && (
          <>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiOrders.suggested')}>
              {INVENTORY_QUESTIONS.map((id: InventoryQuestion) => {
                const label = t(`aiInventory.q.${id}` as MessageKey)
                return (
                  <Chip
                    key={id}
                    label={label}
                    variant="outlined"
                    clickable
                    icon={id === 'summary' ? <AutoAwesomeRoundedIcon fontSize="small" /> : undefined}
                    disabled={insight.isPending}
                    onClick={() => run(id === 'summary' ? null : label)}
                  />
                )
              })}
            </Stack>
            <Box component="form" onSubmit={onSubmit} noValidate>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('aiInventory.ask.label')}
                  placeholder={t('aiInventory.ask.placeholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiInventory.costHint')}
                  inputProps={{ maxLength: MAX_INVENTORY_QUESTION + 50 }}
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
        {canAsk && sinSenales && <Typography sx={{ fontSize: 13 }}>{t('aiInventory.ai.nothing')}</Typography>}

        <Box aria-live="polite" aria-busy={insight.isPending}>
          {insight.isPending && (
            <Stack spacing={0.75}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiInventory.generating')}</Typography>
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
              {t('aiInventory.networkError')}
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
                <InsightView data={result.data} context={result.data} />
                <AiFeedbackButtons interactionId={result.interactionId} />
              </CardContent>
            </Card>
          )}
        </Box>
        <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiInventory.disclaimer')}</Typography>
      </Stack>
    </Stack>
  )
}
