import { Alert, Button, Stack, TextField } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { fetchGiftCardBalance, giftCardProblem } from './giftCards'

/**
 * Tarjeta de regalo en la caja (2026-11-12).
 *
 * Mismo gesto que el cupón: el código y un botón al lado. «Consultar saldo»
 * solo ENSEÑA lo que hay; cuánto se usa lo decide el checkout al cobrar —como
 * mucho el total, y el resto va al medio de pago elegido—. Si no se consulta,
 * el código viaja igual y el servidor lo valida al pagar.
 */
export function GiftCardField({
  storeSlug,
  registration,
  readCode,
  errorKey,
}: {
  storeSlug: string
  registration: UseFormRegisterReturn
  readCode: () => string
  errorKey: MessageKey | null
}) {
  const { t, locale } = useI18n()
  const check = useMutation({ mutationFn: (code: string) => fetchGiftCardBalance(storeSlug, code) })

  const card = check.data
  const problem = card ? giftCardProblem(card) : null

  return (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: 'stretch' }}>
        <TextField
          fullWidth
          label={t('store.checkout.giftCard')}
          placeholder={t('store.checkout.giftCardPlaceholder')}
          error={Boolean(errorKey)}
          {...(errorKey ? { helperText: t(errorKey) } : {})}
          autoComplete="off"
          slotProps={{ htmlInput: { style: { textTransform: 'uppercase' }, maxLength: 40 } }}
          {...registration}
          onChange={(event) => {
            check.reset()
            void registration.onChange(event)
          }}
        />
        <Button
          type="button"
          variant="outlined"
          disabled={check.isPending}
          onClick={() => {
            const code = readCode().trim()
            if (code !== '') check.mutate(code)
          }}
          sx={{ fontWeight: 800, flexShrink: 0, px: 2.5 }}
        >
          {t('store.checkout.giftCardCheck')}
        </Button>
      </Stack>

      {check.isError && <Alert severity="warning">{t('store.checkout.giftCard.unavailable')}</Alert>}
      {card && problem && <Alert severity="warning">{t(problem)}</Alert>}
      {card && !problem && (
        <Alert severity="success" data-gift-card-balance>
          {t('store.checkout.giftCard.ready')
            .replace('{last4}', card.last4 ?? '')
            .replace('{amount}', formatMoney(Number(card.balance ?? '0'), card.currency ?? 'PEN', locale))}
        </Alert>
      )}
    </Stack>
  )
}
