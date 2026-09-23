import { Box, Stack, Typography } from '@mui/material'
import { SectionHeading } from './SectionHeading'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { initials } from '../branding'
import { tintFor } from '../tint'

/**
 * Las marcas del catálogo, al cierre de la portada.
 *
 * No es la fila de «Compra por marca» —esa es navegación, con su contador y su
 * filtro—: esto es reconocimiento. Quien duda de una tienda en línea deja de
 * dudar cuando ve nombres que ya conoce, y por eso va abajo, que es donde se
 * decide comprar o cerrar.
 *
 * Sale de las MARCAS REALES del catálogo, en orden de tamaño: nadie mantiene
 * una lista de logos aparte, y una lista escrita a mano acabaría enseñando una
 * marca que la tienda dejó de vender.
 *
 * ## Lo que ya NO lleva, y por qué
 *
 * Tenía una pastilla fija con «Productos originales». Es una afirmación sobre
 * la cadena de suministro de OTRO, escrita por la plataforma y puesta en todas
 * las tiendas por igual — incluidas las que revenden, las que fabrican y las
 * que no pueden sostenerla. Un comercio que quiera decirlo lo dice desde sus
 * propuestas de valor (`store_settings.value_props`), donde el texto es suyo y
 * solo sale en su tienda.
 */
export function BrandTrustStrip({
  brands,
  storeSlug,
}: {
  brands: readonly { code: string; name: string }[]
  storeSlug: string
}) {
  const { t } = useI18n()
  if (brands.length === 0) return null

  return (
    <Stack
      component="section"
      aria-label={t('store.trust.title')}
      sx={{
        gap: 1.5,
        p: { xs: 2, md: 3 },
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        // El cierre de la portada era una barra blanca con nombres en gris: lo
        // ultimo que se veia antes del pie parecia ya el pie. Con el acento del
        // comercio de fondo, el remate se lee como remate.
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--card)) 0%, color-mix(in srgb, var(--accent2) 8%, var(--card)) 100%)',
      }}
    >
      <SectionHeading title={t('store.trust.title')} subtitle={t('store.trust.subtitle')} />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1, md: 1.25 } }}>
      {brands.slice(0, 8).map((brand) => {
        const tinte = tintFor(brand.name)
        return (
          <Box
            key={brand.code}
            component={Link}
            to={`/s/${storeSlug}?b=${encodeURIComponent(brand.code)}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.875,
              px: 1.25,
              py: 0.875,
              borderRadius: 'var(--sf-pill)',
              bgcolor: 'var(--card)',
              border: '1px solid var(--sf-line)',
              textDecoration: 'none',
              color: 'var(--text)',
              transition: 'transform .18s ease, border-color .18s ease, box-shadow .18s ease',
              '@media (hover: hover)': {
                '&:hover': {
                  transform: 'translateY(-2px)',
                  borderColor: tinte.fg,
                  boxShadow: 'var(--sf-shadow-hover)',
                },
              },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
                '&:hover': { transform: 'none' },
              },
            }}
          >
            {/* Mientras la marca no traiga logo, sus iniciales sobre su tinte:
                una fila de nombres en gris no se distingue de un pie de página,
                y lo que aquí hace falta es RECONOCER de un vistazo. */}
            <Box
              aria-hidden
              sx={{
                width: 30,
                height: 30,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: tinte.fg,
                color: tinte.bg,
                fontSize: 11,
                fontWeight: 800,
                boxShadow: `0 6px 14px -8px ${tinte.fg}`,
              }}
            >
              {initials(brand.name)}
            </Box>
            <Typography sx={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {brand.name}
            </Typography>
          </Box>
        )
      })}
      </Box>
    </Stack>
  )
}
