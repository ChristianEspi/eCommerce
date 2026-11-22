import { Box, Stack, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useMemo, useState, type PointerEvent } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDate, formatMoney } from '@/shared/lib/format'
import type { CopilotChart, CopilotPoint } from './copilot'

/**
 * Tendencia de ventas del Copilot (2026-11-22): la ventana actual frente a la
 * anterior, día a día. Los puntos salen de la base (`ai_copilot_sales_trend`);
 * el modelo solo los comenta con marcadores.
 *
 * Forma: líneas (cambio en el tiempo), un solo eje. El periodo actual va con el
 * acento de la tienda y trazo continuo; el anterior, en gris y DISCONTINUO: la
 * identidad no depende solo del color (el acento es del tenant y no se puede
 * validar de antemano). Leyenda siempre, cursor con detalle al pasar, y la
 * tabla para lectores de pantalla.
 */
const W = 320
const H = 132
const PAD = { top: 8, right: 8, bottom: 18, left: 8 }

function valor(p: CopilotPoint | undefined, porImporte: boolean): number | null {
  if (!p) return null
  if (!porImporte) return p.orders
  return p.revenue === null ? null : Number(p.revenue)
}

function trazo(puntos: readonly (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''
  let abierto = false
  puntos.forEach((v, i) => {
    if (v === null) {
      abierto = false
      return
    }
    d += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    abierto = true
  })
  return d
}

export function CopilotTrendChart({ chart }: { chart: CopilotChart }) {
  const { t, locale } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const porImporte = chart.currency !== null

  const { actual, previo, max } = useMemo(() => {
    const a = chart.current.map((p) => valor(p, porImporte))
    const b = chart.current.map((_, i) => valor(chart.previous[i], porImporte))
    const m = Math.max(1, ...a.filter((v): v is number => v !== null), ...b.filter((v): v is number => v !== null))
    return { actual: a, previo: b, max: m }
  }, [chart, porImporte])

  const n = chart.current.length
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right))
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)
  const fmt = (v: number | null) =>
    v === null ? '—' : porImporte ? formatMoney(v, chart.currency!, locale) : String(v)

  function mover(event: PointerEvent<SVGRectElement>) {
    const caja = event.currentTarget.getBoundingClientRect()
    if (caja.width === 0 || n === 0) return
    const rel = ((event.clientX - caja.left) / caja.width) * W
    const i = Math.round(((rel - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  const etiquetaMedida = porImporte ? t('copilot.chart.revenue') : t('copilot.chart.orders')
  const punto = hover !== null ? chart.current[hover] : null

  return (
    <Box data-copilot-chart sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 1.25, bgcolor: 'var(--card)' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>
          {t('copilot.chart.title').replace('{days}', String(chart.days)).replace('{measure}', etiquetaMedida)}
        </Typography>
        <Stack direction="row" spacing={1.5} aria-hidden>
          <Leyenda texto={t('copilot.chart.current')} />
          <Leyenda texto={t('copilot.chart.previous')} discontinua />
        </Stack>
      </Stack>

      <Box sx={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('copilot.chart.aria')} style={{ display: 'block', overflow: 'visible' }}>
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--border)" strokeWidth={1} />
          <path d={trazo(previo, x, y)} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" />
          <path d={trazo(actual, x, y)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} opacity={0.5} />
              {actual[hover] !== null && (
                <circle cx={x(hover)} cy={y(actual[hover]!)} r={4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
              )}
            </g>
          )}
          {n > 0 && (
            <>
              <text x={PAD.left} y={H - 4} fontSize={9} fill="var(--muted)">{formatDate(chart.current[0]!.day, locale)}</text>
              <text x={W - PAD.right} y={H - 4} fontSize={9} fill="var(--muted)" textAnchor="end">
                {formatDate(chart.current[n - 1]!.day, locale)}
              </text>
            </>
          )}
          {/* Zona de cursor más grande que las marcas. */}
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            onPointerMove={mover}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {punto && hover !== null && (
          <Box
            role="status"
            sx={{
              position: 'absolute',
              top: 0,
              left: `${(x(hover) / W) * 100}%`,
              transform: hover > n / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
              pointerEvents: 'none',
              bgcolor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 1,
              px: 1,
              py: 0.5,
              boxShadow: 2,
              whiteSpace: 'nowrap',
            }}
          >
            <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{formatDate(punto.day, locale)}</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }} className="tnum">
              {t('copilot.chart.current')}: {fmt(actual[hover] ?? null)}
            </Typography>
            <Typography sx={{ fontSize: 12 }} className="tnum">
              {t('copilot.chart.previous')}: {fmt(previo[hover] ?? null)}
            </Typography>
          </Box>
        )}
      </Box>

      <Box component="table" sx={visuallyHidden}>
        <caption>{t('copilot.chart.aria')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('copilot.chart.day')}</th>
            <th scope="col">{t('copilot.chart.current')}</th>
            <th scope="col">{t('copilot.chart.previous')}</th>
          </tr>
        </thead>
        <tbody>
          {chart.current.map((p, i) => (
            <tr key={p.day}>
              <th scope="row">{formatDate(p.day, locale)}</th>
              <td>{fmt(actual[i] ?? null)}</td>
              <td>{fmt(previo[i] ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  )
}

function Leyenda({ texto, discontinua = false }: { texto: string; discontinua?: boolean }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <svg width={16} height={6} aria-hidden>
        <line
          x1={1}
          x2={15}
          y1={3}
          y2={3}
          stroke={discontinua ? 'var(--muted)' : 'var(--accent)'}
          strokeWidth={discontinua ? 1.5 : 2}
          strokeDasharray={discontinua ? '4 3' : undefined}
          strokeLinecap="round"
        />
      </svg>
      <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{texto}</Typography>
    </Stack>
  )
}
