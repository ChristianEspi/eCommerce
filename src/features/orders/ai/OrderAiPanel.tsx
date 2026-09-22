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
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon } from '@/shared/ui/AppIcon'
import { T } from '@/theme/tokens'
import {
  MAX_ORDER_QUESTION,
  ORDER_AI_ROUTE_CAPABILITY,
  suggestedActionFor,
  type OrderAiContext,
  type OrderDiagnosis,
  type OrderInsight,
  type OrderDrawerTab,
  type OrderSuggestedAction,
} from './ordersAi'
import { MarkerText, MotivoNotice, SeverityIcon } from './parts'
import { useOrderInsight, useOrderSignals } from './useOrdersAi'

/** Preguntas sugeridas del detalle. `summary` = sin pregunta (solo resumen). */
export const ORDER_QUESTIONS = ['summary', 'why_not_delivered', 'whats_missing'] as const
type OrderQuestion = (typeof ORDER_QUESTIONS)[number]

function Bloque({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography
        component="h4"
        sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  )
}

/**
 * Botón de la acción sugerida: LLEVA al flujo normal, no ejecuta nada.
 *
 * Con pestaña ⇒ cambia la pestaña del cajón; con ruta ⇒ navega, solo si la
 * sociedad tiene contratado ese módulo. `none` no pinta botón.
 */
export function SuggestedActionButton({
  action,
  onNavigate,
  variant = 'outlined',
}: {
  action: OrderSuggestedAction
  onNavigate: (tab: OrderDrawerTab, orderId: string | null) => void
  variant?: 'outlined' | 'contained' | 'text'
}) {
  const { t } = useI18n()
  const { has } = useCapabilities()
  const navigate = useNavigate()
  if (action.kind === 'none') return null
  const label = t(`aiOrders.action.${action.kind}` as MessageKey)
  const rutaDisponible = action.route !== null && has(ORDER_AI_ROUTE_CAPABILITY[action.route])
  if (!action.tab && !rutaDisponible) return null
  return (
    <Button
      size="small"
      variant={variant}
      endIcon={<ArrowForwardRoundedIcon />}
      sx={{ alignSelf: 'flex-start' }}
      title={t('aiOrders.actionHint')}
      onClick={() => {
        if (action.tab) onNavigate(action.tab, action.order_id)
        else if (action.route && rutaDisponible) navigate(action.route)
      }}
    >
      {label}
    </Button>
  )
}

