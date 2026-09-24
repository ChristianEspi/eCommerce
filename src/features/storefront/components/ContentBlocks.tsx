import { SectionHeading } from './SectionHeading'
import { SliderBlock } from './SliderBlock'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, Button, Card, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatMoney } from '@/shared/lib/format'
import { isInternalPath, isSafeHref } from '@/domain/href'
import { RichText } from '@/shared/ui/RichText'
import { TS } from '@/theme/tokens'
import { blockLayoutOf, type ProductCollectionLayout } from '@/domain/content'
import type { ContentBlock, ContentCollectionItem } from '../content'
import { moneyCorto, offerBadge, vigenciaTexto } from '../offer'
import {
  CategoryDoor,
  CategoryDoorGrid,
  CategoryPills,
  type CategoryDoorItem,
} from './CategoryDoors'
import { CategoryMosaic } from './CategoryMosaic'
import { ProductMedia } from './ProductMedia'
import { LoopingRow } from './LoopingRow'
import { StoreSectionFrame } from './StoreSectionFrame'
import { StoreSplitBand } from './StoreSplitBand'

/**
 * Las puertas de categoría se mudaron a `CategoryDoors.tsx` en Storefront
 * V2 · P03: las usan el CMS, la portada y —desde P13— la vista previa del
 * backoffice, y ninguna de las tres necesita el resolvedor de bloques del CMS
 * para pintar un azulejo. Se reexportan para no tocar a quien las importaba de
 * aquí.
 */
export { CategoryDoorGrid, type CategoryDoorItem }

/**
 * La foto de cada categoría, por id y ya firmada (Storefront V2 · P03).
 *
 * Llega firmada porque el bucket es privado y firmar por puerta serían tantas
 * peticiones como categorías. Quien lo arma es la pantalla, que ya tiene la
 * lista completa de categorías de la tienda.
 */
export type CategoryMedia = Readonly<
  Record<string, { readonly imageUrl?: string | null; readonly imageAlt?: string | null }>
>

/**
 * Pinta los bloques de una página del CMS (P11-SaaS).
 *
 * **Un componente por TIPO, no uno por tenant.** El encargo lo pide con esas
 * palabras («no dupliques componentes por tenant») y aquí es donde se cumple o
 * no: lo que cambia entre dos tiendas son los DATOS del bloque y los tokens del
 * tema, nunca el árbol de React. Si algún día hiciera falta un `if` por nombre
 * de comercio, lo que falta es un tipo de bloque.
 *
 * Todo lo que llega ya está resuelto y filtrado por el servidor: qué bloques
 * están vigentes, en qué orden y con qué productos dentro. Aquí no se decide
 * visibilidad — decidirla en dos sitios es como se acaba enseñando en la
 * vitrina algo que el editor daba por despublicado.
 */
export function ContentBlocks({
  blocks,
  storeSlug,
  assets,
  images,
  currency,
  leadingHeading = false,
  categoryMedia = {},
}: {
  blocks: readonly ContentBlock[]
  storeSlug: string
  /** Rutas de `store-assets` ya firmadas. */
  assets: Record<string, string>
  /**
   * Storefront V2 · P03 · La foto de cada categoría, por id y ya firmada.
   *
   * Opcional y vacío por defecto: una página del CMS que no la pase pinta sus
   * puertas con tinte e icono, que es lo que hacían antes de esta fase.
   */
  categoryMedia?: CategoryMedia
  /** Rutas de `product-images` ya firmadas. */
  images: Record<string, string>
  /** Moneda de la tienda: sin ella, «20 de descuento» no dice de que. */
  currency?: string
  /**
   * El primer `hero` de la lista es el ENCABEZADO de la página (P15-SaaS).
   *
   * Lo usa la portada, donde el hero del CMS sustituye al de `store_settings`:
   * sin esto la página se quedaba sin `<h1>` en cuanto el comercio publicaba
   * una portada, y el documento pasaba a empezar por un `<h2>`. Es `false` por
   * defecto porque en `/p/:slug` el `<h1>` es el título de la página y un
   * segundo `<h1>` no ordena nada, lo desordena.
   */
  leadingHeading?: boolean
}) {
  if (blocks.length === 0) return null

  const leadHeroId = leadingHeading ? blocks.find((block) => block.type === 'hero')?.id : undefined

  return (
    <Stack sx={{ gap: { xs: 2, md: 3 } }}>
      {groupCampaigns(blocks).map((group, orden) => (
        <Seccion key={group[0].id} block={group[0]} orden={orden}>
          {group.length > 1 ? (
            <CampaignWall blocks={group} assets={assets} currency={currency} />
          ) : (
            <ContentBlockView
              block={group[0]}
              storeSlug={storeSlug}
              assets={assets}
              images={images}
              currency={currency}
              categoryMedia={categoryMedia}
              heading={group[0].id === leadHeroId ? 'h1' : 'h2'}
            />
          )}
        </Seccion>
      ))}
    </Stack>
  )
}

/**
 * El fondo de una seccion.
 *
 * Una portada larga con todo sobre el mismo blanco se lee como una lista sin
 * fin: no hay forma de ver de un vistazo donde acaba una cosa y empieza otra.
 * Un tinte muy suave detras de cada seccion resuelve eso sin meter una linea
 * divisoria en cada hueco.
 *
 * ## De donde salen los colores
 *
 * De los tokens del TENANT (`--accent` y `--accent2`), rebajados al 6 % con
 * `color-mix`. No hay ni un color escrito a mano: la regla del repositorio es
 * que el acento es 100 % del comercio, asi que una paleta pastel fija —rosa,
 * azul, verde— seria meterle a cada tienda tres colores que no eligio. Al 6 %
 * el tinte separa y no compite: el texto sigue sobre un fondo practicamente
 * blanco y el contraste AA no se toca.
 *
 * El primero va sin tinte a proposito. Con todas las secciones tenidas, la
 * alternancia deja de leerse como ritmo y pasa a leerse como franjas.
 *
 * El comercio puede fijarlo por bloque con `settings.background` —clave que ya
 * estaba en el vocabulario cerrado del CMS, sin migracion— cuando el orden
 * automatico no le sirva.
 */
