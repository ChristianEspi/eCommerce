import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { useCatalogCommercialPrices } from '../commerce/catalogPrices'
import type { PublicProduct } from '../types'
import { ProductCard } from './ProductCard'
import { LoopingRow } from './LoopingRow'
import { ScrollRow } from './ScrollRow'
import { SectionHeading } from './SectionHeading'

/**
 * Una fila de productos que se ADAPTA a cuántos productos hay.
 *
 * ## El problema que resuelve, con números
 *
 * La fila pintaba siempre lo mismo: un carrusel de tarjetas de 168 px. Con
 * veinte productos está bien. Con UNO, la portada enseñaba una tarjeta pequeña
 * pegada al margen izquierdo y **mil doscientos píxeles de blanco** a su
 * derecha, debajo de un título que prometía una sección. Con dos o tres, lo
 * mismo en menor grado.
 *
 * Eso no se lee como «esta tienda tiene tres ofertas»: se lee como una tienda
 * rota. Y le pasa a toda tienda que empieza, que es justo cuando peor sienta.
 *
 * ## Las tres composiciones, y el criterio
 *
 * La regla es una sola: **la fila ocupa su ancho con lo que de verdad tiene.**
 * Nunca se rellena con productos inventados, repetidos ni «recomendados» que
 * salgan de otra parte — eso sería mentir sobre el catálogo.
 *
 *  · **1–3 productos → rejilla con tarjetas GRANDES.** Las columnas se reparten
 *    entre los productos que hay más una puerta al catálogo, así que con uno se
 *    ven dos columnas anchas y con tres, cuatro. Las tarjetas crecen en vez de
 *    quedarse pequeñas en una esquina.
 *  · **4–6 → rejilla normal**, una columna por producto. Ya llenan la fila.
 *  · **7 o más → carrusel.** A partir de ahí no caben, y una rejilla que se
 *    parte en dos filas desiguales —seis arriba y una abajo— se ve peor que una
 *    fila que gira.
 *
 * ## Por qué la puerta al catálogo es una CELDA y no solo un botón
 *
 * El botón «Ver todo» sigue junto al título, donde estaba. Lo que la celda
 * añade es ocupar el hueco con algo que sirve: quien mira una fila de dos
 * productos y quiere más, tiene la salida en el sitio donde estaba mirando. Y
 * su texto no afirma nada sobre cuántos productos hay —sería mentira en una
 * tienda con dos— sino que invita a recorrer el catálogo, que es cierto siempre.
 */

/** A partir de aquí la rejilla ya no cabe y la fila gira. */
const TOPE_REJILLA = 6

/** Hasta aquí las tarjetas crecen y se acompañan de la puerta al catálogo. */
const POCOS = 3

