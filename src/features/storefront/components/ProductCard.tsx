import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import {
  Box,
  Button,
  Card,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { track } from '../analytics'
import { useAddToCart } from '../cart/useAddToCart'
import { discountPercent, type PublicProduct } from '../types'
import { ProductMedia } from './ProductMedia'

/**
 * Tarjeta de catálogo: foto, categoría, nombre, precio, disponibilidad y compra.
 *
 * ## Por qué la tarjeta ya NO es un enlace entera
 *
 * Lo era, y con razón: un solo `<a>` se alcanza con Tab, se anuncia como enlace
 * y se abre en otra pestaña. Pero ahora lleva un botón de comprar, y un
 * `<button>` dentro de un `<a>` es HTML inválido: el navegador no sabe cuál de
 * los dos activar con Enter y un lector de pantalla anuncia un enlace que
 * contiene un botón, que no es nada.
 *
 * La solución es la de siempre para este caso: el enlace lo lleva el NOMBRE
 * —que es lo que de verdad nombra el destino, mucho mejor que «la tarjeta»— y
 * se estira sobre toda la tarjeta con un pseudo-elemento. Se conserva todo lo
 * que había: un clic en cualquier parte abre el producto, Tab llega, el lector
 * de pantalla anuncia «Silla de roble, enlace», y ctrl-clic o rueda abren la
 * ficha en otra pestaña. El botón se pone por encima de esa capa, así que
 * pulsarlo compra y no navega, sin necesidad de `stopPropagation`.
 *
 * ## La jerarquía, de arriba abajo
 *
 * Cuatro niveles y ni uno más, porque la rejilla se recorre en diagonal y con
 * el rabillo del ojo: **categoría** en versalitas diminutas y gris (contexto,
 * casi un susurro), **nombre** en el cuerpo de la tarjeta, **precio** como la
 * cifra grande —es la que decide, y antes competía en tamaño con el nombre— y
 * **estado** en una pastilla suave. Lo que hace moderna a una tarjeta no es el
 * radio de la esquina, es que esos cuatro pesos se distingan sin leerlos.
 *
 * La foto va sobre su propio fondo (`--sf-media-bg`), un tono por debajo de la
 * tarjeta: separa imagen de texto sin dibujar una caja, y una foto con fondo
 * blanco —la mitad del catálogo— deja de fundirse con la tarjeta.
 *
 * ## Qué hace el botón
 *
 * Con variantes NO añade nada: elegir color o medida cambia precio y stock, y
 * meter «la primera» en el carrito es mandarle a alguien la talla que no era.
 * En ese caso lleva a elegir.
 */
export function ProductCard({
  product,
  storeSlug,
  imageUrl = null,
  onPrefetch,
  onQuickView,
  favorite,
  onToggleFavorite,
  compact = false,
}: {
  product: PublicProduct
  storeSlug: string
  /** URL firmada de la imagen principal, o `null` para el marcador neutral. */
  imageUrl?: string | null
  /**
   * Aviso de intención (P15-SaaS). Se dispara al APUNTAR y al ENFOCAR, no al
   * pintar: adelantar las veinticuatro fichas de la rejilla serían veinticuatro
   * consultas que casi nadie usa. Y va también en `focus` para que quien navega
   * con teclado gane lo mismo que quien navega con ratón.
   */
  onPrefetch?: (slug: string) => void
  /**
   * Vista rápida. Si se pasa, el clic normal abre el diálogo en vez de navegar;
   * el `href` NO se quita, así que ctrl-clic, rueda y «abrir en pestaña nueva»
   * siguen llevando a la ficha, y un buscador la indexa. Sin JavaScript la
   * tarjeta es un enlace y ya está.
   */
  onQuickView?: (slug: string) => void
  /**
   * Estado del corazón. Se pasa desde arriba en vez de leerlo aquí: la rejilla
   * carga los favoritos UNA vez, y una tarjeta que consultara los suyos serían
   * veinticuatro consultas para pintar veinticuatro corazones.
   */
  favorite?: boolean
  /** Sin esto no se pinta el corazón: quien no ofrece guardar, no lo enseña. */
  onToggleFavorite?: (productId: string) => void
  /**
   * La misma tarjeta, para una FILA.
   *
   * En la rejilla del catálogo la tarjeta es el sitio donde se decide comprar,
   * y por eso lleva estado y botón. En una fila de la portada es un escaparate:
   * se recorre de lado, se mira y se entra. Allí el botón de comprar y la
   * pastilla de disponibilidad convierten seis productos en media pantalla
   * cada uno, y lo que se pierde es lo único que la fila tenía que hacer —
   * enseñar QUE HAY.
   *
   * Lo que se quita es lo que se decide DENTRO de la ficha; no se quita ni el
   * precio ni el descuento, que es lo que hace que alguien entre.
   */
  compact?: boolean
}) {
  const { t, locale } = useI18n()
  const { agregar, pending } = useAddToCart()
  const discount = discountPercent(product)
  const available = product.in_stock !== false
  const hasVariants = product.kind === 'variant'
  const to = `/s/${storeSlug}/product/${product.slug}`

  return (
    <Card
      onMouseEnter={() => onPrefetch?.(product.slug)}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        p: compact ? 1 : { xs: 'var(--sf-card-pad)', md: 'var(--sf-card-pad-md)' },
        gap: compact ? 0.75 : 'var(--sf-card-gap)',
        borderRadius: 'var(--sf-radius)',
        // La separación entre tarjetas la da la sombra, no el borde: una línea
        // nítida alrededor de cada una convierte la rejilla en una cuadrícula.
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
        // El movimiento es la única señal de que la tarjeta es pulsable, así
        // que se anula entero con prefers-reduced-motion en vez de acortarlo.
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        '&:hover': {
          borderColor: 'var(--sf-line-strong)',
          boxShadow: 'var(--sf-shadow-hover)',
          transform: 'translateY(-3px)',
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
        },
        '&:hover .eb-card-media img': { transform: 'scale(1.05)' },
        // El foco se pinta en la tarjeta aunque lo reciba el enlace de dentro:
        // si no, con el teclado se ilumina solo el nombre y no se ve qué
        // tarjeta está seleccionada.
        '&:has(a:focus-visible)': { outline: '2px solid var(--accent)', outlineOffset: 2 },
      }}
    >
      {/* La foto flota sobre la tarjeta, sin caja propia.
          Con fondo y relleno propios, un frasco fotografiado sobre blanco
          —casi todo el catalogo de una botica— quedaba como un rectangulo
          blanco dentro de otro gris dentro de la tarjeta: tres bordes para
          ensenar un producto. */}
      <Box
        className="eb-card-media"
        sx={{
          position: 'relative',
          borderRadius: 'var(--sf-radius-sm)',
          overflow: 'hidden',
          px: 0.5,
          pt: 0.5,
          bgcolor: 'transparent',
          '& img': {
            transition: 'transform .35s ease',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none', transform: 'none' },
          },
          // Agotado: la foto se apaga para que el estado se lea de un vistazo
          // en la rejilla, no solo al llegar a la línea de texto.
          ...(available ? {} : { '& img': { filter: 'grayscale(1)', opacity: 0.5 } }),
        }}
      >
        {/* La proporción la pone el tema: cuadrada para un envase, vertical
            para una prenda. Con RESERVA cuadrada, que es la de siempre — y solo
            aquí: el carrito y el resumen de pago siguen con su miniatura
            cuadrada, porque ahí la foto identifica, no vende. */}
        <ProductMedia
          url={imageUrl}
          alt={product.primary_image_alt ?? product.name}
          fit="contain"
          ratio="var(--sf-image-ratio, 1 / 1)"
        />

        {onToggleFavorite && (
          // Por encima de la capa que hace pulsable la tarjeta (`zIndex: 1`):
          // pulsar el corazón guarda, no navega. Y es un botón de verdad, con
          // su nombre accesible cambiando según el estado: «guardar» y «quitar»
          // son dos acciones distintas y el lector de pantalla tiene que poder
          // distinguirlas sin ver el relleno del icono.
          <Tooltip title={favorite ? t('store.favorite.remove') : t('store.favorite.add')}>
            <IconButton
              size="small"
              aria-pressed={Boolean(favorite)}
              aria-label={favorite ? t('store.favorite.remove') : t('store.favorite.add')}
              onClick={() => onToggleFavorite(product.product_id)}
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 1,
                width: 30,
                height: 30,
                // Un disco limpio, sin aro: el borde dibujaba una moneda sobre
                // la foto y era lo primero que se veia de la tarjeta. La sombra
                // basta para despegarlo del fondo, y guardado se reconoce por
                // el relleno del corazon, no por el marco.
                bgcolor: 'color-mix(in srgb, var(--card) 88%, transparent)',
                backdropFilter: 'blur(6px)',
                boxShadow: '0 2px 8px -2px rgba(16, 24, 32, 0.22)',
                color: favorite ? 'var(--sf-heart)' : 'var(--muted)',
                transition: 'transform .15s ease, background-color .15s ease, color .15s ease',
                '&:hover': {
                  bgcolor: 'var(--card)',
                  color: 'var(--sf-heart)',
                  transform: 'scale(1.08)',
                },
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                  '&:hover': { transform: 'none' },
                },
              }}
            >
              {favorite ? (
                <FavoriteRoundedIcon sx={{ fontSize: 18 }} />
              ) : (
                <FavoriteBorderRoundedIcon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </Tooltip>
        )}

        {discount !== null && (
          // Pastilla plana y compacta, no un `Chip` con su alto de 24 px y su
          // sombra: sobre la foto lo que hace falta es una etiqueta que se lea,
          // no un control que parezca pulsable.
          <Box
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              zIndex: 1,
              px: 1,
              py: 0.25,
              borderRadius: 'var(--sf-pill)',
              bgcolor: 'var(--accent-deep)',
              color: '#FFFFFF',
              fontSize: TS.label,
              fontWeight: 800,
              letterSpacing: '0.02em',
              lineHeight: 1.6,
              boxShadow: '0 2px 8px rgba(0,0,0,.18)',
            }}
          >
            {`-${discount}%`}
          </Box>
        )}
      </Box>

      <Stack sx={{ gap: 0.5, flex: 1 }}>
        {product.category_name && (
          <Typography
            sx={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              lineHeight: 1.4,
            }}
          >
            {product.category_name}
          </Typography>
        )}
        <Typography
          component="h3"
          sx={{
            fontSize: compact ? 13.5 : 'var(--sf-card-title)',
            fontWeight: 650,
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
            // Dos líneas y elipsis: los nombres largos no pueden descuadrar la
            // rejilla ni empujar el precio fuera de la tarjeta.
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          <Box
            component={Link}
            to={to}
            onFocus={() => onPrefetch?.(product.slug)}
            onClick={(event: React.MouseEvent) => {
              if (!onQuickView) return
              // Se respetan los gestos de «abrir en otra parte»: si el visitante
              // pidió otra pestaña, abrirle un diálogo aquí sería ignorarlo.
              if (event.defaultPrevented) return
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              if (event.button !== 0) return
              event.preventDefault()
              onQuickView(product.slug)
            }}
            sx={{
              color: 'inherit',
              textDecoration: 'none',
              // La capa que hace pulsable la tarjeta entera. Va detrás de todo
              // (`zIndex: 0`) para que el botón de comprar quede por encima.
              '&::after': { content: '""', position: 'absolute', inset: 0, zIndex: 0 },
              '&:focus-visible': { outline: 'none' },
            }}
          >
            {product.name}
          </Box>
        </Typography>
      </Stack>

      <Stack sx={{ gap: 0.75, mt: 'auto' }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
          {/* La cifra que decide. Sube a 19 px y el nombre baja a 15: antes
              pesaban lo mismo y la tarjeta no tenía protagonista. */}
          <Typography
            className="tnum"
            sx={{
              fontSize: compact ? 16 : 'var(--sf-card-price)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            {formatMoney(Number(product.price), product.currency, locale)}
          </Typography>
          {discount !== null && product.compare_at_price && (
            <Typography
              component="s"
              className="tnum"
              sx={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}
            >
              {formatMoney(Number(product.compare_at_price), product.currency, locale)}
            </Typography>
          )}
        </Stack>

        {/* El estado, en pastilla: en una línea de texto suelta se confunde con
            el resto de la ficha, y es lo que decide si el botón sirve. En la
            fila no se pinta: allí no hay botón al que condicionar. */}
        {compact ? null : (
        <Box
          sx={{
            alignSelf: 'flex-start',
            px: 0.875,
            py: 0.125,
            borderRadius: 'var(--sf-pill)',
            fontSize: TS.label,
            fontWeight: 700,
            lineHeight: 1.7,
            bgcolor: available ? 'var(--accent-soft)' : 'var(--neutral-soft)',
            color: available ? 'var(--accent-deep)' : 'var(--muted)',
          }}
        >
          {available ? t('store.availability.inStock') : t('store.availability.outOfStock')}
        </Box>
        )}
      </Stack>

      {/* Por encima de la capa que hace pulsable la tarjeta: pulsar aquí compra,
          no navega. */}
      {compact ? null : (
      <Button
        fullWidth
        variant={available ? 'contained' : 'outlined'}
        size="small"
        disabled={!available || pending}
        startIcon={
          hasVariants ? (
            <TuneRoundedIcon />
          ) : pending ? (
            <CircularProgress size={14} color="inherit" />
          ) : (
            <ShoppingCartRoundedIcon />
          )
        }
        onClick={() => {
          if (hasVariants) {
            onQuickView?.(product.slug)
            return
          }
          void agregar(product, 1, null)
          // Se cuenta aquí igual que en la ficha: `add_to_cart` es una decisión,
          // y si solo se contara desde la ficha, el embudo perdería a todo el
          // que compra desde la rejilla.
          track(storeSlug, {
            type: 'add_to_cart',
            product_id: product.product_id,
            quantity: 1,
          })
        }}
        sx={{
          position: 'relative',
          zIndex: 1,
          mt: 0.25,
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: 'var(--sf-radius-sm)',
          py: 0.75,
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        }}
      >
        {hasVariants ? t('store.product.chooseOptions') : t('store.product.addToCart')}
      </Button>
      )}
    </Card>
  )
}
