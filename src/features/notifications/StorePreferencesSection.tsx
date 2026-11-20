import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import { Card, FormControlLabel, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useParams } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import { useAppearance } from '@/theme/appearance-context'
import { useCartReminderPreference, useSetCartReminderPreference } from './cartRecovery'

/**
 * Preferencias del comprador en «Mi cuenta» (2026-11-20).
 *
 * Aquí viven las dos cosas que son SUYAS y no de un pedido:
 *  · Claro u oscuro. Antes era un botón en la cabecera, compitiendo con el
 *    carrito; ahora es una preferencia más. Por defecto, claro. Solo se ofrece
 *    si la tienda lo permite (Configuración › Identidad del backoffice).
 *  · Recibir o no recordatorios de carrito de ESTA tienda (cierre, ítem 8),
 *    que antes estaba en la pestaña «Avisos» —los avisos ahora son la
 *    campanita de la cabecera—.
 */
export function StorePreferencesSection({ showThemeOption }: { showThemeOption: boolean }) {
  const { storeSlug } = useParams<{ storeSlug: string }>()
  const { t } = useI18n()
  const { appearance, setMode } = useAppearance()

  return (
    <Stack spacing={1.5}>
      <Typography component="h2" sx={{ fontWeight: 800, fontSize: 17 }}>
        {t('account.prefs.title')}
      </Typography>
      {showThemeOption && (
        <Card variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)', px: 2, py: 1.5 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <div>
              <Typography sx={{ fontWeight: 600 }}>{t('account.prefs.theme')}</Typography>
              <Typography variant="caption" component="p" sx={{ color: 'var(--muted)' }}>
                {t('account.prefs.themeHelp')}
              </Typography>
            </div>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={appearance.mode}
              onChange={(_e, mode: 'light' | 'dark' | null) => mode && setMode(mode)}
              aria-label={t('account.prefs.theme')}
            >
              <ToggleButton value="light" sx={{ gap: 0.75, px: 1.5 }}>
                <LightModeRoundedIcon fontSize="small" />
                {t('account.prefs.light')}
              </ToggleButton>
              <ToggleButton value="dark" sx={{ gap: 0.75, px: 1.5 }}>
                <DarkModeRoundedIcon fontSize="small" />
                {t('account.prefs.dark')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Card>
      )}
      <CartReminderPreference storeSlug={storeSlug ?? null} />
    </Stack>
  )
}

/** Recibir o no recordatorios de carrito de esta tienda. La persona sale del JWT. */
function CartReminderPreference({ storeSlug }: { storeSlug: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const preference = useCartReminderPreference(storeSlug, true)
  const update = useSetCartReminderPreference(storeSlug)

  // Sin tienda en la ruta, sin respuesta o con la función apagada, no se enseña
  // nada: ofrecer apagar algo que no existe es ruido.
  if (!storeSlug || !preference.data || !preference.data.store_enabled) return null

  return (
    <Card variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)', px: 2, py: 1.5 }}>
      <FormControlLabel
        control={
          <Switch
            checked={preference.data.receive}
            disabled={update.isPending}
            onChange={(_, receive) =>
              update.mutate(receive, { onError: () => notify(t('cartRecovery.preferenceError'), 'error') })
            }
          />
        }
        label={t('cartRecovery.preference')}
      />
      <Typography variant="caption" component="p" sx={{ color: 'var(--muted)' }}>
        {t('cartRecovery.preferenceHelp')}
      </Typography>
    </Card>
  )
}
