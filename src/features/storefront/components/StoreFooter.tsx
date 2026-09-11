import { Box, Container, Link as MuiLink, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { R, TS } from '@/theme/tokens'
import { initials } from '../branding'
import { usePublicCategories, useStoreNavigation } from '../hooks'
import { useStorefrontTheme } from '../theme/useStorefrontTheme'
import type { PublicStore } from '../types'

/**
 * El pie de la tienda.
 *
 * ## La regla que gobierna este archivo: no se inventa nada
 *
 * Un pie de comercio es donde más tienta rellenar. Los logotipos de Visa y
 * Mastercard, «envío gratis desde S/ 99», un icono de WhatsApp, un horario de
 * atención, tres redes sociales y una garantía de devolución quedan muy bien y
 * no cuestan nada de maquetar.
 *
 * Todos son afirmaciones sobre el NEGOCIO de otro. Anunciar una tarjeta que el
 * comercio no acepta produce un pedido que no se puede cobrar; un horario
 * inventado produce una llamada que nadie contesta; una garantía inventada es
 * una promesa que alguien va a reclamar. No es cuestión de gusto: es que este
 * código no tiene ese dato y no puede tenerlo.
 *
 * Así que el pie pinta EXCLUSIVAMENTE lo que el comercio escribió, y lo que no
 * escribió no aparece — sin hueco, sin marcador de posición y sin un guion donde
 * iría el teléfono. Un bloque vacío también miente: dice «esto existe y está sin
 * rellenar».
 *
 * ## Qué se enriqueció, y de dónde sale cada cosa
 *
 * La versión anterior era una línea de contacto y los enlaces legales. Se ve
 * pobre al final de una tienda, y sobre todo desaprovecha datos que YA existen:
 *
 *  · la **identidad** —logo o iniciales, nombre comercial y la descripción de la
 *    tienda— sale de `store_settings`. Es lo mismo que la cabecera enseña
 *    arriba, y repetirlo al final es lo que cierra la página: quien llega hasta
 *    aquí ha recorrido el catálogo entero y conviene recordarle en qué tienda
 *    está;
 *  · las **categorías** salen de la misma consulta que ya usa la cabecera, así
 *    que no cuestan una petición más. Son navegación de verdad, no relleno: al
 *    final de un catálogo largo, volver a subir para cambiar de familia es el
 *    motivo más común para cerrar la pestaña;
 *  · el **contacto** y las **páginas**, como antes.
 *
 * Cada bloque desaparece entero si su dato no existe. Una tienda recién creada
 * sigue viendo lo que veía: su nombre y el año.
 *
 * ## Y el tema
 *
 * Cambia el ancho y el aire, como el resto de la vitrina. No cambia qué bloques
 * hay: un pie sin las condiciones de venta no es un pie más limpio, es una
 * tienda que no deja llegar a lo que legalmente tiene que ofrecer.
 */
export function StoreFooter({ store, storeSlug }: { store: PublicStore; storeSlug: string }) {
  const { t } = useI18n()
  const { style } = useStorefrontTheme()
  const { data: pages } = useStoreNavigation(storeSlug)
  const { data: categories } = usePublicCategories(store.store_id)

  const nombre = store.business_display_name?.trim() || store.name
  const descripcion = store.hero_subtitle?.trim() ?? ''

  const contactos = [
    store.support_email?.trim()
      ? {
          clave: 'store.contact.email' as const,
          valor: store.support_email.trim(),
          href: `mailto:${store.support_email.trim()}`,
        }
      : null,
    store.contact_phone?.trim()
      ? {
          clave: 'store.contact.phone' as const,
          valor: store.contact_phone.trim(),
          href: `tel:${store.contact_phone.trim().replace(/\s+/g, '')}`,
        }
      : null,
    store.contact_address?.trim()
      ? { clave: 'store.contact.address' as const, valor: store.contact_address.trim(), href: null }
      : null,
  ].filter((x) => x !== null)

  // Solo las FAMILIAS, y como mucho seis. El pie orienta; no es un índice.
  const familias = (categories ?? []).filter((c) => c.parent_id === null).slice(0, 6)
  const paginas = (pages ?? []).slice(0, 6)

  return (
    <Container
      maxWidth={style.contentWidth}
      component="footer"
      sx={{ pb: 3, pt: 'var(--sf-section-gap-md)' }}
    >
      <Box
        sx={{
          borderTop: '1px solid var(--sf-line)',
          pt: 'var(--sf-section-gap-md)',
          display: 'grid',
          gap: { xs: 3, md: 4 },
          // Cuatro columnas en escritorio, dos en tableta, una en el teléfono.
          // La primera es más ancha porque lleva la descripción del comercio.
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'minmax(0, 1.6fr) repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        <Stack sx={{ gap: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ gap: 1.25, alignItems: 'center', minWidth: 0 }}>
            {store.logo_url ? (
              <Box
                component="img"
                src={store.logo_url}
                alt={nombre}
                sx={{ height: 28, maxWidth: 140, objectFit: 'contain' }}
              />
            ) : (
              // Sin logo, las iniciales sobre el acento del tenant. Lo mismo que
              // hace la cabecera: neutro y suyo, nunca el isotipo de la suite.
              <Box
                aria-hidden
                sx={{
                  width: 32,
                  height: 32,
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
                {initials(nombre)}
              </Box>
            )}
            <Typography sx={{ fontWeight: 800, fontSize: 15, minWidth: 0 }}>{nombre}</Typography>
          </Stack>

          {descripcion !== '' && (
            <Typography
              sx={{
                fontSize: TS.body,
                color: 'var(--muted)',
                maxWidth: 46 * 8,
                // Tres líneas y elipsis: una descripción larga no puede
                // estirar el pie hasta empujar el aviso legal fuera de vista.
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {descripcion}
            </Typography>
          )}
        </Stack>

        {contactos.length > 0 && (
          <BloqueDelPie titulo={t('store.contact.title')}>
            {contactos.map((contacto) => (
              <Box key={contacto.clave} sx={{ fontSize: TS.body, minWidth: 0 }}>
                {/* Sin etiqueta por línea, ni pintada ni en `aria-label`. Un
                    correo y un teléfono se reconocen solos, el bloque ya se
                    llama «Contacto», y repetir «Correo:» delante duplica el
                    alto del pie sin añadir nada. */}
                {contacto.href ? (
                  <EnlaceDelPie href={contacto.href}>{contacto.valor}</EnlaceDelPie>
                ) : (
                  <Typography
                    component="span"
                    sx={{ fontSize: TS.body, color: 'var(--text)', overflowWrap: 'anywhere' }}
                  >
                    {contacto.valor}
                  </Typography>
                )}
              </Box>
            ))}
          </BloqueDelPie>
        )}

        {familias.length > 0 && (
          <BloqueDelPie titulo={t('store.categories.title')}>
            <Stack component="nav" aria-label={t('store.categories.title')} sx={{ gap: 0.75 }}>
              {familias.map((familia) => (
                <EnlaceDelPie
                  key={familia.category_id}
                  to={`/s/${storeSlug}?c=${encodeURIComponent(familia.slug)}`}
                >
                  {familia.name}
                </EnlaceDelPie>
              ))}
            </Stack>
          </BloqueDelPie>
        )}

        {paginas.length > 0 && (
          <BloqueDelPie titulo={t('store.footer.pages')}>
            {/* Sigue siendo un `<nav>` con nombre: quien navega por regiones con
                un lector de pantalla las encuentra por ahí. Y siguen siendo
                obligatorias: «Términos y condiciones» es donde una tienda
                cumple, y una que no deja llegar a sus condiciones de venta no
                está incompleta, está incumpliendo. */}
            <Stack component="nav" aria-label={t('store.footer.pages')} sx={{ gap: 0.75 }}>
              {paginas.map((item) => (
                <EnlaceDelPie key={item.slug} to={`/s/${storeSlug}/p/${item.slug}`}>
                  {item.title}
                </EnlaceDelPie>
              ))}
            </Stack>
          </BloqueDelPie>
        )}
      </Box>

      <Typography
        sx={{
          fontSize: TS.label,
          color: 'var(--muted)',
          mt: 'var(--sf-section-gap-md)',
          pt: 2,
          borderTop: '1px solid var(--sf-line)',
        }}
      >
        {`© ${new Date().getFullYear()} ${nombre}`}
      </Typography>
    </Container>
  )
}

/** Una columna del pie: su rótulo y lo que lleve debajo. */
function BloqueDelPie({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Stack sx={{ gap: 1, minWidth: 0 }}>
      <Typography
        component="h2"
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
      <Stack sx={{ gap: 0.75, minWidth: 0 }}>{children}</Stack>
    </Stack>
  )
}

/**
 * Un enlace del pie, sea interno o externo.
 *
 * Uno solo para los dos casos: el `to` va por el router —sin recargar la
 * tienda— y el `href` sale de ella (`mailto:`, `tel:`). Tenerlos con el mismo
 * aspecto es lo que hace que el pie se lea como una lista y no como tres.
 */
function EnlaceDelPie({
  to,
  href,
  children,
}: {
  to?: string
  href?: string
  children: ReactNode
}) {
  return (
    <MuiLink
      {...(to ? { component: Link, to } : { href })}
      sx={{
        fontSize: TS.body,
        fontWeight: 600,
        color: 'var(--text)',
        textDecoration: 'none',
        overflowWrap: 'anywhere',
        width: 'fit-content',
        '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
      }}
    >
      {children}
    </MuiLink>
  )
}
