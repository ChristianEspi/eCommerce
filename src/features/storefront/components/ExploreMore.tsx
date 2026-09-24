import { Box, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { iconoDe } from '../categoryIcon'
import { tintFor } from '../tint'
import { SectionHeading } from './SectionHeading'

/**
 * «También puedes explorar»: qué ofrecerle a quien encontró poco.
 *
 * ## El problema que resuelve
 *
 * Un catálogo que devuelve dos resultados deja una rejilla con dos tarjetas y
 * media pantalla de blanco debajo. Quien buscó algo y encontró dos cosas se va;
 * lo que le falta es una salida, y la salida no puede ser inventarse resultados.
 *
 * ## La regla que NO se puede romper
 *
 * **Esto no forma parte del conteo.** Va en su propia sección, con su propio
 * título, DEBAJO de los resultados y visiblemente separado. Los productos
 * recomendados dentro de la rejilla serían resultados que el filtro no
 * devolvió, y el contador de arriba pasaría a mentir — «2 resultados» sobre una
 * rejilla de nueve tarjetas.
 *
 * Por eso aquí no hay ni un producto: solo CATEGORÍAS y MARCAS, que son
 * navegación. Nadie puede confundir una puerta a «Abrigos» con un resultado de
 * su búsqueda.
 *
 * ## Y de dónde salen
 *
 * De datos que la pantalla YA tiene cargados: las familias del árbol de la
 * tienda y las marcas de las facetas de la búsqueda. Cero peticiones nuevas y
 * cero listas curadas que mantener. Lo que está filtrado ahora mismo se excluye
 * —ofrecer la categoría en la que ya se está no es una salida— y si no queda
 * nada que ofrecer, la sección no se pinta.
 */

/** Lo que cabe sin convertir la salida en otro catálogo. */
const TOPE = 6

export interface ExploreOption {
  readonly code: string
  readonly name: string
}

export function ExploreMore({
  storeSlug,
  categories,
  brands,
  selectedCategory,
  selectedBrand,
}: {
  storeSlug: string
  /** Familias del árbol de la tienda: `slug` como código. */
  categories: readonly ExploreOption[]
  /** Marcas de las facetas de la búsqueda. */
  brands: readonly ExploreOption[]
  selectedCategory: string | null
  selectedBrand: string | null
}) {
  const { t } = useI18n()

  const familias = categories.filter((c) => c.code !== selectedCategory).slice(0, TOPE)
  const marcas = brands.filter((b) => b.code !== selectedBrand).slice(0, TOPE)

  // Sin nada que ofrecer, nada que pintar: una sección con su título y una fila
  // vacía debajo es peor que no tenerla.
  if (familias.length === 0 && marcas.length === 0) return null

  return (
    <Stack
      component="section"
      aria-label={t('store.explore.title')}
      data-explore-more="true"
      sx={{
        gap: 1.5,
        mt: 'var(--sf-section-gap-md)',
        pt: 'var(--sf-section-gap-md)',
        // Una línea arriba y nada más: lo que tiene que quedar claro es que
        // esto EMPIEZA algo distinto de los resultados, no que sea otra caja.
        borderTop: '1px solid var(--sf-line)',
      }}
    >
      <SectionHeading
        title={t('store.explore.title')}
        subtitle={t('store.explore.subtitle')}
        component="h2"
      />

      {familias.length > 0 && (
        <Grupo
          titulo={t('store.categories.title')}
          opciones={familias}
          hrefDe={(code) => `/s/${storeSlug}?c=${encodeURIComponent(code)}`}
          conIcono
        />
      )}

      {marcas.length > 0 && (
        <Grupo
          titulo={t('store.brands.title')}
          opciones={marcas}
          hrefDe={(code) => `/s/${storeSlug}?b=${encodeURIComponent(code)}`}
        />
      )}
    </Stack>
  )
}

/** Un grupo de píldoras con su rótulo. Enlaces, no filtros: llevan a otro sitio. */
function Grupo({
  titulo,
  opciones,
  hrefDe,
  conIcono = false,
}: {
  titulo: string
  opciones: readonly ExploreOption[]
  hrefDe: (code: string) => string
  conIcono?: boolean
}) {
  return (
    <Stack sx={{ gap: 0.75 }}>
      <Typography
        component="h3"
        sx={{
          fontSize: TS.label,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        }}
      >
        {titulo}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {opciones.map((opcion) => {
          const tinte = tintFor(opcion.name)
          const Icono = iconoDe(opcion.name)
          return (
            <Box
              key={opcion.code}
              component={Link}
              to={hrefDe(opcion.code)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                // 36 px de alto: el mismo objetivo táctil que el resto de
                // píldoras de la vitrina.
                height: 36,
                pl: conIcono ? 0.75 : 1.5,
                pr: 1.5,
                borderRadius: 'var(--sf-pill)',
                textDecoration: 'none',
                border: `1px solid ${tinte.line}`,
                bgcolor: tinte.bg,
                color: tinte.fg,
                fontSize: 13.5,
                fontWeight: 700,
                transition: 'border-color .15s ease',
                '@media (hover: hover)': { '&:hover': { borderColor: tinte.fg } },
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            >
              {conIcono && (
                <Box
                  aria-hidden
                  sx={{
                    width: 26,
                    height: 26,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    bgcolor: 'var(--card)',
                  }}
                >
                  <Icono sx={{ fontSize: 16 }} />
                </Box>
              )}
              {opcion.name}
            </Box>
          )
        })}
      </Box>
    </Stack>
  )
}
