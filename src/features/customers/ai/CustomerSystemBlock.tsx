import { Box, Chip, Stack, Typography } from '@mui/material'
import { formatMetric } from '@/features/admin/dashboard/aiAnalyst'
import { SeverityIcon } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import type { CustomerSystem } from './customersAi'

/** Cifras de la cabecera. Solo se pintan las que la base devolvió. */
const ORDER_FIGURES = [
  'orders_365d',
  'amount_365d',
  'avg_ticket_365d',
  'days_since_last_order',
  'avg_order_interval_days',
  'orders_open',
] as const
const CREDIT_FIGURES = ['debt_total', 'debt_overdue', 'credit_limit', 'max_days_overdue'] as const
const VISIT_FIGURES = ['visits_90d', 'visits_completed_90d', 'days_since_last_visit', 'next_visit_in_days'] as const

function Heading({ children }: { children: string }) {
  return (
    <Typography
      component="h4"
      sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}
    >
      {children}
    </Typography>
  )
}

function Figures({ keys, system }: { keys: readonly string[]; system: CustomerSystem }) {
  const { t, locale } = useI18n()
  const labels = { days: t('aiOrders.unit.days') }
  const present = keys.filter((k) => system.metrics[k])
  if (present.length === 0) return null
  return (
    <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
      {present.map((k) => (
        <Typography key={k} sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t(`aiCustomers.figure.${k}` as MessageKey)}:{' '}
          <Box component="strong" className="tnum" sx={{ color: 'var(--text)' }}>
            {formatMetric(system.metrics[k]!, locale, labels)}
          </Box>
        </Typography>
      ))}
    </Stack>
  )
}

/**
 * CÁLCULO DEL SISTEMA del cliente: señales por regla y cifras de la base. Sin
 * IA y sin cuota. Las secciones que el rol no puede ver (crédito, visitas) no
 * se pintan como vacías: se dice que no se muestran.
 */
export function CustomerSystemBlock({ system }: { system: CustomerSystem }) {
  const { t, locale } = useI18n()
  const labels = { days: t('aiOrders.unit.days') }
  return (
    <Stack spacing={1.75}>
      <Stack spacing={0.75}>
        <Heading>{t('aiCustomers.system.signals')}</Heading>
        {system.signals.length === 0 ? (
          <Typography sx={{ fontSize: 13 }}>{t('aiCustomers.system.noSignals')}</Typography>
        ) : (
          <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {system.signals.map((s) => (
              <Stack component="li" key={s.code} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <SeverityIcon severity={s.severity} />
                <Typography sx={{ fontSize: 13 }}>{t(`aiCustomers.signal.${s.code}` as MessageKey)}</Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>

      <Stack spacing={0.75}>
        <Heading>{t('aiCustomers.system.orders')}</Heading>
        <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
          {t(`aiCustomers.link.${system.link}` as MessageKey)}
        </Typography>
        <Figures keys={ORDER_FIGURES} system={system} />
        {system.recent_orders.length > 0 && (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }} aria-label={t('aiCustomers.system.recentOrders')}>
            {system.recent_orders.map((o) => {
              const total = system.metrics[`${o.ref}_total`]
              const ago = system.metrics[`${o.ref}_days_ago`]
              return (
                <Typography component="li" key={o.order_id} sx={{ fontSize: 12.5 }}>
                  <strong>{o.order_number}</strong>
                  {o.status && ` · ${t(`orders.status.${o.status}` as MessageKey)}`}
                  {total && (
                    <>
                      {' · '}
                      <span className="tnum">{formatMetric(total, locale, labels)}</span>
                    </>
                  )}
                  {ago && ` · ${t('aiCustomers.ago').replace('{d}', formatMetric(ago, locale, labels))}`}
                </Typography>
              )
            })}
          </Stack>
        )}
      </Stack>

      {system.products.length > 0 && (
        <Stack spacing={0.75}>
          <Heading>{t('aiCustomers.system.products')}</Heading>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
            {system.products.map((p) => {
              const orders = system.metrics[`${p.ref}_orders`]
              const last = system.metrics[`${p.ref}_days_since_last`]
              return (
                <Typography component="li" key={p.product_id} sx={{ fontSize: 12.5 }}>
                  {p.name}
                  {orders && ` · ${t('aiCustomers.inOrders').replace('{n}', formatMetric(orders, locale, labels))}`}
                  {last && ` · ${t('aiCustomers.ago').replace('{d}', formatMetric(last, locale, labels))}`}{' '}
                  {p.lapsed && <Chip size="small" variant="outlined" label={t('aiCustomers.lapsed')} />}
                </Typography>
              )
            })}
          </Stack>
        </Stack>
      )}

      {system.promotions.length > 0 && (
        <Stack spacing={0.75}>
          <Heading>{t('aiCustomers.system.promotions')}</Heading>
          <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {system.promotions.map((p) => {
              const uses = system.metrics[`${p.ref}_uses`]
              return (
                <Chip
                  key={p.ref}
                  size="small"
                  variant="outlined"
                  label={uses ? `${p.name} · ${formatMetric(uses, locale, labels)}` : p.name}
                />
              )
            })}
          </Stack>
        </Stack>
      )}

      <Stack spacing={0.75}>
        <Heading>{t('aiCustomers.system.credit')}</Heading>
        {system.sections.credit ? (
          <>
            {system.credit_status && (
              <Typography sx={{ fontSize: 12.5 }}>{t(`aiCustomers.credit.${system.credit_status}` as MessageKey)}</Typography>
            )}
            <Figures keys={CREDIT_FIGURES} system={system} />
          </>
        ) : (
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiCustomers.system.creditHidden')}</Typography>
        )}
      </Stack>

      {system.sections.visits && system.visits && (
        <Stack spacing={0.75}>
          <Heading>{t('aiCustomers.system.visits')}</Heading>
          <Figures keys={VISIT_FIGURES} system={system} />
          {system.tasks.length > 0 && (
            <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }} aria-label={t('aiCustomers.system.tasks')}>
              {system.tasks.map((task) => (
                <Typography component="li" key={task.ref} sx={{ fontSize: 12.5 }}>
                  {task.label}
                </Typography>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  )
}
