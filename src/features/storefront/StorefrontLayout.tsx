import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import LoginRoundedIcon from '@mui/icons-material/LoginRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Badge,
  Box,
  Button,
  Container,
  Fab,
  Link as MuiLink,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { SkipToContentLink, CONTENT_ANCHOR } from '@/shared/ui/SkipToContentLink'
import { AppearanceProvider } from '@/theme/AppearanceProvider'
import { useAppearance } from '@/theme/appearance-context'
import { R, TS } from '@/theme/tokens'
import { StorefrontNotFoundError } from './api'
import { notFoundMeta } from './seo'
import { initials } from './branding'
import { StoreCategoryNav } from './components/StoreCategoryNav'
import { StoreQuickSearch } from './components/StoreQuickSearch'
import { AssistantDrawer } from './components/AssistantDrawer'
import { CartDrawer } from './cart/CartDrawer'
import { CartProvider } from './cart/CartProvider'
import { useCart } from './cart/cart-context'
import {
  OFERTAS_QUERY,
  useCatalogPages,
  usePublicCategories,
  usePublicStore,
  useStoreNavigation,
  type StorefrontOutlet,
} from './hooks'
import { useFavorites } from './useFavorites'
import { StorefrontThemeProvider } from './theme/StorefrontThemeProvider'
import { useStorefrontTheme } from './theme/useStorefrontTheme'
import { themeCssVars, themeDataAttributes } from './theme/theme-context'
import type { PublicStore } from './types'
// La tipografia de la VITRINA, auto-alojada. Se importa aqui —y no en el
// arranque de la app— para que viaje en el chunk del storefront: quien entra al
// backoffice no baja ni un byte de ella.
//
// Cuatro pesos y SOLO el subconjunto latino: los acentos y la enne del espanol
// estan en `latin`, mientras que los ficheros genericos arrastran ademas
// latin-ext, cirilico y vietnamita — tres alfabetos que esta tienda no escribe,
// multiplicados por cada peso.
import '@fontsource/plus-jakarta-sans/latin-400.css'
import '@fontsource/plus-jakarta-sans/latin-500.css'
import '@fontsource/plus-jakarta-sans/latin-700.css'
import '@fontsource/plus-jakarta-sans/latin-800.css'
import './storefront.css'

/**
 * Vitrina pública.
 *
 * El tenant se resuelve por el **slug de la URL** contra `public_stores`, que
 * solo devuelve tiendas activas — nunca por un parámetro que el cliente declare
 * confiable, ni por nada guardado en `localStorage`. Si el slug no resuelve, la
 * respuesta es un 404 de tienda, no una pantalla vacía sin explicar.
 *
 * Todo lo de identidad (logo, nombre, acento, banner, contacto) sale de
 * `store_settings`. Aquí no hay ni un color ni un nombre cableado.
 *
 * **La vitrina ya no lleva pie.** Con él se fue el lockup «by EBIM», que era lo
 * único de casa que quedaba a la vista, y también el bloque de contacto; el
 * correo, el teléfono y la dirección siguen en `store_settings` y los puede
 * pintar un bloque de contenido donde el comercio quiera. Las páginas
 * administrables sí tienen que seguir alcanzables —«Términos y condiciones» no
 * es opcional en una tienda—, así que vuelven a la cabecera.
 */
