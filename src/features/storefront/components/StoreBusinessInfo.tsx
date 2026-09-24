import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { Box, Link as MuiLink, Stack, Typography } from '@mui/material'
import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'

/**
 * La sección `business-info` de la portada: quién es este comercio y cómo se
 * le encuentra (Storefront V2 · P09).
 *
 * ## Qué era hasta P09
 *
 * `'business-info': () => null`. Estaba declarada en el contrato de secciones,
 * salía en el editor de portada del backoffice y un comercio podía encenderla
 * y arrastrarla de sitio. No pintaba nada. Encender algo y que no pase nada es
 * peor que no ofrecerlo.
 *
 * ## La regla, la misma que el pie: no se inventa nada
 *
 * Aquí tienta todavía más que en el pie, porque una sección «sobre nosotros» en
 * mitad de una tienda pide a gritos un párrafo de confianza, un horario de
 * atención y un mapa. Los tres serían afirmaciones sobre el negocio de otro. Lo
 * que se pinta sale **exclusivamente** de lo que el comercio escribió en su
 * configuración y de las páginas que él publicó.
 *
 * ## Cuándo NO se pinta
 *
 * Cuando no hay **ni una** forma de llegar al comercio —correo, teléfono o
 * dirección—. El nombre y la descripción ya están en la cabecera y en el pie,
 * así que una sección que solo los repitiera sería un hueco con tipografía: no
 * responde nada que el visitante no supiera al entrar.
 *
 * Las páginas publicadas acompañan, pero no sostienen la sección por sí solas:
 * el pie ya las lista, y una tienda sin contacto que solo enseñara aquí sus
 * términos estaría usando media portada para repetir el pie.
 *
 * ## Por qué se parece al pie, y por qué está bien
 *
 * Porque es el mismo dato. La diferencia es dónde: el pie es donde se busca
 * cuando ya se ha decidido, y esta sección es donde el comercio la pone cuando
 * quiere que se vea **antes** de decidir —viene apagada en los cuatro temas y
 * es él quien la enciende y la coloca—. Repetir el teléfono a media página es
 * una decisión de comercio legítima; inventarlo no.
 */
