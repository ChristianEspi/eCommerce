import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import type { SvgIconComponent } from '@mui/icons-material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import type { StorePaymentMethod } from '../payment'

/**
 * Icono por FAMILIA, no por código.
 *
 * El código lo pone el comercio y puede ser cualquier cosa —`yape`, `plin`,
 * `bcp-soles`—; la familia es un enum cerrado de la base. Emparejar por código
 * dejaría sin icono a cada tienda nueva, que es justo cuando peor se ve.
 */
const ICONOS: Record<string, SvgIconComponent> = {
  wallet: AccountBalanceWalletRoundedIcon,
  bank_transfer: AccountBalanceRoundedIcon,
  cash: PaymentsRoundedIcon,
  card: CreditCardRoundedIcon,
  credit: ReceiptLongRoundedIcon,
}

/**
 * Cómo quiere pagar el comprador.
 *
 * ## Las instrucciones se enseñan ANTES de pedir, no después
 *
 * «Yape al 999...» o «cuenta BCP 191-...» es lo único que el comprador tiene que
 * hacer cuando el pedido ya existe, y enseñárselo solo en la confirmación
 * significa que decide sin saber qué le espera. Aquí aparecen en cuanto marca el
 * medio, y vuelven a salir en la confirmación —que es donde se consultan—.
 *
 * ## Aquí no se valida nada
 *
 * Este componente pinta una lista y devuelve un código. Que ese código
 * corresponda a un medio vivo de esta tienda lo decide `payment_intent_open` en
 * el servidor, con la fila y el tenant delante. Repetir la comprobación en el
 * navegador sería una segunda autoridad sobre el mismo dato, y la del navegador
 * siempre acaba desactualizada.
 *
 * Sin medios configurados no se pinta un bloque vacío ni se bloquea la compra:
 * se dice que esta tienda acuerda el pago aparte, que es la verdad para un
 * tenant sin `payment_methods` y deja el checkout funcionando exactamente como
 * antes de existir este selector.
 */
export function PaymentPicker({
  methods,
  loading,
  failed,
  selectedCode,
  onSelect,
  error,
}: {
  methods: readonly StorePaymentMethod[]
  loading: boolean
  failed: boolean
  selectedCode: string
  onSelect: (code: string) => void
  error: string | null
}) {
  const { t } = useI18n()
  const selected = methods.find((method) => method.code === selectedCode) ?? null

  if (loading) {
    return (
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('common.loading')}
      </Typography>
    )
  }

  if (failed || methods.length === 0) {
    return (
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('store.payment.none')}
      </Typography>
    )
  }

  return (
    <Stack spacing={1.5}>
      <FormControl error={Boolean(error)}>
        <FormLabel id="payment-methods">{t('store.payment.title')}</FormLabel>
        <RadioGroup
          aria-labelledby="payment-methods"
          value={selectedCode}
          onChange={(event) => onSelect(event.target.value)}
        >
          {methods.map((method) => {
            const Icono = ICONOS[method.kind] ?? PaymentsRoundedIcon
            return (
              <FormControlLabel
                key={method.code}
                value={method.code}
                control={<Radio />}
                label={
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    {/* Decorativo: el nombre que va al lado ya lo dice todo, y
                        anunciarlo otra vez haría que el lector de pantalla
                        leyera dos veces la misma opción. */}
                    <Icono aria-hidden sx={{ fontSize: 20, color: 'var(--muted)' }} />
                    <Typography sx={{ fontSize: TS.body, fontWeight: 600 }}>
                      {method.display_name}
                    </Typography>
                  </Stack>
                }
              />
            )
          })}
        </RadioGroup>
        {error ? (
          <Typography sx={{ fontSize: TS.label, color: 'var(--red)', mt: 0.5 }}>
            {t(error as Parameters<typeof t>[0])}
          </Typography>
        ) : null}
      </FormControl>

      {selected?.instructions ? (
        <Alert severity="info" icon={false} sx={{ borderRadius: 'var(--sf-radius-sm)' }}>
          <Typography sx={{ fontSize: TS.label, fontWeight: 800, mb: 0.25 }}>
            {t('store.payment.instructions')}
          </Typography>
          {/* `pre-wrap`: las instrucciones de una transferencia son varias
              líneas —banco, número, titular— y aplastarlas en un párrafo obliga
              a leerlas con lupa justo cuando hay que copiarlas. */}
          <Box sx={{ fontSize: TS.body, whiteSpace: 'pre-wrap' }}>{selected.instructions}</Box>
        </Alert>
      ) : null}
    </Stack>
  )
}
