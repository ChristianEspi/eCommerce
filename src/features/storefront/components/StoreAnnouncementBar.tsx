import { Box, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { TS } from '@/theme/tokens'
import { sanitizeAnnouncements } from '../identity'

/**
 * La barra de avisos, sobre la cabecera (Storefront V3 · P03).
 *
 * ## La regla, antes que nada: la plataforma no escribe aquí
 *
 * «Envíos a todo el país», «Devoluciones en 30 días», «Pago seguro con Visa».
 * Las tres quedan bien, no cuestan nada de maquetar y son afirmaciones sobre el
 * NEGOCIO de otro. Un envío inventado produce un pedido que no se puede
 * entregar; una devolución inventada es una promesa que alguien va a reclamar.
 *
 * Así que esta barra pinta **exclusivamente** lo que el comercio escribió, y
 * **no existe** si no escribió nada. Cero mensajes por defecto: una barra vacía
 * también miente, porque dice «aquí hay algo que no se ha rellenado».
 *
 * ## Por qué rota en vez de poner los dos a la vez
 *
 * En escritorio caben los dos —van uno al lado del otro, separados—, y así se
 * leen de un vistazo sin esperar. En el teléfono no: dos frases de ochenta
 * caracteres en 390 px se cortan las dos. Ahí rota, cada cinco segundos.
 *
 * Y con `prefers-reduced-motion` no rota: se queda el primero. Un mensaje que
 * cambia solo es movimiento, y hay gente a la que el movimiento le sienta mal —
 * no es una animación decorativa que se pueda «suavizar», así que se apaga.
 */

/** Cinco segundos: da para leer ochenta caracteres sin que parezca un cartel. */
const ROTACION_MS = 5000

export function StoreAnnouncementBar({ messages }: { messages: unknown }) {
  const avisos = sanitizeAnnouncements(messages)
  const [indice, setIndice] = useState(0)

  /**
   * La rotación, y por qué se decide aquí y no con CSS.
   *
   * Una animación de CSS podría ir alternando opacidades, pero entonces los dos
   * mensajes estarían SIEMPRE en el documento y un lector de pantalla los leería
   * los dos seguidos, sin pausa, como una sola frase. Con estado se pinta uno.
   *
   * `matchMedia` en vez de una media query porque lo que cambia no es un estilo:
   * es si el temporizador existe.
   */
  useEffect(() => {
    if (avisos.length < 2) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const temporizador = window.setInterval(
      () => setIndice((actual) => (actual + 1) % avisos.length),
      ROTACION_MS,
    )
    return () => window.clearInterval(temporizador)
  }, [avisos.length])

  // Sin avisos no hay barra. No es un caso defensivo: es el estado por defecto
  // de toda tienda, y el que evita que la plataforma hable por el comercio.
  if (avisos.length === 0) return null

  const visible = avisos[Math.min(indice, avisos.length - 1)]

  return (
    <Box
      data-announcement-bar={avisos.length}
      sx={{
        bgcolor: 'var(--accent-deep)',
        color: '#FFFFFF',
        px: 2,
        py: 0.75,
        textAlign: 'center',
      }}
    >
      <Box sx={{ maxWidth: 'var(--sf-content-w)', mx: 'auto' }}>
        {/**
         * Escritorio: los dos, uno al lado del otro.
         *
         * `role="status"` y no `aria-live="assertive"`: es información de
         * servicio, no una alerta. Con `polite` se anuncia cuando quien escucha
         * termina lo que estaba oyendo, en vez de interrumpirle a media frase.
         */}
        <Stack
          role="status"
          direction="row"
          sx={{
            display: { xs: 'none', md: 'flex' },
            justifyContent: 'center',
            alignItems: 'center',
            gap: 3,
            flexWrap: 'wrap',
          }}
        >
          {avisos.map((aviso) => (
            <Typography
              key={aviso.text}
              sx={{ fontSize: TS.label, fontWeight: 700, letterSpacing: '0.01em' }}
            >
              {aviso.text}
            </Typography>
          ))}
        </Stack>

        {/* Teléfono: uno, el que toque, en una línea y sin cortarse a medias. */}
        <Typography
          role="status"
          data-announcement-index={indice}
          sx={{
            display: { xs: 'block', md: 'none' },
            fontSize: TS.label,
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {visible?.text}
        </Typography>
      </Box>
    </Box>
  )
}
