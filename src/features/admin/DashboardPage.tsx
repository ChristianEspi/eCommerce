import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Box, Button, Card, Stack } from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTenant } from '@/features/tenant/tenant-context'
import { WatchDrawer } from '@/features/watch/WatchDrawer'
import { WatchSection } from '@/features/watch/WatchSection'
import { useWatch } from '@/features/watch/useWatch'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { OrderFlow } from './dashboard/OrderFlow'
import { RecentOrders } from './dashboard/RecentOrders'
import { SalesHero } from './dashboard/SalesHero'
import { StoreHealth } from './dashboard/StoreHealth'
import { TopProducts } from './dashboard/TopProducts'
import { useDashboardKpis, useRecentOrders, type DashboardKpis } from './useDashboardKpis'
import { DEFAULT_SALES_PERIOD, useSalesTrend, type SalesPeriod } from './useSalesTrend'

/** Dos columnas en escritorio: la ancha para leer, la estrecha para actuar. */
const ROW_SX = {
  display: 'grid',
  gap: 2.5,
  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(340px, 1fr)' },
  alignItems: 'stretch',
} as const

/**
 * Resumen del backoffice (v2).
 *
 * Se lee en tres filas, de lo que más importa a lo que menos:
 *
 *  1. **Cómo voy** (ventas del periodo contra el anterior) y **qué hago ahora**
 *     (el centro de vigilancia, con un botón por aviso). Los avisos del banner
 *     de antes —pedidos por cobrar, catálogo sin publicar— ya los levanta la
 *     vigilancia: dos sitios diciendo lo mismo con cifras distintas es peor que
 *     uno solo.
 *  2. **Dónde se atascan los pedidos** (flujo) y la salud de la tienda.
 *  3. **Qué pasó** (últimos pedidos) y qué es lo que más vende.
 *
 * Todas las cifras son reales: `dashboard_kpis` (estado acumulado),
 * `dashboard_sales_trend` (el periodo) y `watch_findings`, las tres bajo la
 * RLS de quien mira. Lo que la base no puede afirmar se muestra como guion:
 * un cero inventado en un panel se lee como un dato.
 */
export function DashboardPage() {
  const { t } = useI18n()
  const { activeStore, tenant } = useTenant()
  const storeId = activeStore?.id ?? null
  const [period, setPeriod] = useState<SalesPeriod>(DEFAULT_SALES_PERIOD)
  const [watchOpen, setWatchOpen] = useState(false)
  const { data, isPending, isError, error, refetch } = useDashboardKpis(storeId)
  const trend = useSalesTrend(storeId, period)
  const recentOrders = useRecentOrders(storeId)
  // Misma consulta (y misma caché) que el carril: decide si la fila tiene dos
  // columnas y alimenta los «atascados» del flujo sin otra lectura.
  const watch = useWatch()
  const findings = watch.data?.items ?? []

  const subtitle = [tenant?.name, activeStore?.name].filter(Boolean).join(' · ')
  // 2026-11-20 · «Ver la tienda» vive en Inicio (antes en Configuración): es lo
  // primero que se ve al entrar y desde donde se quiere echar un vistazo.
  const storeUrl = activeStore ? `/s/${activeStore.slug}` : null
  const header = (
    <PageHeader
      icon={<SpaceDashboardRoundedIcon />}
      title={t('admin.dashboard.title')}
      subtitle={subtitle || tenant?.name}
      actions={
        storeUrl && (
          <Button
            component="a"
            href={storeUrl}
            target="_blank"
            rel="noreferrer"
            variant="outlined"
            endIcon={<LaunchRoundedIcon fontSize="small" />}
          >
            {t('settings.viewStore')}
          </Button>
        )
      }
    />
  )

  if (!storeId) {
    return (
      <>
        {header}
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
        {header}
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      </>
    )
  }

  const kpis: DashboardKpis = data
  const isFresh = kpis.products === 0 && kpis.orders === 0

  return (
    <>
      {header}
      <Stack spacing={2.5}>
        <Box sx={findings.length > 0 ? ROW_SX : undefined}>
          <SalesHero
            kpis={kpis}
            trend={trend.data}
            trendFailed={trend.isError}
            period={period}
            onPeriodChange={setPeriod}
          />
          {/* Se calla sola cuando no hay avisos; entonces la venta ocupa la fila. */}
          <WatchSection onSeeMore={() => setWatchOpen(true)} />
        </Box>

        {isFresh ? (
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
        ) : (
          <>
            <Box sx={ROW_SX}>
              <OrderFlow kpis={kpis} findings={findings} />
              <StoreHealth kpis={kpis} />
            </Box>
            <Box sx={ROW_SX}>
              <RecentOrders orders={recentOrders.data ?? []} />
              <TopProducts kpis={kpis} />
            </Box>
          </>
        )}
      </Stack>

      <WatchDrawer open={watchOpen} onClose={() => setWatchOpen(false)} />
    </>
  )
}
