import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import LocalMallRoundedIcon from '@mui/icons-material/LocalMallRounded'
import PaidRoundedIcon from '@mui/icons-material/PaidRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Box, Card, CardContent, Grid, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Button } from '@mui/material'
import { STATUS_COLOR, type StatusColor } from '@/features/orders/status'
import { ORDER_STATUSES, type OrderStatus } from '@/features/orders/types'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { C, SH, T } from '@/theme/tokens'
import { BarList, type BarRow } from './BarList'
import { AiAnalystPanel } from './dashboard/AiAnalystPanel'
import { InsightBanner, type Insight } from './dashboard/InsightBanner'
import { RecentOrders } from './dashboard/RecentOrders'
import { SectionHeader } from './dashboard/SectionHeader'
import { Meter } from './Meter'
import { useDashboardKpis, useRecentOrders, type DashboardKpis } from './useDashboardKpis'

type KpiTone = 'accent' | 'info' | 'warning'

const KPI_TONE: Record<KpiTone, { fg: string; soft: string }> = {
  accent: { fg: C.accentDeep, soft: C.accentSoft },
  info: { fg: C.blue, soft: C.blueSoft },
  warning: { fg: C.amber, soft: C.amberSoft },
}

/**
 * Tarjeta de cifra del resumen.
 *
 * Una sola forma para las cuatro. La protagonista (`emphasis`) se distingue por
 * el degradado de marca y el cuerpo de la cifra, NO por ocupar media pantalla:
 * con cuatro columnas iguales la fila se lee como una fila y la jerarquia sigue
 * donde tiene que estar. Las demas llevan franja e icono del tono de lo que
 * miden, y un detalle (`extra`) que responde la pregunta siguiente: de cuantos
 * pedidos, en que estado; cuanto catalogo esta vivo.
 *
 * El icono es DECORATIVO (`aria-hidden`): la etiqueta ya nombra la cifra, y
 * anunciarlo seria ruido repetido.
 *
 * El enlace va anclado abajo (`mt: 'auto'`): asi las tarjetas que lo llevan lo
 * tienen a la misma altura.
 */
