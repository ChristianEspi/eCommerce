import LockRoundedIcon from '@mui/icons-material/LockRounded'
import { Alert, Box, Stack, TextField, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { esSimulacroDePago, pareceTarjeta, soloDigitos, type DatosTarjeta } from '../cardToken'

/**
 * Los datos de la tarjeta, dentro del paso 3 del checkout.
 *
 * ## Por qué aquí y no en una pantalla aparte
 *
 * Porque la tarjeta es *cómo* se paga, y el paso 3 ya es esa pregunta. Sacarla a
 * una pantalla propia añadiría una navegación, un estado que conservar y una
 * forma nueva de perder lo escrito, a cambio de nada: el formulario son cuatro
 * campos y caben debajo del medio elegido.
 *
 * ## Estos datos no llegan a ningún servidor de EBIM
 *
 * Se cambian por un token —contra Culqi cuando hay clave, en local cuando no— y
 * lo único que sale del navegador es ese token. El número no viaja, no se
 * guarda y no se registra en ninguna traza.
 *
 * ## El simulacro se anuncia, siempre
 *
 * Un formulario de tarjeta que aprueba sin cobrar y no lo dice es exactamente la
 * clase de cosa que destruye la confianza cuando alguien lo descubre en una
 * demo. Mientras no haya clave, el aviso está encima de los campos, no
 * escondido en un pie.
 */
export function CardFields({
  datos,
  onCambio,
  error,
}: {
  datos: DatosTarjeta
  onCambio: (datos: DatosTarjeta) => void
  error: string | null
}) {
  const { t } = useI18n()
  const simulado = esSimulacroDePago()
  const numeroDigitos = soloDigitos(datos.numero)
  const numeroMal = numeroDigitos.length >= 13 && !pareceTarjeta(datos.numero)

  function cambiar(campo: keyof DatosTarjeta, valor: string) {
    onCambio({ ...datos, [campo]: valor })
  }

  return (
    <Stack sx={{ gap: 1.5, mt: 1 }}>
      {simulado && (
        <Alert severity="warning" sx={{ borderRadius: 'var(--sf-radius-sm)' }}>
          <Typography sx={{ fontSize: TS.label, fontWeight: 800, mb: 0.25 }}>
            {t('store.card.simulatedTitle')}
          </Typography>
          <Box sx={{ fontSize: TS.label }}>{t('store.card.simulatedBody')}</Box>
        </Alert>
      )}

      <TextField
        label={t('store.card.number')}
        value={datos.numero}
        onChange={(evento) => cambiar('numero', evento.target.value)}
        placeholder="4111 1111 1111 1111"
        autoComplete="cc-number"
        error={numeroMal || Boolean(error)}
        helperText={numeroMal ? t('store.card.numberInvalid') : ' '}
        inputProps={{ inputMode: 'numeric', maxLength: 23 }}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label={t('store.card.month')}
          value={datos.mes}
          onChange={(evento) => cambiar('mes', evento.target.value)}
          placeholder="09"
          autoComplete="cc-exp-month"
          inputProps={{ inputMode: 'numeric', maxLength: 2 }}
          sx={{ flex: 1 }}
        />
        <TextField
          label={t('store.card.year')}
          value={datos.anio}
          onChange={(evento) => cambiar('anio', evento.target.value)}
          placeholder="2028"
          autoComplete="cc-exp-year"
          inputProps={{ inputMode: 'numeric', maxLength: 4 }}
          sx={{ flex: 1 }}
        />
        <TextField
          label={t('store.card.cvv')}
          value={datos.cvv}
          onChange={(evento) => cambiar('cvv', evento.target.value)}
          placeholder="123"
          autoComplete="cc-csc"
          inputProps={{ inputMode: 'numeric', maxLength: 4 }}
          sx={{ flex: 1 }}
        />
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
        <LockRoundedIcon aria-hidden sx={{ fontSize: 15, color: 'var(--accent-deep)' }} />
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {t('store.card.privacy')}
        </Typography>
      </Stack>

      {error && (
        <Typography sx={{ fontSize: TS.label, color: 'var(--red)' }}>
          {t(error as Parameters<typeof t>[0])}
        </Typography>
      )}
    </Stack>
  )
}
