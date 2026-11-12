import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import { Box, ButtonBase, Collapse, IconButton, Stack, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { R, TS } from '@/theme/tokens'
import { ProductMedia } from '../components/ProductMedia'
import { QuantityStepper } from '../components/QuantityStepper'
import type { BundleComponent } from '../api'
import { useBundleComponents, useSignedThumbnails } from '../hooks'
import { useFavorites } from '../useFavorites'
import type { PriceQuote } from '@/domain'
import { esAcuerdoDelComprador } from './agreement'
import { MAX_LINE_QUANTITY, lineKey, type Cart, type CartLine } from './cart'
import { useCart } from './cart-context'

/**
 * Líneas del carrito. Se usa igual en el panel lateral y en la página del
 * carrito: una sola implementación para que sumar, restar y quitar se comporten
 * exactamente igual en los dos sitios.
 */
export function CartLineList({
  cart,
  storeSlug,
  onNavigate,
  compact = false,
  quoted = null,
}: {
  cart: Cart
  storeSlug: string
  /** El panel se cierra al pulsar un enlace; la página no necesita nada. */
  onNavigate?: () => void
  compact?: boolean
  /**
   * La cotización del SERVIDOR, si la pantalla la tiene.
   *
   * El precio guardado en el carrito es de escaparate, y desde P19 puede no ser
   * el del comprador: con un acuerdo B2B el subtotal baja y la línea se quedaba
   * diciendo el de catálogo. Dos números distintos para lo mismo en la misma
   * pantalla es lo que hace que alguien deje de fiarse del total.
   *
   * Sin cotización —el panel lateral no la pide— manda el del carrito, como
   * siempre.
   */
  quoted?: PriceQuote | null
}) {
  const thumbs = useSignedThumbnails(cart.lines.map((line) => line.image_path))
  // Una lectura para todas las líneas: el corazón de cada una sale del mismo conjunto.
  const favorites = useFavorites(cart.store_id)
  // Una consulta para todo el carrito: las líneas que no son kit no traen nada.
  const bundles = useBundleComponents(
    storeSlug,
    cart.lines.map((line) => line.product_id),
  )

  return (
    <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: compact ? 1.5 : 2 }}>
      {cart.lines.map((line) => (
        <CartLineRow
          key={lineKey(line)}
          line={line}
          storeSlug={storeSlug}
          imageUrl={line.image_path ? (thumbs[line.image_path] ?? null) : null}
          onNavigate={onNavigate}
          compact={compact}
          precio={precioDe(line, quoted)}
          favorite={favorites.isFavorite(line.product_id)}
          onToggleFavorite={() => void favorites.toggle(line.product_id)}
          components={bundles.data?.[line.product_id] ?? null}
        />
      ))}
    </Stack>
  )
}

interface PrecioLinea {
  amount: number
  currency: string
  /** El precio de antes, si hay uno que tachar. */
  before: number | null
  /** Por qué baja: una oferta del catálogo o el acuerdo de este comprador. */
  motivo: 'offer' | 'agreement' | null
}

/**
 * Lo que se va a cobrar por una unidad, y lo que costaba antes si bajó.
 *
 * Dos fuentes para el tachado, en este orden:
 *  1. `compareAtPrice` de la cotización: el «antes» de una oferta del catálogo.
 *  2. Con un acuerdo del comprador, el precio de escaparate que guardó el
 *     carrito, si es mayor que el del acuerdo. La cotización no devuelve el de
 *     catálogo cuando gana una lista, y sin esto la rebaja del convenio no se
 *     veía en ninguna parte del carrito.
 */
function precioDe(line: CartLine, quoted: PriceQuote | null): PrecioLinea {
  const cotizada = quoted?.lines.find(
    (item) => item.productId === line.product_id && (item.variantId ?? null) === line.variant_id,
  )
  const amount = Number(cotizada?.unitPrice.amount ?? line.unit_price)
  const currency = quoted?.currency ?? line.currency
  const antes = cotizada?.compareAtPrice ? Number(cotizada.compareAtPrice.amount) : null
  if (antes !== null && antes > amount) return { amount, currency, before: antes, motivo: 'offer' }
  const escaparate = Number(line.unit_price)
  if (cotizada && esAcuerdoDelComprador(cotizada) && escaparate > amount) {
    return { amount, currency, before: escaparate, motivo: 'agreement' }
  }
  return { amount, currency, before: null, motivo: null }
}

