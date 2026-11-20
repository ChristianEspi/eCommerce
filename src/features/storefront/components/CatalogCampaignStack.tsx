import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { offerBadge, vigenciaTexto } from '../offer'
import { promotionHref, type StorePromotion } from '../promotions'

/**
 * Las campañas AL LADO de la oferta destacada (tema Catálogo, propuesta 29).
 *
 * Antes Catálogo apilaba dos carruseles: la oferta destacada y, debajo, las
 * campañas de una en una con media tarjeta en blanco. Con pocas campañas —el
 * caso normal de una tienda que empieza— eso era alto de página sin contenido.
 * Aquí comparten fila: hasta dos campañas en una columna, cada una con su foto,
 * cuánto descuenta, hasta cuándo y su puerta. Las que no caben siguen en la
 * sección de campañas, más abajo.
 *
 * La primera va sobre el fondo invertido y la segunda sobre el tinte del
 * acento: dos pesos para dos campañas, sin un color que no sea de la tienda.
 */
export const CAMPANAS_EN_PORTADA_CATALOGO = 2

export function CatalogCampaignStack({
  promotions,
  storeSlug,
  currency,
  assets = {},
}: {
  promotions: readonly StorePromotion[]
  storeSlug: string
  currency: string
  assets?: Record<string, string>
}) {
  const { t } = useI18n()
  const visibles = promotions.slice(0, CAMPANAS_EN_PORTADA_CATALOGO)
  if (visibles.length === 0) return null

  return (
    <Stack
      component="section"
      aria-label={t('store.promos.title')}
      data-catalog-campaigns={visibles.length}
      sx={{ gap: { xs: 1.5, md: 2 }, height: '100%' }}
    >
      {visibles.map((promo, indice) => (
        <Campana
          key={promo.id}
          promo={promo}
          storeSlug={storeSlug}
          currency={currency}
          oscuro={indice === 0}
          imageSrc={fuenteDe(promo.imageUrl, assets)}
        />
      ))}
    </Stack>
  )
}

function fuenteDe(referencia: string | null, firmadas: Record<string, string>) {
  if (!referencia) return null
  if (/^https?:\/\//i.test(referencia)) return referencia
  return firmadas[referencia] ?? null
}

function Campana({
  promo,
  storeSlug,
  currency,
  oscuro,
  imageSrc,
}: {
  promo: StorePromotion
  storeSlug: string
  currency: string
  oscuro: boolean
  imageSrc: string | null
}) {
  const { t, locale } = useI18n()
  const badge = offerBadge(promo, t, locale, currency)
  const vigencia = vigenciaTexto(promo.endsAt, t, locale)
  const destino = promotionHref(promo, storeSlug)

  return (
    <Stack
      direction="row"
      data-catalog-campaign={oscuro ? 'contrast' : 'soft'}
      sx={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        alignItems: 'center',
        gap: 2,
        p: { xs: 1.5, md: 2 },
        minHeight: 132,
        borderRadius: 'var(--sf-radius)',
        bgcolor: oscuro ? 'var(--text)' : 'var(--sf-soft, var(--neutral-soft))',
        color: oscuro ? 'var(--card)' : 'var(--text)',
        border: '1px solid',
        borderColor: oscuro ? 'transparent' : 'var(--sf-line)',
        transition: 'box-shadow .2s ease, transform .2s ease',
        '&:hover': { boxShadow: 'var(--sf-shadow-hover)', transform: 'translateY(-1px)' },
        '&:has(a:focus-visible)': { outline: '2px solid var(--accent)', outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          alt=""
          loading="lazy"
          sx={{
            alignSelf: 'stretch',
            width: { xs: 88, md: 112 },
            minHeight: 96,
            objectFit: 'cover',
            borderRadius: 'var(--sf-radius-sm)',
            flexShrink: 0,
          }}
        />
      ) : null}

      <Stack sx={{ flex: 1, minWidth: 0, gap: 0.5, alignItems: 'flex-start' }}>
        {badge ? (
          <Box
            sx={{
              px: 1,
              py: 0.25,
              borderRadius: 'var(--sf-radius-sm)',
              // El acento profundo con blanco, como los botones de la vitrina:
              // se lee con el color de cualquier tienda, no solo con el claro.
              bgcolor: 'var(--accent-deep)',
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 800,
            }}
          >
            {badge}
          </Box>
        ) : null}
        <Typography
          component="h3"
          sx={{
            fontSize: { xs: 16, md: 17 },
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {promo.name}
        </Typography>
        {vigencia ? (
          <Typography sx={{ fontSize: 12.5, opacity: 0.8 }}>{vigencia.texto}</Typography>
        ) : null}
        <Box
          component={Link}
          to={destino}
          aria-label={`${t('store.promos.see')}: ${promo.name}`}
          sx={{
            mt: 0.25,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: 13.5,
            fontWeight: 800,
            color: oscuro ? 'color-mix(in srgb, var(--accent) 55%, #fff)' : 'var(--accent-deep)',
            textDecoration: 'none',
            // Toda la tarjeta es la puerta; el enlace es solo lo que se ve.
            '&::after': { content: '""', position: 'absolute', inset: 0 },
            '&:focus-visible': { outline: 'none' },
          }}
        >
          {t('store.promos.see')}
          <ArrowForwardRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
        </Box>
      </Stack>
    </Stack>
  )
}
