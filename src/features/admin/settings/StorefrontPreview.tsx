import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import { themeCssVars, themeDataAttributes } from '@/features/storefront/theme/theme-context'
import {
  PREVIEW_VIEWPORTS,
  frameBreakpoint,
  frameCssVars,
  previewWidth,
  type PreviewViewportId,
} from '@/features/storefront/theme/preview-frame'
import { resolveStoreTheme, type ResolvedStoreTheme } from '@/features/storefront/theme/resolve'
import type { HomeLayout, HomeSectionId, StorefrontStyle } from '@/features/storefront/theme/types'
import '@/features/storefront/storefront.css'

/**
 * Vista previa del tema, antes de guardar.
 *
 * ## Por qué esto NO es un dibujo
 *
 * La tentación evidente es maquetar cuatro miniaturas bonitas, una por tema.
 * Sería más rápido y estaría mal el mismo día que alguien cambie un valor de un
 * preset: la vista previa seguiría enseñando lo de antes, y un comercio elegiría
 * su tienda mirando algo que ya no existe.
 *
 * Así que esto consume **las mismas piezas que la vitrina**:
 *
 *  · `resolveStoreTheme` resuelve el tema exactamente igual que en producción,
 *    con los mismos valores por defecto y las mismas reservas;
 *  · `themeCssVars` y `themeDataAttributes` producen las mismas variables y los
 *    mismos atributos que cuelgan de `.sf-scope` en la tienda real;
 *  · `storefront.css` se importa tal cual, así que las reglas por tema —radios,
 *    aire, alturas, columnas— se aplican aquí por el mismo camino.
 *
 * Lo que se pinta dentro son piezas finas —una barra, una portada, una rejilla—
 * que leen esas mismas variables. No son los componentes de producción porque
 * esos necesitan carrito, sesión y consultas de catálogo, y montar todo eso en
 * una pantalla de configuración traería peticiones que aquí no pintan nada.
 * Lo que importa es que la GEOMETRÍA no se duplica: sale del motor.
 *
 * ## El responsive, que hasta P11 era mentira
 *
 * Cambiar el ancho de una caja a 390 px no hace que las media queries
 * reaccionen: una media query mide la VENTANA, no la caja. Así que el «móvil»
 * se pintaba dentro de una ventana de escritorio y todos los valores elegidos
 * eran los de escritorio. Y la vista previa lo empeoraba a mano, usando
 * `--sf-main-pad-md`, `--sf-hero-title-md` y `--sf-grid-lg` **fijos**: el móvil
 * enseñaba el titular de 52 px y las cuatro columnas del escritorio, estrujados.
 *
 * Desde P11 cada marco resuelve sus propios puntos de corte con `--sfp-*` (ver
 * `theme/preview-frame.ts`), así que tres marcos distintos pueden convivir en la
 * misma pantalla resolviendo tres juegos de valores a la vez. Sin `@media`, sin
 * `iframe` y sin duplicar una sola medida.
 *
 * ## Y lo que no hace
 *
 * No guarda. No pide datos con más permisos de los que ya tiene la pantalla. No
 * toca la tienda real ni su caché: es una función del formulario a píxeles. No
 * usa productos reales: el contenido de ejemplo está rotulado como tal, porque
 * el trabajo de esta vista es enseñar la DISPOSICIÓN, no adivinar el catálogo.
 */

const ETIQUETA_MARCO: Record<PreviewViewportId, MessageKey> = {
  desktop: 'settings.design.preview.desktop',
  tablet: 'settings.design.preview.tablet',
  mobile: 'settings.design.preview.mobile',
}

const NOMBRE_SECCION: Record<HomeSectionId, MessageKey> = {
  hero: 'settings.design.section.hero',
  services: 'settings.design.section.services',
  offers: 'settings.design.section.offers',
  cms: 'settings.design.section.cms',
  promotions: 'settings.design.section.promotions',
  categories: 'settings.design.section.categories',
  brands: 'settings.design.section.brands',
  'new-arrivals': 'settings.design.section.newArrivals',
  'best-sellers': 'settings.design.section.bestSellers',
  featured: 'settings.design.section.featured',
  trust: 'settings.design.section.trust',
  'business-info': 'settings.design.section.businessInfo',
  newsletter: 'settings.design.section.newsletter',
}

