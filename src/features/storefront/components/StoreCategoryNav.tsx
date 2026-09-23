import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { Box, Container, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { iconoDe } from '../categoryIcon'
import { tintFor } from '../tint'
import type { PublicCategory } from '../types'

/**
 * Una categoría con lo que cuelga de ella, hasta el fondo.
 *
 * Era `children: PublicCategory[]` —un solo nivel— y por eso el panel enseñaba
 * las hijas de la familia y PERDÍA a las nietas: «Dispositivos y materiales
 * médicos» cuelga de «Hematológicos» y no aparecía por ninguna parte, ni como
 * hija ni como hermana. Una rama que no se pinta es una rama a la que no se
 * puede llegar.
 */
interface Nodo {
  readonly category: PublicCategory
  readonly children: readonly Nodo[]
}

/**
 * El árbol de categorías, con su jerarquía entera.
 *
 * Se arma sobre las categorías que la vitrina ya tiene cargadas: una pasada por
 * el array por nivel, ninguna consulta más. `public_categories` solo trae las
 * alcanzables —activas y con todos sus ancestros activos—, así que lo que llega
 * se enseña.
 *
 * Recursiva y sin tope de profundidad porque el tope no es del componente: lo
 * pone el comercio al componer sus categorías. Un `if` de dos niveles aquí es
 * exactamente lo que hacía desaparecer la tercera.
 */
function ramas(categories: readonly PublicCategory[], parentId: string | null): Nodo[] {
  return categories
    .filter((category) => category.parent_id === parentId)
    .map((category) => ({ category, children: ramas(categories, category.category_id) }))
}

function arbol(categories: readonly PublicCategory[]): Nodo[] {
  return ramas(categories, null)
}

/**
 * La barra de familias, bajo la cabecera.
 *
 * ## Por qué aquí y no en la portada
 *
 * Las categorías eran una fila de azulejos a media página: para cambiar de
 * familia había que volver arriba, y desde una ficha de producto no había forma
 * de llegar. En la cabecera están en TODAS las pantallas de la tienda, que es
 * lo que hace cualquier comercio con un catalogo grande.
 *
 * ## Por qué un panel y no un enlace directo
 *
 * Una familia con cuarenta subcategorías no cabe en una píldora. El panel
 * enseña de una vez todo lo que hay dentro —que es la pregunta real, «¿qué
 * tenéis de esto?»— y desde ahí se entra al nivel concreto en un solo clic, sin
 * pasar por una pantalla intermedia que solo lista más categorías.
 *
 * ## En móvil no hay panel
 *
 * Un desplegable de tres columnas en 380 px es una pantalla entera de enlaces
 * de 12 px. Ahí la familia es un enlace directo y las subcategorías se eligen
 * en el panel de filtros del catálogo, que ya existe y ya funciona con el dedo.
 */
export function StoreCategoryNav({
  storeSlug,
  categories,
  showOffers = false,
}: {
  storeSlug: string
  categories: readonly PublicCategory[]
  /**
   * ¿Hay campañas vivas a las que llevar?
   *
   * Lo decide quien monta la barra, no ella: esta pieza pinta lo que le dan y
   * no consulta nada — es lo que la deja probarse sin montar medio árbol. Y un
   * enlace a una sección que no está en la página es peor que no tenerlo.
   */
  showOffers?: boolean
}) {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const seleccionada = params.get('c')
  const [abierta, setAbierta] = useState<string | null>(null)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const familias = arbol(categories)

  // Cerrar con Escape y al pulsar fuera. Un panel que solo se cierra volviendo
  // a pulsar su propia pestaña es una trampa con el teclado.
  useEffect(() => {
    if (!abierta) return

    const alPulsarFuera = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) setAbierta(null)
    }
    const alTeclear = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAbierta(null)
    }

    document.addEventListener('mousedown', alPulsarFuera)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alPulsarFuera)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierta])

  // Al cambiar de categoría el panel sobra: ya se está viendo el resultado.
  useEffect(() => setAbierta(null), [seleccionada])

  if (familias.length === 0) return null

  return (
    <Box
      ref={contenedor}
      sx={{ position: 'relative', borderTop: '1px solid var(--sf-line)', bgcolor: 'var(--card)' }}
    >
      <Container maxWidth="lg" disableGutters>
        <Stack
          component="nav"
          direction="row"
          aria-label={t('store.categories.title')}
          sx={{
            gap: { xs: 1.5, md: 2.5 },
            px: { xs: 2, md: 3 },
            py: 0.75,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {familias.map(({ category, children }) => {
            const Icono = iconoDe(category.name)
            const tinte = tintFor(category.name)
            const activa = seleccionada === category.slug
            const desplegable = children.length > 0

            return (
              <Box
                key={category.category_id}
                component={desplegable ? 'button' : Link}
                type={desplegable ? 'button' : undefined}
                to={desplegable ? undefined : `/s/${storeSlug}?c=${encodeURIComponent(category.slug)}`}
                aria-expanded={desplegable ? abierta === category.slug : undefined}
                aria-current={activa ? 'true' : undefined}
                onClick={
                  desplegable
                    ? () => setAbierta((previa) => (previa === category.slug ? null : category.slug))
                    : undefined
                }
                sx={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 0.5,
                  py: 0.75,
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  fontSize: 13.5,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  color: activa || abierta === category.slug ? tinte.fg : 'var(--text)',
                  borderBottom:
                    activa || abierta === category.slug
                      ? `2px solid ${tinte.fg}`
                      : '2px solid transparent',
                  '&:hover': { color: tinte.fg },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 24,
                    height: 24,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    bgcolor: tinte.bg,
                    color: tinte.fg,
                  }}
                >
                  <Icono sx={{ fontSize: 15 }} />
                </Box>
                {category.name}
                {desplegable ? (
                  <ExpandMoreRoundedIcon
                    aria-hidden
                    sx={{
                      fontSize: 16,
                      opacity: 0.6,
                      display: { xs: 'none', md: 'block' },
                      transform: abierta === category.slug ? 'rotate(180deg)' : 'none',
                      transition: 'transform .15s ease',
                      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                    }}
                  />
                ) : null}
              </Box>
            )
          })}

          {/* Dos puertas que no son categorías: la oferta y la marca.
              Van al FINAL y separadas por una línea fina — si se mezclaran con
              las familias, «Ofertas» parecería una categoría más del catálogo, y
              no lo es: es un corte transversal.

              «Ofertas» lleva al CATÁLOGO filtrado por lo rebajado, no al ancla
              del carrusel de campañas. Quien pulsa «Ofertas» quiere la lista de
              lo que está más barato, y el carrusel son seis campañas que ya se
              ven en la portada: llevarle allí era enseñarle otra cosa con el
              mismo nombre. Solo aparece si hay algo rebajado —un enlace a una
              lista vacía es peor que no tenerlo— y esa consulta es la MISMA que
              hace la portada para su banda: misma clave de TanStack, cero
              peticiones nuevas. */}
          {showOffers ? (
            <PuertaFija to={`/s/${storeSlug}?ver=todo&oferta=1`} label={t('store.nav.offers')} />
          ) : null}
          <PuertaFija to={`/s/${storeSlug}?ver=todo#marcas`} label={t('store.nav.brands')} />
        </Stack>
      </Container>

      {familias.map(({ category, children }) =>
        abierta === category.slug && children.length > 0 ? (
          <Box
            key={`panel-${category.category_id}`}
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '100%',
              zIndex: 3,
              // En móvil el panel no se abre: la familia navega directa.
              display: { xs: 'none', md: 'block' },
              bgcolor: 'var(--card)',
              borderTop: '1px solid var(--sf-line)',
              borderBottom: '1px solid var(--sf-line)',
              boxShadow: 'var(--sf-shadow-hover)',
              maxHeight: '70vh',
              overflowY: 'auto',
            }}
          >
            <Container maxWidth="lg" sx={{ py: 2.5 }}>
              <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.5, mb: 1.5 }}>
                <Typography
                  component="h2"
                  sx={{ fontSize: 15, fontWeight: 800, color: tintFor(category.name).fg }}
                >
                  {category.name}
                </Typography>
                {/* La familia entera, que es lo que no se puede pedir desde la
                    lista de hijas: alguien que busca «algo de nutrición» sin
                    saber cuál. */}
                <Box
                  component={Link}
                  to={`/s/${storeSlug}?c=${encodeURIComponent(category.slug)}`}
                  sx={{
                    fontSize: TS.label,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    textDecoration: 'none',
                    '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
                  }}
                >
                  {t('store.categories.seeWhole')}
                </Box>
              </Stack>

              {/* Columnas de texto y no una rejilla.
                  Una rejilla reparte CELDAS del mismo alto, y aquí cada rama
                  mide lo que mide —una hija sin nietas ocupa una línea; una con
                  tres, cuatro—: con celdas, las ramas cortas dejaban huecos y la
                  lectura saltaba. Con columnas, cada rama viaja entera
                  (`break-inside: avoid`) y el panel se lee de arriba abajo. */}
              <Box
                component="ul"
                sx={{
                  m: 0,
                  p: 0,
                  listStyle: 'none',
                  columnCount: { md: 3, lg: 4 },
                  columnGap: 3,
                }}
              >
                {children.map((rama) => (
                  <RamaDeCategorias key={rama.category.category_id} rama={rama} storeSlug={storeSlug} />
                ))}
              </Box>
            </Container>
          </Box>
        ) : null,
      )}
    </Box>
  )
}

