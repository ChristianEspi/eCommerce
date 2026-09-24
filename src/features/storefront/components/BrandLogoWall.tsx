import { Box, Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { BrandLogo } from './BrandLogo'
import type { BrandOption } from './BrandRow'
import { SectionHeading } from './SectionHeading'

/**
 * El muro de logotipos (Storefront V3 · P07).
 *
 * ## Qué aporta sobre las tarjetas de marca
 *
 * Las tarjetas dan a cada marca su caja, su nombre en texto y su cuenta de
 * productos. Es lo correcto cuando la marca es un FILTRO: quien busca por marca
 * quiere saber cuántas referencias hay detrás.
 *
 * Un muro de logotipos no informa, **reconoce**. Quien duda de una tienda en
 * línea deja de dudar cuando ve nombres que ya conoce, y para eso el logotipo
 * tiene que estar limpio: sin caja, sin tinte y sin la cuenta al lado. Es la
 * composición que pide una tienda de marca, y por eso Premium la estrena.
 *
 * ## Lo que NO se hace con los logotipos
 *
 * **No se deforman.** `object-fit: contain` y proporción libre: un logotipo
 * estirado a un cuadrado es la identidad de otro rota en la vitrina de un
 * tercero.
 *
 * **No se pintan en gris.** Poner todos los logotipos en monocromo queda
 * ordenado y cambia la identidad de cada marca — que no es nuestra. Si algún día
 * se ofrece, será una opción explícita del comercio, no un defecto.
 *
 * **No se inventan.** La marca sin logotipo no se esconde ni se rellena con una
 * imagen de archivo: se pinta su monograma, que es lo que ya hace `BrandLogo`.
 */
export function BrandLogoWall({
  brands,
  selected,
  onSelect,
  seeAllHref,
}: {
  brands: readonly BrandOption[]
  selected: string | null
  onSelect: (code: string | null) => void
  seeAllHref?: string
}) {
  const { t } = useI18n()
  if (brands.length === 0) return null

  return (
    <Stack
      component="section"
      id="marcas"
      aria-label={t('store.brands.title')}
      data-brand-wall={brands.length}
      sx={{ gap: 1.5, scrollMarginTop: 'var(--sf-anchor-offset, 96px)' }}
    >
      {/**
       * La misma cabecera que las tarjetas, y el mismo enlace al catálogo.
       *
       * Sin `eyebrow` ni subtítulo: el muro es reconocimiento, y tres líneas de
       * texto encima de unos logotipos limpios le quitan justo lo que lo hace
       * limpio. Pero el titular y la salida al catálogo son los de siempre, para
       * que la sección no se lea como si viniera de otra página.
       */}
      <SectionHeading
        title={t('store.brands.title')}
        action={
          seeAllHref ? (
            <Button
              component={Link}
              to={seeAllHref}
              size="small"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 'var(--sf-pill)',
                border: '1px solid var(--sf-line-strong)',
                color: 'var(--text)',
                px: 1.75,
                '&:hover': { borderColor: 'var(--accent)', bgcolor: 'transparent' },
              }}
            >
              {t('store.row.seeAll')}
            </Button>
          ) : undefined
        }
      />

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 1, md: 1.5 },
          /**
           * Columnas que se adaptan al ancho, no un número fijo.
           *
           * `auto-fit` con un mínimo es lo que hace que el muro se lea con tres
           * marcas y con treinta: con un número fijo, tres marcas dejan dos
           * huecos vacíos y treinta salen a cinco por fila en un teléfono.
           */
          gridTemplateColumns: 'repeat(auto-fit, minmax(clamp(88px, 22vw, 132px), 1fr))',
          alignItems: 'stretch',
        }}
      >
        {brands.map((brand) => {
          const activa = selected === brand.code
          return (
            <Box
              key={brand.code}
              /**
               * BOTÓN que filtra, no enlace.
               *
               * Es la misma promesa que las tarjetas de marca: pulsar una marca
               * filtra la vitrina que ya se está mirando —`onSelect` escribe
               * `?b=` en la URL, así que el filtro se comparte y el botón de
               * atrás lo deshace— y volver a pulsarla la suelta. Un `<a>` con
               * `aria-pressed` sería mentir al lector de pantalla sobre las dos
               * cosas: que lleva a otro sitio y que no se apaga.
               *
               * La salida al catálogo completo existe, pero está arriba, en la
               * cabecera, donde también la tienen las tarjetas.
               */
              component="button"
              type="button"
              aria-pressed={activa}
              onClick={() => onSelect(activa ? null : brand.code)}
              data-brand-tile={brand.code}
              sx={{
                display: 'grid',
                placeItems: 'center',
                gap: 0.5,
                px: 1,
                py: 1.25,
                minHeight: 76,
                border: '1px solid',
                // Sin caja cuando hay logotipo de verdad: la caja compite con
                // la identidad que la marca ya trae. Se marca solo la activa y
                // el foco, que sí tienen que verse.
                borderColor: activa ? 'var(--accent)' : 'transparent',
                borderRadius: 'var(--sf-radius-sm)',
                bgcolor: activa ? 'var(--accent-soft)' : 'transparent',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
                textDecoration: 'none',
                transition: 'border-color .15s ease, background-color .15s ease',
                '@media (hover: hover)': {
                  '&:hover': { borderColor: 'var(--sf-line-strong)' },
                },
                '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            >
              <BrandLogo name={brand.name} url={brand.logoUrl ?? null} size={44} marco="limpio" />
              {/**
               * El nombre, pequeño y debajo.
               *
               * Con logotipo es una ayuda —no todos los logotipos se leen a 44
               * px— y sin logotipo es lo único que identifica la marca, porque
               * el monograma son dos letras. En las dos situaciones hace falta,
               * así que no se esconde por tener imagen.
               */}
              <Typography
                sx={{
                  fontSize: TS.label,
                  fontWeight: 700,
                  textAlign: 'center',
                  color: activa ? 'var(--accent-deep)' : 'var(--muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}
              >
                {brand.name}
              </Typography>
              {/* Y no va la cuenta de productos: en un muro de reconocimiento,
                  «12 productos» es ruido. Quien quiera ese dato lo tiene en el
                  catálogo, donde la marca sí es un filtro. */}
            </Box>
          )
        })}
      </Box>
    </Stack>
  )
}
