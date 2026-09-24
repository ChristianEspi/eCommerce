import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded'
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded'
import { Box, Stack, Typography } from '@mui/material'
import type { ComponentType } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { resolveValueProps, type ValuePropIconKey } from '../valueProps'

/**
 * La franja de propuestas de valor, justo bajo la portada.
 *
 * ## Qué cambió y por qué
 *
 * Antes eran cuatro servicios CABLEADOS aquí dentro, y dos de ellos afirmaban
 * cosas de un rubro concreto —asesoría farmacéutica— o del local del comercio
 * —retiro en tienda—. Cualquier tienda las anunciaba. El problema no era el
 * texto: era que la plataforma hablaba en nombre del negocio de otro.
 *
 * Ahora el contenido llega de `resolveValueProps`, que decide entre dos cosas:
 * lo que el comercio configuró (`store_settings.value_props`) o lo que la
 * plataforma puede afirmar de cualquier tienda porque lo hace el código. Ver
 * `../valueProps.ts`, que es donde vive esa decisión.
 *
 * ## Lo que este componente NO hace
 *
 * No sabe qué vende la tienda, no pregunta por su rubro y no tiene una sola
 * condición por cliente. Recibe entre una y cuatro entradas con icono, título
 * y apoyo, y las pinta.
 *
 * ## Y por qué la rejilla cuenta las entradas
 *
 * Porque con dos propuestas, una rejilla de cuatro columnas deja media franja
 * vacía y se lee como una tienda a medio configurar. Las columnas salen del
 * número real de entradas, que es la misma regla que sigue el resto de la
 * portada desde P06.
 */

const ICONO: Readonly<Record<ValuePropIconKey, ComponentType<{ sx?: object }>>> = {
  delivery: LocalShippingRoundedIcon,
  pickup: StorefrontRoundedIcon,
  payment: LockRoundedIcon,
  support: SupportAgentRoundedIcon,
  returns: ReplayRoundedIcon,
  warranty: VerifiedUserRoundedIcon,
  installments: CreditCardRoundedIcon,
  quality: WorkspacePremiumRoundedIcon,
  assortment: Inventory2RoundedIcon,
  expertise: SchoolRoundedIcon,
  schedule: ScheduleRoundedIcon,
  certification: FactCheckRoundedIcon,
}

export function StoreValueProps({
  store,
}: {
  /**
   * Estructural y no `PublicStore`: así esta pieza sirve igual a la vitrina,
   * a la vista previa del backoffice y a una prueba, sin arrastrar el esquema
   * entero de la tienda ni un ciclo de imports.
   */
  store: {
    readonly value_props?: unknown
    readonly support_email?: string | null
    readonly contact_phone?: string | null
  }
}) {
  const { t } = useI18n()

  const propuestas = resolveValueProps({
    configured: store.value_props,
    // «Escríbenos» solo si hay a dónde escribir. Sin esto, una tienda sin
    // contacto mandaría al comprador a una puerta cerrada.
    hasContact: Boolean(store.support_email?.trim() || store.contact_phone?.trim()),
    t,
  })

  // Una tienda que apagó todas sus propuestas no deja una caja vacía: la franja
  // desaparece, como cualquier otra sección sin nada que pintar.
  if (propuestas.length === 0) return null

  const columnas = Math.min(propuestas.length, 4)

  return (
    <Box
      component="section"
      aria-label={t('store.valueProps.title')}
      data-value-props={propuestas.length}
      sx={{
        display: 'grid',
        gap: { xs: 1.5, md: 0 },
        gridTemplateColumns: {
          xs: propuestas.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          md: `repeat(${columnas}, minmax(0, 1fr))`,
        },
        p: { xs: 2, md: 2.25 },
        borderRadius: 'var(--sf-radius)',
        // Una BANDA, no una tarjeta (Storefront V2 · P05).
        //
        // Con borde y sombra era la tercera caja en los primeros ochocientos
        // píxeles de la tienda —portada, esta franja y la banda de ofertas— y
        // las tres pesaban lo mismo. Eso es lo que hace que una vitrina parezca
        // un panel de administración: todo es un recuadro y nada destaca.
        //
        // Aquí la franja no es contenido que se mire, es información de
        // servicio que se lee de pasada, así que se apoya en un tinte del acento
        // del comercio y suelta el borde y la sombra. Las tarjetas de producto
        // recuperan el único recuadro con peso de la pantalla.
        bgcolor: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
      }}
    >
      {propuestas.map((propuesta, indice) => {
        const Icono = ICONO[propuesta.iconKey]
        return (
          <Stack
            key={propuesta.iconKey}
            direction="row"
            sx={{
              gap: 1.25,
              alignItems: 'center',
              px: { xs: 0, md: 2 },
              // Separadores entre columnas, no cajas: cuatro tarjetas aquí
              // competirían con las tarjetas de producto, que son las que venden.
              borderLeft: {
                xs: 'none',
                md: indice === 0 ? 'none' : '1px solid var(--sf-line)',
              },
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 38,
                height: 38,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: 'var(--accent-soft)',
                color: 'var(--accent-deep)',
              }}
            >
              <Icono sx={{ fontSize: 20 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.3 }}>
                {propuesta.title}
              </Typography>
              {propuesta.body !== '' && (
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', lineHeight: 1.4 }}>
                  {propuesta.body}
                </Typography>
              )}
            </Box>
          </Stack>
        )
      })}
    </Box>
  )
}
