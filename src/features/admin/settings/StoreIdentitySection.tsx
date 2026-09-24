import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { TS } from '@/theme/tokens'
import { BRAND_LOCKUPS, IDENTITY_LIMITS, type BrandLockup } from '@/features/storefront/identity'
import type { StoreFormValues } from './types'

/**
 * Identidad de la cabecera y barra de avisos (Storefront V3 · P01).
 *
 * ## Las tres decisiones que reúne
 *
 *  · **Qué enseña la cabecera.** Hasta V3 la cabecera pintaba logotipo y nombre
 *    siempre, y no había forma de decir otra cosa. El problema no es teórico: la
 *    mayoría de los logotipos comerciales YA llevan el nombre dentro, así que la
 *    tienda enseñaba su nombre dos veces, uno al lado del otro.
 *  · **Si la vitrina ofrece selector claro/oscuro.** Estaba en la cabecera de
 *    toda tienda sin que ningún comercio lo hubiera pedido, compitiendo por
 *    atención con el carrito. Ahora se enciende, y viene apagado.
 *  · **Qué dice la barra de avisos.** Cero mensajes por defecto, y los que haya
 *    los escribe el comercio. La plataforma no genera ninguno: «Envíos a todo el
 *    país» es una afirmación sobre el negocio de otro.
 *
 * ## Por qué el lockup se ofrece aunque no haya logotipo
 *
 * Porque el logotipo se sube en esta misma pantalla y el orden en que alguien
 * rellena un formulario no es asunto del formulario. Lo que sí hace la vitrina
 * es no dejar un hueco: sin logotipo, la cabecera enseña el nombre aunque aquí
 * diga «solo logotipo». Esa corrección vive en `resolveBrandLockup` —una sola
 * vez, del lado que pinta— y no en un `disabled` que obligaría a volver aquí
 * después de subir el archivo.
 */

const ETIQUETA_LOCKUP: Record<BrandLockup, MessageKey> = {
  logo_name: 'settings.identity.lockup.logoName',
  logo: 'settings.identity.lockup.logo',
  name: 'settings.identity.lockup.name',
}

export function StoreIdentitySection({
  form,
  busy = false,
}: {
  form: UseFormReturn<StoreFormValues>
  busy?: boolean
}) {
  const { t } = useI18n()
  const avisos = form.watch('announcement_messages')

  function guardarAvisos(siguiente: { text: string }[]) {
    form.setValue('announcement_messages', siguiente, { shouldDirty: true })
  }

  return (
    <Stack spacing={2.5}>
      <Stack spacing={1.5}>
        <TextField
          select
          fullWidth
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
          label={t('settings.identity.lockup')}
          helperText={t('settings.identity.lockupHelp')}
          disabled={busy}
          value={form.watch('brand_lockup')}
          onChange={(evento) =>
            form.setValue('brand_lockup', evento.target.value as BrandLockup, {
              shouldDirty: true,
            })
          }
          sx={{ maxWidth: 360 }}
        >
          {BRAND_LOCKUPS.map((valor) => (
            <MenuItem key={valor} value={valor}>
              {t(ETIQUETA_LOCKUP[valor])}
            </MenuItem>
          ))}
        </TextField>

        <Controller
          control={form.control}
          name="show_theme_toggle"
          render={({ field }) => (
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    disabled={busy}
                    onChange={(evento) => field.onChange(evento.target.checked)}
                  />
                }
                label={t('settings.identity.themeToggle')}
              />
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {t('settings.identity.themeToggleHelp')}
              </Typography>
            </Box>
          )}
        />
      </Stack>

      <Stack spacing={1}>
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.identity.announcements')}
        </Typography>
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {t('settings.identity.announcementsHelp')}
        </Typography>

        {avisos.length === 0 ? (
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {t('settings.identity.announcementsEmpty')}
          </Typography>
        ) : (
          <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1 }}>
            {avisos.map((aviso, indice) => (
              <Stack
                key={indice}
                component="li"
                direction="row"
                sx={{ gap: 1, alignItems: 'flex-start' }}
              >
                <TextField
                  fullWidth
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                  label={t('settings.identity.announcementText').replace(
                    '{n}',
                    String(indice + 1),
                  )}
                  disabled={busy}
                  value={aviso.text}
                  inputProps={{
                    maxLength: IDENTITY_LIMITS.announcementTextMax,
                    'aria-label': t('settings.identity.announcementText').replace(
                      '{n}',
                      String(indice + 1),
                    ),
                  }}
                  onChange={(evento) =>
                    guardarAvisos(
                      avisos.map((entrada, i) =>
                        i === indice ? { text: evento.target.value } : entrada,
                      ),
                    )
                  }
                />
                <IconButton
                  type="button"
                  size="small"
                  disabled={busy}
                  aria-label={`${t('settings.identity.announcementRemove')}: ${indice + 1}`}
                  onClick={() => guardarAvisos(avisos.filter((_, i) => i !== indice))}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}

        <Box>
          <Button
            type="button"
            size="small"
            startIcon={<AddRoundedIcon />}
            // Dos es el tope: la barra rota entre mensajes y con tres nadie
            // llega a leer el tercero antes de empezar a comprar.
            disabled={busy || avisos.length >= IDENTITY_LIMITS.announcementsMax}
            onClick={() => guardarAvisos([...avisos, { text: '' }])}
          >
            {t('settings.identity.announcementAdd')}
          </Button>
        </Box>
      </Stack>
    </Stack>
  )
}
