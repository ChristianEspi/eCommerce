import { Box, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { iconoDe } from '../categoryIcon'
import { tintFor } from '../tint'
import { LoopingRow } from './LoopingRow'
import { ScrollRow } from './ScrollRow'

/**
 * Las puertas de categoría de la vitrina.
 *
 * ## Por qué viven en su propio archivo desde Storefront V2 · P03
 *
 * Estaban dentro de `ContentBlocks.tsx`, un archivo de mil cuatrocientas líneas
 * que pinta todos los bloques del CMS. Funcionaba mientras la puerta era un
 * azulejo de color, y dejó de funcionar cuando la usan tres sitios distintos:
 * el bloque `category_collection` del CMS, la sección `categories` de la
 * portada y —desde P13— la vista previa del backoffice, que necesita el
 * componente presentacional sin arrastrar el resolvedor de bloques del CMS.
 *
 * Sacarlas no cambia lo que pintan. `ContentBlocks` las reexporta, así que
 * quien las importaba de allí sigue funcionando.
 *
 * ## Las dos caras de una puerta, y por qué la foto es opcional
 *
 * **Con foto** (P03) la puerta es la foto: a sangre, con un degradado que
 * garantiza el contraste del texto encima. Es lo que pide una tienda visual —
 * ropa, calzado, mobiliario—, donde la imagen es el argumento.
 *
 * **Sin foto** se pinta con su tinte y su icono, los dos derivados del nombre.
 * No es un estado degradado: es lo correcto para un catálogo de envases o de
 * repuestos, donde la foto de la categoría no añade nada y mantenerla
 * actualizada es trabajo que nadie va a hacer.
 *
 * Ninguna de las dos mira el rubro del comercio. Lo que decide es si esa
 * categoría tiene foto, y eso lo decide quien vende.
 */

/**
 * Las dos formas de enseñar las familias en la portada (contrato `categoryVariant`).
 *
 * ## Por qué son dos y no una con opciones
 *
 * Porque resuelven necesidades opuestas y eso se ve en la composición, no en el
 * relleno:
 *
 *  · **`tiles`** son PUERTAS: azulejos altos con foto o tinte, icono y flecha.
 *    Ocupan pantalla a cambio de decir a dónde llevan. Es lo que quiere una
 *    tienda con ocho familias que se recorren mirando.
 *  · **`pills`** son NAVEGACIÓN: una línea de píldoras compactas con su icono.
 *    Caben treinta sin empujar el catálogo fuera de la primera pantalla, que es
 *    exactamente lo que necesita quien tiene miles de referencias y sabe lo que
 *    busca — el caso del tema `catalog`.
 *
 * Hasta P04 el contrato declaraba las dos y la portada pintaba SIEMPRE azulejos:
 * `categoryVariant` no tenía consumidor. Las píldoras existían, pero solo en la
 * vista de catálogo y como FILTRO, que es otra cosa —se encienden y se apagan—.
 * Estas llevan a otro sitio, así que son enlaces.
 */

/** Lo mínimo que una puerta necesita de una categoría, venga del CMS o del catálogo. */
export interface CategoryDoorItem {
  readonly category_id: string
  readonly name: string
  readonly slug: string
  /**
   * Foto YA firmada, o `null` (P03). Llega firmada y no como ruta porque el
   * bucket es privado y firmar por puerta serían tantas peticiones como
   * categorías: el lote entero se firma una vez arriba.
   */
  readonly imageUrl?: string | null
  /**
   * Texto alternativo. Vacío o ausente = la imagen es DECORATIVA: el nombre de
   * la categoría, que va escrito en la propia puerta, hace de nombre accesible.
   * Repetirlo en el `alt` haría que un lector dijera «Abrigos, Abrigos».
   */
  readonly imageAlt?: string | null
}

/** Cuantas puertas de categoria caben a lo ancho sin apretarse. */
const PUERTAS_A_LO_ANCHO = 4

/**
 * Las puertas de categoría, sin cabecera.
 *
 * Una sola implementación para el CMS y para la portada: la misma familia tiene
 * la misma cara en los dos sitios, y un arreglo de accesibilidad llega a los dos
 * a la vez.
 */
export function CategoryDoorGrid({
  categories,
  storeSlug,
  ariaLabel,
}: {
  categories: readonly CategoryDoorItem[]
  storeSlug: string
  ariaLabel?: string
}) {
  return (
    <>
      {/* Puertas, no etiquetas.
          Eran `Chip` en fila: el mismo tratamiento que un filtro activo del
          catálogo, y aquí no filtran nada — llevan a otro sitio. Una fila de
          píldoras grises tampoco se recorre con el rabillo del ojo, que es como
          se lee una portada.

          Rejilla mientras quepan, carrusel en cuanto no quepan. No es un
          capricho de dos modos: con cuatro familias o menos, la rejilla las
          enseña TODAS de una vez, y esconder tras una flecha algo que cabe
          entero es esconderlo por nada. Pasadas las cuatro, la rejilla las
          apretaba en filas de sobras desiguales —dos arriba y una sola abajo— y
          ahí la fila que se desplaza es lo único que mantiene todas las puertas
          del mismo tamaño. */}
      {categories.length <= PUERTAS_A_LO_ANCHO ? (
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 1.25, md: 2 },
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              md: `repeat(${Math.min(Math.max(categories.length, 2), 4)}, minmax(0, 1fr))`,
            },
          }}
        >
          {categories.map((category) => (
            <CategoryDoor key={category.category_id} category={category} storeSlug={storeSlug} />
          ))}
        </Box>
      ) : (
        <LoopingRow
          items={categories}
          keyOf={(category) => category.category_id}
          itemWidth={{ xs: '68%', sm: '42%', md: 260 }}
          ariaLabel={ariaLabel}
          render={(category, duplicada) => (
            <CategoryDoor category={category} storeSlug={storeSlug} sinFoco={duplicada} />
          )}
        />
      )}
    </>
  )
}

