import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { R, TS } from '@/theme/tokens'
import { ProductMedia } from '../components/ProductMedia'
import { QuantityStepper } from '../components/QuantityStepper'
import { useSignedThumbnails } from '../hooks'
import type { PriceQuote } from '@/domain'
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
        />
      ))}
    </Stack>
  )
}

/** Lo que se va a cobrar por una unidad, con su moneda. */
function precioDe(line: CartLine, quoted: PriceQuote | null): { amount: number; currency: string } {
  const cotizada = quoted?.lines.find(
    (item) => item.productId === line.product_id && (item.variantId ?? null) === line.variant_id,
  )
  return {
    amount: Number(cotizada?.unitPrice.amount ?? line.unit_price),
    currency: quoted?.currency ?? line.currency,
  }
}

function CartLineRow({
  line,
  storeSlug,
  imageUrl,
  onNavigate,
  compact,
  precio,
}: {
  line: CartLine
  storeSlug: string
  imageUrl: string | null
  onNavigate?: () => void
  compact: boolean
  precio: { amount: number; currency: string }
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
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', fontWeight: 600 }}>
          {formatMoney(precio.amount, precio.currency, locale)} · {t('store.cart.each')}
        </Typography>

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

          {/* La papelera se va al otro extremo. Pegada al «+» convertia un
              dedo torpe en una linea borrada, y deshacer eso es volver a
              buscar el producto. */}
          <Box sx={{ flex: 1 }} />
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

      <Typography sx={{ fontWeight: 800, fontSize: TS.bodyStrong, whiteSpace: 'nowrap' }}>
        {formatMoney(precio.amount * line.quantity, precio.currency, locale)}
      </Typography>
    </Stack>
  )
}