/** «CÁLCULO DEL SISTEMA»: reglas deterministas, visibles haya IA o no. */
function SystemBlock({
  diagnosis,
  orderId,
  onNavigate,
}: {
  diagnosis: OrderDiagnosis
  orderId: string
  onNavigate: (tab: OrderDrawerTab, orderId: string | null) => void
}) {
  const { t } = useI18n()
  const next = suggestedActionFor(diagnosis.next_action, orderId)
  return (
    <Stack spacing={1.5}>
      {diagnosis.signals.length === 0 ? (
        <Typography sx={{ fontSize: 13 }}>
          {diagnosis.closed ? t('aiOrders.system.closed') : t('aiOrders.system.none')}
        </Typography>
      ) : (
        <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {diagnosis.signals.map((s) => (
            <Stack component="li" key={s.code} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <SeverityIcon severity={s.severity} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t(`aiOrders.signal.${s.code}` as MessageKey)}</Typography>
                <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {t(`aiOrders.severity.${s.severity}` as MessageKey)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      )}
      {diagnosis.missing.length > 0 && (
        <Bloque title={t('aiOrders.system.missing')}>
          <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            {diagnosis.missing.map((m) => (
              <Chip key={m} size="small" variant="outlined" label={t(`aiOrders.missing.${m}` as MessageKey)} />
            ))}
          </Stack>
        </Bloque>
      )}
      {diagnosis.next_action !== 'none' && (
        <Bloque title={t('aiOrders.system.next')}>
          <SuggestedActionButton action={next} onNavigate={onNavigate} />
        </Bloque>
      )}
    </Stack>
  )
}

function InsightView({
  data,
  context,
  onNavigate,
}: {
  data: OrderInsight
  context: OrderAiContext
  onNavigate: (tab: OrderDrawerTab, orderId: string | null) => void
}) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.75}>
      {data.answer && (
        <Bloque title={t('aiOrders.section.answer')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.answer} context={context} />
          </Typography>
        </Bloque>
      )}
      {data.summary && (
        <Bloque title={t('aiOrders.section.summary')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.summary} context={context} />
          </Typography>
        </Bloque>
      )}
      {data.status_explanation && (
        <Bloque title={t('aiOrders.section.status')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.status_explanation} context={context} />
          </Typography>
        </Bloque>
      )}
      {data.blockers.length > 0 && (
        <Bloque title={t('aiOrders.section.blockers')}>
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {data.blockers.map((b) => (
              <Stack component="li" key={b.signal} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <SeverityIcon severity={b.severity} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t(`aiOrders.signal.${b.signal}` as MessageKey)}</Typography>
                  <Typography sx={{ fontSize: 13 }}>
                    <MarkerText text={b.explanation} context={context} />
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Bloque>
      )}
      {data.missing_info.length > 0 && (
        <Bloque title={t('aiOrders.section.missing')}>
          <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
            {data.missing_info.map((m) => (
              <Typography component="li" key={m.field} sx={{ fontSize: 13 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {t(`aiOrders.missing.${m.field}` as MessageKey)}:
                </Box>{' '}
                <MarkerText text={m.explanation} context={context} />
              </Typography>
            ))}
          </Stack>
        </Bloque>
      )}
      <Bloque title={t('aiOrders.section.next')}>
        <Stack spacing={1}>
          {data.next_step.explanation && (
            <Typography sx={{ fontSize: 13.5 }}>
              <MarkerText text={data.next_step.explanation} context={context} />
            </Typography>
          )}
          {data.next_step.overridden && (
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiOrders.overridden')}</Typography>
          )}
          {data.suggested_action.kind === 'none' ? (
            <Typography sx={{ fontSize: 13 }}>{t('aiOrders.action.none')}</Typography>
          ) : (
            <SuggestedActionButton action={data.suggested_action} onNavigate={onNavigate} variant="contained" />
          )}
        </Stack>
      </Bloque>
      {data.history_summary && (
        <Bloque title={t('aiOrders.section.history')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.history_summary} context={context} />
          </Typography>
        </Bloque>
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
 * Pestaña «Asistente IA» del detalle del pedido (fase 04).
 *
 * Dos capas, separadas en pantalla:
 *  - **Cálculo del sistema** (siempre, sin cuota): bloqueos, faltantes y
 *    siguiente paso esperado, por reglas deterministas sobre los ejes reales.
 *  - **Interpretación IA** (bajo demanda, gasta una consulta): resumen,
 *    explicación del estado, historial y respuesta a una pregunta.
 *
 * Nada aquí cambia el pedido: la acción sugerida cambia de pestaña o navega, y
 * la persona actúa con los controles de siempre, que valida la base.
 */
export function OrderAiPanel({
  orderId,
  onNavigate,
}: {
  orderId: string
  onNavigate: (tab: OrderDrawerTab, orderId: string | null) => void
}) {
  const { t, locale } = useI18n()
  const { availability } = useAiFeature('orders')
  const signals = useOrderSignals(orderId, locale, availability !== 'forbidden' && availability !== 'loading')
  const insight = useOrderInsight(locale)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{ q: string | null } | null>(null)

  // Otro pedido ⇒ la interpretación anterior no le corresponde.
  const { reset } = insight
  useEffect(() => {
    reset()
    setAsked(null)
    setQuestion('')
  }, [orderId, reset])

  if (availability === 'forbidden' || availability === 'loading') return null

  const canAsk = availability === 'available'
  const tooLong = question.trim().length > MAX_ORDER_QUESTION
  const run = (q: string | null) => {
    if (!canAsk || insight.isPending) return
    setAsked({ q })
    insight.mutate({ orderId, question: q })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const q = question.trim()
    if (!q || tooLong) return
    run(q)
  }

  const result = insight.data?.result

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <AppIcon tone="accent" size="sm">
          <AutoAwesomeRoundedIcon fontSize="small" />
        </AppIcon>
        <Stack sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography component="h3" sx={{ fontSize: T.body, fontWeight: 800 }}>
              {t('aiOrders.title')}
            </Typography>
            <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiOrders.description')}</Typography>
        </Stack>
      </Stack>

      <Card variant="outlined" component="section" aria-labelledby="ai-orders-system">
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography id="ai-orders-system" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
            {t('aiOrders.system.title')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiOrders.system.help')}</Typography>
          <Box aria-live="polite" aria-busy={signals.isPending}>
            {signals.isPending && <Skeleton variant="rounded" height={72} />}
            {signals.isError && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void signals.refetch()}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiOrders.system.error')}
              </Alert>
            )}
            {signals.isSuccess && signals.data && (
              <SystemBlock diagnosis={signals.data.diagnosis} orderId={orderId} onNavigate={onNavigate} />
            )}
            {signals.isSuccess && !signals.data && <Alert severity="warning">{t('aiOrders.system.error')}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Divider />

      <Stack spacing={1.5} component="section" aria-labelledby="ai-orders-ai">
        <Typography id="ai-orders-ai" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
          {t('aiOrders.ai.title')}
        </Typography>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

        {canAsk && (
          <>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiOrders.suggested')}>
              {ORDER_QUESTIONS.map((id: OrderQuestion) => {
                const label = t(`aiOrders.q.${id}` as MessageKey)
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
                  label={t('aiOrders.ask.label')}
                  placeholder={t('aiOrders.ask.placeholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiOrders.costHint')}
                  inputProps={{ maxLength: MAX_ORDER_QUESTION + 50 }}
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
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiOrders.generating')}</Typography>
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
              {t('aiOrders.networkError')}
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
                <InsightView data={result.data} context={result.data} onNavigate={onNavigate} />
                <AiFeedbackButtons interactionId={result.interactionId} />
              </CardContent>
            </Card>
          )}
        </Box>
        <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiOrders.disclaimer')}</Typography>
      </Stack>
    </Stack>
  )
}