/**
 * Las familias como PÍLDORAS: densas, en una línea, y enlaces.
 *
 * ## En qué se diferencia de la barra del catálogo
 *
 * En lo que hacen. La barra (`CategoryBar`) son `Chip` con `aria-pressed`: un
 * filtro que se enciende y se apaga sobre la lista que ya se está mirando.
 * Estas son `<a>`: llevan al catálogo filtrado por esa familia. Confundirlos
 * tiene consecuencias de accesibilidad —un lector anuncia «botón, pulsado» o
 * «enlace», y son dos promesas distintas— y de navegación: del enlace se vuelve
 * con el botón de atrás.
 *
 * ## Y por qué llevan icono
 *
 * Porque una línea de treinta píldoras de texto gris no se recorre: todas pesan
 * lo mismo. Con el icono de la familia delante, cada una se distingue por su
 * silueta antes de leerla, que es la única forma de que una fila densa sirva
 * para algo.
 */
export function CategoryPills({
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
    <ScrollRow component="nav" ariaLabel={ariaLabel} gap={1}>
      {categories.map((category) => {
        const tinte = tintFor(category.name)
        const Icono = iconoDe(category.name)
        return (
          <Box
            key={category.category_id}
            component={Link}
            to={`/s/${storeSlug}?c=${encodeURIComponent(category.slug)}`}
            data-category-pill="true"
            sx={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.875,
              // Alto de píldora: la misma medida que la barra del catálogo, para
              // que las dos filas se lean como la misma familia de controles.
              height: 36,
              pl: 0.75,
              pr: 1.5,
              borderRadius: 'var(--sf-pill)',
              textDecoration: 'none',
              border: `1px solid ${tinte.line}`,
              bgcolor: tinte.bg,
              color: tinte.fg,
              transition: 'border-color .15s ease, transform .15s ease',
              '@media (hover: hover)': {
                '&:hover': { borderColor: tinte.fg, transform: 'translateY(-1px)' },
              },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
                '&:hover': { transform: 'none' },
              },
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 26,
                height: 26,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: 'var(--card)',
                color: tinte.fg,
              }}
            >
              <Icono sx={{ fontSize: 16 }} />
            </Box>
            <Typography
              component="span"
              sx={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {category.name}
            </Typography>
          </Box>
        )
      })}
    </ScrollRow>
  )
}

/**
 * Una puerta de categoría.
 *
 * Lo que la hace legible de un vistazo es que cada familia tiene SITIO propio:
 * su foto si la tiene, y si no su tinte y su icono, los dos derivados del
 * nombre, así que se vuelve a encontrar por el color antes de leerla. Es la
 * misma asignación que usa la barra de la cabecera — la categoría que arriba es
 * azul, aquí también.
 *
 * La flecha no es decoración: dice que esto lleva a otro sitio, que es
 * exactamente lo que una píldora gris no decía.
 */