function CartLineRow({
  line,
  storeSlug,
  imageUrl,
  onNavigate,
  compact,
  precio,
  favorite,
  onToggleFavorite,
  components,
}: {
  line: CartLine
  storeSlug: string
  imageUrl: string | null
  onNavigate?: () => void
  compact: boolean
  precio: PrecioLinea
  favorite: boolean
  onToggleFavorite: () => void
  /** Lo que trae el kit; `null` si la línea no es un kit. */
  components: BundleComponent[] | null
}) {
  const { t, locale } = useI18n()
  const { setQuantity, remove } = useCart()
  const size = compact ? 56 : 72

  return (
    <Stack
      component="li"
      direction="row"
      sx={{
        gap: 1.5,
        alignItems: 'flex-start',
        pb: compact ? 1.5 : 2,
        borderBottom: '1px solid var(--border)',
        '&:last-of-type': { borderBottom: 'none', pb: 0 },
      }}
    >
      <Box
        component={Link}
        to={`/s/${storeSlug}/product/${line.slug}`}
        onClick={onNavigate}
        aria-label={line.name}
        className="sf-cart-thumb"
        sx={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: `${R.md}px`,
          bgcolor: 'var(--neutral-soft)',
          overflow: 'hidden',
          display: 'block',
        }}
      >
        {/* `ProductMedia` y no un `<img>` suelto: sin foto pinta el marcador
            neutral igual que el resto de la tienda. Aqui quedaba un
            rectangulo gris vacio que se leia como una imagen rota. */}
        <ProductMedia url={imageUrl} alt="" sizePx={compact ? 18 : 22} />
      </Box>

      <Stack sx={{ flex: 1, minWidth: 0, gap: 0.5 }}>
        <Box
          component={Link}
          to={`/s/${storeSlug}/product/${line.slug}`}
          onClick={onNavigate}
          sx={{ textDecoration: 'none', color: 'inherit' }}
        >
          <Typography sx={{ fontSize: TS.cardTitle, fontWeight: 700, lineHeight: 1.35 }}>
            {line.name}
          </Typography>
          {/* La variante va en su propia linea y no pegada al nombre: es lo que
              distingue dos lineas del mismo producto en el carrito. */}
          {line.variant_name && (
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', fontWeight: 700 }}>
              {line.variant_name}
            </Typography>
          )}
        </Box>
        {/* El precio de antes se TACHA al lado del de ahora: la oferta o el
            convenio no pueden perderse al entrar al carrito. */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          {precio.before !== null ? (
            <Typography component="s" className="tnum" sx={{ fontSize: TS.label, color: 'var(--muted)', fontWeight: 600 }}>
              {formatMoney(precio.before, precio.currency, locale)}
            </Typography>
          ) : null}
          <Typography
            className="tnum"
            sx={{
              fontSize: TS.label,
              fontWeight: precio.before !== null ? 800 : 600,
              color: precio.before !== null ? 'var(--accent-deep)' : 'var(--muted)',
            }}
          >
            {formatMoney(precio.amount, precio.currency, locale)} · {t('store.cart.each')}
          </Typography>
          {precio.motivo ? (
            <Box
              component="span"
              data-line-discount={precio.motivo}
              sx={{
                px: 0.75,
                borderRadius: 'var(--sf-pill, 999px)',
                fontSize: 10.5,
                fontWeight: 800,
                bgcolor: precio.motivo === 'offer' ? 'var(--accent-deep)' : 'var(--accent-soft)',
                color: precio.motivo === 'offer' ? '#fff' : 'var(--accent-deep)',
              }}
            >
              {precio.motivo === 'offer' && precio.before
                ? `-${Math.round((1 - precio.amount / precio.before) * 100)}%`
                : t('store.cart.agreementTag')}
            </Box>
          ) : null}
        </Stack>

        {components && components.length > 0 ? (
          <BundleContents components={components} kits={line.quantity} />
        ) : null}

        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, mt: 0.5 }}>
          {/* El MISMO selector que la ficha y la vista rapida. Con `min` a
              cero: aqui bajar desde uno quita la linea, que es lo que ya
              hacia y lo que espera quien tiene el dedo en ese boton. */}
          <QuantityStepper
            size="sm"
            min={0}
            value={line.quantity}
            max={MAX_LINE_QUANTITY}
            onChange={(next) => setQuantity(line.product_id, next, line.variant_id)}
          />

        </Stack>
      </Stack>

      {/* Importe arriba y acciones abajo, en la MISMA columna y pegadas al
          borde derecho (2026-10-05). Antes las acciones vivían en la columna
          del medio, cuyo ancho cambia con lo largo del importe («S/ 2,199.60»
          frente a «S/ 39.90»): cada línea las ponía en otro sitio. La
          papelera sigue lejos del «+»: pegada a él, un dedo torpe borraba la
          línea. */}
      <Stack
        sx={{
          alignSelf: 'stretch',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 1,
          flexShrink: 0,
        }}
      >
        <Typography sx={{ fontWeight: 800, fontSize: TS.bodyStrong, whiteSpace: 'nowrap' }}>
          {formatMoney(precio.amount * line.quantity, precio.currency, locale)}
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25, mr: -0.75 }}>
          {/* Guardar para después sin perderlo: el corazón deja el producto en
              favoritos y la línea sigue donde estaba. */}
          <IconButton
            size="small"
            aria-pressed={favorite}
            aria-label={`${favorite ? t('store.favorite.remove') : t('store.favorite.add')}: ${line.name}`}
            title={favorite ? t('store.favorite.remove') : t('store.favorite.add')}
            onClick={onToggleFavorite}
            sx={{ color: favorite ? 'var(--sf-heart, #E23E57)' : 'var(--muted)' }}
          >
            {favorite ? <FavoriteRoundedIcon fontSize="small" /> : <FavoriteBorderRoundedIcon fontSize="small" />}
          </IconButton>
          <IconButton
            size="small"
            aria-label={`${t('store.cart.remove')}: ${line.name}${line.variant_name ? ` ${line.variant_name}` : ''}`}
            onClick={() => remove(line.product_id, line.variant_id)}
            sx={{ color: 'var(--muted)', '&:hover': { color: 'var(--red)' } }}
          >
            <DeleteRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    </Stack>
  )
}

