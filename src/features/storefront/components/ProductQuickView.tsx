import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAgreementPrice } from '@/features/pricing/useAgreementPrice'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { AppBreadcrumbs } from '@/shared/ui/AppBreadcrumbs'
import { ErrorState } from '@/shared/ui/states'
import { R, TS } from '@/theme/tokens'
import { track } from '../analytics'
import { useAddToCart } from '../cart/useAddToCart'
import { useGallery, usePublicProduct, usePublicVariants } from '../hooks'
import { discountPercent } from '../types'
import { ProductGallery } from './ProductGallery'
import { QuantityStepper } from './QuantityStepper'
import { useVariantChoice } from '../useVariantChoice'
import { VariantPicker } from './VariantPicker'

/**
 * Vista rápida del producto, en un diálogo sobre el catálogo.
 *
 * **La ficha completa no desaparece: sigue en su URL.** Este diálogo resuelve
 * el caso frecuente —mirar la foto grande, el precio y la descripción sin
 * perder el sitio en la rejilla— y el caso completo se atiende donde siempre.
 * Que la tarjeta siga siendo un enlace de verdad a esa URL es lo que mantiene
 * el clic con rueda, el «abrir en pestaña nueva» y lo que indexa un buscador.
 *
 * Se abre con `?p=<slug>` en la URL y no con un estado del componente: así el
 * botón de atrás lo CIERRA, que es lo que todo el mundo intenta, y el enlace se
 * puede pegar en un chat.
 *
 * **Las variantes se eligen aquí también.** Antes este diálogo mandaba a la
 * ficha para elegir talla o color, con el argumento de que era una decisión con
 * consecuencias sobre precio y stock. Con botones de opción a la vista esa
 * decisión se toma con la misma información que en la ficha —cada talla marcada,
 * las agotadas tachadas y el precio de la elegida en grande—, y obligar a cambiar
 * de página para pulsar «M» era un paso que solo costaba ventas. Es el mismo
 * selector y la misma regla que la ficha (`VariantPicker`), no una copia.
 *
 * Ancho `md` y no `lg`: a lo ancho de 1200 px la mitad derecha se quedaba en
 * blanco. El diálogo se dimensiona por lo que hay dentro, no por lo que cabe en
 * la pantalla.
 */
