import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import {
  Alert,
  Box,
  Button,
  FormControl,
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
  hints = {},
  onRetry,
}: {
  methods: readonly StorePaymentMethod[]
  loading: boolean
  failed: boolean
  selectedCode: string
  onSelect: (code: string) => void
  error: string | null
  /**
   * Resumen v2 · La línea bajo el nombre, por código de medio: la pone quien
   * SABE algo del comprador (p. ej. «30 días · disponible S/ 12,400» del
   * crédito de su cuenta). Sin ella, la de su familia.
   */
  hints?: Readonly<Record<string, string>>
  /** Volver a pedir los medios cuando la consulta falló. */
  onRetry?: () => void
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

  // 2026-11-19 · Que no carguen los medios es un ERROR, no una decisión del
  // comercio: decir «acuerda el pago por separado» mandaba al comprador a
  // esperar un contacto que nadie iba a hacer.
  if (failed) {
    return (
      <Alert
        severity="error"
        data-payment-load-error
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : undefined
        }
      >
        {t('store.payment.loadError')}
      </Alert>
    )
  }

  if (methods.length === 0) {
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
        {/* Resumen v2 · TARJETAS y no una lista de radios: cada medio con su
            icono, su nombre y una línea que dice qué implica. El radio sigue
            ahí —es lo que se enfoca y anuncia—, con el nombre exacto del medio
            como nombre accesible; la tarjeta entera es su `<label>`. */}
        <RadioGroup
          aria-labelledby="payment-methods"
          value={selectedCode}
          onChange={(event) => onSelect(event.target.value)}
          sx={{
            mt: 1,
            display: 'grid',
            gap: 1.25,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: `repeat(${Math.min(methods.length, 3)}, minmax(0, 1fr))`,
            },
          }}
        >
          {methods.map((method) => {
            const Icono = ICONOS[method.kind] ?? PaymentsRoundedIcon
            const activo = method.code === selectedCode
            // La de su familia solo para las familias conocidas: una clave que no
            // existe se pintaría tal cual.
            const pista =
              hints[method.code] ??
              (method.kind in ICONOS ? t(`store.payment.hint.${method.kind}` as Parameters<typeof t>[0]) : null)
            return (
              <Box
                key={method.code}
                component="label"
                data-payment-card={method.code}
                data-selected={activo ? 'true' : 'false'}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  minWidth: 0,
                  p: 1.75,
                  pr: 5,
                  borderRadius: 'var(--sf-radius-sm)',
                  border: activo ? '2px solid var(--accent)' : '1px solid var(--sf-line)',
                  bgcolor: activo ? 'var(--accent-soft)' : 'var(--card)',
                  cursor: 'pointer',
                  transition: 'border-color .15s ease, background-color .15s ease',
                  '&:hover': { borderColor: 'var(--accent)' },
                  '&:has(input:focus-visible)': { outline: '2px solid var(--accent-deep)', outlineOffset: 2 },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}
              >
                <Radio
                  value={method.code}
                  size="small"
                  inputProps={{ 'aria-label': method.display_name }}
                  sx={{ position: 'absolute', top: 6, right: 6 }}
                />
                {/* Decorativo: el nombre que va al lado ya lo dice todo. */}
                <Box
                  aria-hidden
                  sx={{
                    width: 36,
                    height: 36,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 'var(--sf-radius-sm)',
                    bgcolor: activo ? 'var(--accent)' : 'var(--neutral-soft)',
                    color: activo ? '#fff' : 'var(--muted)',
                    mb: 0.5,
                  }}
                >
                  <Icono sx={{ fontSize: 20 }} />
                </Box>
                <Typography sx={{ fontSize: TS.body, fontWeight: 800, lineHeight: 1.25 }}>
                  {method.display_name}
                </Typography>
                {pista ? (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', lineHeight: 1.35 }}>
                    {pista}
                  </Typography>
                ) : null}
              </Box>
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
