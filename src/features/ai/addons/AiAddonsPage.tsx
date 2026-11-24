import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ChatRoundedIcon from '@mui/icons-material/ChatRounded'
import DocumentScannerRoundedIcon from '@mui/icons-material/DocumentScannerRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import ReviewsRoundedIcon from '@mui/icons-material/ReviewsRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import WarehouseRoundedIcon from '@mui/icons-material/WarehouseRounded'
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import RouteRoundedIcon from '@mui/icons-material/RouteRounded'
import RequestQuoteRoundedIcon from '@mui/icons-material/RequestQuoteRounded'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import AssistantRoundedIcon from '@mui/icons-material/AssistantRounded'
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useMemo, type ReactNode } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { roleLabel } from '@/shared/i18n/codeLabels'
import { AppIcon } from '@/shared/ui/AppIcon'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { StatusChip } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { AI_FEATURE_IDS, AI_FEATURE_ROLES, type AiFeature } from '../features'
import { useAiEntitlement } from '../hooks'
import type { AiEntitlement } from '../types'
import { AI_ADDON_GROUPS, type AiAddonState } from './catalog'
import { useAiAddonHistory, useAiUsageThisMonth, useSetAiFeature, type AiUsageRow } from './api'

const ICONS: Record<AiFeature, ReactNode> = {
  assistant: <ChatRoundedIcon fontSize="small" />,
  intake: <DocumentScannerRoundedIcon fontSize="small" />,
  'catalog.copy': <EditNoteRoundedIcon fontSize="small" />,
  content: <ArticleRoundedIcon fontSize="small" />,
  promotions: <LocalOfferRoundedIcon fontSize="small" />,
  reviews: <ReviewsRoundedIcon fontSize="small" />,
  orders: <ReceiptLongRoundedIcon fontSize="small" />,
  inventory: <WarehouseRoundedIcon fontSize="small" />,
  planning: <TimelineRoundedIcon fontSize="small" />,
  fulfillment: <LocalShippingRoundedIcon fontSize="small" />,
  payments: <PaymentsRoundedIcon fontSize="small" />,
  customers: <PeopleAltRoundedIcon fontSize="small" />,
  sales: <RouteRoundedIcon fontSize="small" />,
  quotes: <RequestQuoteRoundedIcon fontSize="small" />,
  credit: <AccountBalanceWalletRoundedIcon fontSize="small" />,
  insights: <InsightsRoundedIcon fontSize="small" />,
  copilot: <AssistantRoundedIcon fontSize="small" />,
  operations: <HealthAndSafetyRoundedIcon fontSize="small" />,
  integrations: <HubRoundedIcon fontSize="small" />,
}

/** Un estado que el servidor no mandó se lee como no incluido: nunca como encendido. */
function stateOf(entitlement: AiEntitlement | undefined, feature: AiFeature): AiAddonState {
  const state = entitlement?.states?.[feature]
  if (state) return state
  return entitlement?.features?.[feature] === true ? 'on' : 'no_ai'
}

/**
 * Complementos IA (2026-11-23): qué IA tiene la empresa, encenderlas o
 * apagarlas, cuánto cupo queda y en qué se fue.
 *
 * El interruptor es de la EMPRESA (propietario o administración) y lo respeta
 * la base al gastar (`ebim.ai_consume_for`): apagar aquí apaga de verdad, no
 * solo esconde un botón. Lo que no está incluido en el plan o depende de un
 * módulo sin contratar se ve, pero sin interruptor: eso lo cambia EBIM.
 */
