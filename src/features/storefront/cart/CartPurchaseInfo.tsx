import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import PhoneIphoneRoundedIcon from '@mui/icons-material/PhoneIphoneRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Box, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { useI18n } from '@/shared/i18n/i18n-context'
import { PUBLIC_DELIVERY_METHODS_VIEW } from '@/shared/lib/db-schema'
import { TS } from '@/theme/tokens'
import { storefrontClient } from '../api'
import { usePaymentMethods } from '../payment'
import { useCommerceContext } from '../commerce/context'
import { useSessionContext } from '@/features/auth/session-context'

/**
 * Cómo se paga y cómo llega, ANTES de ir al pago (2026-10-05).
 *
 * El comprador decidía a ciegas: los medios de pago y las formas de envío solo
 * aparecían dentro del checkout, después de escribir sus datos. Aquí se dicen
 * en el resumen del carrito, como información:
 *
 *  - **Medios de pago** — los activos de la tienda (`public_payment_methods`).
 *  - **Envíos** — las formas de entrega con su plazo (`public_delivery_methods`,
 *    la vista pensada para pintarlas ANTES de tener dirección). El IMPORTE no
 *    se adelanta: depende de la dirección y lo calcula el servidor en el pago;
 *    inventar una ciudad para enseñar un precio sería enseñar uno que no es.
 *
 * Si la tienda no tiene configurado uno de los dos, ese bloque no sale.
 */
const deliveryMethodSchema = z.object({
  delivery_method_id: z.string().uuid(),
  display_name: z.string().min(1),
  description: z.string().nullable().default(null),
  strategy: z.string(),
  lead_time_min_days: z.number().int().nullable().default(null),
  lead_time_max_days: z.number().int().nullable().default(null),
})
type DeliveryMethod = z.infer<typeof deliveryMethodSchema>

function useStoreDeliveryMethods(storeId: string) {
  return useQuery({
    queryKey: ['storefront', 'delivery-methods', storeId] as const,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<DeliveryMethod[]> => {
      const { data, error } = await storefrontClient()
        .from(PUBLIC_DELIVERY_METHODS_VIEW)
        .select('delivery_method_id, display_name, description, strategy, lead_time_min_days, lead_time_max_days')
        .eq('store_id', storeId)
        .order('position', { ascending: true })
      if (error) throw new Error('DELIVERY_METHODS_FAILED')
      return z.array(deliveryMethodSchema).parse(data ?? [])
    },
  })
}

const ICONO_PAGO: Record<string, ReactNode> = {
  bank_transfer: <AccountBalanceRoundedIcon fontSize="inherit" />,
  wallet: <PhoneIphoneRoundedIcon fontSize="inherit" />,
  cash: <PaymentsRoundedIcon fontSize="inherit" />,
  card: <CreditCardRoundedIcon fontSize="inherit" />,
}

export function CartPurchaseInfo({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const { t } = useI18n()
  const pagos = usePaymentMethods(storeId)
  const envios = useStoreDeliveryMethods(storeId)
  // Igual que el checkout: «Crédito empresa» solo para una cuenta con línea.
  const { status } = useSessionContext()
  const { context } = useCommerceContext(storeSlug, status === 'authenticated')
  const conCredito = context?.has_credit_terms === true
  const medios = (pagos.data ?? []).filter((medio) => medio.kind !== 'credit' || conCredito)
  const formas = envios.data ?? []
  if (medios.length === 0 && formas.length === 0) return null

  const plazo = (m: DeliveryMethod) => {
    const { lead_time_min_days: min, lead_time_max_days: max } = m
    if (min === null && max === null) return null
    if (max === null || min === max) {
      const n = min ?? max
      return n === 1 ? t('store.cart.info.oneDay') : t('store.cart.info.days').replace('{n}', String(n))
    }
    if (min === null || min === 0) return t('store.cart.info.upToDays').replace('{n}', String(max))
    return t('store.cart.info.daysRange').replace('{min}', String(min)).replace('{max}', String(max))
  }

  return (
    <Stack className="sf-cart-info" data-cart-info sx={{ gap: 2, mt: 2.5, pt: 2.5, borderTop: '1px solid var(--border)' }}>
      {medios.length > 0 ? (
        <Box component="section" aria-labelledby="sf-cart-info-pagos">
          <Typography id="sf-cart-info-pagos" component="h3" sx={titulo}>
            {t('store.cart.info.payments')}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
            {medios.map((medio) => (
              <Box
                key={medio.payment_method_id}
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.6,
                  px: 1.1,
                  py: 0.45,
                  borderRadius: 'var(--sf-pill, 999px)',
                  border: '1px solid var(--sf-line, var(--border))',
                  bgcolor: 'var(--card)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  '& svg': { fontSize: 16, color: 'var(--muted)' },
                }}
              >
                {ICONO_PAGO[medio.kind] ?? <PaymentsRoundedIcon fontSize="inherit" />}
                {medio.display_name}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}

      {formas.length > 0 ? (
        <Box component="section" aria-labelledby="sf-cart-info-envios">
          <Typography id="sf-cart-info-envios" component="h3" sx={titulo}>
            {t('store.cart.info.shipping')}
          </Typography>
          <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1, gap: 0.9 }}>
            {formas.map((forma) => {
              const cuando = plazo(forma)
              return (
                <Stack component="li" key={forma.delivery_method_id} direction="row" sx={{ gap: 1, alignItems: 'flex-start' }}>
                  <Box sx={{ color: 'var(--muted)', lineHeight: 0, mt: '2px', '& svg': { fontSize: 18 } }} aria-hidden>
                    {forma.strategy === 'pickup' ? <StorefrontRoundedIcon /> : <LocalShippingRoundedIcon />}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>
                      {forma.display_name}
                      {cuando ? (
                        <Box component="span" sx={{ fontWeight: 500, color: 'var(--muted)' }}>
                          {` · ${cuando}`}
                        </Box>
                      ) : null}
                    </Typography>
                    {forma.description ? (
                      <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>{forma.description}</Typography>
                    ) : null}
                  </Box>
                </Stack>
              )
            })}
          </Stack>
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 1.25 }}>{t('store.cart.info.shippingNote')}</Typography>
        </Box>
      ) : null}
    </Stack>
  )
}

const titulo = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text)',
} as const
