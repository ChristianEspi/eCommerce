import { Box, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { T } from '@/theme/tokens'

export interface TrendPoint {
  /** Clave estable (el día ISO). No se pinta. */
  key: string
  /** Etiqueta legible del punto, ya formateada por quien llama. */
  label: string
  /** Lo que marca la altura. */
  value: number
  /** El valor escrito, ya formateado (moneda incluida). */
  display: string
  /** Segunda línea del tooltip: «2 pedidos · 5 unidades». */
  caption?: string
}

/**
 * Serie diaria: un área de UNA sola serie.
 *
 * ## Por qué un área y por qué una sola
 *
 * La pregunta de esta tarjeta es «¿cómo ha ido el mes?», que es cambio en el
 * tiempo, y a eso le corresponde una línea. El relleno bajo la línea es lo que
 * la hace legible a 180 px de alto sin cuadrícula: da masa a una curva que si
 * no queda como un hilo perdido en un rectángulo vacío.
 *
 * Una serie y no dos: cruzar importe y pedidos en el mismo dibujo exigiría dos
 * ejes con escalas distintas, que es la forma más rápida de que dos curvas
 * «se crucen» sin que eso signifique nada. Los pedidos y las unidades del día
 * viajan en el tooltip, donde son contexto y no una segunda escala.
 *
 * Sin leyenda, a propósito: con una sola serie el título ya la nombra, y una
 * caja de leyenda con una entrada es ruido.
 *
 * ## El eje y las etiquetas
 *
 * El eje empieza en CERO. Recortarlo para que la curva «se vea mejor» convierte
 * una subida del 3 % en una montaña, que es la mentira más común de un panel.
 *
 * No hay un número sobre cada punto —con 90 días serían 90 cifras solapadas—:
 * se etiqueta solo el máximo, que es el que alguien va a querer nombrar, y el
 * resto se lee al pasar por encima.
 *
 * ## Accesibilidad
 *
 * El dibujo es decorativo para el lector de pantalla y debajo va la MISMA serie
 * como tabla oculta. Un `aria-label` con «gráfico de ventas» no da ni un dato;
 * la tabla los da todos, y es también lo que se lleva la exportación CSV.
 */
export function TrendChart({
  points,
  height = 180,
  fill = false,
  labelHeader,
  valueHeader,
  peakLabel,
}: {
  points: TrendPoint[]
  /** Alto fijo. Se ignora en modo `fill`, que lo mide del contenedor. */
  height?: number
  /**
   * Toma el alto que le deje la tarjeta en vez de fijarlo.
   *
   * Es lo que evita el vacío al final de la pantalla en monitores altos: el
   * hueco que sobra se lo queda la serie, que es lo único de la pantalla que
   * mejora con más alto —más recorrido vertical, más resolución en la curva—.
   * Con poco sitio se queda en su suelo y la pantalla vuelve a hacer scroll.
   */
  fill?: boolean
  /** Cabecera de la primera columna de la tabla oculta. */
  labelHeader: string
  /** Cabecera de la segunda columna de la tabla oculta. */
  valueHeader: string
  /** Rótulo del punto más alto: «Mejor día». */
  peakLabel: string
}) {
  const box = useRef<HTMLDivElement>(null)
  // El degradado se referencia por `url(#id)`, que es GLOBAL al documento: dos
  // graficos con el mismo id y el segundo pinta con el `defs` del primero.
  const fillId = useId()
  const [width, setWidth] = useState(0)
  const [measured, setMeasured] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  // El ancho se MIDE en vez de escalar el SVG con `preserveAspectRatio="none"`:
  // esa vía estira también el trazo y el texto, y una etiqueta deformada se
  // nota mucho más que una curva mal escalada.
  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    setWidth(node.clientWidth)
    setMeasured(node.clientHeight)
  }, [])

  useEffect(() => {
    const node = box.current
    // jsdom y los navegadores viejos no traen `ResizeObserver`. Sin él el
    // gráfico se pinta igual con el ancho medido al montar: pierde el
    // reajuste al redimensionar, no el dibujo.
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      setWidth(rect?.width ?? 0)
      setMeasured(rect?.height ?? 0)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const padX = 6
  const padT = 18
  const padB = 4
  // Suelo igual al alto fijo de siempre: por debajo la curva se aplasta y deja
  // de decir nada, así que antes que un gráfico ilegible se prefiere que la
  // pantalla vuelva a hacer scroll.
  const plotH = fill ? Math.max(measured, height) : height
  const innerW = Math.max(width - padX * 2, 1)
  const innerH = Math.max(plotH - padT - padB, 1)

  const max = Math.max(...points.map((point) => point.value), 0)
  const peak = points.reduce(
    (best, point, index) => (point.value > (points[best]?.value ?? -1) ? index : best),
    0,
  )

  const x = (index: number) =>
    points.length <= 1 ? padX + innerW / 2 : padX + (index / (points.length - 1)) * innerW
  const y = (value: number) => padT + innerH - (max === 0 ? 0 : (value / max) * innerH)

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${padT + innerH} L${x(0)},${padT + innerH} Z`

  const active = hover === null ? null : points[hover]

  function pick(clientX: number) {
    const node = box.current
    if (!node || points.length === 0) return
    const rect = node.getBoundingClientRect()
    const step = points.length <= 1 ? 1 : innerW / (points.length - 1)
    const index = Math.round((clientX - rect.left - padX) / step)
    setHover(Math.min(Math.max(index, 0), points.length - 1))
  }

  return (
    // En modo `fill` la raíz TIENE que ser una columna flexible: si no, el
    // `flex: 1` del lienzo no tiene contra qué crecer y el gráfico se queda
    // clavado en su suelo por mucho hueco que le deje la tarjeta.
    <Box sx={fill ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : undefined}>
      <Box
        ref={box}
        sx={{
          position: 'relative',
          width: '100%',
          touchAction: 'pan-y',
          ...(fill ? { flex: 1, minHeight: height } : { height }),
        }}
        onPointerMove={(event) => pick(event.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && (
          <Box
            component="svg"
            aria-hidden
            width={width}
            height={plotH}
            sx={{ display: 'block', overflow: 'visible' }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Suelo del eje: recesivo, del mismo gris que separa las filas. */}
            <line
              x1={padX}
              y1={padT + innerH}
              x2={padX + innerW}
              y2={padT + innerH}
              stroke="var(--border)"
              strokeWidth={1}
            />

            <path d={area} fill={`url(#${fillId})`} />
            <path
              d={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Etiqueta directa SOLO del máximo. */}
            {max > 0 && (
              <>
                <circle cx={x(peak)} cy={y(points[peak]?.value ?? 0)} r={4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
                <text
                  x={Math.min(Math.max(x(peak), 28), Math.max(width - 28, 28))}
                  y={Math.max(y(points[peak]?.value ?? 0) - 10, 10)}
                  textAnchor="middle"
                  style={{ fontSize: 11, fontWeight: 800, fill: 'var(--text)' }}
                >
                  {points[peak]?.display}
                </text>
              </>
            )}

            {hover !== null && active && (
              <>
                <line
                  x1={x(hover)}
                  y1={padT}
                  x2={x(hover)}
                  y2={padT + innerH}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <circle
                  cx={x(hover)}
                  cy={y(active.value)}
                  r={5}
                  fill="var(--accent)"
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              </>
            )}
          </Box>
        )}

        {hover !== null && active && (
          <Box
            role="presentation"
            sx={{
              position: 'absolute',
              top: 0,
              left: Math.min(Math.max(x(hover), 70), Math.max(width - 70, 70)),
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              bgcolor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 0.67,
              boxShadow: 'var(--shadow-md)',
              px: 1.25,
              py: 0.75,
              whiteSpace: 'nowrap',
            }}
          >
            <Typography sx={{ fontSize: T.label, color: 'var(--muted)', fontWeight: 700 }}>
              {active.label}
              {hover === peak && max > 0 ? ` · ${peakLabel}` : ''}
            </Typography>
            <Typography className="tnum" sx={{ fontSize: T.bodyStrong, fontWeight: 800 }}>
              {active.display}
            </Typography>
            {active.caption && (
              <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{active.caption}</Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Extremos del eje temporal: con 30 o 90 puntos, una etiqueta por día se
          solapa; los dos extremos bastan para situar la serie. */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ fontSize: T.label, color: 'var(--muted)' }}>{points[0]?.label}</Typography>
        <Typography sx={{ fontSize: T.label, color: 'var(--muted)' }}>
          {points[points.length - 1]?.label}
        </Typography>
      </Box>

      <Box component="table" sx={visuallyHidden}>
        <thead>
          <tr>
            <th scope="col">{labelHeader}</th>
            <th scope="col">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{point.display}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  )
}
