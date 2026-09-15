import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { isUnsubscribeToken, unsubscribeCartReminders } from './cartRecovery'

/**
 * `/s/:storeSlug/unsubscribe?token=…` — la baja de un clic de los recordatorios
 * de carrito (cierre, ítem 8).
 *
 * ## Por qué pide pulsar un botón
 *
 * Los filtros antispam y los antivirus de correo ABREN los enlaces para
 * analizarlos. Si abrir la página diera de baja, la gente quedaría de baja sin
 * haberlo pedido. La página no llama a nada hasta que la persona confirma.
 *
 * ## Qué no hace
 *
 * No pide sesión: quien pulsa el enlace puede estar en otro dispositivo. No
 * enseña a quién pertenece el enlace ni de qué carrito se trata: la base solo
 * responde si la baja se hizo. Y no usa la tienda de la URL para nada que
 * decida: el secreto ya dice de quién y de qué tienda es la baja.
 */
export function StoreUnsubscribePage() {
  const { t } = useI18n()
  const { storeSlug } = useParams<{ storeSlug: string }>()
  const [params] = useSearchParams()
  const token = params.get('token')
  const valid = isUnsubscribeToken(token)

  const unsubscribe = useMutation({
    mutationFn: () => unsubscribeCartReminders(token ?? ''),
  })

  const done = unsubscribe.isSuccess && unsubscribe.data
  const rejected = !valid || (unsubscribe.isSuccess && !unsubscribe.data)

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', px: 2, py: { xs: 4, md: 8 } }}>
      <Card variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)' }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5" component="h1">
              {t('cartRecovery.unsubscribe.title')}
            </Typography>

            {done && <Alert severity="success">{t('cartRecovery.unsubscribe.done')}</Alert>}
            {rejected && <Alert severity="warning">{t('cartRecovery.unsubscribe.invalid')}</Alert>}
            {unsubscribe.isError && <Alert severity="error">{t('cartRecovery.unsubscribe.error')}</Alert>}

            {valid && !unsubscribe.isSuccess && (
              <>
                <Typography variant="body1">{t('cartRecovery.unsubscribe.body')}</Typography>
                <Box>
                  <Button
                    variant="contained"
                    onClick={() => unsubscribe.mutate()}
                    disabled={unsubscribe.isPending}
                  >
                    {t('cartRecovery.unsubscribe.confirm')}
                  </Button>
                </Box>
              </>
            )}

            {storeSlug && (
              <Box>
                <Button component={RouterLink} to={`/s/${storeSlug}`} variant="text">
                  {t('cartRecovery.unsubscribe.back')}
                </Button>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}