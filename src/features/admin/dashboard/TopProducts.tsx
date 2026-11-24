import { Box, Card, CardContent, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { C } from '@/theme/tokens'
import type { DashboardKpis } from '../useDashboardKpis'

/**
 * Lo que más vende, como ranking: puesto, nombre, ingreso y su peso en el total.
 *
 * El largo de la barra es relativo al PRIMERO (compara productos entre sí); el
 * porcentaje escrito es sobre las ventas acumuladas (dice cuánto pesa en la
 * tienda). Son dos preguntas distintas y cada una tiene su forma. El % solo se
 * escribe si hay un total afirmable: con monedas mezcladas no hay base.
 *
 * 2026-11-24: también las unidades vendidas, en su propia columna. Con monedas
 * mezcladas la cifra principal ya son las unidades y no se repiten.
 */
export function TopProducts({ kpis }: { kpis: DashboardKpis }) {
  const { t, locale } = useI18n()
  const rows = kpis.top_products
  const top = Math.max(...rows.map((r) => Number(r.revenue)), 0)
  const total = kpis.sales !== null ? Number(kpis.sales) : null
  const unitsText = (n: number) =>
    t(n === 1 ? 'admin.dashboard.topProducts.units.one' : 'admin.dashboard.topProducts.units').replace('{n}', n.toLocaleString(locale))

  return (
    <Card component="section" aria-labelledby="top-products-title" sx={{ height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Typography id="top-products-title" component="h2" sx={{ fontSize: 17, fontWeight: 800 }}>
          {t('admin.dashboard.topProducts')}
        </Typography>
        <Typography sx={{ fontSize: 12, color: C.muted, mb: 2 }}>{t('admin.dashboard.topProducts.hint')}</Typography>

        {rows.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: C.muted, py: 2 }}>{t('admin.dashboard.noSales')}</Typography>
        ) : (
          <Stack component="ol" spacing={1.75} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {rows.map((row, index) => {
              const revenue = Number(row.revenue)
              const width = top > 0 ? Math.max((revenue / top) * 100, 2) : 0
              const share = total && total > 0 ? `${((revenue / total) * 100).toFixed(1)} %` : null
              return (
                <Stack component="li" key={row.sku} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Typography
                    aria-hidden
                    className="tnum"
                    sx={{ width: 26, flexShrink: 0, fontSize: 17, fontWeight: 800, color: index === 0 ? C.accentDeep : C.muted, opacity: index === 0 ? 1 : 0.55 }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <Typography noWrap title={row.name} sx={{ fontSize: 13, fontWeight: index === 0 ? 800 : 600, minWidth: 0 }}>
                        {row.name}
                      </Typography>
                      <Typography className="tnum" sx={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {kpis.currency ? formatMoney(revenue, kpis.currency, locale) : String(row.units)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.6 }}>
                      <Box aria-hidden sx={{ flex: 1, height: 5, borderRadius: 999, bgcolor: C.neutralSoft, overflow: 'hidden' }}>
                        <Box sx={{ width: `${width}%`, height: '100%', borderRadius: 999, bgcolor: index === 0 ? C.accentDeep : C.accent }} />
                      </Box>
                      {kpis.currency && (
                        <Typography className="tnum" sx={{ fontSize: 11, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap' }}>
                          {unitsText(row.units)}
                        </Typography>
                      )}
                      {share && (
                        <Typography className="tnum" sx={{ fontSize: 11, color: C.muted, width: 44, textAlign: 'right' }}>
                          {share}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </Stack>
              )
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
