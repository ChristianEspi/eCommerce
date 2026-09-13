import AddShoppingCartRoundedIcon from '@mui/icons-material/AddShoppingCartRounded'
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useContext } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatDate } from '@/shared/lib/format'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { addLinesToCart } from '../cart/addLinesToCart'
import { CartContext } from '../cart/cart-context'
import { acceptSuggestion, discardSuggestion, fetchMySuggestions, type MySuggestion } from '../portal'

const mySuggestionsKey = () => ['my-suggestions'] as const

/**
 * Los pedidos sugeridos que la tienda le mandó a la empresa del comprador.
 *
 * ## Qué pasa al aceptar
 *
 * Las líneas van al CARRITO, no a un pedido. El comprador ve el precio y el
 * stock de hoy, cambia lo que quiera y confirma en el checkout de siempre. Es la
 * regla con la que nació el sugerido: un sistema que pide por ti se equivoca
 * por ti.
 *
 * ## Lo que no entra
 *
 * Un producto que se despublicó o se quedó sin stock desde que se generó el
 * sugerido no entra al carrito, y se dice cuántos quedaron fuera. Meterlo igual
 * sería descubrirlo en el último paso del checkout.
 */
export function MySuggestionsSection({ storeId }: { storeId: string | null }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const cart = useContext(CartContext)
  const queryClient = useQueryClient()

  const query = useQuery({ queryKey: mySuggestionsKey(), queryFn: fetchMySuggestions })

  const accept = useMutation({
    mutationFn: async (suggestion: MySuggestion) => {
      const lineas = await acceptSuggestion(suggestion.id)
      if (!cart || !storeId) return { added: 0, skipped: lineas.length }
      return addLinesToCart(cart, storeId, lineas)
    },
    onSuccess: ({ added, skipped }) => {
      notify(
        skipped > 0
          ? t('account.suggestions.addedPartial')
              .replace('{added}', String(added))
              .replace('{skipped}', String(skipped))
          : t('account.suggestions.added'),
        skipped > 0 ? 'warning' : 'success',
      )
      if (added > 0) cart?.openCart()
    },
    onError: () => notify(t('account.suggestions.error'), 'error'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: mySuggestionsKey() }),
  })

  const discard = useMutation({
    mutationFn: (suggestion: MySuggestion) => discardSuggestion(suggestion.id),
    onSuccess: () => notify(t('account.suggestions.discarded')),
    onError: () => notify(t('account.suggestions.error'), 'error'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: mySuggestionsKey() }),
  })

  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  // Los sugeridos son de UNA tienda: en esta se enseñan los de esta.
  const sugeridos = (query.data ?? []).filter((s) => !storeId || s.store_id === storeId)
  if (sugeridos.length === 0) {
    return (
      <EmptyState
        title={t('account.suggestions.empty')}
        description={t('account.suggestions.emptyBody')}
      />
    )
  }

  const ocupado = accept.isPending || discard.isPending

  return (
    <Stack spacing={2}>
      {sugeridos.map((sugerido) => (
        <Card key={sugerido.id} variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)' }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Box>
                <Typography sx={{ fontWeight: 700 }}>
                  {t('account.suggestions.for').replace('{customer}', sugerido.customer_name)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                  {t('account.suggestions.generated').replace('{date}', formatDate(sugerido.generated_at, locale))}
                </Typography>
              </Box>

              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('account.suggestions.product')}</TableCell>
                      <TableCell align="right">{t('account.suggestions.quantity')}</TableCell>
                      <TableCell>{t('account.suggestions.reason')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sugerido.items.map((item) => (
                      <TableRow key={`${item.product_id}|${item.variant_id ?? ''}`}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.name}</Typography>
                          <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{item.sku}</Typography>
                        </TableCell>
                        <TableCell align="right" className="tnum">
                          {Math.round(Number(item.quantity))}
                        </TableCell>
                        <TableCell>{item.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button onClick={() => discard.mutate(sugerido)} disabled={ocupado}>
                  {t('account.suggestions.discard')}
                </Button>
                <Button
                  variant="contained"
                  startIcon={<AddShoppingCartRoundedIcon />}
                  onClick={() => accept.mutate(sugerido)}
                  disabled={ocupado || !cart}
                >
                  {t('account.suggestions.accept')}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
        {t('account.suggestions.hint')}
      </Typography>
    </Stack>
  )
}
