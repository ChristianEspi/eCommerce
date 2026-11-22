import AddShoppingCartRoundedIcon from '@mui/icons-material/AddShoppingCartRounded'
import { Box, Button, Card, CardContent, Checkbox, Chip, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useContext, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { CartContext } from '../cart/cart-context'
import { fetchMyReplenishment, type ReplenishmentItem } from '../portal'
import { addSkuLinesToCart } from '../quick-order/addBySku'
import { restockNote } from '../restockText'

/** Ventanas que puede mirar el comprador: lo de esta semana o lo del mes. */
const HORIZONTES = [7, 30] as const

interface Eleccion {
  readonly checked: boolean
  readonly quantity: string
}

/**
 * Reposición predictiva (2026-11-22): lo que el comprador compra con
 * regularidad y le toca reponer, con su motivo («sueles pedirlo cada 15 días»).
 *
 * El cálculo es de la base sobre SU historial, sin IA y sin cuota. Al aceptar,
 * las líneas van al CARRITO por el verificador del pedido rápido, con el precio
 * y el stock de hoy; lo que ya no se vende se queda fuera y se dice cuánto.
 */
export function MyRestockSection({ storeSlug, storeId }: { storeSlug: string; storeId: string }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const cart = useContext(CartContext)
  const [horizonte, setHorizonte] = useState<(typeof HORIZONTES)[number]>(7)
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({})

  const query = useQuery({
    queryKey: ['storefront', 'my-restock', storeSlug, horizonte],
    queryFn: () => fetchMyReplenishment(storeSlug, horizonte),
  })

  const items = query.data ?? []
  const eleccion = (item: ReplenishmentItem): Eleccion =>
    elecciones[item.sku] ?? { checked: true, quantity: String(item.cantidad) }
  const cambiar = (item: ReplenishmentItem, patch: Partial<Eleccion>) =>
    setElecciones((actual) => ({ ...actual, [item.sku]: { ...eleccion(item), ...patch } }))

  const seleccion = items.flatMap((item, index) => {
    const e = eleccion(item)
    const quantity = Number.parseInt(e.quantity, 10)
    if (!e.checked || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return []
    return [{ row: index + 1, sku: item.sku, quantity }]
  })

  const anadir = useMutation({
    mutationFn: async () => {
      if (!cart) throw new Error('CARRITO_NO_DISPONIBLE')
      return addSkuLinesToCart(cart, { storeId, storeSlug }, seleccion)
    },
    onSuccess: ({ result, rejected }) => {
      const entraron = result.added + result.updated + result.unchanged
      const fuera = result.skipped + rejected
      notify(
        fuera > 0
          ? t('store.restock.addedPartial').replace('{added}', String(entraron)).replace('{skipped}', String(fuera))
          : t('store.restock.added'),
        fuera > 0 ? 'warning' : 'success',
      )
      if (entraron > 0) cart?.openCart()
    },
    onError: () => notify(t('store.restock.error'), 'error'),
  })

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('store.restock.intro')}</Typography>
        <Stack direction="row" spacing={1} role="group" aria-label={t('store.restock.horizon')}>
          {HORIZONTES.map((h) => (
            <Chip
              key={h}
              label={t(h === 7 ? 'store.restock.week' : 'store.restock.month')}
              color={h === horizonte ? 'primary' : 'default'}
              variant={h === horizonte ? 'filled' : 'outlined'}
              onClick={() => setHorizonte(h)}
              aria-pressed={h === horizonte}
            />
          ))}
        </Stack>
      </Stack>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('store.restock.emptyTitle')} description={t('store.restock.empty')} />
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)' }}>
          <CardContent>
            <Stack spacing={1.5}>
              {items.map((item) => {
                const e = eleccion(item)
                const vencido = item.dias_restantes < 0
                return (
                  <Stack key={item.sku} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} data-restock-item={item.sku}>
                    <Checkbox
                      size="small"
                      checked={e.checked}
                      onChange={(event) => cambiar(item, { checked: event.target.checked })}
                      slotProps={{ input: { 'aria-label': `${t('store.intake.review.include')} · ${item.nombre}` } }}
                      sx={{ p: 0.5 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.nombre}</Typography>
                      <Typography variant="caption" sx={{ color: vencido ? 'var(--text)' : 'var(--muted)', fontWeight: vencido ? 700 : 400 }}>
                        {restockNote(t, item)}
                      </Typography>
                    </Box>
                    <Box sx={{ width: 96, flexShrink: 0 }}>
                      <Field
                        size="small"
                        label={t('store.quickOrder.field.quantity')}
                        value={e.quantity}
                        onChange={(event) => cambiar(item, { quantity: event.target.value })}
                        rule="integer"
                        maxLength={4}
                        slotProps={{ htmlInput: { 'aria-label': `${t('store.quickOrder.field.quantity')} · ${item.nombre}` } }}
                      />
                    </Box>
                  </Stack>
                )
              })}
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}>
                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{t('store.restock.priceNote')}</Typography>
                <Button
                  variant="contained"
                  startIcon={<AddShoppingCartRoundedIcon />}
                  disabled={seleccion.length === 0 || anadir.isPending || !cart}
                  onClick={() => anadir.mutate()}
                >
                  {anadir.isPending ? t('store.chat.cart.adding') : t('store.chat.cart.add').replace('{count}', String(seleccion.length))}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}
