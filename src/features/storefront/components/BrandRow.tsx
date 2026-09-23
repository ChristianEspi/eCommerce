import { Box, Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { tintFor } from '../tint'
import { BrandLogo } from './BrandLogo'
import { LoopingRow } from './LoopingRow'
import { SectionHeading } from './SectionHeading'

export interface BrandOption {
  readonly code: string
  readonly name: string
  readonly count: number | null
  /**
   * Logo YA firmado, o `null` si la marca no tiene (Storefront V2 · P02).
   *
   * Llega firmado y no como ruta a propósito: firmar aquí serían tantas
   * peticiones como marcas. La portada firma el lote entero de una vez y
   * reparte — ver `usePublicBrands` y `useSignedStoreAssets`.
   */
  readonly logoUrl?: string | null
}

/**
 * Las marcas de la tienda, como puerta de entrada.
 *
 * Se compra por marca tanto como por categoría: quien busca una marca concreta
 * no busca su familia, busca esa marca. Estaban solo dentro del panel lateral
 * de filtros, que es donde va quien YA está filtrando — y en móvil queda debajo
 * del catálogo, o sea, después de haber recorrido todo.
 *
 * Sale de las FACETAS de la búsqueda, no de una lista aparte: así solo aparecen
 * las marcas que de verdad tienen producto publicado ahora, con cuántos, y
 * nadie tiene que mantener una segunda lista que se queda vieja.
 */
export function BrandRow({
  brands,
  selected,
  onSelect,
  seeAllHref,
}: {
  brands: readonly BrandOption[]
  selected: string | null
  onSelect: (code: string | null) => void
  /** Puerta al catálogo completo, si esta fila la necesita. */
  seeAllHref?: string
}) {
  const { t } = useI18n()
  if (brands.length === 0) return null

  return (
    <Stack
      component="section"
      // Destino del enlace «Marcas». `scroll-margin` por la cabecera pegajosa.
      id="marcas"
      aria-label={t('store.brands.title')}
      sx={{
        gap: 1.25,
        scrollMarginTop: 96,
        // La mitad de abajo de la portada se habia quedado en «listas sueltas
        // sobre blanco» mientras la de arriba ya tenia bandas con fondo. Un
        // panel tenido —el mismo tinte flojo que usan las secciones del CMS—
        // le da a las marcas el peso que de verdad tienen: se entra por marca
        // tanto como por familia.
        p: { xs: 1.75, md: 2.5 },
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--accent2) 8%, transparent) 0%, transparent 100%)',
      }}
    >
      <SectionHeading
        title={t('store.brands.title')}
        eyebrow={t('store.brands.eyebrow')}
        subtitle={t('store.brands.subtitle')}
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

      {/* Gira sola, como las puertas de categoria. Un catalogo con cuarenta
          marcas enseñaba seis y las otras treinta y cuatro solo existian para
          quien se molestara en empujar la fila. */}
      <LoopingRow
        items={brands}
        keyOf={(brand) => brand.code}
        itemWidth={190}
        gap={1}
        ariaLabel={t('store.brands.title')}
        render={(brand, duplicada) => {
          const activa = selected === brand.code
          const tinte = tintFor(brand.name)
          return (
            <Box
              component="button"
              {...(duplicada ? { tabIndex: -1 } : {})}
              type="button"
              aria-pressed={activa}
              onClick={() => onSelect(activa ? null : brand.code)}
              sx={{
                cursor: 'pointer',
                flexShrink: 0,
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 1.5,
                py: 1.25,
                // El ancho lo fija el hueco de `LoopingRow`, del que depende
                // la mitad exacta que hace el bucle.
                width: '100%',
                borderRadius: 'var(--sf-radius)',
                // Elegida: manda el acento del comercio, que es el color de lo
                // que esta ACTIVO. Sin elegir: su propio tinte, para que la
                // fila se lea de lado y cada marca tenga sitio propio.
                border: activa ? '1px solid var(--accent)' : `1px solid ${tinte.line}`,
                bgcolor: activa ? 'color-mix(in srgb, var(--accent) 12%, var(--card))' : tinte.bg,
                boxShadow: 'var(--sf-shadow)',
                transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
                '@media (hover: hover)': {
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 'var(--sf-shadow-hover)',
                    borderColor: activa ? 'var(--accent)' : tinte.fg,
                  },
                },
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                  '&:hover': { transform: 'none' },
                },
              }}
            >
              {/* El logo REAL de la marca si lo tiene, y su monograma si no.
                  El día que la marca trae logo entra aquí sin mover nada: el
                  hueco es del mismo tamaño en los dos casos, así que la fila no
                  cambia de alto al cargar las imágenes. Ver `BrandLogo`. */}
              <BrandLogo name={brand.name} url={brand.logoUrl ?? null} size={40} />

              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1.25,
                    color: activa ? 'var(--accent-deep)' : tinte.fg,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {brand.name}
                </Typography>
                {/* El contador solo cuando se sabe: con un filtro puesto, el
                    resto sale a cero y ese cero significaría «no hay nada»
                    cuando en realidad significa «no te lo he contado». */}
                {brand.count === null ? null : (
                  <Typography
                    sx={{
                      fontSize: TS.label,
                      fontWeight: 600,
                      color: activa ? 'var(--muted)' : tinte.fg,
                      opacity: activa ? 1 : 0.75,
                    }}
                  >
                    {t('store.brands.count').replace('{count}', String(brand.count))}
                  </Typography>
                )}
              </Box>
            </Box>
          )
        }}
      />
    </Stack>
  )
}
