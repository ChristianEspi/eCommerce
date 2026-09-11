import { Box, Container, Link as MuiLink, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import { useStoreNavigation } from '../hooks'
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
 * Así que el pie pinta EXCLUSIVAMENTE lo que el comercio escribió en su
 * configuración, y lo que no escribió no aparece — sin hueco, sin marcador de
 * posición y sin un guion donde iría el teléfono. Un bloque vacío también miente:
 * dice «esto existe y está sin rellenar».
 *
 * ## Qué datos usa, uno por uno
 *
 *  · el nombre comercial (`business_display_name`) o, si no lo hay, el de la
 *    vitrina — que es el que ya llevaba el aviso de copyright;
 *  · el correo de soporte, el teléfono y la dirección de `store_settings`;
 *  · las páginas publicadas que el comercio marcó para navegación, que es de
 *    donde salen las condiciones de venta.
 *
 * Y nada más. No hay un solo texto de venta escrito aquí.
 *
 * ## Y el tema
 *
 * Cambia el ancho y el aire, como en el resto de la vitrina. No cambia qué
 * bloques hay: un pie sin las condiciones de venta no es un pie más limpio, es
 * una tienda que no deja llegar a lo que legalmente tiene que ofrecer.
 */
export function StoreFooter({ store, storeSlug }: { store: PublicStore; storeSlug: string }) {
  const { t } = useI18n()
  const { style } = useStorefrontTheme()
  const { data: pages } = useStoreNavigation(storeSlug)

  const nombre = store.business_display_name?.trim() || store.name
  const contactos = [
    store.support_email?.trim()
      ? { clave: 'store.contact.email' as const, valor: store.support_email.trim(), href: `mailto:${store.support_email.trim()}` }
      : null,
    store.contact_phone?.trim()
      ? { clave: 'store.contact.phone' as const, valor: store.contact_phone.trim(), href: `tel:${store.contact_phone.trim().replace(/\s+/g, '')}` }
      : null,
    store.contact_address?.trim()
      ? { clave: 'store.contact.address' as const, valor: store.contact_address.trim(), href: null }
      : null,
  ].filter((x) => x !== null)

  const hayPaginas = (pages?.length ?? 0) > 0

  return (
    <Container
      maxWidth={style.contentWidth}
      component="footer"
      sx={{ pb: 3, pt: 'var(--sf-section-gap)' }}
    >
      <Stack
        sx={{
          gap: 'var(--sf-section-gap)',
          pt: 2,
          borderTop: '1px solid var(--sf-line)',
        }}
      >
        {/* La fila de arriba solo existe si hay algo que poner en ella. Con una
            tienda recién creada —sin correo, sin teléfono y sin páginas— el pie
            se queda en la línea de copyright, que es lo que había antes. */}
        {(contactos.length > 0 || hayPaginas) && (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            sx={{ gap: { xs: 2.5, md: 6 }, alignItems: 'flex-start' }}
          >
            {contactos.length > 0 && (
              <Stack sx={{ gap: 0.75, minWidth: 0 }}>
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
                  {t('store.contact.title')}
                </Typography>
                {contactos.map((contacto) => (
                  <Box key={contacto.clave} sx={{ fontSize: TS.body, minWidth: 0 }}>
                    {/* Sin etiqueta por línea, ni pintada ni en `aria-label`.
                        Un correo y un teléfono se reconocen solos, el bloque ya
                        se llama «Contacto», y repetir «Correo:» delante duplica
                        el alto del pie sin añadir nada. */}
                    {contacto.href ? (
                      <MuiLink
                        href={contacto.href}
                        sx={{
                          color: 'var(--text)',
                          textDecoration: 'none',
                          overflowWrap: 'anywhere',
                          '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
                        }}
                      >
                        {contacto.valor}
                      </MuiLink>
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
              </Stack>
            )}

            {hayPaginas && <StorePagesNav storeSlug={storeSlug} pages={pages ?? []} />}
          </Stack>
        )}

        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {`© ${new Date().getFullYear()} ${nombre}`}
        </Typography>
      </Stack>
    </Container>
  )
}

/**
 * Las páginas del comercio —quiénes somos, envíos, términos—.
 *
 * Sigue siendo un `<nav>` con nombre: quien navega por regiones con un lector
 * de pantalla las encuentra por ahí. Y siguen siendo obligatorias: «Términos y
 * condiciones» es donde una tienda cumple, y una que no deja llegar a sus
 * condiciones de venta no está incompleta, está incumpliendo.
 */
function StorePagesNav({
  storeSlug,
  pages,
}: {
  storeSlug: string
  pages: readonly { slug: string; title: string }[]
}) {
  const { t } = useI18n()

  return (
    <Stack
      component="nav"
      aria-label={t('store.footer.pages')}
      sx={{
        gap: 0.75,
        flexWrap: 'wrap',
        // En el teléfono van en columna; en escritorio, en fila. Seis enlaces
        // en una sola línea a 360 px se parten por donde caiga.
        flexDirection: { xs: 'column', sm: 'row' },
        columnGap: { sm: 3 },
      }}
    >
      {pages.slice(0, 6).map((item) => (
        <MuiLink
          key={item.slug}
          component={Link}
          to={`/s/${storeSlug}/p/${item.slug}`}
          sx={{
            fontSize: TS.body,
            fontWeight: 700,
            color: 'var(--muted)',
            textDecoration: 'none',
            '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
          }}
        >
          {item.title}
        </MuiLink>
      ))}
    </Stack>
  )
}
