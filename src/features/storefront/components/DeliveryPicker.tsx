import {
  Alert,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import type { DeliveryOption } from '../delivery'

/**
 * Cómo quiere el comprador recibir su pedido.
 *
 * **Recojo y envío son la misma pregunta, no dos checkouts** (regla 7 de la
 * fase): las cuatro estrategias son opciones de esta misma lista, comparten
 * dirección, comparten resumen y comparten botón de comprar. Un «checkout de
 * recojo» aparte duplicaría la validación, el resumen y el error.
 *
 * Las opciones NO disponibles se pintan, deshabilitadas y con su motivo. Es la
 * mitad de la información útil: «a tu distrito no llegamos con express, pero sí
 * con estándar» solo se puede decir si express aparece.
 *
 * Aquí no se calcula ni un céntimo. El importe llega ya resuelto por el
 * servidor; este componente lo formatea.
 */
export function DeliveryPicker({
  options,
  loading,
  failed,
  selectedCode,
  onSelect,
  selectedPickupPointId,
  onSelectPickupPoint,
  error,
  faltaPais = false,
}: {
  options: readonly DeliveryOption[]
  loading: boolean
  failed: boolean
  selectedCode: string
  onSelect: (code: string) => void
  selectedPickupPointId: string
  onSelectPickupPoint: (id: string) => void
  error: string | null
  /** La dirección todavía no dice el país, y la zona lo necesita para decidir. */
  faltaPais?: boolean
}) {
  const { t, locale } = useI18n()
  const selected = options.find((option) => option.code === selectedCode) ?? null
  const hayNoDisponibles = options.some((option) => !option.available)

  if (loading) {
    return (
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('common.loading')}
      </Typography>
    )
  }

  // Sin opciones no se enseña un bloque vacío: se dice que esta tienda no cobra
  // envío, que es la verdad para un tenant sin métodos configurados y el
  // comportamiento que tenía la vitrina antes de P12.
  if (failed || options.length === 0) {
    return (
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('store.delivery.none')}
      </Typography>
    )
  }

  return (
    <Stack spacing={1.5}>
      <FormControl error={Boolean(error)}>
        <FormLabel id="delivery-options">{t('store.delivery.title')}</FormLabel>
        <RadioGroup
          aria-labelledby="delivery-options"
          value={selectedCode}
          onChange={(event) => onSelect(event.target.value)}
        >
          {options.map((option) => (
            <FormControlLabel
              key={option.code}
              value={option.code}
              disabled={!option.available}
              control={<Radio />}
              label={
                <Stack>
                  <Typography sx={{ fontSize: TS.body, fontWeight: 600 }}>
                    {option.name}
                    {option.available && option.amount !== null
                      ? ` · ${
                          option.free
                            ? t('store.delivery.free')
                            : formatMoney(Number(option.amount), option.currency, locale)
                        }`
                      : ''}
                  </Typography>
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {option.available
                      ? option.promised_from
                        ? `${t('store.delivery.promised')} ${option.promised_from} – ${option.promised_to}`
                        : (option.description ?? '')
                      : t('store.delivery.unavailable')}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>
      </FormControl>

      {/* «No disponible para tu dirección» sobre una dirección incompleta es un
          diagnóstico falso: la zona no descarta el domicilio, es que todavía no
          sabe en qué país está. Sin esto, con el país vacío, los dos envíos
          salían muertos y sin motivo, y el comprador solo podía concluir que a
          su calle no se llega. */}
      {faltaPais && hayNoDisponibles && (
        <Alert severity="info">{t('store.delivery.needCountry')}</Alert>
      )}

      {selected?.instructions && <Alert severity="info">{selected.instructions}</Alert>}

      {/* El punto de recojo solo existe cuando la estrategia lo pide. Que la
          base lo exija con un CHECK y aquí aparezca solo entonces es la misma
          regla vista desde los dos lados. */}
      {selected?.strategy === 'pickup' && (
        <TextField
          select
          label={t('store.delivery.pickupPoint')}
          value={selectedPickupPointId}
          onChange={(event) => onSelectPickupPoint(event.target.value)}
          error={Boolean(error)}
        >
          {selected.pickup_points.map((point) => (
            <MenuItem key={point.pickup_point_id} value={point.pickup_point_id}>
              {point.name}
              {typeof point.address.address === 'string' ? ` · ${point.address.address}` : ''}
            </MenuItem>
          ))}
        </TextField>
      )}

      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  )
}
