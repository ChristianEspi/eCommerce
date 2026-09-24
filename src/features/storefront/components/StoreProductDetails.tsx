import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { Accordion, AccordionDetails, AccordionSummary, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { TS } from '@/theme/tokens'

/** Un apartado de la zona de detalle. Sin contenido no se pinta. */
export interface DetailPanel {
  readonly id: string
  readonly title: string
  readonly content: ReactNode
}

/**
 * La zona de detalle de la ficha (Storefront V3 · P10).
 *
 * ## Qué problema resuelve
 *
 * La ficha tenía la descripción y los datos técnicos en dos tarjetas con borde y
 * sombra, cada una con su rótulo en versalitas. En escritorio eso son dos cajas
 * más en una página que ya tenía tres; en el teléfono son dos pantallas de texto
 * entre el botón de comprar y las sugerencias — y quien va a por un dato
 * concreto («¿de qué marca es?») tiene que recorrerlas enteras.
 *
 * Plegadas, la información sigue estando toda y **se elige** cuál se abre. Lo
 * principal —foto, precio, variantes, botón— queda antes, que es lo que pide una
 * ficha comercial.
 *
 * ## Las decisiones
 *
 * **Acordeón y no pestañas.** En un teléfono, unas pestañas de contenido largo
 * obligan a volver arriba para cambiar de una a otra, y con tres o cuatro
 * rótulos no caben sin desplazamiento horizontal. El acordeón crece hacia abajo,
 * que es la dirección en la que una página tiene sitio. (En el backoffice manda
 * la regla contraria —pestañas centradas— porque allí las pantallas son anchas y
 * densas; aquí el lector va con una mano.)
 *
 * **El primero abierto.** Un acordeón todo cerrado esconde que hay algo dentro:
 * parece un pie de página con tres líneas. Abierto el primero, se entiende la
 * mecánica sin tocar nada.
 *
 * **Un apartado sin contenido no existe.** Ni con un «no disponible» dentro: una
 * fila que se abre para decir que no hay nada es peor que no ofrecerla.
 *
 * **No se inventa un apartado.** Esta pieza no sabe qué es un envío ni una
 * devolución: pinta lo que le den. Quien decide qué apartados hay es la ficha, y
 * solo puede darle lo que el comercio escribió o lo que la plataforma sabe.
 *
 * `AccordionSummary` de MUI ya es un botón con `aria-expanded` y su panel
 * asociado, así que el teclado y los lectores de pantalla funcionan sin añadir
 * nada.
 */
export function StoreProductDetails({
  panels,
  ariaLabel,
}: {
  panels: readonly DetailPanel[]
  ariaLabel: string
}) {
  const visibles = panels.filter((panel) => panel.content !== null && panel.content !== undefined)
  if (visibles.length === 0) return null

  return (
    <Stack
      component="section"
      aria-label={ariaLabel}
      data-product-details={visibles.length}
      sx={{
        // Ni tarjeta ni sombra: una línea arriba y las filas separadas por
        // hairlines. Lo que tiene que quedar claro es que aquí EMPIEZA el
        // detalle, no que sea otra caja.
        borderTop: '1px solid var(--sf-line)',
      }}
    >
      {visibles.map((panel, indice) => (
        <Accordion
          key={panel.id}
          disableGutters
          elevation={0}
          square
          defaultExpanded={indice === 0}
          data-detail-panel={panel.id}
          sx={{
            bgcolor: 'transparent',
            borderBottom: '1px solid var(--sf-line)',
            '&::before': { display: 'none' },
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreRoundedIcon />}
            sx={{
              px: 0,
              minHeight: 56,
              '& .MuiAccordionSummary-content': { my: 1.25 },
            }}
          >
            <Typography
              component="h2"
              sx={{ fontSize: { xs: 15, md: 16 }, fontWeight: 800, letterSpacing: '-0.01em' }}
            >
              {panel.title}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0, pb: 2.5, fontSize: TS.body }}>
            {panel.content}
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  )
}
