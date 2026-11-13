import {
  Box,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LocalMallRoundedIcon from '@mui/icons-material/LocalMallRounded'
import PaidRoundedIcon from '@mui/icons-material/PaidRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import RemoveShoppingCartRoundedIcon from '@mui/icons-material/RemoveShoppingCartRounded'
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import { useI18n } from '@/shared/i18n/i18n-context'
import { downloadWorkbook } from '@/shared/lib/excel'
import { useFeedback } from '@/shared/ui/feedback-context'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { FilterBar } from '@/shared/ui/FilterBar'
import { MetricCard } from '@/shared/ui/MetricCard'
import { MiniBar } from '@/shared/ui/MiniBar'
import { SecondaryButton } from '@/shared/ui/buttons'
import { SectionCard } from '@/shared/ui/SectionCard'
import { StatusChip } from '@/shared/ui/StatusChip'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { T } from '@/theme/tokens'
import { analyticsBook } from './exportExcel'
import { TrendChart, type TrendPoint } from './TrendChart'
import {
  useAnalyticsWindow,
  useAnalyticsKpis,
  useChannelPerformance,
  useTimeseries,
  useTopProducts,
} from './hooks'
import { ANALYTICS_RANGES, type AnalyticsRange } from './types'

/**
 * Resumen comercial: lo que sale de los PEDIDOS.
 *
 * Todo lo de esta pestaña es baseline (`analytics.basic`) porque todo sale de
 * `orders`, `order_items`, `checkout_intents` y `carts`, que existen en
 * cualquier tenant. El comportamiento del comprador —lo que hay que instrumentar
 * en la vitrina— vive en la otra pestaña y sí se vende.
 *
 * ## El guion
 *
 * Un `null` se pinta como «—» y NUNCA como 0. La base devuelve `null` cuando el
 * denominador es cero, y traducirlo a 0 % convertiría «todavía no hay con qué
 * calcularlo» en «tu tienda no convierte». Es la misma decisión que el guion de
 * moneda mezclada que `dashboard_kpis` lleva desde P03.
 *
 * ## El orden de la pantalla
 *
 * Rango y exportación arriba, en la barra de la tarjeta que usa el resto del
 * backoffice: son los mandos, no contenido. Luego la fila de cifras —la foto—,
 * luego la serie —cómo se llegó a esa foto— y por último los dos desgloses
 * —quién la compone—. De lo general a lo particular, y cada bloque en su
 * tarjeta con cabecera para que la pantalla se pueda recorrer saltando de
 * rótulo en rótulo.
 */

function dash(value: string | null | undefined): string {
  return value ?? '—'
}

/**
 * `YYYY-MM-DD` a fecha LOCAL.
 *
 * `new Date('2026-08-27')` es medianoche UTC, y al formatearla en Lima (UTC-5)
 * sale el 26. La serie diaria se etiquetaría un día por debajo entera, que es
 * el tipo de error que nadie nota hasta que lo cruza con el ERP.
 */
function localDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1)
}

