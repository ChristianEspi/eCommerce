import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { TS } from '@/theme/tokens'

/**
 * La cabecera de una sección de la vitrina. Una sola, para todas.
 *
 * ## Qué arregla
 *
 * La portada tenía TRES formas distintas de decir «aquí empieza una sección», y
 * las tres podían aparecer en la misma pantalla:
 *
 *  · `ProductRow` y `BrandRow` — 19/22 px en negrita, sin nada más.
 *  · `BlockHeading` del CMS — 21/26 px con una regla de acento a la derecha.
 *  · `PromoCarousel` y `CampaignWall` — versalitas diminutas en color de acento.
 *
 * Ninguna estaba mal por separado. Juntas hacen que la página parezca ensamblada
 * de tres sitios: el comprador no puede aprender la jerarquía porque cambia cada
 * dos bloques, y lo que en un sitio es un título en otro parece una etiqueta.
 *
 * ## Las decisiones
 *
 * **El titular manda y la regla cierra.** Gana el tratamiento del CMS —título
 * grande más una regla que arranca en el acento y se apaga hacia el borde—
 * porque es el único de los tres que además de nombrar la sección la SEPARA de
 * la anterior. En una portada larga eso es la mitad del trabajo.
 *
 * **Las versalitas no desaparecen: bajan a `eyebrow`.** «OFERTAS DE LA SEMANA»
 * encima del título sigue siendo útil —dice de qué va la fila antes de leerla—,
 * pero como acompañante, no como el título entero. Una sección cuyo nombre está
 * a 11 px se lee como un pie de foto.
 *
 * **La acción va pegada al título, no al final de la fila.** Se conserva de
 * `ProductRow`: al final del todo hay que desplazarse hasta el borde para
 * encontrarla, que es justo lo que se quiere evitar.
 *
 * `component` es configurable porque el nivel del encabezado depende de la
 * página, no del adorno: la portada del CMS puede llevar su `h1` en el hero y
 * todo lo demás cuelga en `h2`.
 */
export function SectionHeading({
  title,
  subtitle,
  eyebrow,
  action,
  component = 'h2',
}: {
  title: ReactNode
  subtitle?: ReactNode
  /** Versalitas de contexto sobre el título. */
  eyebrow?: ReactNode
  /** Enlace o controles a la derecha del título. */
  action?: ReactNode
  component?: 'h1' | 'h2' | 'h3'
}) {
  return (
    <Stack sx={{ gap: 0.25 }}>
      {eyebrow ? (
        <Typography
          sx={{
            fontSize: TS.label,
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--accent-deep)',
          }}
        >
          {eyebrow}
        </Typography>
      ) : null}

      <Stack direction="row" sx={{ alignItems: 'flex-end', gap: 2 }}>
        <Stack sx={{ gap: 0.25, minWidth: 0, flexShrink: 1 }}>
          <Typography
            component={component}
            sx={{
              fontSize: { xs: 'var(--sf-heading)', md: 'var(--sf-heading-md)' },
              fontWeight: 800,
              letterSpacing: '-0.025em',
              lineHeight: 1.2,
            }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ fontSize: TS.bodyStrong, color: 'var(--muted)' }}>
              {subtitle}
            </Typography>
          ) : null}
        </Stack>

        {/* Regla que arranca en el acento y se apaga hacia el borde: cierra el
            bloque y ordena la lectura sin competir con el título. A 1 px y en
            gris no se veía; el degradado se ve y sigue sin gritar. */}
        <Box
          aria-hidden
          sx={{
            flex: 1,
            height: 2,
            minWidth: 24,
            mb: 1.25,
            borderRadius: 1,
            background:
              'linear-gradient(to right, color-mix(in srgb, var(--accent) 55%, transparent), transparent)',
          }}
        />

        {action ? <Box sx={{ flexShrink: 0, mb: 0.25 }}>{action}</Box> : null}
      </Stack>
    </Stack>
  )
}
