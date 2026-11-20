import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { offerBadge, vigenciaTexto } from '../offer'
import { promotionHref, type StorePromotion } from '../promotions'

/**
 * Rediseño v3 · Las campañas de UNIVERSAL (lámina «Universal · Home»): hasta
 * tres tarjetas lado a lado, cada una con su tono —la de la marca, la de
 * servicio y la de oferta—, su icono, su vigencia, el nombre y el texto. Toda
 * la tarjeta lleva a los productos de la campaña.
 *
 * Los tonos no inventan color: el primero es el acento del tenant; los otros
 * dos, los semánticos de la vitrina (verde de servicio y amarillo de oferta),
 * rebajados a fondo.
 */
const TONOS = [
  { bg: 'var(--accent-deep)', fg: '#FFFFFF', chip: 'rgba(255,255,255,.16)' },
  { bg: 'color-mix(in srgb, var(--sf-ok) 12%, var(--card))', fg: 'var(--text)', chip: 'var(--card)' },
  { bg: 'color-mix(in srgb, var(--sf-deal) 30%, var(--card))', fg: 'var(--text)', chip: 'var(--card)' },
] as const

export function PromoUniversal({
  promotions,
  storeSlug,
  currency,
}: {
  promotions: readonly StorePromotion[]
  storeSlug: string
  currency: string
}) {
  const { t, locale } = useI18n()
  const tres = promotions.slice(0, 3)
  if (tres.length === 0) return null

  return (
    <Box
      component="section"
      id="ofertas"
      aria-label={t('store.promos.title')}
      data-promotions-presentation="universal"
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: `repeat(${tres.length}, minmax(0, 1fr))` },
        scrollMarginTop: 96,
      }}
    >
      {tres.map((promo, i) => {
        const tono = TONOS[i % TONOS.length]!
        const badge = offerBadge(promo, t, locale, currency)
        const vigencia = vigenciaTexto(promo.endsAt, t, locale)
        const destino = promotionHref(promo, storeSlug)
        return (
          <Stack
            key={promo.id}
            direction="row"
            sx={{
              position: 'relative',
              alignItems: 'center',
              gap: 2,
              p: { xs: 2.5, md: 3 },
              minHeight: 120,
              borderRadius: 'var(--sf-radius)',
              bgcolor: tono.bg,
              color: tono.fg,
              '&:has(a:focus-visible)': { outline: '2px solid var(--accent)', outlineOffset: 2 },
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 44,
                height: 44,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: tono.chip,
              }}
            >
              <LocalOfferRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Stack sx={{ minWidth: 0, gap: 0.25 }}>
              {badge || vigencia ? (
                <Stack
                  direction="row"
                  sx={{ gap: 0.75, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.85 }}
                >
                  {badge ? <span>{badge}</span> : null}
                  {vigencia ? <span>{vigencia.texto}</span> : null}
                </Stack>
              ) : null}
              <Typography component="h3" sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25 }}>
                {promo.name}
              </Typography>
              {promo.description ? (
                <Typography sx={{ fontSize: 12.5, opacity: 0.8 }}>{promo.description}</Typography>
              ) : null}
              {/* Toda la tarjeta es la puerta (`::after`); el texto es lo que se ve. */}
              <Box
                component={Link}
                to={destino}
                sx={{
                  mt: 0.5,
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'inherit',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  '&::after': { content: '""', position: 'absolute', inset: 0 },
                  '&:focus-visible': { outline: 'none' },
                }}
              >
                {t('store.promos.see')}
              </Box>
            </Stack>
          </Stack>
        )
      })}
    </Box>
  )
}