export function OverviewSection({
  storeId,
  days,
  onDaysChange,
}: {
  storeId: string | null
  days: AnalyticsRange
  onDaysChange: (next: AnalyticsRange) => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const window = useAnalyticsWindow(storeId, days)
  const kpis = useAnalyticsKpis(window)
  const top = useTopProducts(window)
  const channels = useChannelPerformance(window)
  const series = useTimeseries(window)

  function money(value: string | null, currency: string | null): string {
    if (value === null || currency === null) return '—'
    return formatMoney(Number(value), currency, locale)
  }

  /**
   * La exportación es la SERIE DIARIA, no la foto.
   *
   * Un libro con cuatro totales no se puede cruzar con nada; uno con una fila
   * por día se pega en una hoja de cálculo al lado de las cifras del ERP. Por
   * eso `analytics_timeseries` devuelve filas y no un jsonb: la exportación es
   * la misma consulta que pinta el listado, sin una segunda ruta que se
   * desincronice. Excel desde 2026-11-13: día como fecha e importe como número.
   */
  function exportExcel(): void {
    void downloadWorkbook(analyticsBook(series.data ?? [], days, t), t).catch(() =>
      notify(t('excel.error.download'), 'error'),
    )
  }

  if (kpis.isError) return <ErrorState error={kpis.error} onRetry={() => void kpis.refetch()} />
  if (kpis.isPending) return <TableSkeleton columns={4} />

  const data = kpis.data

  const rows = series.data ?? []
  // Una curva solo se puede dibujar si todos sus puntos están en la misma
  // unidad. Si el periodo mezcla monedas no hay serie que pintar: se dice, en
  // vez de sumar soles con dólares y dar una línea que no significa nada.
  //
  // Un día sin cobros llega con la moneda en `null` —no hay nada que denominar—
  // y no cuenta como una segunda moneda: si contara, cualquier tienda con un
  // domingo cerrado se quedaría sin gráfico.
  const currencies = new Set(
    rows.map((row) => row.currency).filter((currency): currency is string => currency !== null),
  )
  const trendCurrency = currencies.size === 1 ? ([...currencies][0] ?? null) : null
  const mixedCurrency = currencies.size > 1
  const trend: TrendPoint[] = rows.map((row) => ({
    key: row.day,
    label: formatDate(localDay(row.day), locale),
    value: Number(row.revenue ?? 0),
    display: money(row.revenue, row.currency ?? trendCurrency),
    caption: `${row.orders} ${t('analytics.kpi.orders').toLowerCase()} · ${row.units} ${t('analytics.top.units').toLowerCase()}`,
  }))
  const hasTrend = !mixedCurrency && trend.length > 1 && trend.some((point) => point.value > 0)

  const topRows = top.data ?? []
  const topMax = Math.max(...topRows.map((row) => row.units), 0)
  const channelRows = channels.data ?? []
  const channelMax = Math.max(...channelRows.map((row) => row.orders), 0)

  const tiles = [
    {
      key: 'sales',
      label: t('analytics.kpi.sales'),
      value: money(data.paid_sales, data.currency),
      icon: <PaidRoundedIcon />,
      emphasis: true,
    },
    {
      key: 'orders',
      label: t('analytics.kpi.orders'),
      value: String(data.orders),
      icon: <ReceiptLongRoundedIcon />,
    },
    {
      key: 'ticket',
      label: t('analytics.kpi.ticket'),
      value: money(data.average_ticket, data.currency),
      icon: <LocalMallRoundedIcon />,
    },
    {
      key: 'conversion',
      label: t('analytics.kpi.conversion'),
      value: data.conversion_rate === null ? '—' : `${data.conversion_rate} %`,
      hint: t('analytics.kpi.conversionHint')
        .replace('{done}', String(data.checkouts_completed))
        .replace('{total}', String(data.checkouts_started)),
      icon: <TrendingUpRoundedIcon />,
    },
    {
      key: 'abandonment',
      label: t('analytics.kpi.abandonment'),
      value: data.abandonment_rate === null ? '—' : `${data.abandonment_rate} %`,
      hint: t('analytics.kpi.abandonmentHint')
        .replace('{abandoned}', String(data.carts_abandoned))
        .replace('{converted}', String(data.carts_converted)),
      icon: <RemoveShoppingCartRoundedIcon />,
    },
    {
      key: 'units',
      label: t('analytics.kpi.units'),
      value: String(data.units),
      icon: <Inventory2RoundedIcon />,
    },
  ]

  return (
    <Stack
      sx={{
        gap: 2.5,
        /**
         * La pantalla ocupa la ventana, y el hueco que sobre se lo queda el
         * gráfico.
         *
         * Con el resumen entero midiendo menos que un monitor alto, quedaba
         * media pantalla de fondo gris bajo la última tarjeta: nada roto, pero
         * se lee como que falta algo por cargar. Lo que se descuenta es el
         * cromo fijo que hay por encima de esta pila —barra superior, márgenes
         * del área de contenido, cabecera de pantalla y pestañas—, tirando por
         * lo ALTO: si el descuento se queda corto aparecería una barra de
         * scroll de treinta píxeles, que molesta más que el hueco que se venía
         * a quitar.
         *
         * Es un SUELO, no un alto: cuando el contenido pide más —o la ventana
         * es baja—, manda el contenido y la pantalla hace scroll como siempre.
         */
        minHeight: { lg: 'calc(100dvh - 300px)' },
      }}
    >
      {/* Los mandos, en la misma tarjeta de barra que el resto del backoffice.
          La ventana efectiva va aquí y no bajo las cifras: es lo que el rango
          acaba de decidir, y leerla tres bloques más abajo obliga a recordar
          qué se pulsó. */}
      <FilterBar
        disableGutter
        actions={
          <SecondaryButton
            size="small"
            startIcon={<FileDownloadRoundedIcon />}
            onClick={exportExcel}
            disabled={rows.length === 0}
          >
            {t('common.export')}
          </SecondaryButton>
        }
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={days}
          aria-label={t('analytics.range.label')}
          onChange={(_, next: AnalyticsRange | null) => next && onDaysChange(next)}
        >
          {ANALYTICS_RANGES.map((range) => (
            <ToggleButton key={range} value={range}>
              {t('analytics.range.days').replace('{n}', String(range))}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography sx={{ fontSize: T.body, color: 'var(--muted)' }}>
          {t('analytics.window')
            .replace('{from}', formatDate(data.from, locale))
            .replace('{to}', formatDate(data.to, locale))}
        </Typography>
      </FilterBar>

      {/* Seis cifras en rejilla y no en `flex-wrap`: envueltas se quedaban de
          anchos distintos según lo que midiera el texto, y una fila de tarjetas
          desiguales se lee como tarjetas que dicen cosas de rango distinto. */}
      <Grid container spacing={2}>
        {tiles.map((tile) => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={tile.key}>
            <MetricCard
              label={tile.label}
              value={tile.value}
              hint={tile.hint}
              icon={tile.icon}
              emphasis={tile.emphasis}
            />
          </Grid>
        ))}
      </Grid>

      <SectionCard
        icon={<ShowChartRoundedIcon />}
        title={t('analytics.trend.title')}
        subtitle={t('analytics.trend.subtitle')}
        meta={trendCurrency ?? undefined}
        padded
        fill
      >
        {series.isPending ? (
          <TableSkeleton columns={2} />
        ) : mixedCurrency ? (
          <Typography sx={{ fontSize: T.body, color: 'var(--muted)' }}>
            {t('analytics.trend.mixed')}
          </Typography>
        ) : !hasTrend ? (
          <EmptyState title={t('analytics.trend.empty')} description={t('analytics.trend.emptyBody')} />
        ) : (
          <TrendChart
            fill
            points={trend}
            labelHeader={t('analytics.csv.day')}
            valueHeader={t('analytics.csv.revenue')}
            peakLabel={t('analytics.trend.peak')}
          />
        )}
      </SectionCard>

      {/* Los dos desgloses van EN LA MISMA FILA, no uno debajo de otro.
          Apilados, cada tarjeta ocupaba el ancho entero para tres filas de
          tabla y el reparto por canal —que en una tienda con un solo canal es
          UNA fila— dejaba media pantalla de vacio debajo. Al lado se leen
          ademas como lo que son: dos cortes de la misma venta —por producto y
          por canal—, y comparar dos cortes obliga a tenerlos a la vista a la
          vez. Por debajo de `lg` no caben dos tablas de cuatro columnas, y ahi
          si se apilan. */}
      <Grid container spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Grid item xs={12} lg={7}>
          <SectionCard
            icon={<Inventory2RoundedIcon />}
            title={t('analytics.top.title')}
            meta={topRows.length > 0 ? String(topRows.length) : undefined}
          >
            {top.isPending ? (
              <TableSkeleton columns={4} />
            ) : topRows.length === 0 ? (
              <EmptyState title={t('analytics.top.empty')} description={t('analytics.top.emptyBody')} />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {/* La posición no es un dato que se lea: es el orden de la
                        tabla, y por eso su columna no lleva encabezado. */}
                    <TableCell sx={{ width: 44 }} aria-hidden />
                    <TableCell>{t('analytics.top.name')}</TableCell>
                    <TableCell align="right">{t('analytics.kpi.orders')}</TableCell>
                    <TableCell align="right" sx={{ width: 140 }}>
                      {t('analytics.top.units')}
                    </TableCell>
                    <TableCell align="right">{t('analytics.top.revenue')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {topRows.map((row, index) => (
                    <TableRow key={row.sku} hover>
                      <TableCell>
                        <Box
                          aria-hidden
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '999px',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 11,
                            fontWeight: 800,
                            bgcolor: index === 0 ? 'var(--accent)' : 'var(--neutral-soft)',
                            color: index === 0 ? '#fff' : 'var(--muted)',
                          }}
                        >
                          {index + 1}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: T.body, fontWeight: 600 }}>
                          {dash(row.name)}
                        </Typography>
                        {/* El SKU en monoespaciada y en gris: es un identificador
                            que se compara carácter a carácter, no un nombre. */}
                        <Typography
                          sx={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          }}
                        >
                          {row.sku}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" className="tnum">
                        {row.orders}
                      </TableCell>
                      <TableCell align="right" sx={{ width: 140 }}>
                        <Typography className="tnum" sx={{ fontSize: T.body, fontWeight: 800 }}>
                          {row.units}
                        </Typography>
                        <MiniBar value={row.units} max={topMax} />
                      </TableCell>
                      <TableCell align="right" className="tnum" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {money(row.revenue, row.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </Grid>
        <Grid item xs={12} lg={5}>
          <SectionCard
            icon={<StorefrontRoundedIcon />}
            title={t('analytics.channels.title')}
            meta={channelRows.length > 0 ? String(channelRows.length) : undefined}
          >
            {channels.isPending ? (
              <TableSkeleton columns={4} />
            ) : channelRows.length === 0 ? (
              <EmptyState
                title={t('analytics.channels.empty')}
                description={t('analytics.channels.emptyBody')}
              />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('analytics.channels.channel')}</TableCell>
                    <TableCell align="right" sx={{ width: 140 }}>
                      {t('analytics.kpi.orders')}
                    </TableCell>
                    <TableCell align="right">{t('analytics.top.units')}</TableCell>
                    <TableCell align="right">{t('analytics.top.revenue')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {channelRows.map((row) => (
                    <TableRow key={row.channel_id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography sx={{ fontSize: T.body, fontWeight: 600 }}>
                            {row.channel_name}
                          </Typography>
                          {/* El código del canal es lo que viaja a las integraciones:
                              quien cuadra un pedido con el ERP busca `web`, no
                              «Tienda pública». */}
                          <StatusChip label={row.channel_code} />
                        </Stack>
                      </TableCell>
                      <TableCell align="right" sx={{ width: 140 }}>
                        <Typography className="tnum" sx={{ fontSize: T.body, fontWeight: 800 }}>
                          {row.orders}
                        </Typography>
                        <MiniBar value={row.orders} max={channelMax} />
                      </TableCell>
                      <TableCell align="right" className="tnum">
                        {row.units}
                      </TableCell>
                      <TableCell align="right" className="tnum" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {money(row.revenue, row.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Stack>
  )
}
