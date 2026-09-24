import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import { Box, Button, IconButton, Stack, Switch, TextField, Typography } from '@mui/material'
import type { UseFormReturn } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import {
  DEFAULT_HOME_LAYOUT,
  MAX_ITEMS_LIMITS,
  SECTIONS_WITH_MAX_ITEMS,
  normalizeHomeLayout,
} from '@/features/storefront/theme/presets'
import type { HomeSectionConfig, HomeSectionId } from '@/features/storefront/theme/types'
import type { StoreFormValues } from './types'

/**
 * El orden de la portada, editable sin convertir esto en un maquetador.
 *
 * ## Qué se puede hacer aquí y qué no
 *
 * Se puede encender, apagar, subir, bajar y limitar cuántos productos enseña
 * una sección. No se puede crear una sección, ni escribir su título, ni meterle
 * una imagen: para eso está el CMS, que es donde vive el CONTENIDO. Aquí solo
 * se decide qué se pinta y en qué orden.
 *
 * La diferencia no es un capricho de alcance. Un maquetador libre convierte cada
 * tienda en un caso único, y a partir de ahí ninguna mejora de la vitrina llega
 * a nadie sin romperle la portada a alguien.
 *
 * ## Por qué botones de subir y bajar, y no arrastrar
 *
 * Porque arrastrar no se puede hacer con el teclado, y una parte de la gente
 * que administra una tienda no usa ratón. Si algún día se añade arrastrar, será
 * ADEMÁS de estos botones, nunca en su lugar.
 *
 * Cada botón dice a qué sección pertenece —«Subir Ofertas», no «Subir»—: en una
 * lista de trece filas con dos botones cada una, veintiséis controles llamados
 * «Subir» y «Bajar» no se distinguen de ninguna manera. Y el de los extremos va
 * desactivado en vez de no hacer nada al pulsarlo.
 */

const NOMBRE: Record<HomeSectionId, MessageKey> = {
  hero: 'settings.design.section.hero',
  services: 'settings.design.section.services',
  offers: 'settings.design.section.offers',
  cms: 'settings.design.section.cms',
  promotions: 'settings.design.section.promotions',
  categories: 'settings.design.section.categories',
  brands: 'settings.design.section.brands',
  'new-arrivals': 'settings.design.section.newArrivals',
  'best-sellers': 'settings.design.section.bestSellers',
  featured: 'settings.design.section.featured',
  trust: 'settings.design.section.trust',
  'business-info': 'settings.design.section.businessInfo',
  newsletter: 'settings.design.section.newsletter',
}

/**
 * Las que todavía no tienen nada que pintar.
 *
 * Se enseñan igualmente, y desactivadas. Esconderlas sería más limpio y peor:
 * quien busca «boletín» en la pantalla y no lo encuentra no sabe si no existe o
 * si no lo ha visto. Así sabe que existe y que aún no está.
 */
const SIN_IMPLEMENTAR: ReadonlySet<HomeSectionId> = new Set<HomeSectionId>([
  // `categories` salió de esta lista en H07: pinta las familias reales del
  // catálogo como puertas, y el comercio ya puede encenderla.
  //
  // `business-info` salió en P09. Pinta el nombre del negocio, sus canales de
  // contacto y sus páginas publicadas, y se calla sola cuando el comercio no
  // escribió ninguno — que es distinto de no estar implementada, aunque desde
  // la vitrina se vea igual. Dejarla aquí habría sido tenerla construida y
  // apagada bajo llave.
  //
  // `newsletter` se queda: no hay dónde guardar una suscripción ni su
  // consentimiento, y un formulario que pide un correo y lo tira es peor que
  // no ofrecerlo.
  'newsletter',
])

