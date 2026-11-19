import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { SelectField } from '@/shared/ui/SelectField'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'
import { useConfigureDigest, useDigestSettings } from './aiDigest'

/**
 * Resumen diario por correo (2026-11-19): ventas de ayer, pedidos por aprobar,
 * acciones de la IA esperando decisión y clientes atrasados, para dueño y
 * administración. Cada cifra sale de la base; sale una vez al día a la hora
 * elegida (Lima) por la misma cola que el resto del correo.
 */
export function AiDigestSection({ storeId }: { storeId: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const settings = useDigestSettings(storeId)
  const configure = useConfigureDigest(storeId)

  const [enabled, setEnabled] = useState(false)
  const [hour, setHour] = useState(8)
  useEffect(() => {
    if (!settings.data) return
    setEnabled(settings.data.enabled)
    setHour(settings.data.send_hour)
  }, [settings.data])

  const save = {
    mutate: () =>
      configure.mutate({ enabled, send_hour: hour }, { onSuccess: () => notify(t('aiDigest.saved')) }),
    isPending: configure.isPending,
    isError: configure.isError,
  }

  if (!storeId) return null
  if (settings.isPending) return <LoadingState />

  const changed = settings.data ? settings.data.enabled !== enabled || settings.data.send_hour !== hour : false

  return (
    <Stack spacing={1.5}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('aiDigest.help')}</Typography>
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
        label={t('aiDigest.enabled')}
      />
      <SelectField
        size="small"
        label={t('aiDigest.hour')}
        value={String(hour)}
        onChange={(event) => setHour(Number(event.target.value))}
        disabled={!enabled}
        sx={{ maxWidth: 220 }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <MenuItem key={h} value={String(h)}>
            {`${String(h).padStart(2, '0')}:00`}
          </MenuItem>
        ))}
      </SelectField>
      {settings.isError && <Alert severity="error">{t('aiDigest.error')}</Alert>}
      {save.isError && <Alert severity="error">{t('aiDigest.error')}</Alert>}
      <Button variant="contained" onClick={() => save.mutate()} disabled={!changed || save.isPending} sx={{ alignSelf: 'flex-start' }}>
        {t('aiDigest.save')}
      </Button>
    </Stack>
  )
}
