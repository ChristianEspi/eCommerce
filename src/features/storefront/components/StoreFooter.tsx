import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import PinterestIcon from '@mui/icons-material/Pinterest'
import XIcon from '@mui/icons-material/X'
import YouTubeIcon from '@mui/icons-material/YouTube'
import { Box, Container, Link as MuiLink, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import { initials } from '../branding'
import type { StoreNavigationItem } from '../content'
import { resolveStoreDescription, sanitizeSocialLinks, whatsappHref, type SocialLink, type SocialNetwork } from '../identity'
import { usePublicCategories, useStoreNavigation } from '../hooks'
import { useStorefrontTheme } from '../theme/useStorefrontTheme'
import { usePaymentMethods } from '../payment'
import type { PublicCategory, PublicStore } from '../types'
import { StoreBrandLockup } from './StoreBrandLockup'
import { useIsBusinessBuyer } from '../commerce/businessBuyer'

/**
 * Entrar desde la tienda VUELVE a la tienda (2026-11-20). Sin `from`, el login
 * se mostraba en modo plataforma («crea tu tienda») y al entrar llevaba al panel.
 */
const conVuelta = (ruta: string, storeSlug: string) => `${ruta}?from=${encodeURIComponent(`/s/${storeSlug}`)}`

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
  const { style, preset } = useStorefrontTheme()
  const { data: pages } = useStoreNavigation(storeSlug)
  const { data: categories } = usePublicCategories(store.store_id)

  const nombre = store.business_display_name?.trim() || store.name
  /**
   * La descripción ESTABLE, no la bajada del hero (Storefront V3 · P01).
   *
   * Hasta V3 el pie pintaba `hero_subtitle`, así que un comercio que estrenaba
   * campaña cambiaba de paso lo que su tienda decía de sí misma en el pie de
   * todas sus páginas. `resolveStoreDescription` usa `store_description` y solo
   * cae a la bajada mientras esa descripción esté sin escribir — compatibilidad
   * para las tiendas que ya funcionaban, no acoplamiento.
   */
  const descripcion = resolveStoreDescription(store)

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

  /**
   * 2026-10-02 · El pie ORGANIZADO de una tienda real (Empresa · Mi cuenta ·
   * Legales · ¿Necesitas ayuda?). Se activa solo cuando el comercio tiene de qué
   * llenarlo —páginas legales o datos de ayuda—; sin eso, el pie es el de
   * siempre, y ninguna tienda cambia por desplegar esto.
   */
  const legales = (pages ?? []).filter((item) => item.kind === 'legal').slice(0, 8)
  const empresa = (pages ?? []).filter((item) => item.kind !== 'legal').slice(0, 8)
  const redes = sanitizeSocialLinks(store.social_links)
  const whatsapp = store.whatsapp_phone?.trim() || null
  const horario = store.business_hours?.trim() || null
  const nota = store.help_note?.trim() || null
  const hayAyuda = Boolean(whatsapp || horario || nota || redes.length > 0)
  const organizado = legales.length > 0 || hayAyuda
  const paginas = organizado ? empresa : (pages ?? []).slice(0, 6)
  const firmaLegal = store.legal_name?.trim() || nombre
  const reclamos = `/s/${storeSlug}/libro-de-reclamaciones`

  // Catálogo (lámina B2B, 2026-10-19): una banda del color de la tienda con
  // cuatro columnas de distribuidor. Siempre, haya o no páginas: las columnas
  // Comprar y Empresas salen de rutas que toda tienda tiene.
  if (preset === 'catalog') {
    return (
      <PieCatalogo
        storeSlug={storeSlug}
        paginas={[...empresa, ...legales]}
        contactos={contactos}
        whatsapp={whatsapp}
        horario={horario}
        firmaLegal={firmaLegal}
        reclamos={reclamos}
      />
    )
  }

  // Universal (lámina 2026-10-13): marca a la izquierda y cuatro columnas de
  // tienda grande. Las mismas piezas que el pie organizado, en su orden.
  if (organizado && preset === 'universal') {
    return (
      <PieUniversal
        store={store}
        storeSlug={storeSlug}
        nombre={nombre}
        descripcion={descripcion}
        familias={familias}
        empresa={empresa}
        legales={legales}
        whatsapp={whatsapp}
        horario={horario}
        redes={redes}
        firmaLegal={firmaLegal}
        reclamos={reclamos}
      />
    )
  }

  if (organizado) {
    return (
      <Container
        maxWidth={false}
        component="footer"
        data-content-width={style.contentWidth}
        data-footer-layout="organized"
        className="sf-footer"
        sx={{ maxWidth: 'var(--sf-content-w)', mx: 'auto', pb: 3, pt: 'var(--sf-section-gap-md)' }}
      >
        <Box
          sx={{
            borderTop: '1px solid var(--sf-line)',
            pt: 'var(--sf-section-gap-md)',
            display: 'grid',
            gap: { xs: 3, md: 4 },
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
          }}
        >
          {paginas.length > 0 ? (
            <BloqueDelPie titulo={t('store.footer.company')}>
              <Stack component="nav" aria-label={t('store.footer.company')} sx={{ gap: 0.75 }}>
                {paginas.map((item) => (
                  <EnlaceDelPie key={item.slug} to={`/s/${storeSlug}/p/${item.slug}`}>
                    {item.title}
                  </EnlaceDelPie>
                ))}
              </Stack>
            </BloqueDelPie>
          ) : null}

          <BloqueDelPie titulo={t('store.footer.account')}>
            <Stack component="nav" aria-label={t('store.footer.account')} sx={{ gap: 0.75 }}>
              <EnlaceDelPie to={conVuelta('/login', storeSlug)}>{t('store.footer.signIn')}</EnlaceDelPie>
              <EnlaceDelPie to={`/s/${storeSlug}/account#pedidos`}>{t('store.footer.orders')}</EnlaceDelPie>
              <EnlaceDelPie to={`/s/${storeSlug}/register`}>{t('store.footer.register')}</EnlaceDelPie>
              <EnlaceDelPie to={conVuelta('/recuperar', storeSlug)}>{t('store.footer.recover')}</EnlaceDelPie>
            </Stack>
          </BloqueDelPie>

          {legales.length > 0 ? (
            <BloqueDelPie titulo={t('store.footer.legal')}>
              <Stack component="nav" aria-label={t('store.footer.legal')} sx={{ gap: 0.75 }}>
                {legales.map((item) => (
                  <EnlaceDelPie key={item.slug} to={`/s/${storeSlug}/p/${item.slug}`}>
                    {item.title}
                  </EnlaceDelPie>
                ))}
              </Stack>
            </BloqueDelPie>
          ) : null}

          <BloqueDelPie titulo={t('store.footer.help')}>
            <Stack sx={{ gap: 1.5 }} data-footer-help>
              {nota ? <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{nota}</Typography> : null}
              {whatsapp ? (
                <Box>
                  <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{t('store.footer.whatsapp')}</Typography>
                  {whatsappHref(whatsapp) ? (
                    <EnlaceDelPie href={whatsappHref(whatsapp) as string}>{whatsapp}</EnlaceDelPie>
                  ) : (
                    <Typography sx={{ fontSize: TS.body }}>{whatsapp}</Typography>
                  )}
                </Box>
              ) : null}
              {contactos
                .filter((c) => c.clave !== 'store.contact.address')
                // El mismo número no se repite: si el teléfono ES el WhatsApp,
                // ya está arriba.
                .filter(
                  (c) =>
                    c.clave !== 'store.contact.phone' ||
                    c.valor.replace(/\D/g, '') !== (whatsapp ?? '').replace(/\D/g, ''),
                )
                .map((contacto) => (
                  <Box key={contacto.clave}>
                    {contacto.href ? (
                      <EnlaceDelPie href={contacto.href}>{contacto.valor}</EnlaceDelPie>
                    ) : null}
                  </Box>
                ))}
              {horario ? (
                <Box>
                  <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{t('store.footer.hours')}</Typography>
                  <Typography sx={{ fontSize: TS.body, whiteSpace: 'pre-line' }}>{horario}</Typography>
                </Box>
              ) : null}

              <Box
                component={Link}
                to={reclamos}
                data-complaints-link
                sx={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 0.25,
                  color: 'var(--text)',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                <Typography component="span" sx={{ fontSize: 12, fontWeight: 800, lineHeight: 1.1, textAlign: 'center' }}>
                  {t('store.complaints.book')}
                </Typography>
                <LibroIcono />
              </Box>

              {redes.length > 0 ? (
                <Box>
                  <Typography sx={{ fontSize: TS.label, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
                    {t('store.footer.follow')}
                  </Typography>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    {redes.map((red) => (
                      <Box
                        key={red.network}
                        component="a"
                        href={red.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t('store.footer.social').replace('{network}', NOMBRE_RED[red.network])}
                        sx={{
                          width: 36,
                          height: 36,
                          display: 'grid',
                          placeItems: 'center',
                          borderRadius: '50%',
                          border: '1px solid var(--text)',
                          color: 'var(--text)',
                          '&:hover': { bgcolor: 'var(--text)', color: 'var(--card)' },
                          '& svg': { fontSize: 18, width: 18, height: 18 },
                        }}
                      >
                        <IconoRed network={red.network} />
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          </BloqueDelPie>
        </Box>

        <Box aria-hidden className="sf-footer-mark" data-mark={nombre} sx={{ display: 'none' }} />

        <Typography
          sx={{
            fontSize: TS.label,
            color: 'var(--muted)',
            mt: 'var(--sf-section-gap-md)',
            pt: 2,
            borderTop: '1px solid var(--sf-line)',
          }}
        >
          {[
            `${firmaLegal.toUpperCase()} ${new Date().getFullYear()} © ${t('store.footer.rights')}`,
            store.tax_id?.trim() ? `${t('store.footer.taxId')} ${store.tax_id.trim()}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      </Container>
    )
  }

  return (
    <Container
      maxWidth={false}
      component="footer"
      data-content-width={style.contentWidth}
      // Rediseño v3 · retail lo pinta en tinta a lo ancho, con la marca gigante
      // de fondo (storefront.css).
      className="sf-footer"
      sx={{
        maxWidth: 'var(--sf-content-w)',
        mx: 'auto',
        pb: 3,
        pt: 'var(--sf-section-gap-md)',
      }}
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

      {/* Rediseño v3 · La marca en grande, como firma del pie (lámina retail).
          Decorativa: el nombre ya está arriba y en el copyright. Oculta por
          defecto; la enciende el estilo. */}
      <Box aria-hidden className="sf-footer-mark" data-mark={nombre} sx={{ display: 'none' }} />

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
        {' · '}
        {/* El Libro de Reclamaciones, también en el pie de siempre: es una
            obligación legal y ahora una función real de la tienda. */}
        <MuiLink component={Link} to={reclamos} data-complaints-link sx={{ color: 'inherit' }}>
          {t('store.complaints.book')}
        </MuiLink>
      </Typography>
    </Container>
  )
}

/** Una columna del pie: su rótulo y lo que lleve debajo. */
/**
 * El pie de Universal (lámina 2026-10-13).
 *
 * Marca y descripción a la izquierda; Departamentos (las familias), Compra,
 * Ayuda (lo legal) y Empresa (las páginas de la tienda y el Libro de
 * Reclamaciones); y un bloque de atención con WhatsApp, horario y redes donde
 * la lámina pone un boletín, que la tienda todavía no tiene. Abajo, la firma
 * legal y los medios de pago REALES de la tienda.
 */
function PieUniversal({
  store,
  storeSlug,
  nombre,
  descripcion,
  familias,
  empresa,
  legales,
  whatsapp,
  horario,
  redes,
  firmaLegal,
  reclamos,
}: {
  store: PublicStore
  storeSlug: string
  nombre: string
  descripcion: string | null
  familias: readonly PublicCategory[]
  empresa: readonly StoreNavigationItem[]
  legales: readonly StoreNavigationItem[]
  whatsapp: string | null
  horario: string | null
  redes: readonly SocialLink[]
  firmaLegal: string
  reclamos: string
}) {
  const { t } = useI18n()
  const { style } = useStorefrontTheme()
  const pagos = usePaymentMethods(store.store_id)
  const medios = (pagos.data ?? []).map((medio) => medio.display_name)

  return (
    <Container
      maxWidth={false}
      component="footer"
      data-content-width={style.contentWidth}
      data-footer-layout="universal"
      className="sf-footer"
      sx={{ maxWidth: 'var(--sf-content-w)', mx: 'auto', pb: 3, pt: 'var(--sf-section-gap-md)' }}
    >
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 3, md: 4 },
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'minmax(0, 1.4fr) repeat(4, minmax(0, 1fr)) minmax(0, 1.3fr)',
          },
        }}
      >
        <Stack sx={{ gap: 1.5 }}>
          <StoreBrandLockup store={store} storeSlug={storeSlug} size="md" />
          {descripcion ? (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, maxWidth: 260 }}>{descripcion}</Typography>
          ) : null}
        </Stack>

        {familias.length > 0 ? (
          <BloqueDelPie titulo={t('store.footer.departments')}>
            <Stack component="nav" aria-label={t('store.footer.departments')} sx={{ gap: 0.75 }}>
              {familias.slice(0, 5).map((familia) => (
                <EnlaceDelPie key={familia.category_id} to={`/s/${storeSlug}?c=${encodeURIComponent(familia.slug)}`}>
                  {familia.name}
                </EnlaceDelPie>
              ))}
            </Stack>
          </BloqueDelPie>
        ) : null}

        <BloqueDelPie titulo={t('store.footer.shop')}>
          <Stack component="nav" aria-label={t('store.footer.shop')} sx={{ gap: 0.75 }}>
            <EnlaceDelPie to={`/s/${storeSlug}?ver=todo&oferta=1`}>{t('store.footer.deals')}</EnlaceDelPie>
            <EnlaceDelPie to={`/s/${storeSlug}?ver=todo#marcas`}>{t('store.nav.brands')}</EnlaceDelPie>
            <EnlaceDelPie to={`/s/${storeSlug}/account#pedidos`}>{t('store.footer.orders')}</EnlaceDelPie>
            <EnlaceDelPie to={`/s/${storeSlug}/register`}>{t('store.footer.register')}</EnlaceDelPie>
          </Stack>
        </BloqueDelPie>

        {legales.length > 0 ? (
          <BloqueDelPie titulo={t('store.footer.helpColumn')}>
            <Stack component="nav" aria-label={t('store.footer.helpColumn')} sx={{ gap: 0.75 }}>
              {legales.map((item) => (
                <EnlaceDelPie key={item.slug} to={`/s/${storeSlug}/p/${item.slug}`}>
                  {item.title}
                </EnlaceDelPie>
              ))}
            </Stack>
          </BloqueDelPie>
        ) : null}

        <BloqueDelPie titulo={t('store.footer.company')}>
          <Stack component="nav" aria-label={t('store.footer.company')} sx={{ gap: 0.75 }}>
            {empresa.map((item) => (
              <EnlaceDelPie key={item.slug} to={`/s/${storeSlug}/p/${item.slug}`}>
                {item.title}
              </EnlaceDelPie>
            ))}
            <EnlaceDelPie to={reclamos}>{t('store.complaints.book')}</EnlaceDelPie>
          </Stack>
        </BloqueDelPie>

        <Stack sx={{ gap: 1.25 }} data-footer-help>
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 800 }}>
            {t('store.footer.helpTitle')}
          </Typography>
          {whatsapp ? (
            <Typography sx={{ fontSize: 13.5 }}>
              {t('store.footer.whatsapp')}:{' '}
              {whatsappHref(whatsapp) ? (
                <EnlaceDelPie href={whatsappHref(whatsapp) as string}>{whatsapp}</EnlaceDelPie>
              ) : (
                whatsapp
              )}
            </Typography>
          ) : null}
          {horario ? (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'pre-line' }}>{horario}</Typography>
          ) : null}
          {redes.length > 0 ? (
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
              {redes.map((red) => (
                <Box
                  key={red.network}
                  component="a"
                  href={red.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('store.footer.social').replace('{network}', NOMBRE_RED[red.network])}
                  sx={{
                    width: 34,
                    height: 34,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    border: '1px solid var(--sf-line)',
                    color: 'var(--text)',
                    '&:hover': { bgcolor: 'var(--text)', color: 'var(--sf-band)' },
                    '& svg': { fontSize: 17, width: 17, height: 17 },
                  }}
                >
                  <IconoRed network={red.network} />
                </Box>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Box>

      <Box aria-hidden className="sf-footer-mark" data-mark={nombre} sx={{ display: 'none' }} />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{
          justifyContent: 'space-between',
          gap: 1,
          mt: 'var(--sf-section-gap-md)',
          pt: 2,
          borderTop: '1px solid var(--sf-line)',
          fontSize: TS.label,
          color: 'var(--muted)',
        }}
      >
        <Typography sx={{ fontSize: 'inherit', color: 'inherit' }}>
          {[
            `© ${new Date().getFullYear()} ${firmaLegal}`,
            store.tax_id?.trim() ? `${t('store.footer.taxId')} ${store.tax_id.trim()}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        {medios.length > 0 ? (
          <Typography sx={{ fontSize: 'inherit', color: 'inherit' }} aria-label={t('store.cart.info.payments')}>
            {medios.join(' · ')}
          </Typography>
        ) : null}
      </Stack>
    </Container>
  )
}

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

const NOMBRE_RED: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
}

/** El glifo de cada red. TikTok no está en la librería: va dibujado aquí. */
function IconoRed({ network }: { network: SocialNetwork }) {
  switch (network) {
    case 'facebook':
      return <FacebookIcon aria-hidden />
    case 'instagram':
      return <InstagramIcon aria-hidden />
    case 'youtube':
      return <YouTubeIcon aria-hidden />
    case 'x':
      return <XIcon aria-hidden />
    case 'linkedin':
      return <LinkedInIcon aria-hidden />
    case 'pinterest':
      return <PinterestIcon aria-hidden />
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
          <path d="M16.6 3c.4 2.2 1.8 3.7 4 3.9v3.1c-1.5.1-2.8-.4-4-1.2v6.1c0 3.4-2.6 6.1-6 6.1s-6-2.7-6-6.1 2.6-6 6-6c.3 0 .7 0 1 .1v3.2a2.9 2.9 0 0 0-1-.2 2.9 2.9 0 1 0 2.9 2.9V3h3.1Z" />
        </svg>
      )
  }
}

/**
 * Pie de Catálogo (lámina B2B, 2026-10-19).
 *
 * Una banda a todo el ancho en `accent-deep` —el tono del acento que garantiza
 * AA con texto blanco, así que vale para el naranja de una ferretería y para
 * cualquier otro acento— con las cuatro columnas de un distribuidor: Comprar,
 * Empresas, Ayuda (las páginas que el comercio escribió) y Atención (lo que
 * declaró: horario, correo, teléfono, WhatsApp, dirección). Todo enlace va a
 * una ruta que existe; lo que el comercio no escribió no aparece.
 */
function PieCatalogo({
  storeSlug,
  paginas,
  contactos,
  whatsapp,
  horario,
  firmaLegal,
  reclamos,
}: {
  storeSlug: string
  paginas: readonly StoreNavigationItem[]
  contactos: readonly { clave: MessageKey; valor: string; href: string | null }[]
  whatsapp: string | null
  horario: string | null
  firmaLegal: string
  reclamos: string
}) {
  const { t } = useI18n()
  const { style } = useStorefrontTheme()
  const esEmpresa = useIsBusinessBuyer()
  const enlace = {
    fontSize: 13.5,
    fontWeight: 500,
    color: 'inherit',
    textDecoration: 'none',
    width: 'fit-content',
    '&:hover': { textDecoration: 'underline' },
  } as const
  const columna = (titulo: string, items: { to?: string; href?: string; label: string }[]) =>
    items.length === 0 ? null : (
      <Stack component="nav" aria-label={titulo} sx={{ gap: 0.9, minWidth: 0 }}>
        <Typography component="h2" sx={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85 }}>
          {titulo}
        </Typography>
        {items.map((item) => (
          <MuiLink key={`${item.to ?? item.href}-${item.label}`} {...(item.to ? { component: Link, to: item.to } : { href: item.href })} sx={enlace}>
            {item.label}
          </MuiLink>
        ))}
      </Stack>
    )

  return (
    <Box
      component="footer"
      className="sf-footer"
      data-footer-layout="catalog"
      sx={{ bgcolor: 'var(--accent-deep)', color: '#fff', mt: 'var(--sf-section-gap-md)' }}
    >
      <Container
        maxWidth={false}
        data-content-width={style.contentWidth}
        sx={{ maxWidth: 'var(--sf-content-w)', mx: 'auto', pt: { xs: 4, md: 5 }, pb: 3 }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 3, md: 4 },
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr)) auto' },
          }}
        >
          {columna(t('store.footer.shop'), [
            { to: `/s/${storeSlug}?ver=todo`, label: t('store.catalog.title') },
            { to: `/s/${storeSlug}/pedido-rapido`, label: t('store.quickOrder.open') },
            { to: `/s/${storeSlug}?ver=todo#marcas`, label: t('store.nav.brands') },
            { to: `/s/${storeSlug}?ver=todo&oferta=1`, label: t('store.footer.deals') },
          ])}
          {columna(t('store.footer.business'), [
            { to: `/s/${storeSlug}/register`, label: t('store.footer.openAccount') },
            { to: `/s/${storeSlug}/account#pedidos`, label: t('store.footer.orders') },
            // Solo la cuenta de EMPRESA tiene estas dos pestañas (2026-11-20).
            ...(esEmpresa
              ? [
                  { to: `/s/${storeSlug}/account#cotizaciones`, label: t('account.tab.quotes') },
                  { to: `/s/${storeSlug}/account#estado`, label: t('account.tab.statement') },
                ]
              : []),
          ])}
          {columna(
            t('store.footer.helpColumn'),
            paginas.slice(0, 6).map((item) => ({ to: `/s/${storeSlug}/p/${item.slug}`, label: item.title })),
          )}
          <Stack sx={{ gap: 0.9, minWidth: 0 }} data-footer-help>
            <Typography component="h2" sx={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85 }}>
              {t('store.footer.attention')}
            </Typography>
            {horario ? <Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-line' }}>{horario}</Typography> : null}
            {contactos.map((c) =>
              c.href ? (
                <MuiLink key={c.clave} href={c.href} sx={enlace}>
                  {c.valor}
                </MuiLink>
              ) : (
                <Typography key={c.clave} sx={{ fontSize: 13.5 }}>
                  {c.valor}
                </Typography>
              ),
            )}
            {whatsapp && whatsappHref(whatsapp) ? (
              <MuiLink href={whatsappHref(whatsapp) as string} sx={enlace}>
                {t('store.footer.whatsapp')}: {whatsapp}
              </MuiLink>
            ) : null}
          </Stack>
          <MuiLink
            component={Link}
            to={reclamos}
            sx={{ ...enlace, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, fontSize: 12, fontWeight: 700, textAlign: 'center', alignSelf: 'start' }}
          >
            <LibroIcono />
            {t('store.complaints.book')}
          </MuiLink>
        </Box>
        <Typography
          sx={{ mt: 4, pt: 2, borderTop: '1px solid rgba(255, 255, 255, 0.25)', fontSize: 12.5, textAlign: 'center', opacity: 0.9 }}
        >
          © {new Date().getFullYear()} {firmaLegal}
        </Typography>
      </Container>
    </Box>
  )
}

/** El libro abierto del Libro de Reclamaciones, en el color del texto. */
function LibroIcono() {
  return (
    <svg width="64" height="30" viewBox="0 0 64 30" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M32 6c-6-4-16-4-26-1v21c10-3 20-3 26 1 6-4 16-4 26-1V5C48 2 38 2 32 6Z" />
      <path d="M32 6v21" />
      <path d="M11 10c5-1 10-1 15 1M11 15c5-1 10-1 15 1M38 11c5-2 10-2 15-1M38 16c5-2 10-2 15-1" />
    </svg>
  )
}