const TINTES = {
  none: 'transparent',
  accent: 'color-mix(in srgb, var(--accent) 6%, transparent)',
  accent2: 'color-mix(in srgb, var(--accent2) 6%, transparent)',
  neutral: 'var(--neutral-soft)',
} as const

function tinteDe(block: ContentBlock, orden: number): string {
  const declarado = block.settings.background
  if (typeof declarado === 'string' && declarado in TINTES) {
    return TINTES[declarado as keyof typeof TINTES]
  }
  // El hero y el carrusel de imagenes traen su propio fondo —un degradado, una
  // foto a sangre—: tenirlos solo pondria un marco de color alrededor.
  if (block.type === 'hero' || block.type === 'banner' || block.type === 'slider') {
    return TINTES.none
  }
  return [TINTES.none, TINTES.accent, TINTES.accent2][orden % 3] ?? TINTES.none
}

function Seccion({
  block,
  orden,
  children,
}: {
  block: ContentBlock
  orden: number
  children: React.ReactNode
}) {
  const tinte = tinteDe(block, orden)
  if (tinte === TINTES.none) return <>{children}</>

  return (
    <Box
      sx={{
        bgcolor: tinte,
        borderRadius: 'var(--sf-radius)',
        // El tinte necesita aire: pegado al contenido parece un fallo de
        // pintado en vez de una seccion.
        p: { xs: 1.5, md: 2.5 },
        // Y se sale un poco del ancho del contenido para que el bloque de
        // dentro siga alineado con el resto de la portada.
        mx: { xs: -1.5, md: -2.5 },
        // Un bloque puede no pintar NADA —una coleccion sin productos, un
        // texto sin cuerpo— y entonces esto quedaba como una banda de color
        // vacia en medio de la portada, que parece un fallo de carga. Sin
        // hijos, la seccion no existe.
        '&:empty': { display: 'none' },
      }}
    >
      {children}
    </Box>
  )
}

/**
 * Agrupa las campanas CONSECUTIVAS; todo lo demas viaja de una en una.
 *
 * Dos promociones seguidas, cada una ocupando el ancho entero, obligan a
 * desplazar la portada para descubrir que existe la segunda — y la segunda
 * nunca se ve. Puestas en fila se comparan de un vistazo, que es lo que hace
 * alguien delante de varias ofertas.
 *
 * Se agrupan solo las contiguas a proposito: el orden lo decide el editor en el
 * CMS, y reordenar aqui seria pintar una portada que el editor no compuso.
 */
type BlockGroup = readonly [ContentBlock, ...ContentBlock[]]

function groupCampaigns(blocks: readonly ContentBlock[]): BlockGroup[] {
  const groups: [ContentBlock, ...ContentBlock[]][] = []
  for (const block of blocks) {
    const last = groups[groups.length - 1]
    if (block.type === 'campaign' && last && last[0].type === 'campaign') last.push(block)
    else groups.push([block])
  }
  return groups
}

/** Varias campanas vigentes, en rejilla. Tres por fila es el limite legible. */
function CampaignWall({
  blocks,
  assets,
  currency,
}: {
  blocks: readonly ContentBlock[]
  assets: Record<string, string>
  currency?: string
}) {
  const { t } = useI18n()

  return (
    <Stack component="section" aria-label={t('store.content.campaignWall')} sx={{ gap: 1.5 }}>
      <SectionHeading title={t('store.content.campaignWall')} />
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 1.5, md: 2 },
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: `repeat(${Math.min(blocks.length, 3)}, minmax(0, 1fr))`,
          },
        }}
      >
        {blocks.map((block) => (
          <CampaignBlock key={block.id} block={block} assets={assets} currency={currency} dense />
        ))}
      </Box>
    </Stack>
  )
}

/** Una URL externa se pinta tal cual; una ruta del bucket, ya firmada. */
function mediaUrl(value: string | null, assets: Record<string, string>): string | null {
  if (!value) return null
  if (/^https:\/\//i.test(value)) return value
  return assets[value] ?? null
}

function ContentBlockView({
  block,
  storeSlug,
  assets,
  images,
  currency,
  categoryMedia,
  heading,
}: {
  block: ContentBlock
  storeSlug: string
  assets: Record<string, string>
  images: Record<string, string>
  currency?: string
  categoryMedia: CategoryMedia
  heading: 'h1' | 'h2'
}) {
  switch (block.type) {
    case 'hero':
      return <HeroBlock block={block} assets={assets} heading={heading} />
    case 'banner':
      return <BannerBlock block={block} assets={assets} />
    case 'slider':
      return <SliderBlock block={block} assets={assets} />
    case 'campaign':
      return <CampaignBlock block={block} assets={assets} currency={currency} />
    case 'rich_text':
      return <RichTextBlock block={block} />
    case 'category_collection':
      return (
        <CategoryCollectionBlock
          block={block}
          storeSlug={storeSlug}
          categoryMedia={categoryMedia}
        />
      )
    default:
      return <ProductCollectionBlock block={block} storeSlug={storeSlug} images={images} />
  }
}

/**
 * Botón de llamada a la acción. Interno → `Link`; externo → `<a>`.
 *
 * El destino se vuelve a comprobar aquí, en el borde por el que entra al DOM
 * (P16-SaaS). `internal` NO puede ser `startsWith('/')`: `/\evil.com` empieza
 * por `/` y el navegador la resuelve a otro dominio, así que ese `if` decidía
 * «esto es interno» sobre una cadena que no lo era. `isInternalPath` es la
 * misma pregunta hecha bien.
 */
/**
 * Velo de la portada SIN foto.
 *
 * El degradado de suite es oscuro por arriba y verde medio por abajo, y encima
 * iba texto en `--text`, que en claro es casi negro: negro sobre verde es el
 * peor contraste de la pantalla y ademas se ve viejo. Ahora el texto es blanco
 * SIEMPRE, y para que eso valga con cualquier acento —el color es del tenant y
 * puede ser un amarillo palido— se tumba un velo oscuro por encima del
 * degradado antes del texto. El acento sigue mandando en el ambiente; lo que se
 * garantiza es el suelo de contraste.
 */
const HERO_SCRIM =
  'linear-gradient(180deg, rgba(6,20,16,0.25) 0%, rgba(6,20,16,0.55) 60%, rgba(6,20,16,0.72) 100%)'

function BlockCta({
  block,
  contrast = false,
  quiet = false,
}: {
  block: ContentBlock
  contrast?: boolean
  /**
   * El botón sin relleno, para cuando hay varios a la vez.
   *
   * Tres píldoras oscuras en fila pesan más que las tres ofertas que vienen a
   * anunciar: lo primero que ve el ojo acaba siendo el botón, y el botón es lo
   * último que hace falta leer. En texto con flecha sigue siendo el mismo
   * enlace, con la misma área de pulsación, y deja el peso al descuento.
   */
  quiet?: boolean
}) {
  if (!block.ctaHref || !block.ctaLabel || !isSafeHref(block.ctaHref)) return null

  const internal = isInternalPath(block.ctaHref)
  const sx = {
    alignSelf: 'flex-start',
    fontWeight: 700,
    textTransform: 'none' as const,
    borderRadius: 'var(--sf-pill)',
    px: quiet ? 0 : 2.5,
    py: quiet ? 0.5 : 1,
    boxShadow: 'none',
    ...(quiet
      ? {
          color: 'var(--accent-deep)',
          '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
        }
      : {}),
    ...(contrast
      ? {
          bgcolor: '#FFFFFF',
          color: 'var(--accent-deep)',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.9)', boxShadow: 'none' },
        }
      : { '&:hover': { boxShadow: 'none' } }),
  }
  const variant = quiet ? 'text' : 'contained'
  const contenido = quiet ? `${block.ctaLabel} \u2192` : block.ctaLabel

  return internal ? (
    <Button component={Link} to={block.ctaHref} variant={variant} sx={sx}>
      {contenido}
    </Button>
  ) : (
    <Button
      component="a"
      href={block.ctaHref}
      target="_blank"
      rel="noopener noreferrer"
      variant={variant}
      sx={sx}
    >
      {contenido}
    </Button>
  )
}