export function StorefrontLayout() {
  const { storeSlug } = useParams<{ storeSlug: string }>()
  const { t, locale } = useI18n()
  const { pathname } = useLocation()
  const { data: store, isPending, isError, error, refetch } = usePublicStore(storeSlug)

  // Antes de cualquier retorno temprano: el orden de los hooks no puede
  // depender de si la tienda cargo.
  const [asistenteAbierto, setAsistenteAbierto] = useState(false)
  // La sesión no cambia NADA de lo que se ve del catálogo —la vitrina se lee
  // siempre con el cliente anónimo— pero sí decide de quién es el carrito: con
  // sesión, el del comprador; sin ella, el del token del navegador.
  const { status: sessionStatus } = useSessionContext()

  // Un slug que no resuelve responde 200 como todo en una SPA. Sin este
  // `noindex`, la pantalla de «no encontramos esa tienda» se indexa como si
  // fuera contenido: el «soft 404» clásico. Se declara ANTES de decidir qué
  // pintar para que también cubra el fallo de red.
  const failed = !isPending && (isError || !store)
  useDocumentMeta(
    failed
      ? notFoundMeta({ title: t('store.notFound'), pathname, siteName: 'eCommerce by EBIM', locale })
      : null,
  )

  if (isPending) {
    return (
      <Shell>
        <LoadingState />
      </Shell>
    )
  }

  if (isError || !store) {
    const notFound = error instanceof StorefrontNotFoundError
    return (
      <Shell>
        {notFound ? (
          <EmptyState title={t('store.notFound')} description={t('store.notFoundBody')} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </Shell>
    )
  }

  const context: StorefrontOutlet = { storeSlug: storeSlug as string, store }


  return (
    // El acento de la vitrina es el `accent_color` del tenant, no el de casa.
    // Desde P11-SaaS viajan con él los tokens de white-label: tipografía, radio
    // y densidad por defecto. Los cuatro se aplican en el MISMO render en el
    // que la tienda queda resuelta, así que no hay un primer pintado con la
    // marca de suite y otro con la del tenant — que es el «flash de branding»
    // que el encargo prohíbe.
    <AppearanceProvider
      tenantAccent={store.accent_color}
      // Plus Jakarta Sans es la fuente POR DEFECTO de la vitrina; el token del
      // tenant, cuando existe, manda sobre ella. El defecto vive aqui y no en
      // la fila: una tienda con `font_family` en null es una tienda que no ha
      // elegido, y asi el dia que la suite cambie de fuente cambian todas sin
      // migrar un solo dato.
      tenantFont={store.font_family ?? 'plus-jakarta'}
      tenantRadius={store.ui_radius}
      tenantDensity={store.ui_density}
    >
      {/* El carrito cuelga de la tienda YA RESUELTA: su `store_id` sale de
          `public_stores`, nunca de la URL ni de `localStorage`. Al cambiar de
          tienda, el provider se remonta y carga el carrito de esa tienda. */}
      <CartProvider
        storeId={store.store_id}
        storeSlug={storeSlug as string}
        currency={store.currency}
        authenticated={sessionStatus === 'authenticated'}
      >
        {/* El tema de la tienda se monta AQUÍ y no más arriba: envuelve la
            frontera visual y nada más, así que el backoffice —que nunca pasa
            por este árbol— no lo recibe. Es la misma línea que dibuja
            `.sf-scope` en el CSS, dicha en React. */}
        <StorefrontThemeProvider store={store}>
          <StorefrontSurface>
          {/* Primer elemento enfocable del documento: sin él, llegar al
              catálogo con el teclado obliga a pasar por el logo, el menú, la
              cuenta y el carrito en CADA página. El destino ya existía
              (`id="contenido"`) y el texto también; faltaba el enlace. */}
          <SkipToContentLink label={t('store.skipToContent')} />
          <StoreHeader store={store} storeSlug={storeSlug as string} />

          <StoreMain>
            <ErrorBoundary>
              <Outlet context={context} />
            </ErrorBoundary>
          </StoreMain>

          {/* Las páginas del comercio —quiénes somos, envíos, términos— NO van
              en la cabecera: sus tres trabajos son buscar, entrar a lo tuyo y
              ver el carrito, y ninguno de esos enlaces vende. Pero tampoco
              pueden desaparecer: «Términos y condiciones» es donde una tienda
              cumple, y una que no deja llegar a sus condiciones de venta no
              está incompleta, está incumpliendo.
              Aquí van, en una línea al pie del contenido, dentro del mismo
              contenedor que el catálogo: sin banda de fondo propia y sin ancho
              propio, que es lo que arrastraba la página en horizontal. */}
          <StorePagesFooter
            storeSlug={storeSlug as string}
            storeName={store.business_display_name ?? store.name}
          />

          <CartDrawer storeSlug={storeSlug as string} />

      {/* El asistente flota sobre la tienda y no dentro de ninguna pagina:
          se pregunta desde donde se este, y en la ficha de un producto es
          justo donde mas sentido tiene preguntar por alternativas.

          Se coloca POR ENCIMA de «volver arriba», que ocupa la misma esquina
          en la portada. Apilados y no superpuestos: dos botones peleandose el
          mismo pixel es un boton que no se puede pulsar. */}
      <Fab
        color="primary"
        aria-label={t('store.assistant.open')}
        onClick={() => setAsistenteAbierto(true)}
        sx={{
          position: 'fixed',
          right: { xs: 16, md: 24 },
          bottom: { xs: 76, md: 88 },
          zIndex: 4,
        }}
      >
        <AutoAwesomeRoundedIcon />
      </Fab>

      <AssistantDrawer
        open={asistenteAbierto}
        onClose={() => setAsistenteAbierto(false)}
        storeSlug={storeSlug as string}
        storeId={store.store_id}
      />
          </StorefrontSurface>
        </StorefrontThemeProvider>
      </CartProvider>
    </AppearanceProvider>
  )
}

/**
 * La frontera visual de la vitrina, en un componente propio.
 *
 * Existe por una razón muy concreta: los atributos y las variables del tema
 * salen de `useStorefrontTheme()`, y un componente no puede leer un contexto
 * que él mismo acaba de montar. Separarlo es lo que permite que el proveedor
 * envuelva exactamente a esta caja y a nada más.
 *
 * De aquí para abajo, las diferencias entre temas viajan en CSS —`data-store-*`
 * y `--sf-*`— en vez de en condicionales repartidos por el JSX. Un `if (theme
 * === 'retail')` por componente convierte cuatro temas en cuatro aplicaciones.
 */
function StorefrontSurface({ children }: { children: ReactNode }) {
  const theme = useStorefrontTheme()

  return (
    <Box
      className="sf-scope"
      {...themeDataAttributes(theme)}
      style={themeCssVars(theme)}
      sx={{
        // `100vh` primero y `100dvh` solo donde existe. El pie ya iba al
        // final de la columna, pero en vistas embebidas —el navegador
        // simple del editor, un iframe de previsualizacion— `dvh` calcula
        // MENOS que el alto real y quedaba una banda de fondo bajo el pie.
        // Con las dos, el que no entienda `dvh` se queda con `vh` y nadie
        // ve el hueco.
        minHeight: '100vh',
        '@supports (min-height: 100dvh)': { minHeight: '100dvh' },
        bgcolor: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </Box>
  )
}

/**
 * El contenedor del contenido.
 *
 * Lo único que el tema cambia aquí son dos cosas, y las dos son valores, no
 * condiciones: el ancho —`lg` para casi todo, `xl` para un catálogo de miles de
 * referencias— y el aire alrededor. El resto (el ancla del salto de contenido,
 * el `tabIndex`, el `ErrorBoundary`) no depende del tema y no se mueve.
 */
function StoreMain({ children }: { children: ReactNode }) {
  const { style } = useStorefrontTheme()

  return (
    <Container
      component="main"
      id={CONTENT_ANCHOR}
      // `tabIndex={-1}`: sin esto el salto mueve el scroll pero NO el
      // foco, y el siguiente Tab vuelve al principio de la cabecera.
      tabIndex={-1}
      maxWidth={style.contentWidth}
      sx={{
        flex: 1,
        py: { xs: 'var(--sf-main-pad)', md: 'var(--sf-main-pad-md)' },
        '&:focus': { outline: 'none' },
      }}
    >
      {children}
    </Container>
  )
}

/** Marco neutro para los estados en los que todavía no hay tienda que pintar. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <AppearanceProvider>
      <Box sx={{ minHeight: '100dvh', bgcolor: 'var(--bg)', display: 'grid', placeItems: 'center' }}>
        <Container maxWidth="sm">{children}</Container>
      </Box>
    </AppearanceProvider>
  )
}

function StoreHeader({ store, storeSlug }: { store: PublicStore; storeSlug: string }) {
  /**
   * El buscador se MUEVE, no se duplica.
   *
   * La primera versión lo pintaba dos veces y escondía uno con CSS. A la vista
   * funciona; en el árbol de accesibilidad deja DOS `role="search"`, y un lector
   * de pantalla anuncia dos buscadores donde hay uno. `display: none` quita el
   * elemento de la pantalla, no del documento — la prueba de landmarks lo cantó
   * de inmediato, que es exactamente para lo que está.
   *
   * Con la consulta de medios se renderiza UNO, en el sitio que le toca.
   */
  const enMovil = useMediaQuery('(max-width:899.95px)')
  // El tema decide el ANCHO de la barra y su altura; nada de lo que la barra
  // contiene —buscador, cuenta, carrito, familias— depende de él. Un tema que
  // quitara uno de esos tres dejaría de ser un tema.
  const { style } = useStorefrontTheme()

  return (
    <Box
      component="header"
      className="sf-header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        // El desenfoque lo pone `storefront.css` donde el navegador lo soporta;
        // este color es el respaldo opaco, que es lo que garantiza que la
        // cabecera se lea sobre el catalogo con el que se solapa.
        bgcolor: 'var(--card)',
        borderBottom: '1px solid var(--sf-line)',
      }}
    >
      <Container maxWidth={style.contentWidth} disableGutters>
        <Toolbar
          sx={{
            gap: 1.5,
            px: { xs: 2, md: 3 },
            minHeight: { xs: 'var(--sf-header-h)', md: 'var(--sf-header-h-md)' },
          }}
        >
          <Box
            component={Link}
            to={`/s/${storeSlug}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              textDecoration: 'none',
              color: 'inherit',
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            {store.logo_url ? (
              <Box
                component="img"
                src={store.logo_url}
                alt={store.name}
                sx={{ height: 30, maxWidth: 160, objectFit: 'contain' }}
              />
            ) : (
              // Sin logo: iniciales sobre el acento del tenant. Neutro y suyo,
              // en vez de plantar el isotipo EBIM como si fuera su marca.
              <Box
                aria-hidden
                sx={{
                  width: 34,
                  height: 34,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: `${R.sm}px`,
                  bgcolor: 'var(--accent-soft)',
                  color: 'var(--accent-deep)',
                  fontWeight: 800,
                  fontSize: TS.label,
                }}
              >
                {initials(store.name)}
              </Box>
            )}
            <Typography
              component="span"
              sx={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {store.name}
            </Typography>
          </Box>

          {/* El buscador vive en la cabecera y no en el cuerpo del catalogo:
              es lo primero que se usa para llegar a un producto, y desde aqui
              esta en TODAS las pantallas de la tienda, no solo en la portada.
              Se oculta en movil, donde la barra no da para el logo, el menu,
              la cuenta, el carrito Y una caja de texto. */}
          {!enMovil && (
            <Box sx={{ display: 'flex', flex: 1, minWidth: 0, mx: 1 }}>
              <StoreQuickSearch storeSlug={storeSlug} />
            </Box>
          )}

          {/* Las paginas del CMS —quienes somos, envios, terminos— NO viven
              aqui. La cabecera de una tienda tiene tres trabajos: buscar,
              entrar a lo tuyo y ver el carrito; cada enlace que se le anade
              compite con esos tres y ninguno de ellos vende. Se leen una vez,
              casi siempre buscandolas, y su sitio de siempre es el pie. */}
          <ThemeButton />
          <FavoritesButton storeSlug={storeSlug} storeId={store.store_id} />
          <AccountButton storeSlug={storeSlug} />
          <CartButton />
        </Toolbar>

        {/* En móvil, el buscador baja a su propia fila.

            Antes no estaba en ninguna: se ocultaba por debajo de `md` y no lo
            sustituía nada, así que quien llegaba por teléfono no tenía forma de
            buscar en un catálogo de 570 productos — le quedaba recorrer las
            familias una por una. La cabecera declara tres trabajos y cumplía
            dos.

            En fila propia y no dentro de la barra porque a 360 px no cabe junto
            al logo y el carrito sin dejar los tres apretados. */}
        {enMovil && (
          <Box sx={{ pb: 1 }}>
            <StoreQuickSearch storeSlug={storeSlug} />
          </Box>
        )}
      </Container>

      {/* Las familias, bajo la barra y en TODAS las pantallas de la tienda.
          Estaban a media portada: para cambiar de familia habia que volver
          arriba, y desde una ficha de producto no habia forma de llegar. */}
      <StoreCategories storeSlug={storeSlug} storeId={store.store_id} />
    </Box>
  )
}

/**
 * Menú de páginas administrables (P11-SaaS).
 *
 * Existe porque una página que solo se alcanza escribiendo su URL es media
 * funcionalidad: el comercio la crea y nadie llega. Qué páginas salen aquí lo
 * decide `content_pages.show_in_nav`, y la lista la resuelve el servidor ya
 * filtrada por publicación, vigencia y canal.
 *
 * Se esconde en móvil: en una barra que ya lleva cuenta y carrito, tres enlaces
 * más empujan el nombre de la tienda fuera de la pantalla. Las páginas siguen
 * alcanzables desde los bloques de contenido y desde el pie.
 */
/**
 * Paginas de la tienda —quienes somos, envios, terminos—, en el PIE.
 *
 * Estaban en la cabecera y se las llevaba el sitio que necesitan el buscador,
 * la cuenta y el carrito. Son paginas que se consultan una vez y casi nunca de
 * memoria: al pie se las encuentra igual, y ademas es donde se buscan las
 * legales.
 *
 * Sigue siendo un `<nav>` con nombre: quien navega por regiones con un lector
 * de pantalla las encuentra por ahi, este arriba o abajo.
 */
/**
 * Las categorias de la tienda, ya cargadas.
 *
 * Vive aparte del encabezado para que la consulta de categorias no vuelva a
 * pedirse cada vez que cambia algo de la barra (buscador, carrito): son datos
 * de tienda, no de pantalla, y `usePublicCategories` los comparte con la
 * portada por clave de consulta — una sola llamada para las dos.
 */
function StoreCategories({ storeSlug, storeId }: { storeSlug: string; storeId: string }) {
  const { data } = usePublicCategories(storeId)
  /**
   * ¿Hay algo rebajado ahora mismo?
   *
   * La barra necesita saberlo para decidir si enseña «Ofertas», que lleva al
   * catálogo filtrado. Es EXACTAMENTE la consulta que hace la portada para su
   * banda de ofertas —mismos filtros, mismo orden, mismo límite—, así que
   * comparte clave de TanStack y en la portada no cuesta ni una petición más.
   */
  const ofertas = useCatalogPages(storeSlug, OFERTAS_QUERY)
  const hayRebajas = (ofertas.data?.pages[0]?.items.length ?? 0) > 0
  if (!data || data.length === 0) return null
  return (
    <StoreCategoryNav storeSlug={storeSlug} categories={data} showOffers={hayRebajas} />
  )
}

function StorePagesFooter({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const { data } = useStoreNavigation(storeSlug)
  // El pie comparte ancho con el contenido a propósito: es una línea DENTRO del
  // mismo contenedor, no una banda con ancho propio. Cuando lo tenía, la página
  // se arrastraba en horizontal.
  const { style } = useStorefrontTheme()

  return (
    <Container maxWidth={style.contentWidth} component="footer" sx={{ pb: 3, pt: 1 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{
          gap: { xs: 1, sm: 3 },
          alignItems: { xs: 'flex-start', sm: 'center' },
          flexWrap: 'wrap',
          pt: 2,
          borderTop: '1px solid var(--sf-line)',
        }}
      >
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {`© ${new Date().getFullYear()} ${storeName}`}
        </Typography>
        {data && data.length > 0 ? <StorePagesNav storeSlug={storeSlug} pages={data} /> : null}
      </Stack>
    </Container>
  )
}

function StorePagesNav({
  storeSlug,
  pages,
}: {
  storeSlug: string
  pages: readonly { slug: string; title: string }[]
}) {
  const { t } = useI18n()

  return (
    <Stack
      component="nav"
      direction="row"
      aria-label={t('store.footer.pages')}
      sx={{ gap: { xs: 1.5, sm: 3 }, flexWrap: 'wrap' }}
    >
      {pages.slice(0, 6).map((item) => (
        <MuiLink
          key={item.slug}
          component={Link}
          to={`/s/${storeSlug}/p/${item.slug}`}
          sx={{
            fontSize: TS.body,
            fontWeight: 700,
            color: 'var(--muted)',
            textDecoration: 'none',
            '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
          }}
        >
          {item.title}
        </MuiLink>
      ))}
    </Stack>
  )
}

/**
 * Entrada al área de cuenta (P05-SaaS). Solo aparece con sesión, y es
 * deliberado: un enlace a «tu cuenta» para un comprador anónimo lleva a un
 * sitio donde no hay nada suyo, y la vitrina se navega sin sesión a propósito.
 *
 * Qué cuenta es la suya lo decide el servidor (`my_business_accounts`); esto es
 * solo la puerta.
 */
/**
 * Acceso a los favoritos, con su contador.
 *
 * El corazon de la tarjeta guardaba en un sitio al que no se podia llegar: se
 * podia marcar y no habia donde mirar lo marcado. Esto es la otra mitad de esa
 * funcion, y por eso vive en la cabecera y no escondido en la cuenta — los
 * favoritos NO exigen sesion (sin ella viven en el navegador), asi que ponerlos
 * dentro de «Tu cuenta» los dejaria fuera del alcance de quien todavia no ha
 * entrado, que es justo quien mas los usa.
 *
 * Sin nada guardado no se pinta: un contador a cero es un boton que solo
 * ensena que no has hecho nada.
 */
/**
 * Las tres acciones de la cabecera, con una sola anatomía.
 *
 * Eran tres `Button` con el icono de contorno por defecto de MUI: a trazo de
 * 1,5 px, un glifo hueco al lado de un nombre de tienda en negrita se lee como
 * un vector pegado, no como un control.
 *
 * Lo que hace esta pieza:
 *
 *  · **El icono va RELLENO y dentro de una pastilla de su color.** El tinte es
 *    lo que lo convierte en una etiqueta y no en un adorno; es la misma
 *    gramática que el backoffice usa en `AppIcon`, traída a la vitrina.
 *  · **Cada acción tiene SU color, y ninguno es decorativo.** El corazón va en
 *    rojo porque un corazón es rojo —y es el mismo rojo que la tarjeta de
 *    producto usa cuando algo está guardado, así que la cabecera y la rejilla
 *    dicen lo mismo—; la cuenta en azul, que es el color de «tú»; el carrito en
 *    el acento del tenant, porque es la acción que cierra la venta.
 *  · **El texto NO se tiñe.** Va en tinta: el color lo lleva el icono, que es
 *    donde ayuda a distinguir de un vistazo. Tres etiquetas de colores serían
 *    tres cosas gritando.
 *
 * El nombre accesible SIEMPRE incluye la cifra: quien no ve la píldora necesita
 * oír «Carrito, 3», no «Carrito».
 */
const ACTION_TONES = {
  favorite: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  account: { bg: 'var(--blue-soft)', fg: 'var(--blue)' },
  cart: { bg: 'var(--accent-soft)', fg: 'var(--accent-deep)' },
  // Neutro a propósito: es una preferencia, no un destino. Darle color la
  // pondría a competir con las tres acciones que sí venden.
  neutral: { bg: 'var(--neutral-soft)', fg: 'var(--muted)' },
} as const

function HeaderAction({
  icon,
  label,
  badge = 0,
  tone,
  to,
  state,
  onClick,
  iconOnly = false,
}: {
  icon: ReactNode
  label: string
  badge?: number
  tone: keyof typeof ACTION_TONES
  /** Enlace o botón: uno de los dos, nunca los dos. */
  to?: string
  /** Estado de navegación del enlace, para volver a donde se estaba. */
  state?: unknown
  onClick?: () => void
  /** Sin texto ni en escritorio: para lo que es utilidad y no destino. */
  iconOnly?: boolean
}) {
  const { bg, fg } = ACTION_TONES[tone]

  return (
    <Button
      {...(to ? { component: Link, to, state } : { onClick })}
      aria-label={badge > 0 ? `${label} (${badge})` : label}
      sx={{
        flexShrink: 0,
        minWidth: 0,
        gap: 1,
        px: { xs: 0.75, sm: 1.25 },
        py: 0.625,
        borderRadius: 'var(--sf-pill)',
        fontWeight: 700,
        fontSize: TS.body,
        color: 'var(--text)',
        '&:hover': { bgcolor: 'var(--sf-media-bg)' },
      }}
    >
      <Badge
        badgeContent={badge}
        aria-hidden
        overlap="circular"
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{
          '& .MuiBadge-badge': {
            height: 17,
            minWidth: 17,
            padding: '0 4px',
            fontSize: 10,
            fontWeight: 800,
            bgcolor: 'var(--accent)',
            color: '#fff',
            // El anillo del color de la barra separa la cifra del glifo sin
            // dibujarle una caja alrededor.
            border: '2px solid var(--card)',
          },
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 'var(--sf-pill)',
            display: 'grid',
            placeItems: 'center',
            bgcolor: bg,
            color: fg,
            '& .MuiSvgIcon-root': { fontSize: 19 },
          }}
        >
          {icon}
        </Box>
      </Badge>
      {!iconOnly && (
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {label}
        </Box>
      )}
    </Button>
  )
}

/**
 * Claro u oscuro, también para el comprador.
 *
 * Estaba solo en el backoffice, y quien mira la vitrina de noche es justo quien
 * más lo necesita. El acento sigue siendo del tenant: esto cambia el MODO, no
 * la paleta —contrato §4.4, el comprador nunca repinta la marca de la tienda—.
 *
 * Va sin texto y en gris, al contrario que Favoritos, Tu cuenta y Carrito. La
 * cabecera tiene tres trabajos —buscar, entrar a lo tuyo y ver el carrito— y
 * una cuarta pastilla con etiqueta competiría con los tres sin vender nada. El
 * nombre viaja en `aria-label`, así que quien usa lector de pantalla lo oye
 * igual.
 */
function ThemeButton() {
  const { t } = useI18n()
  const { appearance, toggleMode } = useAppearance()
  const oscuro = appearance.mode === 'dark'

  return (
    <HeaderAction
      onClick={toggleMode}
      icon={oscuro ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
      // Dice a DÓNDE va, no dónde está: es un interruptor, y lo útil de leer
      // antes de pulsarlo es qué va a pasar.
      label={oscuro ? t('common.theme.light') : t('common.theme.dark')}
      tone="neutral"
      iconOnly
    />
  )
}

function FavoritesButton({ storeSlug, storeId }: { storeSlug: string; storeId: string }) {
  const { t } = useI18n()
  // La tienda llega por prop y no por `useStorefront`: ese hook lee el contexto
  // del `<Outlet>`, y la cabecera es quien lo PROVEE — dentro de ella el
  // contexto todavia no existe y el boton no aparecia nunca.
  const favorites = useFavorites(storeId)
  if (favorites.ids.size === 0) return null

  return (
    <HeaderAction
      to={`/s/${storeSlug}/favoritos`}
      // Relleno y no de contorno: el boton solo existe cuando hay algo
      // guardado, asi que el corazon lleno DICE algo — «tienes esto».
      icon={<FavoriteRoundedIcon />}
      label={t('store.favorites.nav')}
      badge={favorites.ids.size}
      tone="favorite"
    />
  )
}

/**
 * La misma casilla de la barra dice dos cosas según haya sesión o no: «Tu
 * cuenta» cuando la hay, «Entrar» cuando no.
 *
 * Sin sesión no había NADA. Un comprador de empresa abría la tienda, veía el
 * precio de catálogo y no tenía por dónde identificarse: el único `/login` de
 * la aplicación estaba en la portada de la plataforma, fuera de la vitrina. Su
 * precio de convenio, su cuenta y sus pedidos existían y eran inalcanzables
 * desde la única pantalla donde importan.
 *
 * **Vuelve a donde estaba.** El destino es la ruta actual y no la portada de la
 * tienda: quien pulsa «Entrar» desde una ficha quiere ver ESA ficha con su
 * precio, y mandarlo al backoffice —o al inicio— después de pedirle la sesión
 * es perderlo. Misma convención que ya usa el checkout de la tienda que exige
 * cuenta (`state.from`).
 */
function AccountButton({ storeSlug }: { storeSlug: string }) {
  const { t } = useI18n()
  const { status } = useSessionContext()
  const location = useLocation()

  if (status === 'authenticated') {
    return (
      <HeaderAction
        to={`/s/${storeSlug}/account`}
        icon={<PersonRoundedIcon />}
        label={t('account.title')}
        tone="account"
      />
    )
  }

  // Mientras se resuelve la sesión no se pinta ninguno de los dos: enseñar
  // «Entrar» a quien ya tiene sesión, aunque sea medio segundo, es decirle que
  // no está dentro.
  if (status !== 'anonymous') return null

  return (
    <HeaderAction
      to="/login"
      state={{ from: `${location.pathname}${location.search}` }}
      icon={<LoginRoundedIcon />}
      label={t('store.signIn')}
      tone="account"
    />
  )
}

/**
 * Botón del carrito. Abre el panel lateral en vez de navegar: el comprador ve
 * lo que lleva sin abandonar la ficha que estaba mirando. La página `/cart`
 * sigue estando a un clic desde el propio panel.
 *
 * Es el único con acento: de las tres acciones de la barra, es la que cierra la
 * venta.
 */
function CartButton() {
  const { t } = useI18n()
  const { count, openCart } = useCart()

  return (
    <HeaderAction
      onClick={openCart}
      icon={<ShoppingCartRoundedIcon />}
      label={t('store.cart.title')}
      badge={count}
      tone="cart"
    />
  )
}