export function CategoryDoor({
  category,
  storeSlug,
  sinFoco = false,
}: {
  category: CategoryDoorItem
  storeSlug: string
  /** La copia del bucle: se ve y se pulsa, pero no se tabula ni se anuncia. */
  sinFoco?: boolean
}) {
  const { t } = useI18n()
  const tinte = tintFor(category.name)
  const Icono = iconoDe(category.name)

  /**
   * Una foto que no carga no puede dejar la puerta en blanco.
   *
   * Pasa de verdad: una firma caducada, un objeto borrado a mano o una URL
   * externa que la CSP del despliegue bloquea. Cayendo al tinte, la portada
   * sigue teniendo sus puertas; sin esto, quedaría una fila de rectángulos con
   * el icono roto del navegador.
   */
  const [fotoRota, setFotoRota] = useState(false)
  const conFoto = Boolean(category.imageUrl) && !fotoRota
  const alt = category.imageAlt?.trim() ?? ''

  return (
    <Box
      component={Link}
      to={`/s/${storeSlug}?c=${encodeURIComponent(category.slug)}`}
      {...(sinFoco ? { tabIndex: -1 } : {})}
      data-category-door={conFoto ? 'photo' : 'tint'}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: { xs: 2, md: 2.5 },
        minHeight: { xs: 132, md: 168 },
        borderRadius: 'var(--sf-radius)',
        textDecoration: 'none',
        // Con foto, el fondo es un gris muy bajo que solo se ve el instante
        // anterior a que la imagen pinte. Sin foto, el degradado del propio
        // tinte: una fila de rectángulos planos de color se lee como una tabla
        // pintada, no como puertas.
        background: conFoto
          ? 'var(--sf-media-bg)'
          : `linear-gradient(150deg, ${tinte.bg} 0%, color-mix(in srgb, ${tinte.fg} 12%, ${tinte.bg}) 100%)`,
        border: conFoto ? '1px solid var(--sf-line)' : `1px solid ${tinte.line}`,
        // Con foto el texto va SIEMPRE en blanco sobre el velo, que es lo que
        // garantiza el contraste con cualquier imagen que suba el comercio.
        color: conFoto ? '#FFFFFF' : tinte.fg,
        boxShadow: 'var(--sf-shadow)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        '@media (hover: hover)': {
          '&:hover': { transform: 'translateY(-2px)', boxShadow: 'var(--sf-shadow-hover)' },
          '&:hover .sf-cat-flecha': { transform: 'translateX(3px)' },
          '&:hover .sf-cat-foto': { transform: 'scale(1.05)' },
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
          '&:hover .sf-cat-foto': { transform: 'none' },
        },
      }}
    >
      {conFoto ? (
        <>
          <Box
            component="img"
            className="sf-cat-foto"
            src={category.imageUrl ?? undefined}
            // Decorativa si el comercio no escribió alt: el nombre está debajo
            // y es el nombre accesible del enlace.
            alt={alt}
            {...(alt === '' ? { 'aria-hidden': true } : {})}
            loading="lazy"
            decoding="async"
            onError={() => setFotoRota(true)}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              // `cover` y no `contain`: la foto de una categoría es un FONDO.
              // Encajada dejaría dos franjas vacías dentro del azulejo.
              objectFit: 'cover',
              transition: 'transform .35s ease',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
          {/* Degradado vertical y no velo plano: garantiza el contraste AA donde
              va el texto sin apagar la foto entera. No controlamos qué imagen
              sube el comercio, así que el suelo de abajo es opaco de verdad. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.75) 100%)',
            }}
          />
        </>
      ) : (
        // Marca de agua: el mismo icono, enorme y casi transparente en la
        // esquina. Da cuerpo al azulejo sin meter una foto que habría que
        // mantener por categoría.
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            right: -14,
            bottom: -18,
            opacity: 0.16,
            color: tinte.fg,
            pointerEvents: 'none',
          }}
        >
          <Icono sx={{ fontSize: 104 }} />
        </Box>
      )}

      {/* El disco del icono se queda también con foto, y no es adorno: es lo que
          hace que la puerta se reconozca cuando la foto es oscura o ruidosa. */}
      <Box
        aria-hidden
        sx={{
          position: 'relative',
          width: 42,
          height: 42,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '50%',
          bgcolor: conFoto ? 'color-mix(in srgb, #FFFFFF 88%, transparent)' : 'var(--card)',
          color: conFoto ? 'var(--accent-deep)' : tinte.fg,
          boxShadow: conFoto ? '0 4px 12px -6px rgba(0,0,0,.5)' : `0 6px 16px -10px ${tinte.fg}`,
        }}
      >
        <Icono sx={{ fontSize: 22 }} />
      </Box>

      <Typography
        sx={{
          position: 'relative',
          mt: 'auto',
          fontSize: { xs: 16, md: 18 },
          fontWeight: 800,
          letterSpacing: '-0.02em',
          lineHeight: 1.25,
          // Con foto detrás, una sombra bajísima despega el texto del ruido de
          // la imagen sin dibujarle una caja.
          ...(conFoto ? { textShadow: '0 1px 12px rgba(0,0,0,.45)' } : {}),
        }}
      >
        {category.name}
      </Typography>

      <Stack
        direction="row"
        sx={{
          position: 'relative',
          alignSelf: 'flex-start',
          alignItems: 'center',
          gap: 0.5,
          px: 1.25,
          py: 0.375,
          borderRadius: 'var(--sf-pill)',
          bgcolor: conFoto ? 'color-mix(in srgb, #FFFFFF 92%, transparent)' : 'var(--card)',
          color: conFoto ? 'var(--text)' : 'inherit',
          fontSize: TS.label,
          fontWeight: 800,
        }}
      >
        {t('store.categories.see')}
        <Box
          className="sf-cat-flecha"
          component="span"
          aria-hidden
          sx={{
            transition: 'transform .18s ease',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          →
        </Box>
      </Stack>
    </Box>
  )
}