/**
 * Hero: la primera pantalla. Misma anatomía que `StoreHero` —degradado de
 * tokens cuando no hay imagen, degradado vertical cuando la hay— para que una
 * portada con CMS y una sin él no parezcan dos productos distintos.
 */
function HeroBlock({
  block,
  assets,
  heading = 'h2',
}: {
  block: ContentBlock
  assets: Record<string, string>
  heading?: 'h1' | 'h2'
}) {
  const url = mediaUrl(block.mediaUrl, assets)

  return (
    <Box
      component="section"
      aria-label={block.title ?? undefined}
      sx={{
        position: 'relative',
        borderRadius: 'var(--sf-radius)',
        overflow: 'hidden',
        background: url ? 'var(--neutral-soft)' : 'var(--hero-grad)',
        // 340 y no 400: el texto vive abajo, y con 400 la mitad superior era
        // degradado y nada mas. Aire, no vacio.
        minHeight: { xs: 260, md: 340 },
        display: 'flex',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      {url ? (
        <>
          <Box
            component="img"
            src={url}
            alt={block.mediaAlt ?? ''}
            aria-hidden={block.mediaAlt ? undefined : true}
            // El hero es lo primero que se ve: es el candidato a LCP de la
            // portada. `lazy` aquí lo RETRASA (el navegador espera al layout
            // para decidir si está en pantalla) y `fetchPriority="high"` le
            // gana el turno a las miniaturas del catálogo, que sí van
            // perezosas. Ninguna de las dos cosas cambia lo que se descarga.
            loading="eager"
            fetchPriority="high"
            decoding="async"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.78) 100%)',
            }}
          />
        </>
      ) : (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: HERO_SCRIM }} />
      )}

      <Stack
        sx={{
          position: 'relative',
          justifyContent: 'flex-end',
          gap: 1.5,
          p: { xs: 3, md: 6 },
          maxWidth: 680,
          color: '#FFFFFF',
        }}
      >
        {block.title ? (
          <Typography
            component={heading}
            sx={{
              fontSize: { xs: 30, md: 52 },
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              textWrap: 'balance',
            }}
          >
            {block.title}
          </Typography>
        ) : null}
        {block.subtitle ? (
          <Typography
            sx={{
              fontSize: { xs: TS.bodyStrong, md: 17 },
              lineHeight: 1.55,
              maxWidth: 560,
              opacity: 0.92,
            }}
          >
            {block.subtitle}
          </Typography>
        ) : null}
        {/* Contraste SIEMPRE, no solo con foto: desde que el texto es blanco,
            la portada sin imagen tambien es una superficie oscura, y el boton
            de acento sobre el degradado del acento era verde sobre verde. */}
        <BlockCta block={block} contrast />
      </Stack>
    </Box>
  )
}

