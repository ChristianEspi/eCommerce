import { Box, Button, Skeleton, Stack } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useCatalogCommercialPrices } from '../commerce/catalogPrices'
import type { PublicProduct } from '../types'
import { ProductCard } from './ProductCard'
import { LoopingRow } from './LoopingRow'
import { ScrollRow } from './ScrollRow'
import { SectionHeading } from './SectionHeading'

/**
 * Una fila de productos con su título y su «Ver todo».
 *
 * La portada dejó de ser una rejilla infinita de catálogo. Una rejilla es lo
 * que se quiere cuando YA se sabe qué se busca; quien acaba de entrar necesita
 * saber qué hay, y eso se enseña mejor en filas cortas con nombre —novedades,
 * ofertas, lo de siempre— que en 400 productos ordenados por relevancia.
 *
 * Cada fila lleva su puerta al catálogo completo: «Ver todo» es lo que abre la
 * rejilla con sus filtros. Antes esa rejilla estaba siempre puesta y no había
 * forma de enseñar nada por encima sin empujarla fuera de la pantalla.
 */
export function ProductRow({
  title,
  eyebrow,
  subtitle,
  products,
  storeSlug,
  thumbnails,
  seeAllHref,
  loading = false,
  onPrefetch,
  onQuickView,
  favorites,
  onToggleFavorite,
}: {
  title: string
  /**
   * Versalitas y frase de apoyo sobre el titulo.
   *
   * Opcionales porque no toda fila las necesita: en la portada dicen de que va
   * la fila ANTES de leer los productos —«recien llegado», «lo que mas sale»—,
   * y ahi es donde el cierre de la pagina se quedaba como una lista mas.
   */
  eyebrow?: string
  subtitle?: string
  products: readonly PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
  seeAllHref: string
  loading?: boolean
  onPrefetch?: (slug: string) => void
  onQuickView?: (slug: string) => void
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (productId: string) => void
}) {
  const { t } = useI18n()
  // Una cotización por fila, no por tarjeta: la fila que gira repite tarjetas
  // pero no productos (N03).
  const commercial = useCatalogCommercialPrices(storeSlug, products)
  if (!loading && products.length === 0) return null

  return (
    <Stack component="section" aria-label={title} sx={{ gap: 1.25 }}>
      <SectionHeading
        title={title}
        {...(eyebrow ? { eyebrow } : {})}
        {...(subtitle ? { subtitle } : {})}
        /* La puerta al catálogo, al lado del título y no al final de la fila:
           al final hay que desplazarse hasta el borde para encontrarla, que es
           justo lo que se quiere evitar. */
        action={
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
        }
      />

      {/* Cargando NO gira: unos esqueletos derivando parecen contenido que se
          va sin haber llegado. La fila arranca cuando hay algo que enseñar. */}
      {loading ? (
        <ScrollRow ariaLabel={title} gap={1.5}>
          {Array.from({ length: 6 }, (_, i) => (
            <Box key={i} sx={{ width: 168, flexShrink: 0 }}>
              <Skeleton variant="rounded" height={220} sx={{ borderRadius: 'var(--sf-radius)' }} />
            </Box>
          ))}
        </ScrollRow>
      ) : (
        <LoopingRow
          items={products}
          keyOf={(product) => product.product_id}
          itemWidth={168}
          gap={1.5}
          ariaLabel={title}
          render={(product) => (
            <Box sx={{ display: 'flex', width: '100%' }}>
              <ProductCard
                compact
                product={product}
                storeSlug={storeSlug}
                commercialPrice={commercial.get(product.product_id) ?? null}
                {...(onQuickView ? { onQuickView } : {})}
                {...(onToggleFavorite ? { onToggleFavorite } : {})}
                favorite={favorites?.has(product.product_id) ?? false}
                imageUrl={
                  product.primary_image_path
                    ? (thumbnails[product.primary_image_path] ?? null)
                    : null
                }
                onPrefetch={onPrefetch}
              />
            </Box>
          )}
        />
      )}
    </Stack>
  )
}