/** Las que pintan una rejilla de producto, que es lo que hace visible la densidad. */
const CON_PRODUCTOS: ReadonlySet<HomeSectionId> = new Set<HomeSectionId>([
  'offers',
  'new-arrivals',
  'best-sellers',
  'featured',
])

type Modo = 'focus' | 'compare'

/** Lo que ocupa la comparación: el marco más ancho manda sobre el conjunto. */
const ANCHO_COMPARAR = Math.max(
  previewWidth('desktop'),
  previewWidth('tablet') + previewWidth('mobile') + 16,
)

export function StorefrontPreview({
  storeName,
  themePreset,
  style,
  layout,
}: {
  storeName: string
  themePreset: string
  style: Partial<StorefrontStyle>
  layout: HomeLayout
}) {
  const { t } = useI18n()
  const [modo, setModo] = useState<Modo>('focus')
  const [marco, setMarco] = useState<PreviewViewportId>('desktop')
  const [ajustar, setAjustar] = useState(true)

  // El MISMO resolvedor que la vitrina. Recibe lo que hay en el formulario sin
  // guardar, que es lo que permite ver el cambio antes de decidirlo.
  const tema = resolveStoreTheme({
    theme_preset: themePreset,
    storefront_style: style,
    home_layout: layout,
  })

  const lienzo = useRef<HTMLDivElement>(null)
  const disponible = useAnchoDisponible(lienzo)

  const necesario = modo === 'compare' ? ANCHO_COMPARAR : previewWidth(marco)
  const escala = factorDeAjuste(ajustar, disponible, necesario)

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
      >
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.design.preview.title')}
        </Typography>

        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {/**
           * Enfoque o Comparar (Storefront V2 · P11).
           *
           * Son dos preguntas distintas y por eso son dos controles. «¿Cómo se
           * ve en el teléfono?» se responde mirando UN marco grande; «¿se ve
           * bien en los tres?» se responde viéndolos a la vez. Un solo selector
           * de cuatro posiciones —escritorio, tableta, móvil, todos— mezclaba
           * el tamaño con la forma de mirar.
           */}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={modo}
            aria-label={t('settings.design.preview.mode')}
            onChange={(_evento, valor: Modo | null) => {
              if (valor) setModo(valor)
            }}
          >
            <ToggleButton value="focus">{t('settings.design.preview.focus')}</ToggleButton>
            <ToggleButton value="compare">{t('settings.design.preview.compare')}</ToggleButton>
          </ToggleButtonGroup>

          {/* En comparación no hay nada que elegir: están los tres. */}
          {modo === 'focus' && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={marco}
              aria-label={t('settings.design.preview.viewport')}
              onChange={(_evento, valor: PreviewViewportId | null) => {
                // `exclusive` devuelve `null` al pulsar el que ya estaba:
                // quedarse sin marco dejaría la vista previa sin ancho.
                if (valor) setMarco(valor)
              }}
            >
              {PREVIEW_VIEWPORTS.map((v) => (
                <ToggleButton
                  key={v.id}
                  value={v.id}
                  aria-label={t(ETIQUETA_MARCO[v.id as PreviewViewportId])}
                >
                  {t(ETIQUETA_MARCO[v.id as PreviewViewportId])}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}

          {/**
           * Ajustar al ancho.
           *
           * `zoom` y no `transform: scale`: `zoom` participa en la maquetación,
           * así que el hueco que deja el marco encoge con él. Con `scale`, la
           * caja seguiría midiendo 1280 px de alto y dejaría un desierto debajo.
           *
           * Y nunca agranda (`min(1, …)`): un móvil de 390 px estirado a 900 no
           * es una vista previa, es una mentira cómoda.
           */}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={ajustar ? 'fit' : 'real'}
            aria-label={t('settings.design.preview.zoom')}
            onChange={(_evento, valor: string | null) => {
              if (valor) setAjustar(valor === 'fit')
            }}
          >
            <ToggleButton value="fit">{t('settings.design.preview.fit')}</ToggleButton>
            <ToggleButton value="real">{t('settings.design.preview.actual')}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.design.preview.help')}
      </Typography>

      {/**
       * El rótulo de ejemplo, una sola vez y arriba (Storefront V2 · P13).
       *
       * Va aquí y no repetido en cada tarjeta por dos motivos: repetirlo trece
       * veces convertiría la vista previa en una pantalla de advertencias, y
       * puesto una vez sobre el lienzo entero cubre todo lo que hay dentro.
       *
       * Y va SIEMPRE, no solo cuando algo falta: el contenido de la vista previa
       * nunca sale del catálogo, así que un rótulo condicional sería más
       * confuso que uno fijo.
       */}
      <Typography data-testid="preview-demo-note" sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.design.preview.demo')}
      </Typography>

      {/**
       * El lienzo.
       *
       * El marco se desplaza si no cabe y no se ha pedido ajustar, en vez de
       * encogerse por su cuenta: un escritorio de 1280 px comprimido a 600 no
       * enseña la densidad real, que es justo lo que se viene a mirar.
       *
       * Y va CENTRADO (Storefront V2 · P10). Antes se pegaba a la izquierda, así
       * que en un monitor ancho el teléfono de 390 px dejaba un kilómetro de
       * gris a la derecha y parecía que la vista previa estaba rota.
       *
       * `safe center` y no `center` a secas: cuando el marco NO cabe, centrar
       * recorta por la izquierda y el principio de la tienda se vuelve
       * inalcanzable con la barra de desplazamiento. `safe` vuelve a alinear al
       * inicio justo en ese caso. El `center` de fuera es la reserva para quien
       * no lo entienda.
       */}
      <Box
        ref={lienzo}
        data-testid="preview-canvas"
        data-preview-mode={modo}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          '@supports (justify-content: safe center)': { justifyContent: 'safe center' },
          overflowX: 'auto',
          p: 1,
          bgcolor: 'var(--neutral-soft)',
          borderRadius: `${R.lg}px`,
        }}
      >
        <Box
          sx={{
            // El zoom se aplica a la BANDEJA y no a cada marco: en comparación,
            // los tres tienen que encoger lo mismo o dejarían de ser
            // comparables entre sí.
            zoom: escala,
            flex: '0 0 auto',
            display: 'grid',
            gap: 2,
            justifyItems: 'center',
          }}
        >
          {modo === 'focus' ? (
            <MarcoDeVistaPrevia
              viewport={marco}
              tema={tema}
              storeName={storeName}
              escala={escala}
            />
          ) : (
            <Comparacion tema={tema} storeName={storeName} escala={escala} />
          )}
        </Box>
      </Box>
    </Stack>
  )
}

