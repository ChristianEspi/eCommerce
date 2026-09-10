import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { R } from '@/theme/tokens'
import { useAiEntitlement } from './hooks'
import { agotado, porAgotarse, type AiEntitlement } from './types'

/**
 * El medidor de IA: cuánto queda y qué pasa cuando no queda.
 *
 * ## Por qué el estado se dice en palabras y no solo con una barra
 *
 * Una barra al cero puede leerse como «esto se está cargando» o como «esto se
 * rompió». Lo que ha pasado en realidad es una de dos cosas muy distintas: se
 * acabó la prueba, o se acabó la cuota del mes. La primera lleva a contratar y
 * la segunda a ampliar, así que se nombran por separado. Ofrecer «amplía tu
 * cuota» a quien nunca contrató nada es ofrecerle un botón que no existe.
 *
 * ## Por qué no hay botón de comprar
 *
 * El catálogo comercial es del hub, no de esta app (contrato, principio 2).
 * Aquí se dice el estado y a quién dirigirse; el alta la hace quien lleva la
 * cuenta. Pintar un botón de pago que no lleva a ninguna pasarela sería peor
 * que no pintarlo.
 */
export function AiMeter({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const consulta = useAiEntitlement()
  const estado = consulta.data

  // Mientras carga no se pinta nada. Un medidor que aparece en blanco y luego
  // se rellena se lee como un fallo que se arregló solo.
  if (!estado) return null
  if (!estado.enabled) return compact ? null : <SinContratar />

  const usado = estado.used ?? 0
  const tope = estado.quota ?? 0
  const restante = estado.remaining ?? 0
  const proporcion = tope > 0 ? Math.min((usado / tope) * 100, 100) : 0
  const sinSaldo = agotado(estado)
  const avisando = porAgotarse(estado)

  const tono = sinSaldo ? 'var(--red)' : avisando ? 'var(--amber)' : 'var(--accent)'

  return (
    <Box
      sx={{
        p: compact ? 1.25 : 2,
        borderRadius: `${R.md}px`,
        border: '1px solid var(--border)',
        bgcolor: 'var(--surface)',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.75 }}>
        <AutoAwesomeRoundedIcon fontSize="small" sx={{ color: tono }} />
        <Typography sx={{ fontSize: 13, fontWeight: 800, flex: 1 }}>{t('ai.meter.title')}</Typography>
        {/* El número exacto, no solo la barra: quien administra necesita saber
            cuántas acciones le quedan, no una impresión visual. */}
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
          {usado} / {tope}
        </Typography>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={proporcion}
        aria-label={t('ai.meter.title')}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: 'var(--neutral-soft)',
          '& .MuiLinearProgress-bar': { bgcolor: tono, borderRadius: 3 },
        }}
      />

      <Typography sx={{ mt: 0.75, fontSize: 12, color: sinSaldo ? 'var(--red)' : 'var(--muted)' }}>
        {mensaje(estado, restante, t)}
      </Typography>
    </Box>
  )
}

/** El texto que corresponde al estado, no un genérico para todos. */
function mensaje(
  estado: AiEntitlement,
  restante: number,
  t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string,
): string {
  if (estado.status === 'trial_expired') return t('ai.meter.trialExpired')
  if (estado.status === 'quota_exceeded') return t('ai.meter.quotaExceeded')
  if (estado.status === 'trial') return t('ai.meter.trial').replace('{n}', String(restante))
  return t('ai.meter.active').replace('{n}', String(restante))
}

/**
 * Sin contratar. No es un error y no se pinta como tal.
 *
 * Reusa el mismo lenguaje que el resto de módulos no contratados: se activa
 * desde la consola de EBIM, no desde aquí.
 */
function SinContratar() {
  const { t } = useI18n()
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: `${R.md}px`,
        border: '1px dashed var(--border)',
        bgcolor: 'var(--neutral-soft)',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <AutoAwesomeRoundedIcon fontSize="small" sx={{ color: 'var(--muted)' }} />
        <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{t('ai.meter.title')}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {t('capabilities.locked.body')}
      </Typography>
    </Box>
  )
}