function KpiTile({
  label,
  value,
  hint,
  icon,
  to,
  actionLabel,
  emphasis = false,
  tone = 'accent',
  extra,
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  /** Adonde lleva la cifra: una cifra sin salida obliga a buscarla en el menu. */
  to?: string
  actionLabel?: string
  /**
   * La protagonista: degradado de marca (`--hero-grad`, conmuta con la paleta
   * del tenant) y texto blanco. El resto, superficie de tarjeta con franja.
   */
  emphasis?: boolean
  tone?: KpiTone
  /** Detalle bajo la cifra (barra de estados, progreso…). Todo de la base. */
  extra?: ReactNode
}) {
  const colors = KPI_TONE[tone]
  const ink = emphasis ? C.white : C.ink
  const soft = emphasis ? `color-mix(in srgb, ${C.white} 82%, transparent)` : C.muted
  return (
    <Card
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        borderRadius: 3,
        transition: 'box-shadow 160ms ease, transform 160ms ease',
        '&:hover': { boxShadow: SH.lg, transform: 'translateY(-1px)' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
        ...(emphasis
          ? {
              background: C.heroGrad,
              border: 'none',
              color: C.white,
              // Detalle decorativo: dos círculos translúcidos en la esquina.
              '&::after': {
                content: '""',
                position: 'absolute',
                right: -40,
                top: -40,
                width: 150,
                height: 150,
                borderRadius: '50%',
                background: `color-mix(in srgb, ${C.white} 8%, transparent)`,
                boxShadow: `0 0 0 22px color-mix(in srgb, ${C.white} 5%, transparent)`,
                pointerEvents: 'none',
              },
            }
          : {
              '&::before': {
                content: '""',
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                bgcolor: colors.fg,
                opacity: 0.85,
              },
            }),
      }}
    >
      <CardContent
        sx={{
          // `CardContent` reserva 24 px de fondo para el ultimo hijo: en una
          // tarjeta de una cifra eso es una franja vacia bajo el numero.
          position: 'relative',
          zIndex: 1,
          p: 2.25,
          pl: emphasis ? 2.25 : 2.5,
          '&:last-child': { pb: 2 },
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              bgcolor: emphasis ? `color-mix(in srgb, ${C.white} 18%, transparent)` : colors.soft,
              color: emphasis ? C.white : colors.fg,
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          >
            {icon}
          </Box>
          <Typography
            sx={{
              fontSize: T.label,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: soft,
              lineHeight: 1.3,
            }}
          >
            {label}
          </Typography>
        </Stack>
        <Typography
          className="tnum"
          sx={{
            fontSize: emphasis ? T.kpiBig + 4 : T.kpiBig,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: ink,
            // Una cifra partida en dos lineas dentro de una tarjeta estrecha se
            // lee como dos numeros.
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </Typography>
        {hint && <Typography sx={{ fontSize: 12, color: soft, lineHeight: 1.4 }}>{hint}</Typography>}
        {extra}
        {to && actionLabel && (
          <Button
            component={RouterLink}
            to={to}
            size="small"
            endIcon={<ArrowForwardRoundedIcon />}
            sx={{ mt: 'auto', ml: -1, alignSelf: 'flex-start', ...(emphasis ? { color: C.white } : {}) }}
          >
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

const STATUS_VAR: Record<StatusColor, string> = {
  default: C.muted,
  info: C.blue,
  success: C.accent,
  warning: C.amber,
  error: C.red,
}

const isOrderStatus = (v: string): v is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(v)

/**
 * Barra segmentada de pedidos por estado, con los colores del listado de
 * Pedidos, y su leyenda. El color acompaña: la leyenda dice qué es cada tramo.
 */
function StatusStrip({ rows, total }: { rows: DashboardKpis['by_status']; total: number }) {
  const { t } = useI18n()
  const visibles = rows.filter((r) => r.count > 0 && isOrderStatus(r.status))
  if (total <= 0 || visibles.length === 0) return null
  return (
    <Stack spacing={0.75}>
      <Box
        role="img"
        aria-label={visibles.map((r) => `${t(`orders.status.${r.status}` as MessageKey)}: ${r.count}`).join(', ')}
        sx={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', bgcolor: C.neutralSoft, gap: '2px' }}
      >
        {visibles.map((r) => (
          <Box
            key={r.status}
            sx={{ flexGrow: r.count, flexBasis: 0, bgcolor: STATUS_VAR[STATUS_COLOR[r.status as OrderStatus]] }}
          />
        ))}
      </Box>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 1.25, rowGap: 0.25 }}>
        {visibles.map((r) => (
          <Stack key={r.status} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box
              aria-hidden
              sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_VAR[STATUS_COLOR[r.status as OrderStatus]] }}
            />
            <Typography sx={{ fontSize: 11.5, color: C.muted }}>
              <Box component="span" className="tnum" sx={{ fontWeight: 800, color: C.ink }}>
                {r.count}
              </Box>{' '}
              {t(`orders.status.${r.status}` as MessageKey)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

/** Progreso fino (publicados / total). */
function ProgressLine({ value, total, caption }: { value: number; total: number; caption: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <Stack spacing={0.5}>
      <Box
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={caption}
        sx={{ height: 8, borderRadius: 999, bgcolor: C.neutralSoft, overflow: 'hidden' }}
      >
        <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 999, bgcolor: C.blue }} />
      </Box>
      <Typography sx={{ fontSize: 11.5, color: C.muted }}>
        <Box component="span" className="tnum" sx={{ fontWeight: 800, color: C.ink }}>
          {pct} %
        </Box>{' '}
        · {caption}
      </Typography>
    </Stack>
  )
}

/** Panel con titulo, para que cada desglose diga que responde. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography component="h2" sx={{ fontSize: T.cardTitle, fontWeight: 800, mb: 2 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * Resumen del backoffice.
 *
 * Cuatro cifras y todas reales: salen de `dashboard_kpis`, que cuenta bajo la
 * RLS del usuario. Lo que la base no puede afirmar —ventas cuando la tienda
 * mezcla monedas o cuando todavía no hay pedidos— se muestra como guion. Un
 * cero inventado en un panel se lee como un dato.
 */
export function DashboardPage() {
  const { t, locale } = useI18n()
  const { activeStore, tenant } = useTenant()
  const storeId = activeStore?.id ?? null
  const { data, isPending, isError, error, refetch } = useDashboardKpis(storeId)
  const recentOrders = useRecentOrders(storeId)

  const subtitle = [tenant?.name, activeStore?.name].filter(Boolean).join(' · ')

  if (!storeId) {
    return (
      <>
        <PageHeader icon={<SpaceDashboardRoundedIcon />} title={t('admin.dashboard.title')} subtitle={tenant?.name} />
        <Card>
          <EmptyState
            title={t('admin.store.none')}
            description={t('admin.store.noneBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        </Card>
      </>
    )
  }

  if (isPending) return <LoadingState />
  if (isError) {
    return (
      <>
        <PageHeader icon={<SpaceDashboardRoundedIcon />} title={t('admin.dashboard.title')} subtitle={subtitle} />
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      </>
    )
  }

  const kpis: DashboardKpis = data
  const money = (raw: string | null) =>
    raw !== null && kpis.currency ? formatMoney(Number(raw), kpis.currency, locale) : '—'

  type Tile = {
    key: string
    label: MessageKey
    value: string
    hint?: string
    icon: ReactNode
    /** Adonde lleva la cifra. Una cifra sin salida obliga a buscarla en el menu. */
    to?: string
    actionLabel?: MessageKey
    tone?: KpiTone
    extra?: ReactNode
  }

  const hero: Tile = {
    key: 'sales',
    label: 'admin.kpi.sales',
    value: money(kpis.sales),
    icon: <PaidRoundedIcon fontSize="small" />,
    ...(kpis.sales === null ? { hint: t('admin.kpi.sales.none') } : {}),
  }

  const cards: Tile[] = [
    {
      key: 'avgTicket',
      label: 'admin.kpi.avgTicket',
      value: money(kpis.avg_ticket),
      icon: <TrendingUpRoundedIcon fontSize="small" />,
      hint: t('admin.kpi.avgTicket.hint'),
      tone: 'accent',
    },
    {
      key: 'orders',
      label: 'admin.kpi.orders',
      value: String(kpis.orders),
      icon: <ReceiptLongRoundedIcon fontSize="small" />,
      to: '/app/orders',
      actionLabel: 'admin.dashboard.seeOrders',
      tone: 'warning',
      extra: <StatusStrip rows={kpis.by_status} total={kpis.orders} />,
    },
    {
      key: 'products',
      label: 'admin.kpi.products',
      value: String(kpis.products),
      icon: <LocalMallRoundedIcon fontSize="small" />,
      to: '/app/products',
      actionLabel: 'admin.dashboard.seeProducts',
      tone: 'info',
      // Publicados deja de ser una tarjeta propia: como cifra suelta no dice
      // nada, y junto a total responde «cuanto catalogo esta vivo».
      extra: (
        <ProgressLine
          value={kpis.published}
          total={kpis.products}
          caption={`${kpis.published} ${t('admin.kpi.publishedTotal')}`}
        />
      ),
    },
  ]

  // Se deriva del desglose, no de otra consulta: dos fuentes para la misma
  // cifra acaban siempre discrepando.
  const paidOrders = kpis.by_status.find((row) => row.status === 'paid')?.count ?? 0

  const statusRows: BarRow[] = kpis.by_status.map((row) => ({
    id: row.status,
    label: t(`orders.status.${row.status}` as MessageKey),
    value: row.count,
    display: String(row.count),
  }))

  const productRows: BarRow[] = kpis.top_products.map((row) => ({
    id: row.sku,
    label: row.name,
    value: Number(row.revenue),
    display: kpis.currency
      ? formatMoney(Number(row.revenue), kpis.currency, locale)
      : String(row.units),
  }))

  const isFresh = kpis.products === 0 && kpis.orders === 0

  const pending = kpis.by_status.find((row) => row.status === 'pending')?.count ?? 0
  const unpublished = Math.max(kpis.products - kpis.published, 0)

  // Los avisos se CALCULAN de lo que ya hay; no hay una tabla de avisos que
  // alguien tenga que mantener al dia. Y solo aparecen cuando hay algo que
  // decir: un banner permanente de «todo va bien» ensena a ignorar esa zona.
  const insights: Insight[] = []
  if (pending > 0) {
    insights.push({
      id: 'pending',
      tone: 'warning',
      icon: <PendingActionsRoundedIcon />,
      title: t('admin.dashboard.insight.pending'),
      body: `${pending} ${t('admin.dashboard.insight.pending.body')}`,
      action: { label: t('admin.dashboard.review'), to: '/app/orders' },
    })
  }
  if (unpublished > 0) {
    insights.push({
      id: 'unpublished',
      tone: 'info',
      icon: <VisibilityOffRoundedIcon />,
      title: t('admin.dashboard.insight.unpublished'),
      body: `${unpublished} ${t('admin.dashboard.insight.unpublished.body')}`,
      action: { label: t('admin.dashboard.review'), to: '/app/products' },
    })
  }

  return (
    <>
      <PageHeader icon={<SpaceDashboardRoundedIcon />} title={t('admin.dashboard.title')} subtitle={subtitle} />
      <Stack spacing={2.5}>
        <InsightBanner insights={insights} />

        {/* Analista IA (fase 02): COMPLEMENTA los avisos y KPIs deterministas,
            no los sustituye. Se oculta solo para roles sin la funcionalidad
            `insights`; en una tienda recien creada no hay nada que analizar. */}
        {!isFresh && <AiAnalystPanel storeId={storeId} />}

        <SectionHeader icon={<QueryStatsRoundedIcon fontSize="small" />} title={t('admin.dashboard.section.sales')} />
        {/* Cuatro columnas iguales: la cifra protagonista manda por el borde y
            el cuerpo, no por el ancho. */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <KpiTile
              emphasis
              label={t(hero.label)}
              value={hero.value}
              icon={hero.icon}
              {...(hero.hint ? { hint: hero.hint } : {})}
            />
          </Grid>
          {cards.map((card) => (
            <Grid item xs={12} sm={6} md={3} key={card.key}>
              <KpiTile
                label={t(card.label)}
                value={card.value}
                icon={card.icon}
                {...(card.hint ? { hint: card.hint } : {})}
                {...(card.to ? { to: card.to, actionLabel: t(card.actionLabel as MessageKey) } : {})}
                {...(card.tone ? { tone: card.tone } : {})}
                {...(card.extra ? { extra: card.extra } : {})}
              />
            </Grid>
          ))}
        </Grid>

        {!isFresh && (
          <>
            <SectionHeader
              icon={<InsightsRoundedIcon fontSize="small" />}
              title={t('admin.dashboard.section.breakdown')}
            />
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Panel title={t('admin.dashboard.byStatus')}>
                  <BarList rows={statusRows} emptyLabel={t('admin.dashboard.noOrders')} />
                </Panel>
              </Grid>
              <Grid item xs={12} md={4}>
                <Panel title={t('admin.dashboard.topProducts')}>
                  <BarList rows={productRows} emptyLabel={t('admin.dashboard.noSales')} />
                </Panel>
              </Grid>
              <Grid item xs={12} md={4}>
                <Panel title={t('admin.dashboard.health')}>
                  <Stack sx={{ gap: 2.5 }}>
                    <Meter
                      label={t('admin.dashboard.meter.published')}
                      value={kpis.published}
                      total={kpis.products}
                      caption={`${kpis.published} / ${kpis.products}`}
                    />
                    <Meter
                      label={t('admin.dashboard.meter.paid')}
                      value={paidOrders}
                      total={kpis.orders}
                      caption={`${paidOrders} / ${kpis.orders}`}
                    />
                  </Stack>
                </Panel>
              </Grid>
            </Grid>

            <SectionHeader
              icon={<HistoryRoundedIcon fontSize="small" />}
              title={t('admin.dashboard.section.activity')}
            />
            <RecentOrders orders={recentOrders.data ?? []} />
          </>
        )}

        {isFresh && (
          <Card>
            <EmptyState
              title={t('admin.dashboard.fresh.title')}
              description={t('admin.dashboard.fresh.body')}
              icon={<Inventory2RoundedIcon fontSize="small" />}
              action={
                <Button component={RouterLink} to="/app/products" variant="contained">
                  {t('admin.dashboard.fresh.cta')}
                </Button>
              }
            />
          </Card>
        )}
      </Stack>
    </>
  )
}