export function HomeLayoutEditor({
  form,
  busy = false,
}: {
  form: UseFormReturn<StoreFormValues>
  busy?: boolean
}) {
  const { t } = useI18n()
  const guardado = form.watch('home_layout')

  /**
   * Se edita la lista COMPLETA aunque se guarde parcial.
   *
   * La normalización añade al final lo que la configuración no mencionaba, así
   * que el editor siempre enseña las trece secciones —no se puede encender lo
   * que no aparece— mientras que lo guardado sigue siendo lo que el comercio
   * tocó. Ver `sanitize` frente a `normalize` en el motor de temas.
   */
  const secciones = normalizeHomeLayout(guardado).sections

  function guardar(siguiente: readonly HomeSectionConfig[]) {
    form.setValue('home_layout', { version: 1, sections: siguiente }, { shouldDirty: true })
  }

  function mover(indice: number, delta: number) {
    const destino = indice + delta
    if (destino < 0 || destino >= secciones.length) return
    const copia = [...secciones]
    const [movida] = copia.splice(indice, 1)
    if (movida) copia.splice(destino, 0, movida)
    guardar(copia)
  }

  function encender(indice: number, enabled: boolean) {
    guardar(secciones.map((s, i) => (i === indice ? { ...s, enabled } : s)))
  }

  function limitar(indice: number, valor: string) {
    const numero = Number.parseInt(valor, 10)
    guardar(
      secciones.map((s, i) => {
        if (i !== indice) return s
        // Vaciar el campo QUITA el tope, no lo pone en cero: «sin límite» y
        // «cero productos» son cosas distintas, y guardar un cero dejaría la
        // sección encendida y vacía.
        if (!Number.isInteger(numero)) return { id: s.id, enabled: s.enabled }
        const acotado = Math.min(Math.max(numero, MAX_ITEMS_LIMITS.min), MAX_ITEMS_LIMITS.max)
        return { ...s, maxItems: acotado }
      }),
    )
  }

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}
      >
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.design.home.title')}
        </Typography>
        <Button
          type="button"
          size="small"
          disabled={busy}
          onClick={() => guardar(DEFAULT_HOME_LAYOUT.sections)}
        >
          {t('settings.design.home.reset')}
        </Button>
      </Stack>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.design.home.help')}
      </Typography>

      <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1 }}>
        {secciones.map((seccion, indice) => {
          const nombre = t(NOMBRE[seccion.id])
          const pendiente = SIN_IMPLEMENTAR.has(seccion.id)

          return (
            <Stack
              key={seccion.id}
              component="li"
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: `${R.md}px`,
                border: '1px solid var(--border)',
                bgcolor: 'var(--card)',
                flexWrap: 'wrap',
              }}
            >
              <Switch
                size="small"
                checked={seccion.enabled}
                disabled={busy || pendiente}
                onChange={(event) => encender(indice, event.target.checked)}
                inputProps={{ 'aria-label': `${t('settings.design.home.enabled')}: ${nombre}` }}
              />

              <Box sx={{ flex: 1, minWidth: 140 }}>
                <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>{nombre}</Typography>
                {pendiente && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('settings.design.home.pending')}
                  </Typography>
                )}
              </Box>

              {SECTIONS_WITH_MAX_ITEMS.has(seccion.id) && (
                <TextField
                  size="small"
                  type="number"
                  label={t('settings.design.home.maxItems')}
                  disabled={busy}
                  value={seccion.maxItems ?? ''}
                  onChange={(event) => limitar(indice, event.target.value)}
                  inputProps={{
                    min: MAX_ITEMS_LIMITS.min,
                    max: MAX_ITEMS_LIMITS.max,
                    'aria-label': `${t('settings.design.home.maxItems')}: ${nombre}`,
                  }}
                  sx={{ width: 110 }}
                />
              )}

              <Stack direction="row" sx={{ gap: 0.5 }}>
                <IconButton
                  type="button"
                  size="small"
                  disabled={busy || indice === 0}
                  aria-label={`${t('settings.design.home.up')}: ${nombre}`}
                  onClick={() => mover(indice, -1)}
                >
                  <ArrowUpwardRoundedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  type="button"
                  size="small"
                  disabled={busy || indice === secciones.length - 1}
                  aria-label={`${t('settings.design.home.down')}: ${nombre}`}
                  onClick={() => mover(indice, 1)}
                >
                  <ArrowDownwardRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          )
        })}
      </Stack>
    </Stack>
  )
}