/**
 * El desplegable «Ver qué incluye» de una línea de kit.
 *
 * Las cantidades son las TOTALES de la línea (receta × kits): con 2 kits el
 * comprador se lleva 2 mochilas, y eso es lo que tiene que leer. Cerrado por
 * defecto: el carrito sigue siendo una lista corta.
 */
export function BundleContents({
  components,
  kits,
}: {
  components: BundleComponent[]
  kits: number
}) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const listId = useId()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })

  return (
    <Box>
      <ButtonBase
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        sx={{
          gap: 0.25,
          fontSize: TS.label,
          fontWeight: 700,
          color: 'var(--accent-deep)',
          borderRadius: `${R.sm}px`,
          '&:focus-visible': { outline: '2px solid var(--accent-deep)', outlineOffset: 2 },
        }}
      >
        {open
          ? t('store.cart.bundleHide')
          : t('store.cart.bundleShow').replace('{n}', String(components.length))}
        <ExpandMoreRoundedIcon
          fontSize="small"
          sx={{
            transition: 'transform 160ms ease',
            transform: open ? 'rotate(180deg)' : 'none',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        />
      </ButtonBase>
      <Collapse in={open} timeout="auto">
        <Box
          component="ul"
          id={listId}
          sx={{
            listStyle: 'none',
            m: 0,
            mt: 0.5,
            p: 0,
            pl: 1.25,
            borderLeft: '2px solid var(--border)',
            display: 'grid',
            gap: 0.25,
          }}
        >
          {components.map((component, index) => (
            <Typography
              key={`${component.name}|${component.variantName ?? ''}|${index}`}
              component="li"
              sx={{ fontSize: TS.label, color: 'var(--muted)', lineHeight: 1.4 }}
            >
              <Box component="span" className="tnum" sx={{ fontWeight: 800, color: 'var(--text)' }}>
                {number.format(component.quantity * kits)}
                {component.unit ? ` ${component.unit}` : ' ×'}
              </Box>{' '}
              {component.name}
              {component.variantName ? ` · ${component.variantName}` : ''}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}