export function ProductRow({
  title,
  eyebrow,
  subtitle,
  products,
  storeSlug,
  thumbnails,
  seeAllHref,
  loading = false,
  tone = 'plain',
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
   * la fila ANTES de leer los productos, y ahi es donde el cierre de la pagina
   * se quedaba como una lista mas.
   */
  eyebrow?: string
  subtitle?: string
  products: readonly PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
  seeAllHref: string
  loading?: boolean
  /**
   * El fondo de la fila (P06).
   *
   * `plain` es el de siempre: la fila sobre el fondo de la página. `tinted` la
   * apoya en un tinte muy bajo del acento del comercio.
   *
   * No es decoración: es lo que permite que dos filas seguidas se lean como dos
   * secciones. Una portada de cuatro filas idénticas —título, tarjetas, título,
   * tarjetas— se recorre como una lista sin fin, y el comprador deja de
   * distinguir dónde acaba una cosa y empieza otra. Quien decide el ritmo es el
   * registro de secciones, que es el único que sabe qué va antes y después.
   */
  tone?: 'plain' | 'tinted'
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

  const cuantos = products.length
  const pocos = !loading && cuantos > 0 && cuantos <= POCOS
  const rejilla = !loading && cuantos > 0 && cuantos <= TOPE_REJILLA

  const tarjeta = (product: PublicProduct, compact: boolean) => (
    <ProductCard
      compact={compact}
      product={product}
      storeSlug={storeSlug}
      commercialPrice={commercial.get(product.product_id) ?? null}
      {...(onQuickView ? { onQuickView } : {})}
      {...(onToggleFavorite ? { onToggleFavorite } : {})}
      favorite={favorites?.has(product.product_id) ?? false}
      imageUrl={product.primary_image_path ? (thumbnails[product.primary_image_path] ?? null) : null}
      onPrefetch={onPrefetch}
    />
  )

  return (
    <Stack
      component="section"
      aria-label={title}
      data-row-layout={loading ? 'loading' : pocos ? 'spotlight' : rejilla ? 'grid' : 'carousel'}
      data-row-count={cuantos}
      sx={{
        gap: 1.25,
        ...(tone === 'tinted'
          ? {
              p: { xs: 1.75, md: 2.5 },
              borderRadius: 'var(--sf-radius)',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--accent2) 8%, transparent) 0%, transparent 100%)',
            }
          : {}),
      }}
    >
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

      {loading ? (
        /* Cargando NO gira: unos esqueletos derivando parecen contenido que se
           va sin haber llegado. La fila arranca cuando hay algo que enseñar. */
        <ScrollRow ariaLabel={title} gap={1.5}>
          {Array.from({ length: 6 }, (_, i) => (
            <Box key={i} sx={{ width: 168, flexShrink: 0 }}>
              <Skeleton variant="rounded" height={220} sx={{ borderRadius: 'var(--sf-radius)' }} />
            </Box>
          ))}
        </ScrollRow>
      ) : rejilla ? (
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 'var(--sf-grid-gap, 12px)', md: 'var(--sf-grid-gap-md, 20px)' },
            // Con pocos productos entra una columna más: la puerta al catálogo.
            // Sin ella, dos tarjetas dejaban media fila en blanco debajo de un
            // título que prometía una sección.
            gridTemplateColumns: {
              xs: cuantos === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))',
              md: `repeat(${pocos ? cuantos + 1 : cuantos}, minmax(0, 1fr))`,
            },
            gridAutoRows: '1fr',
          }}
        >
          {products.map((product) => (
            <Box key={product.product_id} sx={{ display: 'flex' }}>
              {/* Tarjeta COMPLETA —con estado y botón de comprar— cuando hay
                  sitio: con tres productos en fila no se está ojeando un
                  escaparate, se está mirando lo que hay. La versión reducida es
                  para la fila que gira, donde la tarjeta es un anuncio. */}
              {tarjeta(product, false)}
            </Box>
          ))}
          {pocos && <PuertaAlCatalogo href={seeAllHref} />}
        </Box>
      ) : (
        <LoopingRow
          items={products}
          keyOf={(product) => product.product_id}
          itemWidth={168}
          gap={1.5}
          ariaLabel={title}
          render={(product) => (
            <Box sx={{ display: 'flex', width: '100%' }}>{tarjeta(product, true)}</Box>
          )}
        />
      )}
    </Stack>
  )
}

/**
 * La celda que cierra una fila corta.
 *
 * ## Qué dice y qué NO dice
 *
 * Invita a recorrer el catálogo. No afirma que haya más productos —en una
 * tienda con dos sería falso— ni inventa recomendaciones para rellenar. Lo
 * único que promete es lo que hace: llevar al catálogo.
 *
 * Es un enlace de altura completa, así que la fila queda cuadrada: todas las
 * celdas miden lo mismo y no hay un hueco a la derecha.
 */
function PuertaAlCatalogo({ href }: { href: string }) {
  const { t } = useI18n()

  return (
    <Box
      component={Link}
      to={href}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        gap: 1,
        p: { xs: 2, md: 2.5 },
        minHeight: '100%',
        borderRadius: 'var(--sf-radius)',
        textDecoration: 'none',
        // Trazo discontinuo y fondo casi transparente: dice «esto no es un
        // producto» sin gritar. Con el mismo relleno que una tarjeta, la fila
        // se lee como una sola pieza.
        border: '1px dashed var(--sf-line-strong)',
        bgcolor: 'color-mix(in srgb, var(--accent) 4%, transparent)',
        color: 'var(--accent-deep)',
        transition: 'border-color .18s ease, background-color .18s ease',
        '@media (hover: hover)': {
          '&:hover': {
            borderColor: 'var(--accent)',
            bgcolor: 'color-mix(in srgb, var(--accent) 9%, transparent)',
          },
          '&:hover .sf-row-flecha': { transform: 'translateX(3px)' },
        },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1.3 }}>
        {t('store.row.exploreTitle')}
      </Typography>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', lineHeight: 1.4 }}>
        {t('store.row.exploreBody')}
      </Typography>
      <Box
        className="sf-row-flecha"
        aria-hidden
        sx={{
          display: 'inline-flex',
          transition: 'transform .18s ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        <ArrowForwardRoundedIcon sx={{ fontSize: 20 }} />
      </Box>
    </Box>
  )
}
