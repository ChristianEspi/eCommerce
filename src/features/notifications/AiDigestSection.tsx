import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useI18n } from '@/shared/i18n/i18n-context'
import { codeFromDbError } from '@/shared/lib/appError'
import { AI_DIGEST_CONFIGURE_RPC, AI_DIGEST_SETTINGS_TABLE } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { SelectField } from '@/shared/ui/SelectField'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'

/**
 * Resumen diario por correo (2026-11-19): ventas de ayer, pedidos por aprobar,
 * acciones de la IA esperando decisión y clientes atrasados, para dueño y
 * administración. Cada cifra sale de la base; sale una vez al día a la hora
 * elegida (Lima) por la misma cola que el resto del correo.
 */
const settingsSchema = z.object({ enabled: z.boolean(), send_hour: z.number().int().min(0).max(23) })

function client() {
  const c = tryGetSupabaseClient()
  if (!c) throw new Error('CONFIG_INCOMPLETA')
  return c
}

export function AiDigestSection({ storeId }: { storeId: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const key = ['ai', 'digest-settings', storeId] as const

  const settings = useQuery({
    queryKey: key,
    enabled: Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await client()
        .from(AI_DIGEST_SETTINGS_TABLE)
        .select('enabled, send_hour')
        .eq('store_id', storeId)
        .maybeSingle()
      if (error) throw new Error(codeFromDbError(error))
      return data ? settingsSchema.parse(data) : { enabled: false, send_hour: 8 }
    },
  })

  const [enabled, setEnabled] = useState(false)
  const [hour, setHour] = useState(8)
  useEffect(() => {
    if (!settings.data) return
    setEnabled(settings.data.enabled)
    setHour(settings.data.send_hour)
  }, [settings.data])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await client().rpc(AI_DIGEST_CONFIGURE_RPC, {
        p_store_id: storeId,
        p_enabled: enabled,
        p_send_hour: hour,
      })
      if (error) throw new Error(codeFromDbError(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      notify(t('aiDigest.saved'))
    },
  })

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