/** Banner: más bajo que el hero y con la imagen al lado, no detrás. */
function BannerBlock({ block, assets }: { block: ContentBlock; assets: Record<string, string> }) {
  const url = mediaUrl(block.mediaUrl, assets)
  const reverse = block.settings.reverse === true

  /**
   * Las tres disposiciones del banner (V3 · P08).
   *
   *  · `contained` es la de siempre: una franja dentro del ancho de la página,
   *    con la imagen al 40 % y su alto limitado a 260 px. Es el banner
   *    informativo —«Envíos a todo el país», si el comercio lo escribió— y ese
   *    tope es lo que evita que ocupe la primera pantalla entera.
   *  · `bleed` es la misma franja llevada al ancho de la ventana. NO trae
   *    cálculo propio: lo hace el marco de sección de P06, que es donde vive el
   *    único `50vw` de la vitrina — repetir ese truco por bloque es cómo
   *    aparece una barra de desplazamiento horizontal en toda la tienda.
   *  · `split` es mitad y mitad, con la imagen sin tope de alto y el mensaje en
   *    su propia mitad. Es la composición de una campaña, no de un aviso: la
   *    imagen deja de ser una viñeta al lado del texto y pasa a ser la mitad del
   *    argumento.
   */
  const disposicion = blockLayoutOf('banner', block.settings)
  const aSangre = disposicion === 'bleed'
  const mitades = disposicion === 'split'

  const tarjeta = (
    <Card
      component="section"
      aria-label={block.title ?? undefined}
      data-banner-layout={disposicion}
      sx={{
        p: 0,
        overflow: 'hidden',
        // A sangre, el borde redondeado no tiene sentido: los cantos se salen
        // de la pantalla, así que solo se vería el de abajo a medias.
        ...(aSangre ? { borderRadius: 0, borderInline: 'none' } : {}),
      }}
    >
      <Stack
        direction={{ xs: 'column', md: reverse ? 'row-reverse' : 'row' }}
        sx={{ alignItems: 'stretch' }}
      >
        {url ? (
          <Box
            component="img"
            src={url}
            alt={block.mediaAlt ?? ''}
            aria-hidden={block.mediaAlt ? undefined : true}
            loading="lazy"
            decoding="async"
            // `aspectRatio` (P15-SaaS): sin él el hueco de la imagen valía cero
            // hasta que la imagen llegaba, y el texto del banner —que en móvil
            // va DEBAJO— caía de golpe media pantalla. Con la proporción
            // declarada el navegador reserva el sitio antes de descargarla.
            sx={{
              // Mitad y mitad en `split`, y sin tope de alto: ahí la imagen ES
              // la mitad del argumento, y limitarla a 260 px la devolvía a ser
              // una viñeta al lado del texto.
              width: { xs: '100%', md: mitades ? '50%' : '40%' },
              aspectRatio: { xs: '16 / 9', md: 'auto' },
              ...(mitades ? { minHeight: { md: 320 } } : { maxHeight: 260 }),
              objectFit: 'cover',
            }}
          />
        ) : null}
        <Stack
          sx={{
            gap: 1,
            // Más aire en `split`: una mitad de pantalla con el relleno de una
            // franja deja el texto pegado al canto de la imagen.
            p: mitades ? { xs: 2.5, md: 5 } : { xs: 2.5, md: 3.5 },
            justifyContent: 'center',
            flex: 1,
          }}
        >
          {block.title ? (
            <Typography component="h2" sx={{ fontSize: TS.pageTitle, fontWeight: 800 }}>
              {block.title}
            </Typography>
          ) : null}
          {block.subtitle ? (
            <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', lineHeight: 1.6 }}>
              {block.subtitle}
            </Typography>
          ) : null}
          <RichText doc={block.body} />
          <BlockCta block={block} />
        </Stack>
      </Stack>
    </Card>
  )

  // El ancho de ventana, con el primitivo de P06 y su `50vw` único.
  if (!aSangre) return tarjeta
  return (
    <StoreSectionFrame
      presentation={{ variant: disposicion, surface: 'plain', width: 'bleed' }}
      sectionId={`cms-banner-${block.id}`}
    >
      {tarjeta}
    </StoreSectionFrame>
  )
}

/**
 * El medallón del descuento.
 *
 * Sustituye al panel de color que ocupaba media tarjeta para escribir dentro
 * «Promoción vigente» — lo mismo que ya decía el rótulo de al lado, en grande y
 * ocupando el sitio de la información. Un cartel que se repite a sí mismo no
 * informa: gasta espacio.
 *
 * Ahora ese hueco vale algo: cuando la campaña sabe cuánto descuenta lo enseña
 * («-20 %», «3x2»); cuando no —porque nadie ha declarado la forma del descuento
 * todavía— cae a la etiqueta de oferta, que ocupa 56 píxeles y no una columna.
 */
