import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import { Box, Stack, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'

export type PasoCheckout = {
  /** Clave estable del paso; no se pinta, se usa para el `key` y el `id`. */
  id: string
  titulo: string
}

/**
 * La barra de pasos del checkout.
 *
 * ## Por qué no son pestañas
 *
 * Unas pestañas dicen «lo mismo mirado de otra forma, entra por donde quieras».
 * Un checkout dice lo contrario: hay un orden, cada paso depende del anterior y
 * el último es un compromiso. Por eso esto es un **camino**, no un conmutador:
 * un paso al que todavía no se ha llegado no se puede pulsar, y uno que ya se
 * validó sí — volver atrás a corregir el correo es el gesto más frecuente de
 * cualquier compra, y esconderlo detrás de dos «Anterior» seguidos es lo que
 * hace que la gente abandone en vez de corregir.
 *
 * ## Lo que hace que se lea sin instrucciones
 *
 * Tres estados, y cada uno se distingue por **dos** señales y no solo por
 * color: el hecho lleva un check sobre relleno de acento, el actual lleva su
 * número sobre relleno de acento y el título en negrita, y el pendiente es un
 * círculo hueco con el número en gris. Quien no distingue el verde sigue viendo
 * el check, el grosor y el hueco.
 *
 * `aria-current="step"` es lo que un lector de pantalla anuncia como «paso
 * actual»; el resto de la semántica la da la lista ordenada, que ya dice cuántos
 * pasos hay y cuál es el tercero sin que haya que escribirlo.
 */
export function CheckoutSteps({
  pasos,
  actual,
  alcanzado,
  onIr,
}: {
  pasos: readonly PasoCheckout[]
  actual: number
  /** Índice del paso más avanzado ya validado: hasta ahí se puede saltar. */
  alcanzado: number
  onIr: (indice: number) => void
}) {
  const { t } = useI18n()

  return (
    <Stack
      component="ol"
      aria-label={t('store.checkout.steps')}
      direction="row"
      sx={{ listStyle: 'none', m: 0, mb: { xs: 2, md: 3 }, p: 0, alignItems: 'flex-start' }}
    >
      {pasos.map((paso, indice) => {
        const hecho = indice < actual
        const esActual = indice === actual
        const activo = hecho || esActual
        // Se puede pulsar lo ya recorrido. Saltar a un paso que nadie ha
        // validado dejaría el formulario a medias sin decir por qué.
        const pulsable = indice <= alcanzado && !esActual
        // La línea de la izquierda pertenece al TRAMO anterior: se pinta de
        // acento cuando ese tramo ya está hecho, no cuando lo está este.
        const lineaIzq = indice <= actual ? 'var(--accent)' : 'var(--sf-line)'
        const lineaDer = indice < actual ? 'var(--accent)' : 'var(--sf-line)'

        return (
          <Box component="li" key={paso.id} sx={{ flex: 1, minWidth: 0 }}>
            <Box
              component="button"
              type="button"
              disabled={!pulsable}
              aria-current={esActual ? 'step' : undefined}
              onClick={() => onIr(indice)}
              sx={{
                width: '100%',
                display: 'block',
                border: 'none',
                background: 'none',
                p: 0,
                font: 'inherit',
                color: 'inherit',
                textAlign: 'center',
                cursor: pulsable ? 'pointer' : 'default',
                borderRadius: 'var(--sf-radius-sm)',
                '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto 1fr',
                  alignItems: 'center',
                }}
              >
                <Box
                  sx={{ height: 2, bgcolor: indice === 0 ? 'transparent' : lineaIzq }}
                />
                <Box
                  // El numero es DECORATIVO: la lista ordenada ya dice cual es
                  // el tercero de tres. Dejarlo dentro del nombre accesible
                  // convertia el boton en «3 Pago», que no es como se llama.
                  aria-hidden
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: '999px',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 13,
                    fontWeight: 800,
                    transition: 'background-color .18s, color .18s',
                    ...(activo
                      ? { bgcolor: 'var(--accent)', color: '#FFFFFF', border: 'none' }
                      : {
                          bgcolor: 'transparent',
                          color: 'var(--muted)',
                          border: '2px solid var(--sf-line)',
                        }),
                  }}
                >
                  {hecho ? (
                    <CheckRoundedIcon
                      aria-hidden
                      sx={{ fontSize: 17, color: 'inherit' }}
                    />
                  ) : (
                    indice + 1
                  )}
                </Box>
                <Box
                  sx={{
                    height: 2,
                    bgcolor: indice === pasos.length - 1 ? 'transparent' : lineaDer,
                  }}
                />
              </Box>

              <Typography
                sx={{
                  mt: 0.75,
                  fontSize: TS.label,
                  lineHeight: 1.3,
                  fontWeight: esActual ? 800 : 600,
                  color: activo ? 'var(--text)' : 'var(--muted)',
                }}
              >
                {paso.titulo}
              </Typography>
              {/* El estado, solo para quien no ve la barra. Repetirlo en
                  pantalla junto al título sería ruido: ahí ya lo dice el check. */}
              {hecho && (
                <Box component="span" sx={visuallyHidden}>
                  {` · ${t('store.checkout.stepDone')}`}
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Stack>
  )
}
