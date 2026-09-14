import AddShoppingCartRoundedIcon from '@mui/icons-material/AddShoppingCartRounded'
import {
  Alert,
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
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { StatusChip, type StatusTone } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { addLinesToCart } from '../cart/addLinesToCart'
import { CartContext } from '../cart/cart-context'
import {
  acceptQuote,
  fetchMyQuotes,
  isAcceptable,
  mapQuoteCode,
  myQuotesKey,
  quoteCartBlocker,
  quoteErrorCode,
  type MyQuote,
  type QuoteStatus,
} from '../quotes'

const STATUS_TONE: Record<QuoteStatus, StatusTone> = {
  requested: 'info',
  sent: 'warning',
  accepted: 'success',
  rejected: 'default',
  expired: 'default',
}

const STATUS_LABEL: Record<QuoteStatus, MessageKey> = {
  requested: 'account.quotes.status.requested',
  sent: 'account.quotes.status.sent',
  accepted: 'account.quotes.status.accepted',
  rejected: 'account.quotes.status.rejected',
  expired: 'account.quotes.status.expired',
}

/**
 * Las cotizaciones del comprador en esta tienda (cierre A3).
 *
 * ## Qué pasa al aceptar
 *
 * El precio cotizado pasa a ser un acuerdo del motor y las líneas van al
 * CARRITO, no a un pedido. El comprador confirma en el checkout de siempre y
 * cobra lo cotizado. Es la misma regla que los sugeridos: nada pide por él.
 *
 * ## Por qué a veces no se ofrece
 *
 * El acuerdo exige la cantidad cotizada, y el carrito de la vitrina recorta cada
 * línea y no guarda presentación. Una cotización que no cabe tal cual se enseña
 * con el motivo y SIN botón: aceptarla crearía un acuerdo que el carrito no
 * puede usar y el pedido saldría a precio de catálogo sin que nadie lo notara.
 */
export function MyQuotesSection({ storeSlug, storeId }: { storeSlug: string; storeId: string | null }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const cart = useContext(CartContext)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: myQuotesKey(storeSlug),
    queryFn: () => fetchMyQuotes(storeSlug),
    enabled: storeSlug !== '',
  })

  const accept = useMutation({
    mutationFn: async (quote: MyQuote) => {
      const accepted = await acceptQuote(quote.quote_id)
      if (!cart || !storeId) return { added: 0, skipped: accepted.lines.length }
      return addLinesToCart(cart, storeId, accepted.lines)
    },
    onSuccess: ({ added, skipped }) => {
      notify(
        skipped > 0
          ? t('account.quotes.addedPartial').replace('{added}', String(added)).replace('{skipped}', String(skipped))
          : t('account.quotes.added'),
        skipped > 0 ? 'warning' : 'success',
      )
      if (added > 0) cart?.openCart()
    },
    onError: (error) => notify(t(mapQuoteCode(quoteErrorCode(error))), 'error'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: myQuotesKey(storeSlug) }),
  })

  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const quotes = query.data ?? []
  if (quotes.length === 0) {
    return <EmptyState title={t('account.quotes.empty')} description={t('account.quotes.emptyBody')} />
  }

  return (
    <Stack spacing={2}>
      {quotes.map((quote) => {
        const blocker = quoteCartBlocker(quote)
        const acceptable = isAcceptable(quote)
        return (
          <Card key={quote.quote_id} variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)' }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>{quote.quote_number}</Typography>
                    <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                      {t('account.quotes.validUntil').replace('{date}', formatDate(quote.valid_until, locale))}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <StatusChip label={t(STATUS_LABEL[quote.status])} tone={STATUS_TONE[quote.status]} />
                    <Typography className="tnum" sx={{ fontWeight: 700 }}>
                      {formatMoney(Number(quote.grand_total), quote.currency, locale)}
                    </Typography>
                  </Stack>
                </Stack>

                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('account.quotes.product')}</TableCell>
                        <TableCell align="right">{t('account.quotes.quantity')}</TableCell>
                        <TableCell align="right">{t('account.quotes.unitPrice')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {quote.items.map((item) => (
                        <TableRow key={`${item.product_id}|${item.variant_id ?? ''}|${item.uom_code ?? ''}`}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell align="right" className="tnum">
                            {Number(item.quantity)}
                          </TableCell>
                          <TableCell align="right" className="tnum">
                            {formatMoney(Number(item.unit_price), quote.currency, locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>

                {quote.status === 'requested' && (
                  <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                    {t('account.quotes.requestedHint')}
                  </Typography>
                )}

                {acceptable && blocker && (
                  <Alert severity="info">
                    {t(blocker === 'tooLarge' ? 'account.quotes.blocked.tooLarge' : 'account.quotes.blocked.presentation')}
                  </Alert>
                )}

                {acceptable && !blocker && (
                  <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                    <Button
                      variant="contained"
                      startIcon={<AddShoppingCartRoundedIcon />}
                      onClick={() => accept.mutate(quote)}
                      // Ocupado mientras hay UNA aceptación en curso, sea de esta
                      // o de otra: el servidor es idempotente, pero dos carritos
                      // rellenándose a la vez confunden a cualquiera.
                      disabled={accept.isPending || !cart || !storeId}
                    >
                      {t(quote.status === 'accepted' ? 'account.quotes.addAgain' : 'account.quotes.accept')}
                    </Button>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        )
      })}
      <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
        {t('account.quotes.hint')}
      </Typography>
    </Stack>
  )
}
