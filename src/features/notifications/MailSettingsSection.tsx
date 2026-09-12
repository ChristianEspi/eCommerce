import ForwardToInboxRoundedIcon from '@mui/icons-material/ForwardToInboxRounded'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { LoadingState } from '@/shared/ui/states'
import { useMailStatus, useSendTestMail } from './api'

/**
 * Configuración → Correo. El botón «Probar» del contrato §14.
 *
 * ## Lo que enseña y por qué
 *
 * Si el envío por Microsoft Graph está configurado, desde qué buzón sale y, si
 * no lo está, QUÉ secretos faltan. «No configurado» a secas manda a revisar los
 * cinco; «falta MS_CLIENT_SECRET» se arregla en un minuto.
 *
 * Los secretos no se escriben desde esta pantalla, y es deliberado: los carga el
 * operador en los secretos de Edge Functions del proyecto. Un formulario que
 * aceptara el secreto de la App Registration de toda la suite sería el sitio
 * más valioso de la aplicación para intentar entrar.
 *
 * ## A quién va la prueba
 *
 * A quien pulsa el botón. La función ni siquiera acepta una dirección.
 */
const CODE_KEY: Record<string, MessageKey> = {
  GRAPH_TOKEN: 'mail.error.token',
  GRAPH_NO_AUTORIZADO: 'mail.error.unauthorized',
  GRAPH_LIMITE: 'mail.error.rateLimit',
  GRAPH_SIN_RED: 'mail.error.network',
}

export function MailSettingsSection() {
  const { t } = useI18n()
  const status = useMailStatus(true)
  const send = useSendTestMail()

  if (status.isPending) return <LoadingState />

  if (status.isError) {
    return <Alert severity="error">{t('mail.error.status')}</Alert>
  }

  const data = send.data ?? status.data

  return (
    <Stack spacing={2}>
      {data.configured ? (
        <Alert severity="success">
          {t('mail.configured')
            .replace('{name}', data.sender_name ?? '')
            .replace('{email}', data.sender_email ?? '')}
        </Alert>
      ) : (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('mail.notConfigured')}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {t('mail.missing')}
          </Typography>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {data.missing.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </Box>
        </Alert>
      )}

      <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
        {t('mail.help')}
      </Typography>

      {send.isSuccess && send.data.sent && <Alert severity="success">{t('mail.testSent')}</Alert>}
      {send.isSuccess && !send.data.sent && send.data.code && (
        <Alert severity="error">{t(CODE_KEY[send.data.code] ?? 'mail.error.generic')}</Alert>
      )}
      {send.isError && <Alert severity="error">{t('mail.error.generic')}</Alert>}

      <Box>
        <Button
          variant="contained"
          startIcon={<ForwardToInboxRoundedIcon />}
          onClick={() => send.mutate()}
          disabled={!data.configured || send.isPending}
        >
          {t('mail.test')}
        </Button>
      </Box>
    </Stack>
  )
}
