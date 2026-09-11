import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { CuentaCreada } from './createAccount'

/**
 * Las credenciales de una cuenta recién creada, que se ven UNA vez.
 *
 * El servidor genera la contraseña, la devuelve y la olvida: no queda en
 * ninguna tabla ni en ningún registro, así que esta pantalla es literalmente la
 * única vez que existe a la vista. De ahí las tres decisiones de diseño:
 *
 *  · **El aviso va arriba y en `warning`**, antes que la contraseña. Después de
 *    leerla ya es tarde para enterarse de que no va a volver a salir.
 *  · **Se puede copiar de un clic**, porque el destino real de este texto es
 *    otra ventana —un chat, un correo— y una contraseña tecleada a mano es una
 *    contraseña escrita mal.
 *  · **Se ve en monoespaciada y con las letras separadas.** Va a acabar
 *    dictándose por teléfono aunque no debiera; el servidor ya evita los
 *    caracteres que se confunden, y esto termina el trabajo.
 *
 * No se ofrece «volver a verla»: no hay dónde consultarla. Si se pierde, el
 * camino es recuperar contraseña, que es el mismo que para todo el mundo.
 */
export function TemporaryCredentials({ cuenta }: { cuenta: CuentaCreada }) {
  const { t } = useI18n()
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(cuenta.temporary_password)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles la contraseña sigue a la vista para copiarla
      // a mano. Perder el botón no puede significar perder la contraseña.
    }
  }

  return (
    <Stack spacing={1.5}>
      <Alert severity="warning">{t('account.create.once')}</Alert>

      <Box>
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          {t('account.create.email')}
        </Typography>
        <Typography sx={{ fontWeight: 600, wordBreak: 'break-all' }}>{cuenta.email}</Typography>
      </Box>

      <Box>
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          {t('account.create.password')}
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography
            component="code"
            sx={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '1.05rem',
              letterSpacing: '0.08em',
              fontWeight: 600,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              bgcolor: 'var(--surface-2, rgba(0,0,0,0.05))',
              wordBreak: 'break-all',
            }}
          >
            {cuenta.temporary_password}
          </Typography>
          <Button
            size="small"
            startIcon={copiado ? <DoneRoundedIcon /> : <ContentCopyRoundedIcon />}
            onClick={() => void copiar()}
          >
            {t(copiado ? 'account.create.copied' : 'account.create.copy')}
          </Button>
        </Stack>
      </Box>

      <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
        {t('account.create.next')}
      </Typography>
    </Stack>
  )
}