function OfferMedallion({ badge, dense }: { badge: string | null; dense: boolean }) {
  // En la pieza ancha el descuento es el argumento: comparte sitio con el botón
  // y tiene que leerse desde la misma distancia que el titular. En el mural es
  // una marca de esquina y ahí 52 px es todo lo que cabe sin tapar la foto.
  const lado = dense ? 52 : 78

  return (
    <Box
      aria-hidden
      sx={{
        width: badge ? 'auto' : lado,
        minWidth: lado,
        height: lado,
        px: badge ? 1.5 : 0,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--sf-radius-sm)',
        bgcolor: 'color-mix(in srgb, var(--accent) 16%, var(--card))',
        border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
        color: 'var(--accent-deep)',
      }}
    >
      {badge ? (
        <Typography
          sx={{
            fontSize: dense ? 20 : 32,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </Typography>
      ) : (
        <LocalOfferRoundedIcon sx={{ fontSize: dense ? 24 : 34 }} />
      )}
    </Box>
  )
}

/**
 * Bloque de campaña.
 *
 * `campaignLive` viene del servidor y dice si la promoción a la que apunta está
 * descontando AHORA. Lo que NO viene —ni puede venir— es el código del cupón:
 * enumerar los códigos activos de una tienda a un comprador anónimo sería
 * regalar el folleto de las campañas secretas (misma decisión que P10 tomó al
 * no reportar las campañas que exigen cupón y no lo traen).
 *
 * La tarjeta dice tres cosas y en este orden: **cuánto** (el medallón), **de
 * qué** (el título y su frase) y **hasta cuándo** (la línea de estado). Antes
 * decía cuatro veces que era una promoción vigente —el rótulo, el chip, un
 * panel de color con la palabra escrita en grande y la fecha— y ninguna vez
 * cuánto descontaba.
 *
 * Dos formas para dos sitios, y la diferencia no es decorativa:
 *
 *  · **sola**, a lo ancho de la portada: en fila —descuento, texto, botón— para
 *    que el ancho se use en vez de dejar medio cartel en blanco;
 *  · **`dense`**, dentro de un mural de varias: en columna y con el enlace
 *    abajo del todo, para que tres tarjetas terminen a la misma altura y se
 *    puedan comparar de un vistazo.
 */
function CampaignBlock({
  block,
  assets,
  currency,
  dense = false,
}: {
  block: ContentBlock
  assets: Record<string, string>
  currency?: string
  dense?: boolean
}) {
  const { t, locale } = useI18n()
  const url = mediaUrl(block.mediaUrl, assets)
  const badge = offerBadge(block.campaign, t, locale, currency)
  // Hasta cuándo, en UNA línea. «Activa» + «Hasta el 30 set. 2026» eran dos
  // frases para un solo dato: el año sobra en una campaña que dura semanas, y
  // la urgencia solo se nombra cuando existe.
  const vigencia = block.campaignLive ? vigenciaTexto(block.campaignEndsAt, t, locale) : null
  const acaba = vigencia?.urgente ?? false

  const foto = url ? (
    <Box
      component="img"
      src={url}
      alt={block.mediaAlt ?? ''}
      aria-hidden={block.mediaAlt ? undefined : true}
      loading="lazy"
      decoding="async"
      // Proporción declarada: sin ella la tarjeta salta cuando la foto llega.
      sx={{
        width: dense ? '100%' : { xs: '100%', sm: 300, md: 360 },
        height: dense ? 150 : { xs: 200, sm: 'auto' },
        minHeight: dense ? 150 : 240,
        // Y su TECHO. Con el alto en `auto` y solo un mínimo, una foto vertical
        // se pintaba a su proporción natural —360 px de ancho por lo que
        // hiciera falta de alto— y estiraba la tarjeta hasta dejar el texto
        // flotando en el centro de un rectángulo enorme. El comercio sube la
        // foto que tiene; el marco lo pone la vitrina.
        maxHeight: dense ? 150 : 320,
        // A lo ancho la foto es el producto y se ve ENTERA; en el mural es una
        // ilustración de cabecera y ahí recortar mantiene las tres tarjetas
        // iguales. Recortar el producto en la pieza grande esconde justo lo que
        // se está anunciando.
        objectFit: dense ? 'cover' : 'contain',
        objectPosition: 'center',
        p: dense ? 0 : { xs: 1, md: 2 },
        flexShrink: 0,
        bgcolor: 'var(--sf-media-bg)',
      }}
    />
  ) : null

  /**
   * ¿Lleva enlace esta campaña?
   *
   * Importa para la maqueta del mural: la rejilla estira todas las tarjetas a la
   * altura de la más alta, y la que no tiene enlace reservaba igualmente el
   * hueco del fondo (`mt: 'auto'`). El resultado era una tarjeta con el texto
   * pegado arriba y un agujero debajo — que es exactamente lo que se ve en una
   * portada donde una campaña trae subtítulo y la de al lado no.
   */
  const tieneCta = Boolean(block.ctaHref && block.ctaLabel && isSafeHref(block.ctaHref))

  const textos = (
    <Stack
      sx={{
        gap: 0.75,
        flex: 1,
        minWidth: 0,
        height: '100%',
        // Sin enlace no hay nada que anclar al fondo: el contenido se centra y
        // el aire sobrante se reparte arriba y abajo en vez de acumularse
        // debajo. Con enlace manda `mt: 'auto'`, que ya alinea los enlaces de
        // todas las tarjetas a la misma altura.
        justifyContent: dense && !tieneCta ? 'center' : 'flex-start',
      }}
    >
      <Typography
        component="h2"
        sx={{
          // A lo ancho es la pieza de cabecera de la portada: el titular tiene
          // que pesar como tal. A 24 px competía con el título de la fila de
          // productos que viene debajo.
          fontSize: dense ? { xs: 18, md: 19 } : { xs: 26, md: 34 },
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1.15,
        }}
      >
        {block.title}
      </Typography>

      {block.subtitle ? (
        <Typography
          sx={{
            fontSize: dense ? TS.body : { xs: TS.bodyStrong, md: 16.5 },
            color: 'var(--muted)',
            maxWidth: '52ch',
            // En el mural las tarjetas van a la par: dos líneas cada una, y la
            // que se pase se corta en vez de estirar su columna. A lo ancho hay
            // sitio para tres.
            display: '-webkit-box',
            WebkitLineClamp: dense ? 2 : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {block.subtitle}
        </Typography>
      ) : null}

      {/* Estado en una sola línea: hasta cuándo, el mínimo si lo hay, y el
          aviso de cupón. Tres datos distintos, no tres formas de decir que la
          promoción existe. */}
      <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap', pt: 0.25 }}>
        {vigencia ? (
          <Typography
            sx={{
              fontSize: TS.label,
              fontWeight: 800,
              color: acaba ? 'var(--accent-deep)' : 'var(--muted)',
              ...(acaba
                ? {
                    px: 1,
                    py: 0.25,
                    borderRadius: 'var(--sf-pill)',
                    bgcolor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                  }
                : {}),
            }}
          >
            {vigencia.texto}
          </Typography>
        ) : null}

        {block.campaign?.minSubtotal && currency ? (
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {t('store.content.offer.minSubtotal').replace(
              '{amount}',
              moneyCorto(block.campaign.minSubtotal, currency, locale),
            )}
          </Typography>
        ) : null}

        {/* Que hace falta un código se dice; cuál es, no. Prometer un descuento
            que no se aplica solo decepciona en el carrito. */}
        {block.campaign?.needsCoupon ? (
          <Typography
            sx={{
              fontSize: TS.label,
              fontWeight: 700,
              color: 'var(--text)',
              px: 1,
              py: 0.25,
              borderRadius: 'var(--sf-pill)',
              border: '1px solid var(--sf-line-strong)',
            }}
          >
            {t('store.content.offer.needsCoupon')}
          </Typography>
        ) : null}
      </Stack>

      {/* En el mural el enlace va al fondo de la tarjeta: así las tres filas de
          enlaces quedan a la misma altura aunque una campaña traiga una línea
          más que otra. */}
      {dense && tieneCta ? (
        <Box sx={{ mt: 'auto', pt: 0.75 }}>
          <BlockCta block={block} quiet />
        </Box>
      ) : null}
    </Stack>
  )

  return (
    <Card
      component="section"
      aria-label={block.title ?? undefined}
      sx={{
        p: 0,
        position: 'relative',
        overflow: 'hidden',
        height: dense ? '100%' : undefined,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
        // La pieza ancha es cabecera de portada: un tinte del acento al 5 % la
        // separa del blanco de todo lo demás sin meter un color que no sea del
        // comercio. En el mural se queda blanca — tres tarjetas teñidas seguidas
        // dejan de ser piezas y pasan a ser una franja.
        bgcolor: dense ? 'var(--card)' : 'color-mix(in srgb, var(--accent) 5%, var(--card))',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        '@media (hover: hover)': {
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 'var(--sf-shadow-hover)',
            borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
          },
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
        },
      }}
    >
      {/* Filo de acento: dice «esto es una oferta» sin gastar una columna ni
          repetir la palabra. Es el único adorno de la tarjeta. */}
      <Box
        aria-hidden
        sx={{
          height: 4,
          flexShrink: 0,
          background:
            'linear-gradient(90deg, var(--accent-deep) 0%, color-mix(in srgb, var(--accent) 55%, transparent) 100%)',
        }}
      />

      <Stack
        // A lo ancho la foto va a la DERECHA: se lee primero qué se ofrece y
        // después se mira el producto, que es el orden en que alguien decide.
        // Con la foto a la izquierda, el titular empieza a media tarjeta.
        direction={dense ? 'column' : { xs: 'column', sm: 'row-reverse' }}
        sx={{ flex: 1, alignItems: 'stretch' }}
      >
        {foto}

        <Stack
          direction="row"
          sx={{
            gap: dense ? 1.75 : 3,
            p: dense ? 2 : { xs: 2.5, md: 4 },
            flex: 1,
            minWidth: 0,
            alignItems: dense ? 'flex-start' : 'center',
          }}
        >
          {/* En el mural, con foto el medallón se cuela sobre ella —el descuento
              no pierde el primer sitio por tener una imagen bonita—; sin foto,
              ocupa el hueco que antes gastaba el panel de color. */}
          {dense && !foto ? <OfferMedallion badge={badge} dense /> : null}

          {textos}

          {/* A lo ancho, el descuento y el botón van JUNTOS a la derecha: son
              las dos mitades de la misma frase —cuánto me ahorro y dónde pulso—
              y separarlas obligaba a cruzar la tarjeta entera para leerla. */}
          {dense ? null : (
            <Stack
              sx={{
                flexShrink: 0,
                gap: 1.5,
                alignItems: 'flex-start',
                display: { xs: 'none', sm: 'flex' },
              }}
            >
              <OfferMedallion badge={badge} dense={false} />
              <BlockCta block={block} />
            </Stack>
          )}
        </Stack>

        {/* En móvil el descuento y el botón vuelven abajo, a lo ancho de la
            tarjeta: a la derecha no caben sin estrangular el texto. */}
        {dense ? null : (
          <Stack
            direction="row"
            sx={{
              display: { xs: 'flex', sm: 'none' },
              gap: 1.5,
              alignItems: 'center',
              px: 2.5,
              pb: 2.5,
            }}
          >
            <OfferMedallion badge={badge} dense />
            <BlockCta block={block} />
          </Stack>
        )}
      </Stack>

      {dense && foto ? (
        <Box sx={{ position: 'absolute', top: 18, left: 16 }}>
          <OfferMedallion badge={badge} dense />
        </Box>
      ) : null}
    </Card>
  )
}

function RichTextBlock({ block }: { block: ContentBlock }) {
  return (
    <Card component="section" aria-label={block.title ?? undefined} sx={{ p: { xs: 2.5, md: 3.5 } }}>
      <Stack sx={{ gap: 1.5 }}>
        {block.title ? (
          <Typography component="h2" sx={{ fontSize: TS.pageTitle, fontWeight: 800 }}>
            {block.title}
          </Typography>
        ) : null}
        <RichText doc={block.body} />
        <BlockCta block={block} />
      </Stack>
    </Card>
  )
}

function CategoryCollectionBlock({
  block,
  storeSlug,
  categoryMedia,
}: {
  block: ContentBlock
  storeSlug: string
  categoryMedia: CategoryMedia
}) {
  const categories = block.items.filter(
    (item): item is Extract<ContentCollectionItem, { kind: 'category' }> => item.kind === 'category',
  )
  if (categories.length === 0) return null

  /**
   * La foto se CRUZA por `category_id`, no viene en el bloque.
   *
   * El resolvedor del CMS devuelve de cada categoría lo que necesita una
   * puerta —id, slug y nombre— y no su media. Ampliar esa función SQL para
   * traerla habría sido un cambio en el borde público del CMS por una foto
   * opcional; la vitrina ya tiene las categorías de la tienda cargadas
   * (`usePublicCategories`, la misma consulta que la barra de familias), así
   * que basta cruzarlas. Cero peticiones nuevas y la mejora llega a los dos
   * sitios a la vez, que es lo que pedía la fase.
   */
  const conFoto = categories.map((item) => ({
    ...item,
    ...(categoryMedia[item.category_id] ?? {}),
  }))

  /**
   * Las cuatro disposiciones (V3 · P08).
   *
   * `tiles` es la de siempre: puertas, y fila desplazable a partir de cuatro.
   * `pills` es navegación densa, la que ya usa el tema `catalog` en la portada.
   * Las dos nuevas aprovechan la foto por categoría que V2 ya deja subir:
   * `photo-grid` las enseña TODAS a la vez en piezas iguales —sin convertirse
   * en carrusel, que es lo que `tiles` hace a partir de cuatro— y `mosaic` es
   * la composición editorial, donde la primera manda.
   *
   * Ninguna inventa imágenes: la familia sin foto sigue cayendo a su tinte.
   */
  const disposicion = blockLayoutOf('category_collection', block.settings)
  const etiqueta = block.title ?? undefined

  return (
    <Stack component="section" aria-label={etiqueta} sx={{ gap: 1.5 }}>
      <BlockHeading block={block} />
      {disposicion === 'pills' ? (
        <CategoryPills categories={conFoto} storeSlug={storeSlug} ariaLabel={etiqueta} />
      ) : disposicion === 'mosaic' ? (
        <CategoryMosaic categories={conFoto} storeSlug={storeSlug} ariaLabel={etiqueta} />
      ) : disposicion === 'photo-grid' ? (
        <CategoryPhotoGrid categories={conFoto} storeSlug={storeSlug} ariaLabel={etiqueta} />
      ) : (
        <CategoryDoorGrid categories={conFoto} storeSlug={storeSlug} ariaLabel={etiqueta} />
      )}
    </Stack>
  )
}

/**
 * Las familias en una rejilla de piezas IGUALES, todas a la vez (V3 · P08).
 *
 * ## En qué se diferencia de las puertas
 *
 * En que no se rinde. `CategoryDoorGrid` pasa a fila desplazable a partir de
 * cuatro familias —correcto cuando son muchas y no caben del mismo tamaño— y eso
 * deja media colección detrás de una flecha. Quien subió foto a ocho familias
 * las quiere ver a las ocho: la rejilla crece hacia abajo, que es la dirección
 * en la que una página tiene sitio.
 *
 * Y en que no hay pieza principal. Eso es `mosaic`. Aquí todas pesan lo mismo,
 * que es lo correcto cuando ninguna manda.
 */
function CategoryPhotoGrid({
  categories,
  storeSlug,
  ariaLabel,
}: {
  categories: readonly CategoryDoorItem[]
  storeSlug: string
  ariaLabel?: string
}) {
  if (categories.length === 0) return null

  return (
    <Box
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      data-category-photo-grid={categories.length}
      sx={{
        display: 'grid',
        gap: { xs: 1.25, md: 2 },
        /**
         * Dos columnas en el teléfono y tres o cuatro en escritorio, según
         * cuántas haya: con cinco familias a cuatro columnas queda una sola en
         * la segunda fila, y eso se lee como un hueco, no como una rejilla.
         */
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          md: `repeat(${categories.length % 4 === 0 || categories.length > 6 ? 4 : 3}, minmax(0, 1fr))`,
        },
      }}
    >
      {categories.map((category) => (
        <CategoryDoor key={category.category_id} category={category} storeSlug={storeSlug} />
      ))}
    </Box>
  )
}

/**
 * Cuántas piezas hacen falta para que «la primera manda» signifique algo.
 *
 * La misma cifra y el mismo motivo que el mosaico de familias: con dos, una
 * pieza doble y una sencilla no es una jerarquía, es un hueco.
 */
const MINIMO_PARA_DESTACAR = 3

/** La disposición de una colección de productos: la guardada, o la del tipo. */
function disposicionDeColeccion(block: ContentBlock): ProductCollectionLayout {
  // Los dos tipos ofrecen las mismas cinco y se diferencian en su defecto:
  // `carousel` nace en franja, `product_collection` en rejilla.
  return blockLayoutOf(block.type === 'carousel' ? 'carousel' : 'product_collection', block.settings)
}

function ProductCollectionBlock({
  block,
  storeSlug,
  images,
}: {
  block: ContentBlock
  storeSlug: string
  images: Record<string, string>
}) {
  // Una coleccion de productos solo pinta productos y variantes. La base ya lo
  // impide (`content_block_items_kind_matches_block`), pero el tipo tiene que
  // decirlo igual: aqui llega la union entera de items del CMS.
  const items = block.items.filter(
    (item): item is Exclude<ContentCollectionItem, { kind: 'category' } | { kind: 'media' }> =>
      item.kind !== 'category' && item.kind !== 'media',
  )
  if (items.length === 0) return null

  const columns = typeof block.settings.columns === 'number' ? block.settings.columns : 4
  const showPrice = block.settings.show_price !== false

  /**
   * Las cinco disposiciones (V3 · P08). La MISMA lista de productos, los mismos
   * ids, la misma consulta: lo único que cambia es el reparto en pantalla.
   *
   *  · `rail` es lo que hacía el tipo `carousel`, y sigue siendo su defecto.
   *  · `grid` es lo que hacía `product_collection`, y sigue siendo el suyo.
   *  · `editorial` da el doble de foto a cada pieza y le quita la caja.
   *  · `spotlight` hace que la primera ocupe el doble de área.
   *  · `split` saca el mensaje del bloque a su propia columna.
   */
  const disposicion = disposicionDeColeccion(block)
  const editorial = disposicion === 'editorial'
  const destaca = disposicion === 'spotlight' && items.length >= MINIMO_PARA_DESTACAR

  const clave = (item: (typeof items)[number]) =>
    'variant_id' in item ? item.variant_id : item.product_id

  const tarjeta = (item: (typeof items)[number]) => (
    <CollectionCard
      item={item}
      storeSlug={storeSlug}
      images={images}
      showPrice={showPrice}
      snap={false}
      variante={editorial ? 'editorial' : 'card'}
    />
  )

  /**
   * Cuántas columnas en escritorio.
   *
   * `editorial` no respeta el ajuste del comercio a propósito: seis columnas de
   * foto grande son seis fotos pequeñas, y entonces `editorial` no significa
   * nada. `split` tampoco, porque su rejilla vive en media pantalla.
   */
  const columnasEscritorio = editorial
    ? Math.min(Math.max(columns, 2), 3)
    : disposicion === 'split'
      ? 2
      : Math.min(Math.max(columns, 2), 6)

  const franja = (
    /* Carrusel de verdad: `LoopingRow` pone las flechas, el difuminado del
       borde y esconde la barra. Antes era un `overflow-x` pelado, que en
       escritorio no ofrece ningun gesto —no hay rueda horizontal— y encima
       dejaba la barra gris cruzando la seccion. */
    <LoopingRow
      items={items}
      keyOf={clave}
      itemWidth={{ xs: '68%', sm: '42%', md: 250 }}
      ariaLabel={block.title ?? undefined}
      render={(item) => tarjeta(item)}
    />
  )

  const rejilla = (
    <Box
      data-collection-layout={disposicion}
      sx={{
        display: 'grid',
        gap: editorial ? { xs: 2, md: 3 } : 2,
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          md: `repeat(${columnasEscritorio}, minmax(0, 1fr))`,
        },
        // La pieza destacada estira su fila; sin alto mínimo igual para todas,
        // las pequeñas de al lado se deforman.
        ...(destaca ? { gridAutoRows: { md: 'minmax(0, auto)' } } : {}),
      }}
    >
      {items.map((item, indice) => (
        <Box
          key={clave(item)}
          data-collection-cell={indice === 0 && destaca ? 'lead' : 'follow'}
          sx={{
            display: 'flex',
            minWidth: 0,
            '& > *': { width: '100%' },
            // El doble de área, y solo en escritorio: en 390 px una pieza doble
            // deja las otras sin sitio. Es la misma regla del mosaico.
            ...(indice === 0 && destaca
              ? { gridColumn: { md: 'span 2' }, gridRow: { md: 'span 2' } }
              : {}),
          }}
        >
          {tarjeta(item)}
        </Box>
      ))}
    </Box>
  )

  const cuerpo = disposicion === 'rail' ? franja : rejilla

  /**
   * `split`: el mensaje a un lado y los productos al otro.
   *
   * La cabecera se va a la columna del mensaje, así que NO se pinta encima —
   * pintarla dos veces era el error evidente—. Y el reparto y el apilado en el
   * teléfono los decide el primitivo, que es el mismo de la banda de rebajados.
   */
  if (disposicion === 'split') {
    return (
      <Stack component="section" aria-label={block.title ?? undefined} sx={{ gap: 1.5 }}>
        <StoreSplitBand
          reverse={block.settings.reverse === true}
          copy={
            <>
              <BlockHeading block={block} />
              <BlockCta block={block} />
            </>
          }
          content={cuerpo}
        />
      </Stack>
    )
  }

  return (
    <Stack component="section" aria-label={block.title ?? undefined} sx={{ gap: 1.5 }}>
      <BlockHeading block={block} />
      {cuerpo}
      {/* El botón del bloque, si lo escribió el comercio: una colección puede
          ser la entrada a algo más grande («ver toda la selección»). */}
      <BlockCta block={block} />
    </Stack>
  )
}

