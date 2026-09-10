import { Box, Card, Skeleton, Stack } from '@mui/material'
import type { PublicProduct } from '../types'
import { ProductCard } from './ProductCard'

/**
 * Rejilla del catálogo, mobile-first de verdad: **dos columnas ya en el móvil**
 * (que es como se ven las tiendas en el teléfono) y hasta cuatro en escritorio.
 * `auto-rows: 1fr` iguala la altura de las tarjetas sin medir nada en JS.
 *
 * Las columnas y el aire salen de variables que pone el tema. Fuera de la
 * vitrina esas variables no existen, y por eso llevan RESERVA: 2/3/4 y 12/20
 * px, que es exactamente lo que la rejilla hacía antes del Theme Engine. Una
 * rejilla que se quedara sin columnas por una variable ausente sería una lista
 * de una columna, y eso no se ve en ninguna prueba de unidad.
 */
const GRID_SX = {
  display: 'grid',
  gap: { xs: 'var(--sf-grid-gap, 12px)', md: 'var(--sf-grid-gap-md, 20px)' },
  gridTemplateColumns: {
    xs: 'repeat(var(--sf-grid-xs, 2), minmax(0, 1fr))',
    sm: 'repeat(var(--sf-grid-sm, 3), minmax(0, 1fr))',
    lg: 'repeat(var(--sf-grid-lg, 4), minmax(0, 1fr))',
  },
  gridAutoRows: '1fr',
} as const

export function ProductGrid({
  products,
  storeSlug,
  thumbnails,
  onPrefetch,
  onQuickView,
  favorites,
  onToggleFavorite,
}: {
  products: PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
  /** Se llama al apuntar o enfocar una tarjeta. Opcional a propósito: los
      relacionados de la ficha no lo pasan, porque ahí el siguiente clic es
      mucho menos probable que en la rejilla del catálogo. */
  onPrefetch?: (slug: string) => void
  /** Abre la vista rapida. Sin esto la tarjeta navega a la ficha, que es
      su comportamiento por defecto y el que conserva sin JavaScript. */
  onQuickView?: (slug: string) => void
  /** Ids guardados. La rejilla los recibe YA cargados: una consulta, no una por
      tarjeta. */
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (productId: string) => void
}) {
  return (
    <Box sx={GRID_SX}>
      {products.map((product) => (
        <ProductCard
          key={product.product_id}
          product={product}
          storeSlug={storeSlug}
          {...(onQuickView ? { onQuickView } : {})}
          {...(onToggleFavorite ? { onToggleFavorite } : {})}
          favorite={favorites?.has(product.product_id) ?? false}
          imageUrl={
            product.primary_image_path ? (thumbnails[product.primary_image_path] ?? null) : null
          }
          onPrefetch={onPrefetch}
        />
      ))}
    </Box>
  )
}

/**
 * Esqueleto con la MISMA rejilla que el catálogo real: si el esqueleto tuviera
 * otra forma, la página daría un salto al llegar los datos.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <Box sx={GRID_SX} aria-hidden data-testid="catalog-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <Card
          key={index}
          sx={{
            p: 1.5,
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Skeleton
            variant="rectangular"
            sx={{ aspectRatio: '1 / 1', borderRadius: 'var(--sf-radius-sm)' }}
          />
          <Stack sx={{ gap: 0.5, mt: 1 }}>
            <Skeleton width="45%" height={12} />
            <Skeleton width="90%" height={18} />
            <Skeleton width="35%" height={18} />
          </Stack>
        </Card>
      ))}
    </Box>
  )
}
