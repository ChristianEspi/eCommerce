import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import { Box, Button, CircularProgress, Stack, Typography, useMediaQuery } from '@mui/material'
import type { ReactNode } from 'react'
import { TS } from '@/theme/tokens'

/**
 * La barra de compra del teléfono (Storefront V3 · P10).
 *
 * ## Por qué existe
 *
 * En el teléfono la ficha es una columna: foto, nombre, precio, botón,
 * confianza, descripción, ficha de datos, opiniones y tres filas de sugerencias.
 * El botón de comprar queda en el primer tercio, y quien baja a leer la
 * descripción —que es justo lo que hace quien está decidiendo— pierde de vista
 * el precio y el botón a la vez. La decisión se toma abajo y el botón está
 * arriba.
 *
 * La barra devuelve las dos cosas que hacen falta para decidir, y solo esas: lo
 * que cuesta y cómo se compra.
 *
 * ## Lo que NO hace, y es la parte importante
 *
 * **No decide nada.** No calcula precio, no mira stock, no elige variante y no
 * habla con el carrito: recibe la etiqueta ya formateada y una acción, y las dos
 * salen del MISMO sitio que el botón de arriba. Dos caminos para añadir al
 * carrito con dos reglas distintas es cómo se acaba cobrando otro precio del que
 * se enseñó.
 *
 * **No aparece cuando no se puede comprar.** Una barra pegada abajo con un botón
 * apagado ocupa sitio para no ofrecer nada.
 *
 * **No existe en escritorio.** Allí la columna de compra es pegajosa y el botón
 * no se va de la pantalla. Y no se esconde con `display: none`: se decide con
 * una CONSULTA DE MEDIOS en JavaScript, igual que el buscador de la cabecera y
 * por el mismo motivo escrito allí —`display: none` quita el elemento de la
 * pantalla, no del documento, así que un lector de pantalla anunciaría dos
 * botones de «añadir al carrito» donde hay uno—. Con la consulta se renderiza
 * UNO, el que toca.
 *
 * ## Los dos detalles que se ven poco y se notan mucho
 *
 * El **área segura** del teléfono (`env(safe-area-inset-bottom)`): sin ella, en
 * un iPhone el botón queda debajo de la barra de gestos del sistema y no se
 * puede pulsar.
 *
 * Y el **nivel**: `zIndex: 3`, el mismo que el botón de «volver arriba» y muy por
 * debajo de los diálogos de MUI (1300), para que la vista rápida y el aviso de
 * variante agotada sigan saliendo por encima.
 */
export function StoreProductPurchaseBar({
  priceLabel,
  note,
  ctaLabel,
  onCta,
  pending = false,
  disabled = false,
}: {
  /** El precio, ya formateado por quien conoce la moneda y el acuerdo. */
  priceLabel: ReactNode
  /** Una línea corta de contexto: «desde», «precio de acuerdo», la variante. */
  note?: ReactNode
  ctaLabel: string
  onCta: () => void
  pending?: boolean
  disabled?: boolean
}) {
  // El mismo corte que usa la cabecera para su buscador: por debajo de `md`.
  const enMovil = useMediaQuery('(max-width:899.95px)')
  if (!enMovil) return null

  return (
    <Box
      data-purchase-bar="true"
      sx={{
        display: 'flex',
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 3,
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        px: 2,
        pt: 1.25,
        // El área segura va en el RELLENO y no en la posición: así el fondo de
        // la barra llega al borde de la pantalla y el contenido no.
        pb: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        bgcolor: 'var(--card)',
        borderTop: '1px solid var(--sf-line)',
        // Sombra hacia arriba: dice que la barra está POR ENCIMA de la página,
        // que es lo que evita que se lea como el final del contenido.
        boxShadow: '0 -8px 24px -18px rgba(0,0,0,.45)',
      }}
    >
      <Stack sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
            // Las cifras no bailan al cambiar de variante.
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {priceLabel}
        </Typography>
        {note ? (
          <Typography
            sx={{
              fontSize: TS.label,
              color: 'var(--muted)',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {note}
          </Typography>
        ) : null}
      </Stack>

      <Button
        variant="contained"
        onClick={onCta}
        disabled={disabled || pending}
        startIcon={
          pending ? <CircularProgress size={16} color="inherit" /> : <ShoppingCartRoundedIcon />
        }
        sx={{ flexShrink: 0, fontWeight: 800, borderRadius: 'var(--sf-pill)', px: 2.5 }}
      >
        {ctaLabel}
      </Button>
    </Box>
  )
}