/**
 * Cabecera de seccion.
 *
 * El titulo llevaba una barra de acento a la izquierda... y no: una seccion de
 * portada no es una cita. Lo que la separa de la anterior es AIRE y peso
 * tipografico, no un adorno. Lo unico que se anade es la regla fina que corre
 * hasta el borde derecho: cierra el bloque, ordena la lectura y no compite con
 * nada.
 */
function BlockHeading({ block }: { block: ContentBlock }) {
  // Un bloque sin titulo ni subtitulo no tiene cabecera: pintar la regla sola
  // seria un separador que no separa nada.
  if (!block.title && !block.subtitle) return null
  return <SectionHeading title={block.title} subtitle={block.subtitle} />
}

function CollectionCard({
  item,
  storeSlug,
  images,
  showPrice,
  snap,
  variante = 'card',
}: {
  item: Exclude<ContentCollectionItem, { kind: 'category' } | { kind: 'media' }>
  storeSlug: string
  images: Record<string, string>
  showPrice: boolean
  snap: boolean
  /**
   * Cómo se enmarca la pieza (V3 · P08).
   *
   * `card` es la de siempre: caja, línea y sombra. `editorial` las quita y deja
   * la foto sola, que es lo que pide una selección corta donde la imagen es el
   * argumento — doce cajas con sombra alrededor de doce fotos compiten con las
   * fotos.
   *
   * La línea no desaparece, se vuelve transparente: si se quitara, la tarjeta
   * mediría un píxel menos por lado y la rejilla se movería al pasar el ratón.
   */
  variante?: 'card' | 'editorial'
}) {
  const { t, locale } = useI18n()
  const price = item.kind === 'product' ? (item.price_from ?? item.price) : item.price
  // Mismo criterio que la tarjeta del catalogo: el porcentaje se calcula, no se
  // escribe a mano, y solo existe si el «antes» es mayor que el precio.
  const descuento =
    item.compare_at_price && price && Number(item.compare_at_price) > Number(price)
      ? Math.round((1 - Number(price) / Number(item.compare_at_price)) * 100)
      : null

  const editorial = variante === 'editorial'

  return (
    <Card
      component={Link}
      to={`/s/${storeSlug}/product/${item.slug}`}
      data-card-variant={variante}
      sx={{
        p: editorial ? 0 : 1.5,
        display: 'grid',
        gap: 0.5,
        alignContent: 'start',
        textDecoration: 'none',
        color: 'inherit',
        borderRadius: 'var(--sf-radius)',
        border: editorial ? '1px solid transparent' : '1px solid var(--sf-line)',
        boxShadow: editorial ? 'none' : 'var(--sf-shadow)',
        bgcolor: editorial ? 'transparent' : undefined,
        scrollSnapAlign: snap ? 'start' : undefined,
        transition: 'box-shadow .18s ease, transform .18s ease',
        '&:hover': {
          boxShadow: 'var(--sf-shadow-hover)',
          transform: 'translateY(-3px)',
          borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
        },
        '& .sf-collection-media': {
          borderRadius: 'var(--sf-radius-sm)',
          overflow: 'hidden',
          px: 0.5,
          pt: 0.5,
          bgcolor: 'transparent',
          mb: 0.75,
        },
        // La foto crece un poco al pasar por encima: es la señal de que la
        // tarjeta entera es pulsable, y sin ella una fila de fotos quietas no
        // parece un escaparate.
        '& .sf-collection-media img': {
          transition: 'transform .35s ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        },
        '&:hover .sf-collection-media img': { transform: 'scale(1.05)' },
      }}
    >
      <Box className="sf-collection-media" sx={{ position: 'relative' }}>
      {descuento !== null ? (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 1,
            px: 1,
            py: 0.25,
            borderRadius: 'var(--sf-pill)',
            bgcolor: 'var(--accent-deep)',
            color: '#FFFFFF',
            fontSize: TS.label,
            fontWeight: 800,
            lineHeight: 1.6,
            boxShadow: '0 2px 8px rgba(0,0,0,.18)',
          }}
        >
          {`-${descuento}%`}
        </Box>
      ) : null}
      <ProductMedia
        url={item.image_path ? (images[item.image_path] ?? null) : null}
        alt={item.image_alt ?? item.name}
        fit="contain"
      />
      </Box>
      {item.kind === 'product' && item.brand_name ? (
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
          {item.brand_name}
        </Typography>
      ) : null}
      <Typography
        sx={{
          fontSize: 15,
          fontWeight: 650,
          lineHeight: 1.35,
          // Dos lineas y elipsis: un nombre largo no puede empujar el precio
          // fuera de la tarjeta ni descuadrar la fila.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {item.name}
      </Typography>
      {item.kind === 'variant' && item.variant_label ? (
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {item.variant_label}
        </Typography>
      ) : null}
      {showPrice && price && item.currency ? (
        // El «antes» tachado va JUNTO al precio, no debajo: en una fila de
        // ofertas lo que se compara es una cifra con otra, y separarlas obliga
        // a hacer la resta de memoria.
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
          <Typography
            className="tnum"
            sx={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}
          >
            {formatMoney(Number(price), item.currency, locale)}
          </Typography>
          {descuento !== null && item.compare_at_price ? (
            <Typography
              component="s"
              className="tnum"
              sx={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}
            >
              {formatMoney(Number(item.compare_at_price), item.currency, locale)}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      {item.in_stock === false ? (
        <Typography sx={{ fontSize: TS.micro, fontWeight: 700, color: 'var(--muted)' }}>
          {t('store.availability.outOfStock')}
        </Typography>
      ) : null}
    </Card>
  )
}