export function StoreBusinessInfo({
  store,
  storeSlug,
  pages,
}: {
  /**
   * Estructural y no `PublicStore`, como `StoreValueProps`: así la vista previa
   * del backoffice y las pruebas pueden montarla sin construir una tienda
   * entera ni arrastrar el esquema público.
   */
  store: {
    readonly name: string
    readonly business_display_name?: string | null
    readonly hero_subtitle?: string | null
    readonly support_email?: string | null
    readonly contact_phone?: string | null
    readonly contact_address?: string | null
  }
  storeSlug: string
  /** Solo las que el comercio publicó y marcó para el menú. */
  pages: readonly { readonly slug: string; readonly title: string }[]
}) {
  const { t } = useI18n()

  const nombre = store.business_display_name?.trim() || store.name
  const descripcion = store.hero_subtitle?.trim() ?? ''
  const correo = store.support_email?.trim() ?? ''
  const telefono = store.contact_phone?.trim() ?? ''
  const direccion = store.contact_address?.trim() ?? ''

  const canales = [
    correo !== ''
      ? {
          clave: 'email' as const,
          icono: MailOutlineRoundedIcon,
          etiqueta: t('store.contact.email'),
          valor: correo,
          href: `mailto:${correo}`,
        }
      : null,
    telefono !== ''
      ? {
          clave: 'phone' as const,
          icono: PhoneRoundedIcon,
          etiqueta: t('store.contact.phone'),
          valor: telefono,
          // El mismo saneado que el pie: un número con espacios no se marca.
          href: `tel:${telefono.replace(/\s+/g, '')}`,
        }
      : null,
    direccion !== ''
      ? {
          clave: 'address' as const,
          icono: PlaceOutlinedIcon,
          etiqueta: t('store.contact.address'),
          valor: direccion,
          href: null,
        }
      : null,
  ].filter((canal) => canal !== null)

  // Sin una sola forma de llegar al comercio, esto es la cabecera repetida.
  if (canales.length === 0) return null

  // Como mucho cuatro: esto orienta, y el pie ya tiene la lista completa. Y un
  // título en blanco no es un enlace, es un destino invisible.
  const paginas = pages.filter((pagina) => pagina.title.trim() !== '').slice(0, 4)

  return (
    <Box
      component="section"
      aria-label={t('store.business.title')}
      data-business-info={canales.length}
      sx={{
        display: 'grid',
        gap: { xs: 2.5, md: 4 },
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)' },
        alignItems: 'start',
        p: { xs: 2.25, md: 3 },
        borderRadius: 'var(--sf-radius)',
        // Banda tintada y no tarjeta, por lo mismo que la franja de propuestas
        // de valor: esto es información de servicio, y un recuadro más con
        // borde y sombra le quitaría peso a las tarjetas de producto, que son
        // las que venden.
        bgcolor: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
      }}
    >
      <Stack sx={{ gap: 1, minWidth: 0 }}>
        <Typography
          component="h2"
          sx={{ fontSize: { xs: 19, md: 22 }, fontWeight: 800, lineHeight: 1.2 }}
        >
          {t('store.business.title')}
        </Typography>
        <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{nombre}</Typography>
        {descripcion !== '' && (
          <Typography sx={{ fontSize: TS.body, color: 'var(--muted)', maxWidth: 62 * 8 }}>
            {descripcion}
          </Typography>
        )}

        {paginas.length > 0 && (
          <Stack
            component="nav"
            aria-label={t('store.business.pages')}
            direction="row"
            sx={{ gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}
          >
            {paginas.map((pagina) => (
              <MuiLink
                key={pagina.slug}
                component={Link}
                to={`/s/${storeSlug}/p/${pagina.slug}`}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 999,
                  border: '1px solid var(--sf-line)',
                  bgcolor: 'var(--card)',
                  fontSize: TS.label,
                  fontWeight: 700,
                  color: 'var(--text)',
                  textDecoration: 'none',
                  '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent-deep)' },
                }}
              >
                {pagina.title}
                <ChevronRightRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
              </MuiLink>
            ))}
          </Stack>
        )}
      </Stack>

      <Stack sx={{ gap: 1.25, minWidth: 0 }}>
        {canales.map((canal) => (
          <CanalDeContacto
            key={canal.clave}
            icono={canal.icono}
            etiqueta={canal.etiqueta}
            href={canal.href}
          >
            {canal.valor}
          </CanalDeContacto>
        ))}
      </Stack>
    </Box>
  )
}

/**
 * Una forma de llegar al comercio.
 *
 * Con etiqueta visible, al revés que en el pie: allí las tres líneas van juntas
 * bajo el rótulo «Contacto» y se reconocen solas, pero aquí comparten sección
 * con el nombre y las páginas, y una dirección sin rótulo a media portada se
 * lee como parte de la descripción.
 */
function CanalDeContacto({
  icono: Icono,
  etiqueta,
  href,
  children,
}: {
  icono: ComponentType<{ sx?: object }>
  etiqueta: string
  href: string | null
  children: ReactNode
}) {
  return (
    <Stack direction="row" sx={{ gap: 1.25, alignItems: 'flex-start', minWidth: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: 34,
          height: 34,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '50%',
          bgcolor: 'var(--accent-soft)',
          color: 'var(--accent-deep)',
        }}
      >
        <Icono sx={{ fontSize: 18 }} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: TS.label,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}
        >
          {etiqueta}
        </Typography>
        {href ? (
          <MuiLink
            href={href}
            sx={{
              fontSize: TS.body,
              fontWeight: 600,
              color: 'var(--text)',
              textDecoration: 'none',
              overflowWrap: 'anywhere',
              '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
            }}
          >
            {children}
          </MuiLink>
        ) : (
          <Typography sx={{ fontSize: TS.body, fontWeight: 600, overflowWrap: 'anywhere' }}>
            {children}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}
