import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import LoginRoundedIcon from '@mui/icons-material/LoginRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Fab,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useDocumentMeta } from '@/shared/seo/useDocumentMeta'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { SkipToContentLink, CONTENT_ANCHOR } from '@/shared/ui/SkipToContentLink'
import { AppearanceProvider } from '@/theme/AppearanceProvider'
import { useAppearance } from '@/theme/appearance-context'
import { SH, TS } from '@/theme/tokens'
import { StorefrontNotFoundError } from './api'
import { notFoundMeta } from './seo'
import { initials } from './branding'
import { resolveShowThemeToggle } from './identity'
import { StoreCategoryNav } from './components/StoreCategoryNav'
import { StoreFooter } from './components/StoreFooter'
import { StoreAnnouncementBar } from './components/StoreAnnouncementBar'
import { StoreBrandLockup } from './components/StoreBrandLockup'
import { StoreQuickSearch } from './components/StoreQuickSearch'
import { CartDrawer } from './cart/CartDrawer'
import { CartProvider } from './cart/CartProvider'
import { useCart } from './cart/cart-context'
import {
  OFERTAS_QUERY,
  useCatalogPages,
  usePublicCategories,
  usePublicStore,
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
 * El asistente, por `lazy` y montado solo cuando se abre (P14).
 *
 * Estaba SIEMPRE montado —cerrado, pero montado— así que toda visita a la
 * tienda descargaba su cajón, su conversación y la tarjeta de producto que
 * pinta dentro. Es una pantalla que se abre pulsando un botón flotante: quien
 * no lo pulsa no debería pagarla en el primer pintado.
 *
 * `asistenteUsado` existe para que la animación de cierre siga viéndose: una
 * vez abierto, el cajón se queda montado y se cierra como siempre. Desmontarlo
 * al cerrar lo haría desaparecer de golpe.
 */
const AssistantDrawer = lazy(() =>
  import('./components/AssistantDrawer').then((modulo) => ({ default: modulo.AssistantDrawer })),
)

/** Solo se descarga con sesión: ver el comentario donde se monta. */
const CommerceContextBar = lazy(() =>
  import('./commerce/CommerceContextBar').then((m) => ({ default: m.CommerceContextBar })),
)

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
  const [asistenteUsado, setAsistenteUsado] = useState(false)
  const enCheckout = /\/checkout\/?$/.test(pathname)
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
            {/* Para quién se compra, cuando hay una cuenta de empresa activa en
                esta sociedad (H05-H06). Para el consumidor no pinta nada.
                Diferida y solo con sesión: el visitante anónimo —casi todo el
                tráfico de una portada— no descarga ni un byte de ella, y la
                portada estaba a medio kB de su techo de rendimiento. */}
            {sessionStatus === 'authenticated' && (
              <Suspense fallback={null}>
                <CommerceContextBar storeSlug={storeSlug as string} />
              </Suspense>
            )}
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
          <StoreFooter store={store} storeSlug={storeSlug as string} />
          {/* N07 · Holgura bajo el pie en el teléfono: al final del scroll, lo
              último de la página tiene que poder quedar POR ENCIMA de los dos
              botones flotantes (asistente y «volver arriba»), incluida la
              franja segura de un iPhone con barra de gestos. */}
          <Box aria-hidden sx={{ display: { xs: 'block', md: 'none' }, height: 'calc(72px + env(safe-area-inset-bottom, 0px))' }} />

          <CartDrawer storeSlug={storeSlug as string} />

      {/* El asistente flota sobre la tienda y no dentro de ninguna pagina:
          se pregunta desde donde se este, y en la ficha de un producto es
          justo donde mas sentido tiene preguntar por alternativas.

          Se coloca POR ENCIMA de «volver arriba», que ocupa la misma esquina
          en la portada. Apilados y no superpuestos: dos botones peleandose el
          mismo pixel es un boton que no se puede pulsar. */}
      {/* N07 · En el checkout NO flota: tapaba «Siguiente» y el campo de orden
          de compra en el teléfono, justo donde se cierra la venta. */}
      {!enCheckout && (
      <Fab
        color="primary"
        aria-label={t('store.assistant.open')}
        onClick={() => {
          setAsistenteUsado(true)
          setAsistenteAbierto(true)
        }}
        sx={{
          position: 'fixed',
          right: { xs: 16, md: 24 },
          bottom: { xs: 'calc(76px + env(safe-area-inset-bottom, 0px))', md: 88 },
          zIndex: 4,
        }}
      >
        <AutoAwesomeRoundedIcon />
      </Fab>
      )}

      {asistenteUsado && (
        <Suspense fallback={null}>
          <AssistantDrawer
            open={asistenteAbierto}
            onClose={() => setAsistenteAbierto(false)}
            storeSlug={storeSlug as string}
            storeId={store.store_id}
          />
        </Suspense>
      )}
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
      // El ancho lo pone el TEMA, no la escala de MUI: ver `--sf-content-w` en
      // `theme-context.ts`. `maxWidth={false}` apaga el tope de MUI —1200 px en
      // `lg`, que en un monitor de 1920 dejaba 360 px de desierto a cada lado—
      // y deja mandar a la variable. Los gutters del contenedor se conservan.
      maxWidth={false}
      data-content-width={style.contentWidth}
      sx={{
        flex: 1,
        maxWidth: 'var(--sf-content-w)',
        mx: 'auto',
        py: { xs: 'var(--sf-main-pad)', md: 'var(--sf-main-pad-md)' },
        // El ancla del salto de contenido no puede quedar debajo de la cabecera
        // pegajosa.
        scrollMarginTop: 'var(--sf-anchor-offset)',
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

/**
 * La cabecera de la tienda, en tres composiciones (Storefront V3 · P03).
 *
 * ## Qué cambió, y por qué no son tres cabeceras
 *
 * Hasta V3 había UNA barra —logotipo, buscador, acciones— y `headerVariant`
 * solo le cambiaba la altura y el alto de la caja de búsqueda. Un tema que
 * solo cambia medidas no es una personalidad, y la primera pantalla de una
 * tienda premium se veía igual que la de un catálogo de ferretería.
 *
 * Ahora son tres REPARTOS de las mismas piezas:
 *
 *  · `standard` — marca a la izquierda, buscador al centro, acciones a la
 *    derecha. La de siempre, y la que ve quien no eligió tema.
 *  · `compact` — la marca se encoge y el buscador ocupa lo que suelta. Para un
 *    catálogo de miles de referencias, donde quien llega ya sabe qué quiere.
 *  · `brand` — la marca al CENTRO y grande, con las acciones a un lado y el
 *    buscador debajo. Una tienda de marca no compite por el clic en la primera
 *    pantalla: compite por ser reconocida.
 *
 * Las piezas son las mismas en las tres —`StoreBrandLockup`,
 * `StoreQuickSearch`, los cuatro botones— y ninguna variante quita ninguna. Un
 * tema que dejara la tienda sin carrito dejaría de ser un tema.
 *
 * ## Lo que NINGUNA variante hace
 *
 * Esconder el buscador en el teléfono. Se probó en V2 y fue un error:
 * ocultarlo por debajo de `md` dejaba a quien llegaba por teléfono sin forma
 * de buscar en un catálogo de cientos de productos. Baja a su propia fila, y
 * ahí sigue en las tres.
 */
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

  /**
   * La composición la elige el TEMA; el contenido, nunca.
   *
   * El tema ya decidía el ancho de la barra, su altura y el alto de la caja de
   * búsqueda, y los tres viajan como variables de CSS desde P05. Lo que V3 añade
   * es el REPARTO, y eso sí hay que leerlo aquí: son árboles distintos, no
   * medidas distintas.
   */
  const { style } = useStorefrontTheme()
  const variante = style.headerVariant

  // En el teléfono las tres se comportan igual, y a propósito: dos filas de
  // marca centrada en 390 px se comen media pantalla antes del primer producto.
  const deMarca = variante === 'brand' && !enMovil
  const compacta = variante === 'compact'

  const acciones = (
    <>
      {/* Las páginas del CMS —quiénes somos, envíos, términos— NO viven aquí.
          La cabecera de una tienda tiene tres trabajos: buscar, entrar a lo
          tuyo y ver el carrito; cada enlace que se le añade compite con esos
          tres y ninguno de ellos vende. Se leen una vez, casi siempre
          buscándolas, y su sitio de siempre es el pie. */}
      <ThemeButton store={store} />
      <FavoritesButton storeSlug={storeSlug} storeId={store.store_id} />
      <AccountButton storeSlug={storeSlug} />
      <CartButton />
    </>
  )

  const buscador = <StoreQuickSearch storeSlug={storeSlug} />

  return (
    <Box
      component="header"
      className="sf-header"
      data-header-variant={variante}
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
      {/* Los avisos del comercio, ENCIMA de todo y solo si los escribió. Ver
          `StoreAnnouncementBar`: la plataforma no genera ninguno. */}
      <StoreAnnouncementBar messages={store.announcement_messages} />

      <Container
        maxWidth={false}
        disableGutters
        sx={{ maxWidth: 'var(--sf-content-w)', mx: 'auto' }}
      >
        {deMarca ? (
          /**
           * La composición de marca: dos filas.
           *
           * Arriba la marca, centrada y grande, con las acciones a la derecha
           * —en su sitio de siempre, porque mover el carrito de sitio por tema
           * sería cambiar dónde se compra—. Debajo el buscador, centrado y
           * acotado: accesible, pero visualmente secundario.
           *
           * Las acciones van en posición absoluta para que la marca quede
           * centrada respecto a la PÁGINA y no respecto al hueco que le dejan:
           * con `space-between` el logotipo se descentra en cuanto el carrito
           * gana una insignia de dos cifras.
           */
          <Box sx={{ px: { xs: 2, md: 3 }, pt: 1.5, pb: 1 }}>
            <Box sx={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
              <StoreBrandLockup store={store} storeSlug={storeSlug} size="lg" center />
              <Stack
                direction="row"
                sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', alignItems: 'center', gap: 0.5 }}
              >
                {acciones}
              </Stack>
            </Box>
            <Box sx={{ maxWidth: 520, mx: 'auto', mt: 1.25 }}>{buscador}</Box>
          </Box>
        ) : (
          <Toolbar
            sx={{
              gap: compacta ? 1 : 1.5,
              px: { xs: 2, md: 3 },
              minHeight: { xs: 'var(--sf-header-h)', md: 'var(--sf-header-h-md)' },
            }}
          >
            <StoreBrandLockup
              store={store}
              storeSlug={storeSlug}
              // La compacta encoge la marca para que el buscador ocupe lo que
              // suelta: es lo que la convierte en «search first» de verdad y no
              // en la estándar con doce píxeles menos.
              size={compacta ? 'sm' : 'md'}
            />

            {/* El buscador vive en la cabecera y no en el cuerpo del catálogo:
                es lo primero que se usa para llegar a un producto, y desde aquí
                está en TODAS las pantallas de la tienda. En el teléfono baja a
                su propia fila —ver abajo—, porque a 360 px no cabe junto al
                logotipo y el carrito sin dejar los tres apretados. */}
            {!enMovil && (
              <Box sx={{ display: 'flex', flex: 1, minWidth: 0, mx: compacta ? 0.5 : 1 }}>
                {buscador}
              </Box>
            )}

            {acciones}
          </Toolbar>
        )}

        {/* En móvil, el buscador baja a su propia fila.

            Antes no estaba en ninguna: se ocultaba por debajo de `md` y no lo
            sustituía nada, así que quien llegaba por teléfono no tenía forma de
            buscar en un catálogo de 570 productos — le quedaba recorrer las
            familias una por una. La cabecera declara tres trabajos y cumplía
            dos. Vale para las TRES variantes: ninguna esconde la búsqueda. */}
        {enMovil && <Box sx={{ px: 2, pb: 1 }}>{buscador}</Box>}
      </Container>

      {/* Las familias, bajo la barra y en TODAS las pantallas de la tienda.
          Estaban a media portada: para cambiar de familia habia que volver
          arriba, y desde una ficha de producto no habia forma de llegar. */}
      <StoreCategories storeSlug={storeSlug} storeId={store.store_id} />
    </Box>
  )
}

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
  trailing,
  menu,
}: {
  icon: ReactNode
  label: string
  badge?: number
  tone: keyof typeof ACTION_TONES
  /** Enlace o botón: uno de los dos, nunca los dos. */
  to?: string
  /** Estado de navegación del enlace, para volver a donde se estaba. */
  state?: unknown
  onClick?: (event: React.MouseEvent<HTMLElement>) => void
  /** Sin texto ni en escritorio: para lo que es utilidad y no destino. */
  iconOnly?: boolean
  /** Detrás del texto, solo en escritorio (la flecha de un menú). */
  trailing?: ReactNode
  /** Cuando el botón abre un menú: para que el lector de pantalla lo anuncie. */
  menu?: { id: string; open: boolean }
}) {
  const { bg, fg } = ACTION_TONES[tone]

  return (
    <Button
      {...(to ? { component: Link, to, state } : { onClick })}
      {...(menu
        ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu.open, 'aria-controls': menu.open ? menu.id : undefined }
        : {})}
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
      {trailing && (
        <Box
          component="span"
          aria-hidden
          sx={{ display: { xs: 'none', sm: 'inline-flex' }, ml: -0.5, color: 'var(--muted)', '& .MuiSvgIcon-root': { fontSize: 18 } }}
        >
          {trailing}
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
/**
 * El selector claro/oscuro, que ahora lo decide el COMERCIO (V3 · P01/P03).
 *
 * Estaba en la cabecera de toda tienda sin que ningún comercio lo hubiera
 * pedido. En una herramienta de trabajo un botón de tema es útil; en una tienda
 * compite por atención con el carrito, y lo que se ve en la primera pantalla es
 * lo que dice a qué se dedica la página.
 *
 * Viene APAGADO. Lo que no desaparece es el tema oscuro: la vitrina sigue
 * respetando la preferencia del sistema de quien llega y lo que ese visitante
 * hubiera elegido antes. Lo que se va es el control, no el modo.
 *
 * Y no toca el backoffice, que tiene el suyo en Apariencia: esto solo mira la
 * configuración de la tienda pública.
 */
function ThemeButton({ store }: { store: PublicStore }) {
  const { t } = useI18n()
  const { appearance, toggleMode } = useAppearance()
  const oscuro = appearance.mode === 'dark'

  if (!resolveShowThemeToggle(store.show_theme_toggle)) return null

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

  if (status === 'authenticated') return <AccountMenu storeSlug={storeSlug} />

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
 * Una opción del menú de cuenta: icono en su círculo de color —el mismo
 * lenguaje que las pastillas de la barra—, título y una línea que dice qué hay
 * detrás. El nombre accesible es solo el título: la ayuda no se lee dos veces.
 */
function AccountMenuItem({
  icon,
  tone,
  title,
  hint,
  to,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: ReactNode
  tone: { bg: string; fg: string }
  title: string
  hint: string
  to?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <MenuItem
      {...(to ? { component: Link, to } : {})}
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      sx={{
        gap: 1.5,
        px: 1.25,
        py: 1,
        borderRadius: 'var(--sf-radius-sm, 10px)',
        alignItems: 'center',
        whiteSpace: 'normal',
        '&:hover, &.Mui-focusVisible': { bgcolor: danger ? 'var(--red-soft)' : 'var(--sf-media-bg)' },
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 'var(--sf-pill)',
          display: 'grid',
          placeItems: 'center',
          bgcolor: tone.bg,
          color: tone.fg,
          '& .MuiSvgIcon-root': { fontSize: 19 },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: TS.body, fontWeight: 700, color: danger ? 'var(--red)' : 'var(--text)' }}>
          {title}
        </Typography>
        <Typography aria-hidden sx={{ fontSize: TS.label, color: 'var(--muted)', lineHeight: 1.35 }}>
          {hint}
        </Typography>
      </Box>
    </MenuItem>
  )
}

/**
 * «Tu cuenta» abre un menú: quién eres, a dónde ir y salir.
 *
 * La barra llegó a tener cuatro pastillas —tema, Tu cuenta, Salir, Carrito— y
 * dos de ellas eran la MISMA cosa: tu sesión. Juntas en un menú la cabecera
 * vuelve a sus tres trabajos (buscar, lo tuyo, el carrito) y «Salir» sigue a un
 * clic, donde se busca: en tu cuenta.
 *
 * Salir vuelve a la PORTADA de la tienda y no a donde estaba: la página actual
 * puede ser tu cuenta, un pedido o el checkout, que sin sesión ya no tienen nada
 * que enseñar. Un equipo compartido no puede quedarse con la cuenta de empresa,
 * el precio de convenio y los pedidos del anterior abiertos.
 */
function AccountMenu({ storeSlug }: { storeSlug: string }) {
  const { t } = useI18n()
  const { session, signOut } = useSessionContext()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [saliendo, setSaliendo] = useState(false)
  const open = anchor !== null
  const menuId = 'store-account-menu'
  const email = session?.user?.email ?? null
  // El nombre, si Auth lo tiene (alta desde la tienda lo guarda); si no, la
  // parte del correo antes de la arroba. Nunca «?» en un avatar de alguien que
  // sí tiene sesión.
  const metadata = (session?.user?.user_metadata ?? {}) as Record<string, unknown>
  const nombre =
    (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
    (typeof metadata.name === 'string' && metadata.name.trim()) ||
    null
  const primerNombre = nombre ? nombre.split(/\s+/)[0] : null
  const avatar = initials(nombre ?? (email ? email.split('@')[0]!.replace(/[._-]+/g, ' ') : ''))

  const cerrar = () => setAnchor(null)

  async function salir() {
    if (saliendo) return
    setSaliendo(true)
    cerrar()
    try {
      await signOut()
    } finally {
      setSaliendo(false)
      navigate(`/s/${storeSlug}`, { replace: true })
    }
  }

  return (
    <>
      <HeaderAction
        onClick={(event) => setAnchor(event.currentTarget)}
        icon={<PersonRoundedIcon />}
        label={t('account.title')}
        tone="account"
        trailing={
          <KeyboardArrowDownRoundedIcon
            sx={{ transition: 'transform 160ms ease', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        }
        menu={{ id: menuId, open }}
      />
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={cerrar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              width: 300,
              maxWidth: 'calc(100vw - 32px)',
              borderRadius: 'var(--sf-radius, 14px)',
              border: '1px solid var(--border)',
              boxShadow: SH.lg,
              bgcolor: 'var(--card)',
              overflow: 'hidden',
            },
          },
          list: { sx: { p: 0.75 } },
        }}
      >
        {email && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 1.25,
              pt: 1,
              pb: 1.5,
              mb: 0.5,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: 'var(--sf-pill)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: TS.bodyStrong,
                letterSpacing: '0.02em',
                bgcolor: 'var(--blue-soft)',
                color: 'var(--blue)',
              }}
            >
              {avatar}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 800, color: 'var(--text)' }}>
                {primerNombre
                  ? t('store.accountMenu.greeting').replace('{name}', primerNombre)
                  : t('store.accountMenu.signedInAs')}
              </Typography>
              <Typography
                title={email}
                sx={{
                  fontSize: TS.label,
                  color: 'var(--muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {email}
              </Typography>
            </Box>
          </Box>
        )}
        <AccountMenuItem
          to={`/s/${storeSlug}/account`}
          onClick={cerrar}
          icon={<PersonRoundedIcon />}
          tone={ACTION_TONES.account}
          title={t('store.accountMenu.account')}
          hint={t('store.accountMenu.accountHint')}
        />
        <AccountMenuItem
          to={`/s/${storeSlug}/account#pedidos`}
          onClick={cerrar}
          icon={<ReceiptLongRoundedIcon />}
          tone={ACTION_TONES.cart}
          title={t('account.tab.orders')}
          hint={t('store.accountMenu.ordersHint')}
        />
        <Divider sx={{ my: 0.5, borderColor: 'var(--border)' }} />
        <AccountMenuItem
          onClick={() => void salir()}
          disabled={saliendo}
          icon={<LogoutRoundedIcon />}
          tone={ACTION_TONES.favorite}
          title={t('store.signOut')}
          hint={t('store.accountMenu.signOutHint')}
          danger
        />
      </Menu>
    </>
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

