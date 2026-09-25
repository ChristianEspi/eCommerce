import { Box, Chip, Divider, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type { PriceQuote } from '@/domain'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { TS } from '@/theme/tokens'
import { esAcuerdoDelComprador } from '../cart/agreement'
import { lineKey, type CartLine } from '../cart/cart'
import { useSignedThumbnails } from '../hooks'
import { ProductMedia } from './ProductMedia'

/** Cómo va la cotización del servidor. Siempre uno de los cuatro, nunca vacío. */
export type EstadoCotizacion = 'pidiendo' | 'confirmada' | 'fallida' | 'sinPedir'

export type EnvioResumen = {
  amount: number
  currency: string
}

/**
 * El resumen de la compra, al lado del formulario.
 *
 * ## Qué cambió y por qué
 *
 * Era una lista de texto: «1 × Coluquim Granulado Para Suspension Oral 100 mg/5
 * ml 30 ml», el precio unitario repetido debajo y tres filas de importes con el
 * mismo peso tipográfico que todo lo demás. Se leía como un extracto bancario,
 * y tenía dos problemas que no son de gusto:
 *
 *  1. **No se reconocía lo que se está comprando.** Con nombres largos de
 *     catálogo, dos presentaciones del mismo producto se distinguen en la
 *     penúltima palabra. La foto lo resuelve de un vistazo, y es la misma que
 *     el comprador ya vio en la ficha.
 *  2. **El TOTAL no destacaba.** Es la única cifra por la que alguien decide
 *     seguir o no, y estaba al mismo tamaño que el resto.
 *
 * ## Sigue sin calcular nada
 *
 * Este componente PINTA lo que le dan. El total es el del servidor, el envío es
 * el que devolvió la cotización de entrega, y cuando la cotización no llega se
 * cae al subtotal local **y se dice**. Sumar aquí sería una segunda autoridad
 * sobre el dinero, y la del navegador siempre acaba discrepando.
 *
 * El único cálculo es el AHORRO, y es una resta de dos números que ya vienen
 * dados —el precio tachado y el vigente, los dos del servidor— para no obligar
 * a hacerla mentalmente.
 */
export function CheckoutSummary({
  lines,
  quoted,
  subtotalLocal,
  currencyLocal,
  envio,
  estado,
  acciones,
}: {
  lines: readonly CartLine[]
  quoted: PriceQuote | null
  /** Suelo cuando el servidor no contesta. Nunca reemplaza a su cotización. */
  subtotalLocal: number
  currencyLocal: string
  /** `null` mientras no se ha elegido una entrega con cobertura. */
  envio: EnvioResumen | null
  estado: EstadoCotizacion
  /** Lo que va debajo del total: avisos y notas, que los pone la página. */
  acciones?: ReactNode
}) {
  const { t, locale } = useI18n()
  const thumbs = useSignedThumbnails(lines.map((line) => line.image_path))

  const unidades = lines.reduce((suma, line) => suma + line.quantity, 0)
  const moneda = quoted?.currency ?? currencyLocal

  // El ahorro solo cuenta cuando lo dice el SERVIDOR: el precio tachado del
  // carrito es de escaparate y podría venir de un `localStorage` editado.
  const ahorro = (quoted?.lines ?? []).reduce((suma, line) => {
    if (!line.compareAtPrice) return suma
    const antes = Number(line.compareAtPrice.amount)
    const ahora = Number(line.unitPrice.amount)
    return antes > ahora ? suma + (antes - ahora) * line.quantity : suma
  }, 0)

  // Que el precio salga de un acuerdo y no del catálogo es media explicación de
  // por qué este comprador ve un número distinto al de la vitrina.
  // Mismo criterio que el carrito: la lista general de la tienda no es un acuerdo.
  const conAcuerdo = (quoted?.lines ?? []).some(esAcuerdoDelComprador)

  const subtotal = Number(quoted?.netTotal ?? subtotalLocal)
  const impuesto = quoted ? Number(quoted.taxTotal) : 0
  // `grossTotal` ya viene con el descuento restado: la identidad de la base es
  // `subtotal + impuesto - descuento`, y volver a restarlo aquí lo contaría dos
  // veces. Esta cifra se enseña, no se recalcula.
  const descuento = quoted ? Number(quoted.discountTotal) : 0
  const campanas = quoted?.promotions ?? []
  const total = quoted ? Number(quoted.grossTotal) + (envio?.amount ?? 0) : null

  return (
    <Box
      sx={{
        // Sigue al comprador por los tres pasos: el total es justo lo que hay
        // que tener delante mientras se decide, y en un formulario partido en
        // tres se quedaba arriba, fuera de la vista.
        position: { md: 'sticky' },
        top: { md: 96 },
        p: { xs: 2, md: 2.5 },
        bgcolor: 'var(--card)',
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography component="h2" sx={{ fontSize: TS.cardTitle, fontWeight: 800, flex: 1 }}>
          {t('store.cart.summary')}
        </Typography>
        <Chip
          size="small"
          label={`${unidades} ${unidades === 1 ? t('store.cart.unit') : t('store.cart.units')}`}
          sx={{
            height: 22,
            fontSize: TS.micro,
            fontWeight: 800,
            bgcolor: 'var(--neutral-soft)',
            color: 'var(--muted)',
          }}
        />
      </Stack>

      <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1.5 }}>
        {lines.map((line) => {
          const cotizada = quoted?.lines.find(
            (item) =>
              item.productId === line.product_id && (item.variantId ?? null) === line.variant_id,
          )
          const unitario = Number(cotizada?.unitPrice.amount ?? line.unit_price)
          const monedaLinea = quoted?.currency ?? line.currency
          return (
            <Stack
              component="li"
              key={lineKey(line)}
              direction="row"
              sx={{ gap: 1.25, alignItems: 'flex-start' }}
            >
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  flexShrink: 0,
                  borderRadius: 'var(--sf-radius-sm)',
                  overflow: 'hidden',
                  bgcolor: 'var(--sf-media-bg)',
                }}
              >
                {/* Decorativa: el nombre va al lado, en texto. Repetirlo en el
                    `alt` haría que un lector de pantalla lo leyera dos veces. */}
                <ProductMedia
                  url={line.image_path ? (thumbs[line.image_path] ?? null) : null}
                  alt=""
                  sizePx={16}
                />
              </Box>

              <Stack sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
                <Typography
                  sx={{
                    fontSize: TS.label,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    // Dos líneas y puntos suspensivos: un nombre de producto
                    // ocupa cuatro y empuja el total fuera de la vista.
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {line.name}
                </Typography>
                {line.variant_name && (
                  <Typography sx={{ fontSize: TS.micro, color: 'var(--muted)', fontWeight: 700 }}>
                    {line.variant_name}
                  </Typography>
                )}
                <Typography sx={{ fontSize: TS.micro, color: 'var(--muted)' }}>
                  {line.quantity} × {formatMoney(unitario, monedaLinea, locale)}
                </Typography>
              </Stack>

              <Typography
                sx={{ fontSize: TS.label, fontWeight: 800, whiteSpace: 'nowrap', pt: 0.25 }}
              >
                {formatMoney(unitario * line.quantity, monedaLinea, locale)}
              </Typography>
            </Stack>
          )
        })}
      </Stack>

      <Divider sx={{ my: 1.75 }} />

      <Fila etiqueta={t('store.cart.subtotal')} valor={formatMoney(subtotal, moneda, locale)} />

      {/* Las campañas, con su nombre y ANTES del impuesto: es el orden en que se
          calculan —el impuesto cae sobre lo pagadero— y el orden en que las lee
          quien repasa la cuenta. Sin esta fila el total no cuadraba con la suma
          de las líneas y no había forma de saber por qué. */}
      {descuento > 0 && (
        <>
          <Fila
            etiqueta={t('store.cart.discount')}
            valor={`- ${formatMoney(descuento, moneda, locale)}`}
            destacada
          />
          {campanas.map((promo) => (
            <Typography
              key={promo.id ?? promo.label ?? promo.code}
              sx={{ fontSize: TS.micro, color: 'var(--muted)', mt: -0.5, mb: 0.5 }}
            >
              {promo.label ?? promo.code}
              {promo.amount ? ` · − ${formatMoney(Number(promo.amount), moneda, locale)}` : ''}
            </Typography>
          ))}
        </>
      )}

      {quoted && impuesto > 0 && (
        <Fila etiqueta={t('store.cart.tax')} valor={formatMoney(impuesto, moneda, locale)} />
      )}

      {/* El transporte va SEPARADO del total. Un comprador que ve un total mayor
          que la suma de sus líneas y ninguna línea que lo explique es un
          comprador que abandona el carrito. */}
      {envio && (
        <Fila
          etiqueta={t('store.delivery.shipping')}
          valor={
            envio.amount === 0
              ? t('store.delivery.free')
              : formatMoney(envio.amount, envio.currency, locale)
          }
        />
      )}

      {ahorro > 0 && (
        <Fila
          etiqueta={t('store.cart.savings')}
          valor={`- ${formatMoney(ahorro, moneda, locale)}`}
          destacada
        />
      )}

      {total !== null && (
        <Stack
          direction="row"
          sx={{
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 1,
            mt: 1.5,
            px: 1.5,
            py: 1.25,
            borderRadius: 'var(--sf-radius-sm)',
            bgcolor: 'var(--accent-soft)',
          }}
        >
          <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 800 }}>
            {t('store.cart.total')}
          </Typography>
          <Typography
            sx={{
              fontSize: TS.figure,
              fontWeight: 800,
              lineHeight: 1.1,
              // `accent-deep` y nunca `accent`: sobre el tinte suave, el acento
              // puro no llega a AA como color de TEXTO (contrato §4.4).
              color: 'var(--accent-deep)',
              whiteSpace: 'nowrap',
            }}
          >
            {formatMoney(total, moneda, locale)}
          </Typography>
        </Stack>
      )}

      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: TS.micro, color: 'var(--muted)' }}>
          {estado === 'pidiendo'
            ? t('store.cart.quoting')
            : estado === 'confirmada'
              ? t('store.cart.quoted')
              : estado === 'fallida'
                ? t('store.cart.quoteFailed')
                : t('store.cart.taxNote')}
        </Typography>
        {conAcuerdo && (
          <Chip
            size="small"
            label={t('store.cart.listPrice')}
            sx={{
              height: 20,
              fontSize: TS.micro,
              fontWeight: 800,
              bgcolor: 'var(--accent-soft)',
              color: 'var(--accent-deep)',
            }}
          />
        )}
      </Stack>

      {acciones}
    </Box>
  )
}

/** Una fila de importe. Existe para que las cuatro se alineen igual. */
function Fila({
  etiqueta,
  valor,
  destacada = false,
}: {
  etiqueta: string
  valor: string
  destacada?: boolean
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
      <Typography
        sx={{ fontSize: TS.label, color: destacada ? 'var(--accent-deep)' : 'var(--muted)' }}
      >
        {etiqueta}
      </Typography>
      <Typography
        sx={{
          fontSize: TS.label,
          fontWeight: destacada ? 800 : 700,
          whiteSpace: 'nowrap',
          color: destacada ? 'var(--accent-deep)' : 'var(--text)',
        }}
      >
        {valor}
      </Typography>
    </Stack>
  )
}