/**
 * Los tres a la vez.
 *
 * El escritorio arriba, ocupando la fila entera, y tableta y móvil debajo, uno
 * al lado del otro. No es una elección estética: 1280 + 768 + 390 son 2438 px y
 * no caben en fila ni en un monitor de 27 pulgadas, mientras que 768 + 390 sí
 * caben en la mitad de abajo del mismo sitio que ocupa el escritorio.
 *
 * Y así la comparación que de verdad se hace —¿se ve bien en tableta Y en
 * móvil?— queda con los dos marcos pegados, que es como se comparan dos cosas.
 */
function Comparacion({
  tema,
  storeName,
  escala,
}: {
  tema: ResolvedStoreTheme
  storeName: string
  escala: number
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: `${previewWidth('tablet')}px ${previewWidth('mobile')}px`,
        gridTemplateAreas: `"desktop desktop" "tablet mobile"`,
        justifyContent: 'center',
      }}
    >
      <Box sx={{ gridArea: 'desktop', justifySelf: 'center' }}>
        <MarcoDeVistaPrevia viewport="desktop" tema={tema} storeName={storeName} escala={escala} />
      </Box>
      <Box sx={{ gridArea: 'tablet' }}>
        <MarcoDeVistaPrevia viewport="tablet" tema={tema} storeName={storeName} escala={escala} />
      </Box>
      <Box sx={{ gridArea: 'mobile' }}>
        <MarcoDeVistaPrevia viewport="mobile" tema={tema} storeName={storeName} escala={escala} />
      </Box>
    </Box>
  )
}

