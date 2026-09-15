import { Alert, Box, Button, FormControlLabel, Grid, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'
import {
  DELAY_HOURS_RANGE,
  MAX_AGE_DAYS_RANGE,
  isValidWindow,
  useCartRecoveryOverview,
  useConfigureCartRecovery,
  type CartRecoveryOverview,
} from './cartRecovery'

/**
 * Configuración → Correo → Recordatorio de carrito abandonado (cierre, ítem 8).
 *
 * ## Apagado hasta que alguien decida encenderlo
 *
 * La base lo crea apagado en todas las tiendas y esta pantalla lo dice junto al
 * interruptor: un recordatorio de carrito se parece a una comunicación
 * comercial, y la base legal para enviarlo la tiene que confirmar el negocio.
 *
 * ## Los números, sin detalle
 *
 * En cola, enviados, fallidos, caducados, suprimidos y bajas de los últimos 30
 * días. Ni una dirección ni un carrito: para ver si funciona basta con contar.
 *
 * ## Un botón propio
 *
 * Va en la pestaña de Correo, que no usa la barra de Guardar del formulario de
 * la tienda: se guarda con su propia llamada, así que su botón es
 * `type="button"` para no enviar el formulario que lo rodea.
 */
const COUNTS: ReadonlyArray<{ key: keyof CartRecoveryOverview['counts'] | 'opted_out'; label: MessageKey }> = [
  { key: 'queued', label: 'cartRecovery.count.queued' },
  { key: 'sent', label: 'cartRecovery.count.sent' },
  { key: 'failed', label: 'cartRecovery.count.failed' },
  { key: 'expired', label: 'cartRecovery.count.expired' },
  { key: 'suppressed', label: 'cartRecovery.count.suppressed' },
  { key: 'opted_out', label: 'cartRecovery.count.optedOut' },
]

export function CartRecoverySection({ storeId }: { storeId: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const overview = useCartRecoveryOverview(storeId)
  const configure = useConfigureCartRecovery(storeId)

  const [enabled, setEnabled] = useState(false)
  const [delay, setDelay] = useState('4')
  const [maxAge, setMaxAge] = useState('7')

  useEffect(() => {
    if (!overview.data) return
    setEnabled(overview.data.enabled)
    setDelay(String(overview.data.delay_hours))
    setMaxAge(String(overview.data.max_age_days))
  }, [overview.data])

  if (!storeId) return null
  if (overview.isPending) return <LoadingState />
  if (overview.isError) return <Alert severity="error">{t('cartRecovery.loadError')}</Alert>

  const delayHours = Number(delay)
  const maxAgeDays = Number(maxAge)
  const valid = isValidWindow(delayHours, maxAgeDays)
  const data = overview.data

  async function save() {
    if (!valid) return
    try {
      await configure.mutateAsync({ enabled, delayHours, maxAgeDays })
      notify(t('cartRecovery.saved'))
    } catch {
      notify(t('cartRecovery.error'), 'error')
    }
  }

  return (
    <Stack spacing={2}>
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(_, value) => setEnabled(value)} />}
        label={t('cartRecovery.enable')}
      />
      <Alert severity="warning" icon={false}>
        {t('cartRecovery.consent')}
      </Alert>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            type="number"
            label={t('cartRecovery.delay')}
            value={delay}
            onChange={(event) => setDelay(event.target.value)}
            helperText={t('cartRecovery.delayHelp')}
            slotProps={{ htmlInput: { min: DELAY_HOURS_RANGE.min, max: DELAY_HOURS_RANGE.max, step: 1 } }}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            type="number"
            label={t('cartRecovery.maxAge')}
            value={maxAge}
            onChange={(event) => setMaxAge(event.target.value)}
            helperText={t('cartRecovery.maxAgeHelp')}
            slotProps={{ htmlInput: { min: MAX_AGE_DAYS_RANGE.min, max: MAX_AGE_DAYS_RANGE.max, step: 1 } }}
          />
        </Grid>
      </Grid>
      {!valid && <Alert severity="error">{t('cartRecovery.invalid')}</Alert>}

      <Box>
        <Button type="button" variant="contained" onClick={() => void save()} disabled={!valid || configure.isPending}>
          {t('cartRecovery.save')}
        </Button>
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('cartRecovery.stats').replace('{days}', String(data.window_days))}
        </Typography>
        <Grid container spacing={1.5} component="dl" sx={{ m: 0 }}>
          {COUNTS.map((item) => (
            <Grid item xs={6} sm={4} md={2} key={item.key}>
              <Typography component="dt" variant="caption" sx={{ color: 'var(--muted)' }}>
                {t(item.label)}
              </Typography>
              <Typography component="dd" variant="h6" sx={{ m: 0 }}>
                {item.key === 'opted_out' ? data.opted_out : data.counts[item.key]}
              </Typography>
            </Grid>
          ))}
        </Grid>
        <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mt: 1 }}>
          {t('cartRecovery.suppressedHelp')}
        </Typography>
      </Box>
    </Stack>
  )
}