export function ProductQuickView({
  storeId,
  storeSlug,
  slug,
  onClose,
}: {
  storeId: string
  storeSlug: string
  /** `null` = cerrado. Sale del parámetro `p` de la URL. */
  slug: string | null
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { agregar, pending } = useAddToCart()
  const [quantity, setQuantity] = useState(1)

  const product = usePublicProduct(storeId, slug ?? undefined)
  const gallery = useGallery(product.data?.product_id ?? null)
  const variants = usePublicVariants(product.data)

  // La cantidad vuelve a uno al cambiar de producto. Heredar la del anterior
  // es el camino corto a comprar seis de algo que se miraba de pasada.
  useEffect(() => setQuantity(1), [slug])

  const item = product.data
  const hasVariants = item?.kind === 'variant'
  const { selected, select } = useVariantChoice(variants.data ?? [], hasVariants)
  const variantsPending = hasVariants && variants.isPending
  // Con variante elegida, lo que se enseña y lo que se compra es ELLA: su
  // precio, su tachado y su disponibilidad. El maestro solo manda sin elección.
  const available = hasVariants && selected ? selected.in_stock !== false : item?.in_stock !== false
  const canBuy = available && (!hasVariants || selected !== null)

  /**
   * El precio del acuerdo de quien mira, igual que la ficha completa.
   *
   * Sin esto la tarjeta decía «S/ 55.28 · Precio convenio» y al abrir la vista
   * rápida del MISMO producto salía S/ 61.42, el público: dos precios para una
   * misma cosa, que es exactamente lo que hace desconfiar de la tienda. Misma
   * regla que la tarjeta y la ficha (cotización del servidor, cantidad 1, solo
   * si viene de una lista y mejora el público); con variantes no se pregunta.
   */
  const conAcuerdo = useAgreementPrice(storeSlug, item && !hasVariants ? item : null)
  // Con acuerdo, el tachado es el precio público: el −% de la oferta abierta a
  // todos no es el ahorro de este comprador.
  const shown = item && hasVariants && selected ? { ...item, price: selected.price, compare_at_price: selected.compare_at_price } : item
  const discount = shown && !conAcuerdo ? discountPercent(shown) : null

  return (
    <Dialog
      open={slug !== null}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-label={item?.name ?? t('store.product.quickView')}
      // `sf-scope` en el papel: el diálogo se monta en un portal colgado de
      // `body`, fuera del ámbito de la tienda, y sin la clase cada `var(--sf-*)`
      // de dentro —radios, líneas— resolvía a nada. Se notaba en los botones de
      // talla: borde negro y esquinas rectas. Misma razón que `MyOrderDrawer`.
      slotProps={{
        paper: {
          className: 'sf-scope',
          sx: { borderRadius: 'var(--sf-radius)', bgcolor: 'var(--bg)', backgroundImage: 'none' },
        },
      }}
    >
      {/* Migas a la izquierda y cerrar a la derecha: dónde estás y por dónde
          sales, en la misma línea y sin competir con el nombre del producto. */}
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2.5,
          py: 1.5,
          bgcolor: 'var(--card)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <AppBreadcrumbs
          ariaLabel={t('store.product.breadcrumb')}
          items={[
            { label: t('store.catalog.title'), to: `/s/${storeSlug}` },
            ...(item?.category_name ? [{ label: item.category_name }] : []),
            ...(item ? [{ label: item.name }] : []),
          ]}
        />
        <Button
          onClick={onClose}
          endIcon={<CloseRoundedIcon />}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            color: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: `${R.md}px`,
            flexShrink: 0,
          }}
        >
          {t('store.product.close')}
        </Button>
      </Stack>

      <DialogContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
        {product.isError && (
          <Card sx={{ p: 2 }}>
            <ErrorState error={product.error} onRetry={() => void product.refetch()} />
          </Card>
        )}

        {/* El esqueleto tiene la MISMA forma que el contenido real: si no, el
            diálogo cambia de tamaño al llegar los datos, y uno centrado se
            mueve entero. El PRECIO no se dibuja a propósito: es la única cifra
            de la ficha, y un rectángulo gris con su forma y su sitio se lee
            como un precio que aún no se sabe, o peor, como uno tachado. */}
        {product.isPending && slug !== null && (
          <Stack aria-hidden direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2 }}>
            <Card
              sx={{
                p: 2,
                width: { md: 400 },
                flexShrink: 0,
                borderRadius: 'var(--sf-radius)',
                border: '1px solid var(--sf-line)',
                boxShadow: 'var(--sf-shadow)',
              }}
            >
              <Skeleton
                variant="rectangular"
                sx={{ width: '100%', aspectRatio: '4 / 3', borderRadius: `${R.md}px` }}
              />
            </Card>
            <Card sx={{ p: 2.5, flex: 1 }}>
              <Stack sx={{ gap: 1.25 }}>
                <Skeleton width="80%" height={30} />
                <Skeleton width="35%" height={16} />
                <Skeleton width="25%" height={18} sx={{ mt: 1 }} />
                <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
                  <Skeleton variant="rounded" width={120} height={40} />
                  <Skeleton variant="rounded" width={190} height={40} />
                </Stack>
                <Skeleton variant="rounded" height={120} sx={{ mt: 2 }} />
              </Stack>
            </Card>
          </Stack>
        )}

        {item && (
          /* `flex-start` y no `stretch`: la tarjeta de la galería se estiraba
             hasta la altura de la columna derecha y dejaba un palmo de blanco
             bajo la foto, porque la foto tiene su proporción y no crece. */
          <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2, alignItems: 'flex-start' }}>
            {/* Galería en su propia tarjeta, con las miniaturas dentro.
                400 px y no 300: a 300 la foto de la vista rápida se quedaba en
                una estampilla en la que no se distingue el acabado, que es
                justo lo que se mira antes de comprar. Lo que se pierde a la
                derecha es aire, no contenido. */}
            <Card
              sx={{
                p: 2,
                width: { md: 400 },
                flexShrink: 0,
                borderRadius: 'var(--sf-radius)',
                border: '1px solid var(--sf-line)',
                boxShadow: 'var(--sf-shadow)',
              }}
            >
              <ProductGallery images={gallery.data ?? []} alt={item.name} />
            </Card>

            <Stack sx={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Card
                sx={{
                  p: { xs: 2, md: 2.5 },
                  borderRadius: 'var(--sf-radius)',
                  border: '1px solid var(--sf-line)',
                  boxShadow: 'var(--sf-shadow)',
                }}
              >
                <Stack sx={{ gap: 1 }}>
                  {discount !== null && (
                    <Chip
                      size="small"
                      label={`-${discount}%`}
                      sx={{
                        alignSelf: 'flex-start',
                        bgcolor: 'var(--accent)',
                        color: '#FFFFFF',
                        fontWeight: 800,
                      }}
                    />
                  )}

                  <Typography
                    component="h2"
                    sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 800, lineHeight: 1.25 }}
                  >
                    {item.name}
                  </Typography>

                  {/* Marca y categoría en una línea tenue bajo el título: son
                      contexto, no titular. */}
                  <Typography sx={{ fontSize: TS.body, color: 'var(--muted)' }}>
                    {[item.brand_name, item.category_name].filter(Boolean).join(' / ') || '—'}
                  </Typography>

                  <Stack sx={{ gap: 0, mt: 0.5 }}>
                    {conAcuerdo ? (
                      <Typography
                        component="s"
                        sx={{ fontSize: TS.body, color: 'var(--muted)', fontWeight: 600 }}
                      >
                        {formatMoney(Number(item.price), item.currency, locale)}
                      </Typography>
                    ) : (
                      discount !== null &&
                      shown?.compare_at_price && (
                        <Typography
                          component="s"
                          sx={{ fontSize: TS.body, color: 'var(--muted)', fontWeight: 600 }}
                        >
                          {formatMoney(Number(shown.compare_at_price), item.currency, locale)}
                        </Typography>
                      )
                    )}
                    {/* Sin variante elegida todavía, el precio del maestro es un
                        «desde»: anunciarlo a secas sería prometer uno que quizá
                        no es el de la talla que se va a pulsar. */}
                    {hasVariants && !selected && item.variant_count > 1 && (
                      <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', fontWeight: 700 }}>
                        {t('store.product.priceFrom')}
                      </Typography>
                    )}
                    <Typography
                      sx={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatMoney(
                        conAcuerdo ? conAcuerdo.amount : Number(shown?.price ?? item.price),
                        conAcuerdo?.currency ?? item.currency,
                        locale,
                      )}
                    </Typography>
                    {/* Por qué ese precio y no el del catálogo: sin la línea, un
                        número más bajo parece un error que cambiará en la caja. */}
                    {conAcuerdo && (
                      <Typography sx={{ fontSize: TS.label, color: 'var(--accent-deep)', fontWeight: 700 }}>
                        {t('store.product.agreementPrice')}
                      </Typography>
                    )}
                  </Stack>

                  <Chip
                    size="small"
                    label={
                      available
                        ? t('store.availability.inStock')
                        : t('store.availability.outOfStock')
                    }
                    sx={{
                      alignSelf: 'flex-start',
                      fontWeight: 800,
                      fontSize: TS.label,
                      bgcolor: available ? 'var(--accent-soft)' : 'var(--neutral-soft)',
                      color: available ? 'var(--accent-deep)' : 'var(--muted)',
                    }}
                  />

                  {/* La variante, la cantidad y la compra son UNA decisión, así
                      que se anuncian como un grupo. La variante va encima, a
                      todo el ancho: una fila de tallas no cabe al lado de un
                      botón. */}
                  <Stack
                    role="group"
                    aria-label={t('store.product.buyGroup')}
                    sx={{ gap: 1.5, mt: 1.5 }}
                  >
                    {hasVariants &&
                      (variantsPending ? (
                        <Skeleton variant="rounded" height={44} />
                      ) : (
                        <VariantPicker
                          productName={item.name}
                          variants={variants.data ?? []}
                          selected={selected}
                          onSelect={select}
                        />
                      ))}

                    {hasVariants && selected?.in_stock === false && (
                      <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', fontWeight: 600 }}>
                        {t('store.product.combinationOutOfStock')}
                      </Typography>
                    )}

                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      <QuantityStepper
                        value={quantity}
                        onChange={setQuantity}
                        disabled={!canBuy}
                      />
                      <Button
                        variant="contained"
                        startIcon={
                          pending ? (
                            <CircularProgress size={14} color="inherit" />
                          ) : (
                            <ShoppingCartRoundedIcon />
                          )
                        }
                        disabled={!canBuy || pending}
                        onClick={() => {
                          void agregar(item, quantity, hasVariants ? selected : null)
                          track(storeSlug, {
                            type: 'add_to_cart',
                            product_id: item.product_id,
                            ...(hasVariants && selected ? { variant_id: selected.variant_id } : {}),
                            quantity,
                          })
                          onClose()
                        }}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        {t('store.product.addToCart')}
                      </Button>
                      <Button
                        component={Link}
                        to={`/s/${storeSlug}/product/${item.slug}`}
                        variant="outlined"
                        endIcon={<OpenInFullRoundedIcon />}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        {t('store.product.detail')}
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </Card>

              {/* La descripción, sola y a todo el ancho del panel.
                  Compartía sitio con una columna de marca, categoría y
                  disponibilidad —los tres datos que ya están arriba, en la
                  tarjeta del precio— y esa columna se dimensionaba a
                  `max-content`: con una categoría larga como «Accesorios Para
                  Alimentación Infantil» se quedaba con 370 px y dejaba el texto
                  en una tira de dos palabras por línea. Se leía peor que si no
                  estuviera. */}
              <Card sx={{ p: { xs: 2, md: 2.5 }, bgcolor: 'var(--neutral-soft)' }}>
                <Typography
                  component="h3"
                  sx={{ fontSize: TS.cardTitle, fontWeight: 800, mb: 0.75 }}
                >
                  {t('store.product.description')}
                </Typography>
                <ProductDescription text={item.description?.trim() ?? ''} />
              </Card>
            </Stack>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A partir de cuántos caracteres la descripción se pliega.
 *
 * Es un umbral de TEXTO y no de píxeles medidos: medir el alto real obliga a
 * pintar, leer el DOM y volver a pintar, y el resultado cambia con el ancho del
 * diálogo, con la fuente del tenant y con el zoom. Unos 340 caracteres son las
 * seis líneas que se enseñan plegadas en el ancho de este panel; pasarse en una
 * línea no rompe nada, y a cambio la decisión es la misma en todas las pantallas.
 */