/**
 * Un dispositivo.
 *
 * Lleva su ancho lógico ESCRITO debajo, y el porcentaje al que se está viendo
 * cuando no se ve a tamaño real. Sin eso, ajustar al ancho convertiría la vista
 * previa en «algo pequeño»: quien mira tiene que saber que está viendo 1280 px
 * al 62 %, no una tienda que cabe en 800.
 */
function MarcoDeVistaPrevia({
  viewport,
  tema,
  storeName,
  escala,
}: {
  viewport: PreviewViewportId
  tema: ResolvedStoreTheme
  storeName: string
  escala: number
}) {
  const { t } = useI18n()
  const ancho = previewWidth(viewport)
  const encendidas = tema.layout.sections.filter((s) => s.enabled)

  return (
    <Stack sx={{ gap: 0.5, minWidth: 0 }}>
      <Box
        data-testid="preview-frame"
        data-viewport={viewport}
        // El escalón que le toca POR SU ANCHO, no por el de la ventana. Es lo
        // que permite comprobar desde una prueba que el móvil resuelve como
        // móvil aunque la ventana sea de escritorio.
        data-preview-bp={frameBreakpoint(ancho)}
        className="sf-scope"
        {...themeDataAttributes(tema)}
        style={{ ...themeCssVars(tema), ...frameCssVars(ancho), width: ancho }}
        sx={{
          // Sin encoger: dentro de un contenedor flexible, un marco de 1280 px
          // se comprimiría a lo que quedara libre y la densidad que se viene a
          // mirar sería la de otra tienda. Encoger, cuando toca, es cosa del
          // zoom del lienzo, que encoge TODO por igual y lo dice.
          flex: '0 0 auto',
          bgcolor: 'var(--card)',
          borderRadius: `${R.md}px`,
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <PreviewHeader storeName={storeName} />

        <Box sx={{ p: 'var(--sfp-main-pad)', display: 'grid', gap: 'var(--sfp-section-gap)' }}>
          {encendidas.length === 0 ? (
            <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
              {t('settings.design.preview.empty')}
            </Typography>
          ) : (
            encendidas.map((seccion) => (
              <SeccionDeEjemplo
                key={seccion.id}
                id={seccion.id}
                titulo={t(NOMBRE_SECCION[seccion.id])}
                tema={tema}
                storeName={storeName}
              />
            ))
          )}
        </Box>
      </Box>

      <Typography
        data-testid="preview-label"
        sx={{ fontSize: TS.label, color: 'var(--muted)', textAlign: 'center' }}
      >
        {escala < 1
          ? t('settings.design.preview.scaled')
              .replace('{device}', t(ETIQUETA_MARCO[viewport]))
              .replace('{w}', String(ancho))
              .replace('{pct}', String(Math.round(escala * 100)))
          : t('settings.design.preview.size')
              .replace('{device}', t(ETIQUETA_MARCO[viewport]))
              .replace('{w}', String(ancho))}
      </Typography>
    </Stack>
  )
}

/**
 * Cuánto mide el lienzo, para saber si el marco cabe.
 *
 * Con `ResizeObserver` cuando lo hay, y con el `resize` de la ventana cuando no
 * —el panel cambia de ancho al cambiar la ventana, así que cubre el caso real—.
 * Devuelve `null` mientras no se haya podido medir, y entonces no se ajusta
 * nada: encoger a un factor inventado sería peor que no encoger.
 */
function useAnchoDisponible(ref: RefObject<HTMLDivElement | null>): number | null {
  const [ancho, setAncho] = useState<number | null>(null)

  useEffect(() => {
    const nodo = ref.current
    if (!nodo) return

    const medir = () => setAncho(nodo.clientWidth > 0 ? nodo.clientWidth : null)
    medir()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', medir)
      return () => window.removeEventListener('resize', medir)
    }

    const observador = new ResizeObserver(medir)
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [ref])

  return ancho
}

/** Nunca agranda, y sin medida no toca nada. El aire del lienzo son 16 px. */
function factorDeAjuste(
  ajustar: boolean,
  disponible: number | null,
  necesario: number,
): number {
  if (!ajustar || disponible === null || necesario <= 0) return 1
  return Math.min(1, Math.max(0.25, (disponible - 16) / necesario))
}

/**
 * La barra, con lo que de verdad lleva la de la tienda.
 *
 * Hasta P13 eran tres rectángulos grises, y eso es lo que hacía que la vista
 * previa se leyera como una pantalla a medio cargar: un esqueleto es
 * exactamente eso, rectángulos grises donde luego habrá cosas. El alto sigue
 * saliendo del marco.
 */
function PreviewHeader({ storeName }: { storeName: string }) {
  const { t } = useI18n()

  return (
    <Box
      className="sf-header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        minHeight: 'var(--sfp-header-h)',
        borderBottom: '1px solid var(--sf-line)',
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap' }}>
        {storeName}
      </Typography>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          mx: 1.5,
          px: 1.25,
          height: 'var(--sf-search-h)',
          display: 'flex',
          alignItems: 'center',
          borderRadius: 'var(--sf-pill)',
          border: '1px solid var(--sf-line)',
          bgcolor: 'var(--sf-media-bg)',
          fontSize: 12,
          color: 'var(--muted)',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {t('settings.design.preview.search')}
      </Box>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
        {t('settings.design.preview.cart')}
      </Typography>
    </Box>
  )
}

/**
 * La portada, con las DOS composiciones del contrato (Storefront V2 · P13).
 *
 * `heroVariant` elige entre dos árboles distintos en la tienda —una portada que
 * enseña un producto rebajado y una que enseña el lema del comercio— y hasta
 * P13 la vista previa pintaba la misma caja con degradado para los dos. Una
 * opción del formulario que no cambia nada en la vista previa es una opción que
 * el comercio no puede evaluar.
 */
function PreviewHero({ tema, storeName }: { tema: ResolvedStoreTheme; storeName: string }) {
  const { t } = useI18n()
  const lema = tema.style.heroVariant === 'statement'

  return (
    <Box
      data-preview-hero={tema.style.heroVariant}
      sx={{
        minHeight: 'var(--sfp-hero-min)',
        borderRadius: 'var(--sf-radius)',
        background: 'var(--hero-grad)',
        display: 'grid',
        gridTemplateColumns: lema ? '1fr' : 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: 2,
        alignItems: lema ? 'center' : 'end',
        justifyItems: lema ? 'center' : 'stretch',
        textAlign: lema ? 'center' : 'left',
        p: 'var(--sfp-hero-pad)',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 'var(--sfp-hero-title)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            color: '#FFFFFF',
          }}
        >
          {storeName}
        </Typography>
        <Typography sx={{ fontSize: 13, color: '#FFFFFF', opacity: 0.85, mt: 0.5 }}>
          {t('settings.design.preview.heroSubtitle')}
        </Typography>
      </Box>

      {/* La portada de producto enseña PRODUCTO: es media razón de la variante,
          y sin la tarjeta al lado las dos se ven igual. */}
      {!lema && (
        <Box
          sx={{
            display: 'grid',
            gap: 0.5,
            p: 1,
            borderRadius: 'var(--sf-radius-sm)',
            bgcolor: 'var(--card)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Box
            sx={{
              aspectRatio: 'var(--sf-image-ratio)',
              borderRadius: 'var(--sf-radius-sm)',
              bgcolor: 'var(--sf-media-bg)',
            }}
          />
          <Typography sx={{ fontSize: 11, fontWeight: 700 }}>
            {t('settings.design.preview.demoProduct').replace('{n}', '1')}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

/**
 * Una sección de la portada, con contenido de EJEMPLO (Storefront V2 · P13).
 *
 * ## Por qué dejó de ser un rectángulo gris
 *
 * Porque un rectángulo gris es exactamente lo que pinta una pantalla mientras
 * carga. La vista previa se leía como un esqueleto —y más de una vez se
 * preguntó si estaba rota— cuando en realidad estaba terminada: lo que enseñaba
 * era su contenido definitivo.
 *
 * Ahora cada sección pinta lo que pinta la de verdad, con textos de ejemplo
 * DETERMINISTAS y rotulados. No se usan productos del catálogo: esta pantalla
 * enseña la DISPOSICIÓN, y traerse el catálogo para dibujar seis tarjetas sería
 * pagar una consulta por cada tecla del formulario.
 *
 * Los textos son neutros a propósito. Ni un nombre de producto, ni una familia,
 * ni un precio que pudiera parecerse al de nadie: «Producto de ejemplo 1» no se
 * confunde con el catálogo de una tienda de verdad.
 */
function SeccionDeEjemplo({
  id,
  titulo,
  tema,
  storeName,
}: {
  id: HomeSectionId
  titulo: string
  tema: ResolvedStoreTheme
  storeName: string
}) {
  const { t } = useI18n()

  if (id === 'hero') return <PreviewHero tema={tema} storeName={storeName} />

  if (id === 'services') return <FranjaDeServicios />

  if (id === 'categories') {
    return <PuertasDeEjemplo titulo={titulo} variante={tema.style.categoryVariant} />
  }

  if (id === 'brands' || id === 'trust') return <MarcasDeEjemplo titulo={titulo} />

  if (CON_PRODUCTOS.has(id)) {
    return (
      <Stack sx={{ gap: 1 }}>
        <TituloDeBanda titulo={titulo} />
        <Box
          data-testid="preview-grid"
          sx={{
            display: 'grid',
            gap: 'var(--sfp-grid-gap)',
            gridTemplateColumns: 'repeat(var(--sfp-grid-cols), minmax(0, 1fr))',
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <PreviewCard key={i} numero={i + 1} variante={tema.style.productCardVariant} />
          ))}
        </Box>
      </Stack>
    )
  }

  // Lo que queda —contenido del CMS, promociones, datos del negocio— es una
  // banda de texto: eso es lo que pintan en la tienda, y no una rejilla.
  return (
    <Stack sx={{ gap: 1 }}>
      <TituloDeBanda titulo={titulo} />
      <Stack
        sx={{
          gap: 0.75,
          p: 1.5,
          borderRadius: 'var(--sf-radius)',
          bgcolor: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
        }}
      >
        <Box sx={{ height: 8, width: '45%', borderRadius: 4, bgcolor: 'var(--sf-media-bg)' }} />
        <Box sx={{ height: 8, width: '70%', borderRadius: 4, bgcolor: 'var(--sf-media-bg)' }} />
        <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
          {t('settings.design.preview.demoBlock')}
        </Typography>
      </Stack>
    </Stack>
  )
}

function TituloDeBanda({ titulo }: { titulo: string }) {
  return (
    <Typography sx={{ fontSize: 'var(--sfp-heading)', fontWeight: 800, letterSpacing: '-0.025em' }}>
      {titulo}
    </Typography>
  )
}

/** La franja de propuestas de valor: cuatro apoyos cortos, como en la tienda. */
function FranjaDeServicios() {
  const { t } = useI18n()

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1,
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        p: 1.25,
        borderRadius: 'var(--sf-radius)',
        bgcolor: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
      }}
    >
      {[1, 2, 3, 4].map((n) => (
        <Stack key={n} direction="row" sx={{ gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          <Box
            sx={{
              width: 20,
              height: 20,
              flexShrink: 0,
              borderRadius: '50%',
              bgcolor: 'var(--accent-soft)',
            }}
          />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
            {t('settings.design.preview.demoService').replace('{n}', String(n))}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}

/**
 * Las familias, con las DOS variantes del contrato.
 *
 * `categoryVariant` elige entre puertas con foto y una fila de píldoras, que en
 * la tienda son dos composiciones distintas. Pintarlas igual aquí dejaba la
 * opción sin forma de evaluarse.
 */
function PuertasDeEjemplo({ titulo, variante }: { titulo: string; variante: string }) {
  const { t } = useI18n()
  const pildoras = variante === 'pills'

  return (
    <Stack sx={{ gap: 1 }}>
      <TituloDeBanda titulo={titulo} />
      <Box
        data-preview-categories={variante}
        sx={{ display: 'flex', gap: 1, flexWrap: pildoras ? 'wrap' : 'nowrap' }}
      >
        {[1, 2, 3, 4].map((n) =>
          pildoras ? (
            <Typography
              key={n}
              sx={{
                fontSize: 11,
                fontWeight: 700,
                px: 1.25,
                py: 0.5,
                borderRadius: 'var(--sf-pill)',
                border: '1px solid var(--sf-line)',
                color: 'var(--muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('settings.design.preview.demoCategory').replace('{n}', String(n))}
            </Typography>
          ) : (
            <Stack
              key={n}
              sx={{
                flex: 1,
                minWidth: 0,
                gap: 0.5,
                p: 0.75,
                borderRadius: 'var(--sf-radius-sm)',
                // Los mismos tintes de orientación que usa la vitrina para sus
                // puertas: sin ellos, cuatro cajas grises no enseñan nada.
                bgcolor: `var(--sf-tint-${n}-bg)`,
                border: '1px solid var(--sf-line)',
              }}
            >
              <Box
                sx={{
                  height: 28,
                  borderRadius: 'var(--sf-radius-sm)',
                  bgcolor: 'var(--sf-media-bg)',
                }}
              />
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                {t('settings.design.preview.demoCategory').replace('{n}', String(n))}
              </Typography>
            </Stack>
          ),
        )}
      </Box>
    </Stack>
  )
}

/** Las marcas: monogramas, como los pinta la vitrina cuando no hay logotipo. */
function MarcasDeEjemplo({ titulo }: { titulo: string }) {
  const { t } = useI18n()

  return (
    <Stack sx={{ gap: 1 }}>
      <TituloDeBanda titulo={titulo} />
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        {['A', 'B', 'C', 'D', 'E'].map((letra) => (
          <Stack
            key={letra}
            direction="row"
            sx={{
              gap: 0.75,
              alignItems: 'center',
              px: 1,
              py: 0.5,
              borderRadius: 'var(--sf-pill)',
              border: '1px solid var(--sf-line)',
            }}
          >
            <Box
              sx={{
                width: 18,
                height: 18,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: 'var(--accent-soft)',
                color: 'var(--accent-deep)',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {letra}
            </Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
              {t('settings.design.preview.demoBrand').replace('{n}', letra)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

/**
 * Una tarjeta de producto de ejemplo, con su variante.
 *
 * `comfortable` y `compact` no son dos rellenos distintos: la cómoda enseña el
 * apoyo bajo el nombre y respira, y la compacta va directa al nombre y al
 * precio. El relleno sale de `--sfp-card-pad`, que el marco resuelve por su
 * ancho, así que la misma tarjeta se aprieta sola en el teléfono.
 */
function PreviewCard({ numero, variante }: { numero: number; variante: string }) {
  const { t } = useI18n()
  const comoda = variante === 'comfortable'

  return (
    <Stack
      data-preview-card={variante}
      sx={{
        gap: 'var(--sf-card-gap)',
        p: 'var(--sfp-card-pad)',
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
        bgcolor: 'var(--card)',
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          aspectRatio: 'var(--sf-image-ratio)',
          borderRadius: 'var(--sf-radius-sm)',
          bgcolor: 'var(--sf-media-bg)',
        }}
      />
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {t('settings.design.preview.demoProduct').replace('{n}', String(numero))}
      </Typography>
      {comoda && (
        <Typography sx={{ fontSize: 10, color: 'var(--muted)' }}>
          {t('settings.design.preview.demoProductSupport')}
        </Typography>
      )}
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-deep)' }}>
        {t('settings.design.preview.demoPrice')}
      </Typography>
    </Stack>
  )
}