/**
 * Una rama del panel: la subcategoría y, debajo, lo que cuelga de ella.
 *
 * ## Por qué la jerarquía se PINTA y no se aplana
 *
 * En una lista plana, «Dispositivos y materiales médicos» y «Hematológicos» se
 * leen como hermanas, y no lo son: la primera está DENTRO de la segunda. Quien
 * navega así no se hace una idea del catálogo, se hace una idea equivocada — y
 * al abrir la madre encuentra cosas que la lista decía que estaban al lado.
 *
 * La madre va en negrita solo cuando tiene descendencia: sin eso, el peso de la
 * tipografía dejaría de significar «esto contiene más» y pasaría a ser adorno.
 * La línea vertical hace el resto sin gastar sangría: en un panel de cuatro
 * columnas, indentar dos niveles se come el ancho útil.
 *
 * Se llama a sí misma porque la profundidad la decide el comercio, no este
 * archivo.
 */
function RamaDeCategorias({
  rama,
  storeSlug,
  nivel = 0,
}: {
  rama: Nodo
  storeSlug: string
  nivel?: number
}) {
  const tieneHijas = rama.children.length > 0

  return (
    <Box
      component="li"
      sx={{
        // La rama entera en la misma columna: partir «Hematológicos» de sus
        // hijas por un salto de columna es peor que no enseñarlas.
        breakInside: 'avoid',
        ...(nivel === 0 ? { mb: tieneHijas ? 1.25 : 0 } : {}),
      }}
    >
      <Box
        component={Link}
        to={`/s/${storeSlug}?c=${encodeURIComponent(rama.category.slug)}`}
        sx={{
          display: 'block',
          py: 0.5,
          fontSize: nivel === 0 ? 13.5 : 13,
          fontWeight: nivel === 0 && tieneHijas ? 800 : 400,
          color: nivel === 0 ? 'var(--text)' : 'var(--muted)',
          textDecoration: 'none',
          '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
        }}
      >
        {rama.category.name}
      </Box>

      {tieneHijas ? (
        <Box
          component="ul"
          sx={{
            m: 0,
            mb: 0.5,
            p: 0,
            pl: 1.25,
            listStyle: 'none',
            borderLeft: '1px solid var(--sf-line)',
          }}
        >
          {rama.children.map((hija) => (
            <RamaDeCategorias
              key={hija.category.category_id}
              rama={hija}
              storeSlug={storeSlug}
              nivel={nivel + 1}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * Una entrada de navegación que no es una categoría.
 *
 * Sin icono ni tinte a propósito: los tintes de la barra identifican FAMILIAS
 * del catálogo, y darle uno a «Ofertas» la disfrazaría de familia. Lo que la
 * distingue es el peso y el color de acento, que es el idioma de la acción en
 * el resto de la tienda.
 */
function PuertaFija({ to, label }: { to: string; label: string }) {
  return (
    <Box
      component={Link}
      to={to}
      sx={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        py: 0.75,
        px: 0.5,
        ml: 0.5,
        borderLeft: '1px solid var(--sf-line)',
        pl: 2,
        textDecoration: 'none',
        fontSize: 13.5,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        color: 'var(--accent-deep)',
        borderBottom: '2px solid transparent',
        '&:hover': { borderBottomColor: 'var(--accent)' },
      }}
    >
      {label}
    </Box>
  )
}