export function AiAddonsPage() {
  const { t } = useI18n()
  const { role } = useTenant()
  const saldo = useAiEntitlement(Boolean(role))
  const puedeCambiar = role === 'owner' || role === 'admin'

  const encendidas = AI_FEATURE_IDS.filter((f) => stateOf(saldo.data, f) === 'on').length

  const items = useMemo(
    () => [
      {
        id: 'complementos',
        label: `${t('aiAddons.tab.addons')} · ${encendidas}/${AI_FEATURE_IDS.length}`,
        content: <AddonsTab entitlement={saldo.data} loading={saldo.isPending} canChange={puedeCambiar} />,
      },
      { id: 'saldo', label: t('aiAddons.tab.balance'), content: <BalanceTab entitlement={saldo.data} loading={saldo.isPending} /> },
      { id: 'consumo', label: t('aiAddons.tab.usage'), content: <UsageTab enabled={puedeCambiar} /> },
      { id: 'historial', label: t('aiAddons.tab.history'), content: <HistoryTab enabled={puedeCambiar} /> },
    ],
    [t, saldo.data, saldo.isPending, puedeCambiar, encendidas],
  )

  return (
    <SectionTabs
      items={items}
      ariaLabel={t('aiAddons.title')}
      header={(tabs) => (
        <PageHeader
          icon={<AutoAwesomeRoundedIcon />}
          title={t('aiAddons.title')}
          subtitle={t('aiAddons.subtitle')}
          center={tabs}
        />
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Complementos
// ---------------------------------------------------------------------------

function AddonsTab({
  entitlement,
  loading,
  canChange,
}: {
  entitlement: AiEntitlement | undefined
  loading: boolean
  canChange: boolean
}) {
  const { t } = useI18n()
  if (loading) return <LoadingState />

  return (
    <Stack spacing={3}>
      <Alert
        severity="info"
        icon={<InfoOutlinedIcon fontSize="small" />}
        action={
          <Button size="small" variant="outlined" href="#saldo" startIcon={<AccountBalanceWalletRoundedIcon fontSize="small" />}>
            {t('aiAddons.banner.cta')}
          </Button>
        }
        sx={{ alignItems: 'center' }}
      >
        {t('aiAddons.banner')}
      </Alert>
      {!canChange && <Alert severity="warning">{t('aiAddons.readOnly')}</Alert>}

      {AI_ADDON_GROUPS.map((group) => (
        <Box key={group.id} component="section" aria-labelledby={`ai-addons-${group.id}`}>
          <Typography
            id={`ai-addons-${group.id}`}
            component="h2"
            sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)', mb: 1.25 }}
          >
            {t(`aiAddons.group.${group.id}` as MessageKey)}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
              alignItems: 'start',
            }}
          >
            {group.features.map((feature) => (
              <AddonCard key={feature} feature={feature} state={stateOf(entitlement, feature)} canChange={canChange} />
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  )
}

function AddonCard({ feature, state, canChange }: { feature: AiFeature; state: AiAddonState; canChange: boolean }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const cambiar = useSetAiFeature()
  const nombre = t(`aiAddons.f.${feature}.name` as MessageKey)
  const disponible = state === 'on' || state === 'off'

  const estado: { tone: 'success' | 'default' | 'warning'; label: string } =
    state === 'on'
      ? { tone: 'success', label: t('aiAddons.state.on') }
      : state === 'off'
        ? { tone: 'default', label: t('aiAddons.state.off') }
        : state === 'no_module'
          ? { tone: 'warning', label: t('aiAddons.state.no_module') }
          : { tone: 'warning', label: t('aiAddons.state.no_ai') }

  function alternar(next: boolean) {
    cambiar.mutate(
      { feature, enabled: next },
      {
        onSuccess: () => notify(t(next ? 'aiAddons.toast.on' : 'aiAddons.toast.off').replace('{name}', nombre)),
        onError: () => notify(t('aiAddons.toast.error'), 'error'),
      },
    )
  }

  return (
    <Card
      variant="outlined"
      data-ai-addon={feature}
      sx={{
        borderRadius: 3,
        borderTop: '3px solid',
        borderTopColor: state === 'on' ? 'var(--accent)' : 'var(--border)',
        opacity: disponible ? 1 : 0.85,
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
          <AppIcon tone={state === 'on' ? 'accent' : 'neutral'}>{ICONS[feature]}</AppIcon>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" sx={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.3 }}>
              {nombre}
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <StatusChip tone={estado.tone} label={estado.label} />
            </Box>
          </Box>
          {disponible && (
            <Switch
              checked={state === 'on'}
              disabled={!canChange || cambiar.isPending}
              onChange={(_e, next) => alternar(next)}
              inputProps={{ 'aria-label': t('aiAddons.toggle').replace('{name}', nombre) }}
            />
          )}
        </Stack>

        <Typography sx={{ fontSize: 13, color: 'var(--text-2, var(--muted))', mt: 1.25, lineHeight: 1.5 }}>
          {t(`aiAddons.f.${feature}.desc` as MessageKey)}
        </Typography>

        <Box sx={{ borderTop: '1px dashed var(--border)', mt: 1.5, pt: 1.25 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mb: 1 }}>
            <StorageRoundedIcon sx={{ fontSize: 16, color: 'var(--muted)', mt: '2px' }} aria-hidden />
            <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {/* `visuallyHidden` y no `width: 1`: en `sx`, un número ≤ 1 es un
                  PORCENTAJE (100 %), y este span absoluto ensanchaba la página
                  entera con una barra horizontal (2026-11-24). */}
              <Box component="span" sx={visuallyHidden}>
                {t('aiAddons.data')}:{' '}
              </Box>
              {t(`aiAddons.f.${feature}.data` as MessageKey)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <GroupsRoundedIcon sx={{ fontSize: 16, color: 'var(--muted)', mt: '4px' }} aria-label={t('aiAddons.roles')} />
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {AI_FEATURE_ROLES[feature].map((r) => (
                <Chip key={r} size="small" variant="outlined" label={roleLabel(t, r)} sx={{ height: 22, fontSize: 11.5 }} />
              ))}
            </Stack>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------------

function BalanceTab({ entitlement, loading }: { entitlement: AiEntitlement | undefined; loading: boolean }) {
  const { t, locale } = useI18n()
  if (loading) return <LoadingState />
  if (!entitlement?.enabled || entitlement.quota === undefined) {
    return (
      <Card>
        <EmptyState title={t('aiAddons.balance.notEnabled')} icon={<AutoAwesomeRoundedIcon fontSize="small" />} />
      </Card>
    )
  }
  const fmt = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE')
  const used = entitlement.used ?? 0
  const quota = entitlement.quota
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 100
  // El periodo de la prueba es `trial`; el del plan, el mes (`YYYYMM`).
  const trial = entitlement.period === 'trial'

  return (
    <Stack spacing={2} sx={{ maxWidth: 760, mx: 'auto' }}>
      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
            <Typography component="h2" sx={{ fontWeight: 800, fontSize: 15 }}>
              {t('aiAddons.balance.title')}
            </Typography>
            <StatusChip tone={trial ? 'info' : 'success'} label={t(trial ? 'aiAddons.balance.plan.trial' : 'aiAddons.balance.plan.active')} />
          </Stack>
          <Typography className="tnum" sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>
            {fmt.format(entitlement.remaining ?? Math.max(quota - used, 0))}
          </Typography>
          <Typography sx={{ color: 'var(--muted)', fontSize: 13, mb: 1.5 }}>{t('aiAddons.balance.remainingLabel')}</Typography>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={pct >= 100 ? 'error' : pct >= 80 ? 'warning' : 'primary'}
            aria-label={t('aiAddons.balance.used').replace('{used}', fmt.format(used)).replace('{quota}', fmt.format(quota))}
            sx={{ height: 8, borderRadius: 99 }}
          />
          <Typography className="tnum" sx={{ fontSize: 12.5, color: 'var(--muted)', mt: 0.75 }}>
            {t('aiAddons.balance.used').replace('{used}', fmt.format(used)).replace('{quota}', fmt.format(quota))} · {pct} %
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', mt: 1 }}>
            {t(trial ? 'aiAddons.balance.trialNote' : 'aiAddons.balance.renews')}
          </Typography>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <Typography component="h2" sx={{ fontWeight: 800, fontSize: 14, mb: 0.5 }}>
            {t('aiAddons.balance.topup.title')}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{t('aiAddons.balance.topup.body')}</Typography>
        </CardContent>
      </Card>
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Consumo
// ---------------------------------------------------------------------------

function UsageTab({ enabled }: { enabled: boolean }) {
  const { t, locale } = useI18n()
  const usage = useAiUsageThisMonth(enabled)
  if (!enabled) return <Alert severity="info">{t('aiAddons.readOnly')}</Alert>
  if (usage.isPending) return <LoadingState />
  if (usage.isError) return <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
  const filas: AiUsageRow[] = usage.data ?? []
  const total = filas.reduce((s, f) => s + f.calls, 0)
  const fmt = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE')

  return (
    <Card>
      <CardContent>
        <Typography component="h2" sx={{ fontWeight: 800, fontSize: 15 }}>
          {t('aiAddons.usage.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)', fontSize: 12.5, mb: 2 }}>{t('aiAddons.usage.help')}</Typography>
        {filas.length === 0 ? (
          <EmptyState title={t('aiAddons.usage.empty')} />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('aiAddons.usage.col.addon')}</TableCell>
                  <TableCell align="right">{t('aiAddons.usage.col.calls')}</TableCell>
                  <TableCell sx={{ minWidth: 140 }}>{t('aiAddons.usage.col.share')}</TableCell>
                  <TableCell align="right">{t('aiAddons.usage.col.tokens')}</TableCell>
                  <TableCell>{t('aiAddons.usage.col.last')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filas.map((fila) => {
                  const pct = total > 0 ? Math.round((fila.calls / total) * 100) : 0
                  const conocida = (AI_FEATURE_IDS as readonly string[]).includes(fila.feature)
                  return (
                    <TableRow key={fila.feature} hover>
                      <TableCell sx={{ fontWeight: 700 }}>
                        {conocida ? t(`aiAddons.f.${fila.feature}.name` as MessageKey) : fila.feature}
                      </TableCell>
                      <TableCell align="right" className="tnum">{fmt.format(fila.calls)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 6, borderRadius: 99 }} aria-hidden />
                          <Typography className="tnum" sx={{ fontSize: 12, minWidth: 34, textAlign: 'right' }}>{pct} %</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell align="right" className="tnum" sx={{ fontSize: 12 }}>
                        {fmt.format(fila.input_tokens)} / {fmt.format(fila.output_tokens)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fila.last_at ? new Date(fila.last_at).toLocaleString(locale === 'en' ? 'en-US' : 'es-PE') : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

function HistoryTab({ enabled }: { enabled: boolean }) {
  const { t, locale } = useI18n()
  const history = useAiAddonHistory(enabled)
  if (!enabled) return <Alert severity="info">{t('aiAddons.readOnly')}</Alert>
  if (history.isPending) return <LoadingState />
  if (history.isError) return <ErrorState error={history.error} onRetry={() => void history.refetch()} />
  const filas = history.data ?? []

  return (
    <Card>
      <CardContent>
        <Typography component="h2" sx={{ fontWeight: 800, fontSize: 15 }}>
          {t('aiAddons.history.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)', fontSize: 12.5, mb: 2 }}>{t('aiAddons.history.help')}</Typography>
        {filas.length === 0 ? (
          <EmptyState title={t('aiAddons.history.empty')} />
        ) : (
          <Stack component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {filas.map((fila, i) => {
              const on = fila.action === 'ai_feature.enabled'
              const feature = fila.entity_label ?? ''
              const nombre = (AI_FEATURE_IDS as readonly string[]).includes(feature)
                ? t(`aiAddons.f.${feature}.name` as MessageKey)
                : feature
              return (
                <Stack
                  key={fila.id}
                  component="li"
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={{ xs: 0.25, sm: 1.5 }}
                  sx={{ py: 1.25, borderBottom: i === filas.length - 1 ? 'none' : '1px solid var(--border)', alignItems: { sm: 'center' } }}
                >
                  <Typography sx={{ fontSize: 12, color: 'var(--muted)', minWidth: 150, whiteSpace: 'nowrap' }}>
                    {new Date(fila.occurred_at).toLocaleString(locale === 'en' ? 'en-US' : 'es-PE')}
                  </Typography>
                  <StatusChip tone={on ? 'success' : 'default'} label={t(on ? 'aiAddons.history.on' : 'aiAddons.history.off')} />
                  <Typography sx={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{nombre}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{fila.actor_email ?? '—'}</Typography>
                </Stack>
              )
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
