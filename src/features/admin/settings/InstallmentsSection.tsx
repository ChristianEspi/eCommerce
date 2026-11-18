import { Button, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { installmentFor, type StoreInstallments } from '@/features/storefront/productDetail'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { useFeedback } from '@/shared/ui/feedback-context'
import { useSaveStoreInstallments, useStoreInstallments } from './installments'

/**
 * Cuotas sin intereses que anuncia la ficha (2026-10-13 · migración
 * 20261013100000): «o 3 cuotas de S/ 7.30 sin intereses con Tarjeta Andes».
 *
 * Su propio guardado, como «Atención y datos legales»: una columna de
 * `store_settings` que no depende del formulario principal. La plataforma no
 * cobra en cuotas: esto ANUNCIA lo que el medio de pago del comercio ofrece, y
 * por eso pide el nombre del medio y un mínimo.
 */
export function InstallmentsSection({ storeId, canManage }: { storeId: string | null; canManage: boolean }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const current = useStoreInstallments(storeId)
  const guardar = useSaveStoreInstallments(storeId)

  const [enabled, setEnabled] = useState(false)
  const [count, setCount] = useState('3')
  const [provider, setProvider] = useState('')
  const [minAmount, setMinAmount] = useState('')

  useEffect(() => {
    if (current.data === undefined) return
    setEnabled(current.data !== null)
    setCount(String(current.data?.count ?? 3))
    setProvider(current.data?.provider ?? '')
    setMinAmount(current.data?.min_amount !== undefined ? String(current.data.min_amount) : '')
  }, [current.data])

  const cuotas = Number(count)
  const minimo = minAmount.trim() === '' ? undefined : Number(minAmount)
  const valido =
    !enabled ||
    (Number.isInteger(cuotas) &&
      cuotas >= 2 &&
      cuotas <= 36 &&
      provider.trim().length <= 60 &&
      (minimo === undefined || (Number.isFinite(minimo) && minimo >= 0)))
  const valor: StoreInstallments | null = enabled
    ? {
        count: cuotas,
        ...(provider.trim() ? { provider: provider.trim() } : {}),
        ...(minimo !== undefined ? { min_amount: minimo } : {}),
      }
    : null

  const save = {
    isPending: guardar.isPending,
    mutate: () =>
      guardar.mutate(valor, {
        onSuccess: () => notify(t('settings.installments.saved'), 'success'),
        onError: () => notify(t('settings.installments.error'), 'error'),
      }),
  }

  const ejemplo = installmentFor(valido ? valor : null, 100)
  const busy = !canManage || save.isPending

  return (
    <Stack sx={{ gap: 2 }}>
      <FormControlLabel
        control={<Switch checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />}
        label={t('settings.installments.enabled')}
      />
      {enabled ? (
        <Stack sx={{ gap: 2, maxWidth: 640 }}>
            <TextField
              fullWidth
              type="number"
              label={t('settings.installments.count')}
              value={count}
              disabled={busy}
              inputProps={{ min: 2, max: 36, step: 1 }}
              error={!(Number.isInteger(cuotas) && cuotas >= 2 && cuotas <= 36)}
              onChange={(event) => setCount(event.target.value)}
            />
            <TextField
              fullWidth
              label={t('settings.installments.provider')}
              placeholder={t('settings.installments.providerPlaceholder')}
              value={provider}
              disabled={busy}
              inputProps={{ maxLength: 60 }}
              onChange={(event) => setProvider(event.target.value)}
            />
            <TextField
              fullWidth
              type="number"
              label={t('settings.installments.min')}
              helperText={t('common.optional')}
              value={minAmount}
              disabled={busy}
              inputProps={{ min: 0, step: '0.01' }}
              onChange={(event) => setMinAmount(event.target.value)}
            />
        </Stack>
      ) : null}
      {ejemplo ? (
        <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('settings.installments.example')
            .replace('{count}', String(ejemplo.count))
            .replace('{amount}', formatMoney(ejemplo.amount, 'PEN', locale))}
        </Typography>
      ) : null}
      <Stack direction="row">
        <Button variant="contained" disabled={busy || !valido} onClick={() => save.mutate()}>
          {t('settings.installments.save')}
        </Button>
      </Stack>
    </Stack>
  )
}
