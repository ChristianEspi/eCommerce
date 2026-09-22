import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type FormEvent } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { AppIcon } from '@/shared/ui/AppIcon'
import { StatusChip } from '@/shared/ui/StatusChip'
import { T } from '@/theme/tokens'
import {
  APPROVAL_LABEL,
  FULFILLMENT_COLOR,
  FULFILLMENT_LABEL,
  PAYMENT_COLOR,
  PAYMENT_LABEL,
  SOURCE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from '../status'
import {
  MAX_ORDER_QUESTION,
  describeFilters,
  suggestedActionFor,
  type AttentionSystem,
  type OrderAiFilters,
  type OrderDrawerTab,
  type OrdersAttention,
  type OrdersSearch,
} from './ordersAi'
import { SuggestedActionButton } from './OrderAiPanel'
import { MarkerText, MotivoNotice, SeverityIcon } from './parts'
import { useOrdersAttention, useOrdersNaturalSearch } from './useOrdersAi'

/** Ejemplos de búsqueda en lenguaje natural (se envían tal cual). */
export const SEARCH_EXAMPLES = ['paid_unshipped', 'unpaid_week', 'awaiting'] as const

type Resultado =
  | { readonly kind: 'search'; readonly question: string }
  | { readonly kind: 'attention' }

function filterValueLabel(
  key: keyof OrderAiFilters,
  value: string | number | true,
  t: (k: MessageKey) => string,
): string {
  switch (key) {
    case 'status':
      return t(STATUS_LABEL[value as keyof typeof STATUS_LABEL])
    case 'payment_status':
      return t(PAYMENT_LABEL[value as keyof typeof PAYMENT_LABEL])
    case 'fulfillment_status':
      return t(FULFILLMENT_LABEL[value as keyof typeof FULFILLMENT_LABEL])
    case 'approval_status':
      return t(APPROVAL_LABEL[value as keyof typeof APPROVAL_LABEL])
    case 'source_channel':
      return t(SOURCE_LABEL[value as keyof typeof SOURCE_LABEL])
    case 'placed_within_days':
      return t('aiOrders.filter.placed_within_days').replace('{n}', String(value))
    case 'older_than_days':
      return t('aiOrders.filter.older_than_days').replace('{n}', String(value))
    case 'attention_only':
      return t('aiOrders.filter.attention_only')
    default:
      return `«${String(value)}»`
  }
}

function SearchResults({
  data,
  onOpenOrder,
}: {
  data: OrdersSearch
  onOpenOrder: (orderId: string, tab?: OrderDrawerTab) => void
}) {
  const { t, locale } = useI18n()
  const filtros = describeFilters(data.filters)
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>{t('aiOrders.search.filters')}:</Typography>
        {filtros.map((f) => (
          <Chip
            key={f.key}
            size="small"
            variant="outlined"
            label={
              f.key === 'placed_within_days' || f.key === 'older_than_days' || f.key === 'attention_only'
                ? filterValueLabel(f.key, f.value, t)
                : `${t(`aiOrders.filter.${f.key}` as MessageKey)}: ${filterValueLabel(f.key, f.value, t)}`
            }
          />
        ))}
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }} aria-live="polite">
        {t('aiOrders.search.count').replace('{n}', String(data.rows.length)).replace('{total}', String(data.total))}
      </Typography>
      {data.rows.length === 0 ? (
        <Typography sx={{ fontSize: 13 }}>{t('aiOrders.search.empty')}</Typography>
      ) : (
        <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {data.rows.map((row) => (
            <Box
              component="li"
              key={row.id}
              sx={{ border: '1px solid var(--border)', borderRadius: 1.5, px: 1.5, py: 1 }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => onOpenOrder(row.id)}
                    sx={{ p: 0, minWidth: 0, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    aria-label={`${t('orders.open')} ${row.order_number}`}
                  >
                    {row.order_number}
                  </Button>
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                    {[row.customer_label, row.placed_at ? formatDate(row.placed_at, locale) : null].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusChip tone={STATUS_COLOR[row.status]} label={t(STATUS_LABEL[row.status])} />
                  <StatusChip tone={PAYMENT_COLOR[row.payment_status]} label={t(PAYMENT_LABEL[row.payment_status])} />
                  <StatusChip
                    tone={FULFILLMENT_COLOR[row.fulfillment_status]}
                    label={t(FULFILLMENT_LABEL[row.fulfillment_status])}
                  />
                  {row.grand_total && row.currency && (
                    <Typography className="tnum" sx={{ fontSize: 13, fontWeight: 800 }}>
                      {formatMoney(Number(row.grand_total), row.currency, locale)}
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
      {data.total > data.rows.length && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('aiOrders.search.capped').replace('{n}', String(data.limit))}
        </Typography>
      )}
      {data.discarded > 0 && (
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiOrders.search.discarded')}</Typography>
      )}
    </Stack>
  )
}

function AttentionItem({
  item,
  reason,
  context,
  onOpenOrder,
  kind,
}: {
  item: AttentionSystem['items'][number] | OrdersAttention['items'][number]
  reason: string | null
  context: OrdersAttention | AttentionSystem
  onOpenOrder: (orderId: string, tab?: OrderDrawerTab) => void
  kind: 'ai' | 'system'
}) {
  const { t } = useI18n()
  const action =
    'suggested_action' in item ? item.suggested_action : suggestedActionFor(item.next_action, item.order_id)
  return (
    <Box component="li" sx={{ border: '1px solid var(--border)', borderRadius: 1.5, px: 1.5, py: 1.25 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
        <SeverityIcon severity={item.severity} />
        <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {item.order_number}
            </Typography>
            {item.customer_label && (
              <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{item.customer_label}</Typography>
            )}
          </Stack>
          {reason ? (
            <Typography sx={{ fontSize: 13 }}>
              <MarkerText text={reason} context={context} />
            </Typography>
          ) : null}
          <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {item.signals.map((s) => (
              <Chip key={s} size="small" variant="outlined" label={t(`aiOrders.signal.${s}` as MessageKey)} />
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ pt: 0.25 }}>
            <SuggestedActionButton
              action={action.kind === 'none' ? suggestedActionFor('open_order', item.order_id) : action}
              onNavigate={(tab, id) => onOpenOrder(id ?? item.order_id, tab)}
              variant={kind === 'ai' ? 'outlined' : 'text'}
            />
          </Stack>
        </Stack>
      </Stack>
    </Box>
  )
}

function AttentionResults({
  data,
  system,
  onOpenOrder,
}: {
  data: OrdersAttention | null
  system: AttentionSystem | null
  onOpenOrder: (orderId: string, tab?: OrderDrawerTab) => void
}) {
  const { t } = useI18n()
  if (data) {
    return (
      <Stack spacing={1.25}>
        {data.overview && (
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <MarkerText text={data.overview} context={data} />
          </Typography>
        )}
        <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {data.items.map((item) => (
            <AttentionItem key={item.ref} item={item} reason={item.reason} context={data} onOpenOrder={onOpenOrder} kind="ai" />
          ))}
        </Stack>
        {system && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('aiOrders.attention.shown').replace('{n}', String(system.items.length)).replace('{total}', String(system.total_open))}
          </Typography>
        )}
        {data.discarded > 0 && (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('aiOrders.discarded').replace('{n}', String(data.discarded))}
          </Typography>
        )}
      </Stack>
    )
  }
  if (!system) return null
  if (system.items.length === 0) {
    return <Typography sx={{ fontSize: 13 }}>{t('aiOrders.attention.none')}</Typography>
  }
  // Sin interpretación (sin cuota, proveedor caído…): la cola del SISTEMA,
  // ordenada por regla, sigue siendo útil.
  return (
    <Stack spacing={1}>
      <Typography component="h4" sx={{ fontSize: 12.5, fontWeight: 800 }}>
        {t('aiOrders.attention.system')}
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiOrders.attention.systemHelp')}</Typography>
      <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {system.items.map((item) => (
          <AttentionItem key={item.ref} item={item} reason={null} context={system} onOpenOrder={onOpenOrder} kind="system" />
        ))}
      </Stack>
    </Stack>
  )
}

/**
 * Asistente IA del listado de pedidos (fase 04).
 *
 *  - **Búsqueda en lenguaje natural**: la IA traduce la frase a FILTROS de una
 *    lista cerrada; el servidor los revisa y ejecuta una búsqueda controlada
 *    (≤25 filas) con la RLS de la persona. Los filtros aplicados se enseñan.
 *  - **¿Qué pedidos requieren atención?**: lote pequeño (≤15) de pedidos
 *    abiertos, con la cola del sistema como respaldo si no hay IA.
 *
 * No sustituye al buscador ni a las pestañas de siempre: es un atajo. Nada se
 * pide al cargar (cada consulta gasta cuota) y nada cambia un estado.
 */
export function OrdersAiBar({
  storeId,
  onOpenOrder,
}: {
  storeId: string
  onOpenOrder: (orderId: string, tab?: OrderDrawerTab) => void
}) {
  const { t, locale } = useI18n()
  const { availability } = useAiFeature('orders')
  const search = useOrdersNaturalSearch(locale)
  const attention = useOrdersAttention(locale)
  const [question, setQuestion] = useState('')
  const [shown, setShown] = useState<Resultado | null>(null)

  if (availability === 'forbidden' || availability === 'loading') return null

  const canAsk = availability === 'available'
  const busy = search.isPending || attention.isPending
  const tooLong = question.trim().length > MAX_ORDER_QUESTION

  const runSearch = (text: string) => {
    const q = text.trim()
    if (!canAsk || busy || !q || q.length > MAX_ORDER_QUESTION) return
    setShown({ kind: 'search', question: q })
    attention.reset()
    search.mutate({ storeId, question: q })
  }
  const runAttention = () => {
    if (!canAsk || busy) return
    setShown({ kind: 'attention' })
    search.reset()
    attention.mutate({ storeId })
  }
  const clear = () => {
    setShown(null)
    search.reset()
    attention.reset()
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    runSearch(question)
  }

  const active = shown?.kind === 'search' ? search : shown?.kind === 'attention' ? attention : null
  const searchResult = search.data
  const attentionResult = attention.data

  return (
    <Card component="section" aria-labelledby="ai-orders-bar-title" sx={{ borderColor: 'var(--accent)' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <AppIcon tone="accent" size="sm">
            <AutoAwesomeRoundedIcon fontSize="small" />
          </AppIcon>
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography id="ai-orders-bar-title" component="h2" sx={{ fontSize: T.body, fontWeight: 800 }}>
                {t('aiOrders.bar.title')}
              </Typography>
              <Chip size="small" label={t('aiOrders.badge')} color="primary" variant="outlined" />
            </Stack>
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiOrders.bar.description')}</Typography>
          </Stack>
          {shown && (
            <Button size="small" startIcon={<CloseRoundedIcon />} onClick={clear} disabled={busy}>
              {t('aiOrders.search.clear')}
            </Button>
          )}
        </Stack>

        {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
        {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

        {canAsk && (
          <>
            <Box component="form" onSubmit={onSubmit} noValidate>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('aiOrders.search.label')}
                  placeholder={t('aiOrders.search.placeholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  error={tooLong}
                  helperText={tooLong ? t('aiOrders.ask.tooLong') : undefined}
                  inputProps={{ maxLength: MAX_ORDER_QUESTION + 50 }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<SearchRoundedIcon />}
                  disabled={busy || !question.trim() || tooLong}
                  sx={{ flexShrink: 0 }}
                >
                  {t('aiOrders.search.send')}
                </Button>
              </Stack>
            </Box>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label={t('aiOrders.suggested')}>
              <Chip
                label={t('aiOrders.attention.run')}
                color="primary"
                variant="outlined"
                clickable
                icon={<AutoAwesomeRoundedIcon fontSize="small" />}
                disabled={busy}
                onClick={runAttention}
              />
              {SEARCH_EXAMPLES.map((id) => {
                const label = t(`aiOrders.example.${id}` as MessageKey)
                return (
                  <Chip
                    key={id}
                    label={label}
                    variant="outlined"
                    clickable
                    disabled={busy}
                    onClick={() => {
                      setQuestion(label)
                      runSearch(label)
                    }}
                  />
                )
              })}
            </Stack>
          </>
        )}

        {shown && active && (
          <Box aria-live="polite" aria-busy={active.isPending}>
            {active.isPending && (
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {shown.kind === 'search' ? t('aiOrders.search.searching') : t('aiOrders.attention.running')}
                </Typography>
                <Skeleton variant="rounded" height={96} />
              </Stack>
            )}
            {!active.isPending && active.isError && (
              <Alert
                severity="error"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => (shown.kind === 'search' ? runSearch(shown.question) : runAttention())}
                  >
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('aiOrders.networkError')}
              </Alert>
            )}

            {!search.isPending && !search.isError && shown.kind === 'search' && searchResult && (
              <Stack spacing={1.25}>
                {searchResult.motivo && (
                  <MotivoNotice motivo={searchResult.motivo} onRetry={() => runSearch(shown.question)} />
                )}
                {searchResult.motivo === 'vacia' && (
                  <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('aiOrders.search.notUnderstood')}</Typography>
                )}
                {searchResult.data && <SearchResults data={searchResult.data} onOpenOrder={onOpenOrder} />}
                <AiFeedbackButtons interactionId={searchResult.interactionId} />
              </Stack>
            )}

            {!attention.isPending && !attention.isError && shown.kind === 'attention' && attentionResult && (
              <Stack spacing={1.25}>
                {attentionResult.result.motivo &&
                  !(attentionResult.result.motivo === 'vacia' && attentionResult.system?.items.length === 0) && (
                    <MotivoNotice motivo={attentionResult.result.motivo} onRetry={runAttention} />
                  )}
                <AttentionResults
                  data={attentionResult.result.data}
                  system={attentionResult.system}
                  onOpenOrder={onOpenOrder}
                />
                <AiFeedbackButtons interactionId={attentionResult.result.interactionId} />
              </Stack>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
