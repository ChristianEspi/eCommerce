import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
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
import { useState, type FormEvent, type ReactNode } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { MarkerText, MotivoNotice, SeverityIcon } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { CustomerSystemBlock } from './CustomerSystemBlock'
import { MAX_CUSTOMER_QUESTION, type CustomerAiContext, type CustomerInsight } from './customersAi'
import { useCustomerInsight, useCustomerSignals } from './useCustomersAi'

/** Preguntas sugeridas. `summary` = sin pregunta (solo el resumen 360). */
export const CUSTOMER_QUESTIONS = ['summary', 'pending', 'opportunities', 'trend'] as const
type CustomerQuestion = (typeof CUSTOMER_QUESTIONS)[number]

export function AiBlock({ title, children }: { title: string; children: ReactNode }) {
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

export function PendingList({
  items,
  context,
}: {
  items: readonly { signal: string; severity: 'high' | 'medium' | 'low'; text: string }[]
  context: CustomerAiContext
}) {
  const { t } = useI18n()
  return (
    <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {items.map((p) => (
        <Stack component="li" key={p.signal} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <SeverityIcon severity={p.severity} />
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{t(`aiCustomers.signal.${p.signal}` as MessageKey)}</Typography>
            <Typography sx={{ fontSize: 13 }}>
              <MarkerText text={p.text} context={context} />
            </Typography>
          </Stack>
        </Stack>
      ))}
    </Stack>
  )
}

export function ProductNotes({
  items,
  context,
}: {
  items: readonly { ref: string; name: string; lapsed: boolean; text: string }[]
  context: CustomerAiContext
}) {
  const { t } = useI18n()
  return (
    <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {items.map((p) => (
        <Stack component="li" key={p.ref} spacing={0.25}>
          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
            {p.name} {p.lapsed && <Chip size="small" variant="outlined" label={t('aiCustomers.lapsed')} />}
          </Typography>
          <Typography sx={{ fontSize: 13 }}>
            <MarkerText text={p.text} context={context} />
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

function InsightView({ data }: { data: CustomerInsight }) {
  const { t } = useI18n()
  return (
    <Stack spacing={1.75}>
      {data.answer && (
        <AiBlock title={t('aiCustomers.section.answer')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.answer} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.overview && (
        <AiBlock title={t('aiCustomers.section.overview')}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.overview} context={data} />
          </Typography>
        </AiBlock>
      )}
      {data.highlights.length > 0 && (
        <AiBlock title={t('aiCustomers.section.highlights')}>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
            {data.highlights.map((h, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 13 }}>
                <MarkerText text={h} context={data} />
              </Typography>
            ))}
          </Stack>
        </AiBlock>
      )}
      {data.pending.length > 0 && (
        <AiBlock title={t('aiCustomers.section.pending')}>
          <PendingList items={data.pending} context={data} />
        </AiBlock>
      )}
      {data.opportunities.length > 0 && (
        <AiBlock title={t('aiCustomers.section.opportunities')}>
          <ProductNotes items={data.opportunities} context={data} />
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

/**
 * Pestaña «Resumen IA» de la ficha de cliente (fase 06).
 *
 *  - **Cálculo del sistema** (al abrir, sin cuota): señales, pedidos, productos
 *    frecuentes, promociones, crédito (solo si el rol lo ve) y visitas.
 *  - **Interpretación IA** (bajo demanda, una consulta): resumen 360,
 *    observaciones, pendientes, oportunidades observables y respuesta.
 *
 * Nada aquí escribe. Sin permiso para la funcionalidad, la pestaña no existe
 * (la decide `CustomerDrawer` con `useAiFeature('customers')`).
 */
export function CustomerAiPanel({ customerId }: { customerId: string }) {
  const { t, locale } = useI18n()
  const { availability } = useAiFeature('customers')
  const visible = availability !== 'forbidden' && availability !== 'loading'
  const signals = useCustomerSignals(customerId, locale, visible)
  const insight = useCustomerInsight(locale)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{ q: string | null } | null>(null)

  if (!visible) return null

  const canAsk = availability === 'available'
  const tooLong = question.trim().length > MAX_CUSTOMER_QUESTION
  const run = (q: string | null) => {
    if (!canAsk || insight.isPending) return
    setAsked({ q })
    insight.mutate({ customerId, question: q })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const q = question.trim()
    if (!q || tooLong) return
    run(q)
  }
  const result = insight.data?.result

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 800 }}>
          {t('aiCustomers.title')}
        </Typography>
        <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
      </Stack>

      <Card variant="outlined" component="section" aria-labelledby="ai-customer-system">
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography id="ai-customer-system" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
            {t('aiCustomers.system.title')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiCustomers.system.help')}</Typography>
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
                {t('aiCustomers.system.error')}
              </Alert>
            )}
            {signals.isSuccess && signals.data && <CustomerSystemBlock system={signals.data} />}
            {signals.isSuccess && !signals.data && <Alert severity="warning">{t('aiCustomers.system.error')}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Divider />

      <Stack spacing={1.5} component="section" aria-labelledby="ai-customer-ai">
        <Typography id="ai-customer-ai" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
          {t('aiCustomers.ai.title')}
        </Typography>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

        {canAsk && (
          <>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiOrders.suggested')}>
              {CUSTOMER_QUESTIONS.map((id: CustomerQuestion) => {
                const label = t(`aiCustomers.q.${id}` as MessageKey)
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
                  label={t('aiCustomers.ask.label')}
                  placeholder={t('aiCustomers.ask.placeholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : t('aiCustomers.costHint')}
                  inputProps={{ maxLength: MAX_CUSTOMER_QUESTION + 50 }}
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
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiCustomers.generating')}</Typography>
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
              {t('aiCustomers.networkError')}
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
                <InsightView data={result.data} />
                <AiFeedbackButtons interactionId={result.interactionId} />
              </CardContent>
            </Card>
          )}
        </Box>
        <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiCustomers.disclaimer')}</Typography>
      </Stack>
    </Stack>
  )
}