const DESCRIPCION_LARGA = 340

/** Cuántas líneas se ven mientras está plegada. */
const LINEAS_PLEGADA = 6

/**
 * La descripción del producto, que puede venir de dos palabras o de dos folios.
 *
 * Las dos formas tienen que caber en la MISMA vista rápida:
 *
 *  · **Corta** — se pinta entera y sin más. Ningún botón que abrir, ningún
 *    hueco reservado por si acaso.
 *  · **Larga** — se pliega a seis líneas con un «leer la descripción completa».
 *    La vista rápida existe para decidir sin salir del catálogo; si dos folios
 *    de ficha técnica empujan el precio y el botón de comprar fuera de la
 *    pantalla, deja de ser rápida y hay que desplazarse hacia arriba para
 *    comprar, que es justo lo que se venía a evitar.
 *
 * El botón dice qué va a hacer —no «leer más» a secas— porque en una vista con
 * otro botón que lleva a la ficha entera, «más» no distingue entre desplegar
 * aquí y cambiar de página.
 */
function ProductDescription({ text }: { text: string }) {
  const { t } = useI18n()
  const [desplegada, setDesplegada] = useState(false)
  const larga = text.length > DESCRIPCION_LARGA

  return (
    <Stack sx={{ gap: 0.75, alignItems: 'flex-start' }}>
      <Typography
        sx={{
          fontSize: TS.body,
          color: 'var(--muted)',
          lineHeight: 1.6,
          whiteSpace: 'pre-line',
          // Tope de medida: pasada de ~65 caracteres, la línea obliga a buscar
          // el principio de la siguiente con la vista, y eso cansa antes de la
          // tercera. Ahora hay ancho de sobra, así que el tope lo pone esto y
          // no la columna de al lado.
          maxWidth: '68ch',
          ...(larga && !desplegada
            ? {
                display: '-webkit-box',
                WebkitLineClamp: LINEAS_PLEGADA,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : {}),
        }}
      >
        {text || t('store.product.noDescription')}
      </Typography>

      {larga ? (
        <Button
          size="small"
          onClick={() => setDesplegada((abierta) => !abierta)}
          sx={{ textTransform: 'none', fontWeight: 700, px: 0.5 }}
        >
          {desplegada ? t('store.product.readLess') : t('store.product.readMore')}
        </Button>
      ) : null}
    </Stack>
  )
}
