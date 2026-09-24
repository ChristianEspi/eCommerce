import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import { Box, Button, IconButton, Stack, Switch, TextField, Typography } from '@mui/material'
import { useRef, useState } from 'react'
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
 * Se puede encender, apagar, subir, bajar, arrastrar y limitar cuántos productos
 * enseña una sección. No se puede crear una sección, ni escribir su título, ni
 * meterle una imagen: para eso está el CMS, que es donde vive el CONTENIDO. Aquí
 * solo se decide qué se pinta y en qué orden.
 *
 * La diferencia no es un capricho de alcance. Un maquetador libre convierte cada
 * tienda en un caso único, y a partir de ahí ninguna mejora de la vitrina llega
 * a nadie sin romperle la portada a alguien.
 *
 * ## Arrastrar es un AÑADIDO, nunca un sustituto (Storefront V2 · P12)
 *
 * Los botones de subir y bajar siguen ahí y siguen siendo el camino completo:
 * arrastrar no se puede hacer con el teclado, y una parte de la gente que
 * administra una tienda no usa ratón. Lo que se añadió en P12 es arrastrar
 * **además**, con la API nativa del navegador y sin una sola dependencia —una
 * librería de arrastre son decenas de kilobytes en el paquete del backoffice
 * para mover trece filas—.
 *
 * Cada botón dice a qué sección pertenece —«Subir Ofertas», no «Subir»—: en una
 * lista de trece filas con dos botones cada una, veintiséis controles llamados
 * «Subir» y «Bajar» no se distinguen de ninguna manera. Y el de los extremos va
 * desactivado en vez de no hacer nada al pulsarlo.
 *
 * ## «Próximamente» va aparte (Storefront V2 · P12)
 *
 * Las secciones sin componente estaban mezcladas con las demás, con su
 * interruptor apagado y una nota debajo. Se podían subir y bajar como si
 * significara algo: ordenar lo que no se pinta es ordenar nada, y además
 * empujaba a las de verdad fuera de sitio.
 *
 * Ahora van en su propio grupo al final, sin flechas y sin interruptor. Se
 * siguen enseñando —esconderlas sería más limpio y peor: quien busca «boletín» y
 * no lo encuentra no sabe si no existe o si no lo ha visto— y **su posición
 * guardada no se toca**: reordenar las activas las deja exactamente donde
 * estaban en el array.
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
 * `categories` salió de esta lista en H07: pinta las familias reales del
 * catálogo como puertas, y el comercio ya puede encenderla.
 *
 * `business-info` salió en P09. Pinta el nombre del negocio, sus canales de
 * contacto y sus páginas publicadas, y se calla sola cuando el comercio no
 * escribió ninguno — que es distinto de no estar implementada, aunque desde la
 * vitrina se vea igual. Dejarla aquí habría sido tenerla construida y apagada
 * bajo llave.
 *
 * `newsletter` se queda: no hay dónde guardar una suscripción ni su
 * consentimiento, y un formulario que pide un correo y lo tira es peor que no
 * ofrecerlo.
 */
const SIN_IMPLEMENTAR: ReadonlySet<HomeSectionId> = new Set<HomeSectionId>(['newsletter'])

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

  /** Las que se pueden ordenar, en su orden. Las pendientes no entran. */
  const activas = secciones.filter((s) => !SIN_IMPLEMENTAR.has(s.id))
  const pendientes = secciones.filter((s) => SIN_IMPLEMENTAR.has(s.id))

  function guardar(siguiente: readonly HomeSectionConfig[]) {
    form.setValue('home_layout', { version: 1, sections: siguiente }, { shouldDirty: true })
  }

  /**
   * Reordena las ACTIVAS y deja las pendientes donde estaban.
   *
   * El array guardado es uno solo y lleva las trece. Si al mover una activa se
   * arrastrara también una pendiente, el orden guardado cambiaría por algo que
   * el comercio no tocó — y esa es exactamente la clase de diferencia que
   * aparece meses después como «yo no moví eso».
   *
   * Se calcula el nuevo orden de las activas y se vuelca **en sus propias
   * posiciones** del array completo: las pendientes conservan su índice.
   */
  function reordenar(desde: number, hasta: number) {
    if (desde === hasta || hasta < 0 || hasta >= activas.length) return

    const orden = [...activas]
    const [movida] = orden.splice(desde, 1)
    if (!movida) return
    orden.splice(hasta, 0, movida)

    let siguiente = 0
    guardar(secciones.map((s) => (SIN_IMPLEMENTAR.has(s.id) ? s : (orden[siguiente++] ?? s))))
  }

  function encender(id: HomeSectionId, enabled: boolean) {
    guardar(secciones.map((s) => (s.id === id ? { ...s, enabled } : s)))
  }

  function limitar(id: HomeSectionId, valor: string) {
    const numero = Number.parseInt(valor, 10)
    guardar(
      secciones.map((s) => {
        if (s.id !== id) return s
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

      <ListaOrdenable
        secciones={activas}
        busy={busy}
        onReordenar={reordenar}
        onEncender={encender}
        onLimitar={limitar}
      />

      {pendientes.length > 0 && (
        <Stack spacing={0.5} sx={{ pt: 1 }}>
          <Typography
            component="h3"
            sx={{
              fontSize: TS.label,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}
          >
            {t('settings.design.home.pendingGroup')}
          </Typography>
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {t('settings.design.home.pendingGroupHelp')}
          </Typography>
          <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1, mt: 0.5 }}>
            {pendientes.map((seccion) => (
              <Stack
                key={seccion.id}
                component="li"
                direction="row"
                data-pending-section={seccion.id}
                sx={{
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.75,
                  borderRadius: `${R.md}px`,
                  border: '1px dashed var(--border)',
                  // Sin fondo de tarjeta: no es una fila que se pueda tocar, y
                  // parecerlo es lo que hacía que se intentara.
                  color: 'var(--muted)',
                }}
              >
                {/* Ni interruptor ni flechas: no hay nada que encender ni nada
                    que ordenar. Un control desactivado invita a pulsarlo. */}
                <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>
                  {t(NOMBRE[seccion.id])}
                </Typography>
                <Typography sx={{ fontSize: TS.label }}>
                  · {t('settings.design.home.pending')}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}

/**
 * La lista que se puede ordenar.
 *
 * Arrastrar va con la API nativa (`draggable` + `dragover` + `drop`) y sin una
 * sola dependencia. El índice de origen viaja en un `ref` **y** en el
 * `dataTransfer`: el `ref` es lo que se lee al soltar —es fiable y síncrono— y
 * el `dataTransfer` existe porque sin `setData` Firefox no inicia el arrastre.
 */
function ListaOrdenable({
  secciones,
  busy,
  onReordenar,
  onEncender,
  onLimitar,
}: {
  secciones: readonly HomeSectionConfig[]
  busy: boolean
  onReordenar: (desde: number, hasta: number) => void
  onEncender: (id: HomeSectionId, enabled: boolean) => void
  onLimitar: (id: HomeSectionId, valor: string) => void
}) {
  const { t } = useI18n()
  const origen = useRef<number | null>(null)
  const [encima, setEncima] = useState<number | null>(null)

  function soltar(destino: number) {
    const desde = origen.current
    origen.current = null
    setEncima(null)
    if (desde !== null) onReordenar(desde, destino)
  }

  return (
    <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0, gap: 0.75 }}>
      {secciones.map((seccion, indice) => {
        const nombre = t(NOMBRE[seccion.id])

        return (
          <Stack
            key={seccion.id}
            component="li"
            direction="row"
            data-section={seccion.id}
            data-drop-target={encima === indice ? 'true' : undefined}
            draggable={!busy}
            onDragStart={(evento) => {
              origen.current = indice
              evento.dataTransfer?.setData('text/plain', seccion.id)
            }}
            onDragOver={(evento) => {
              // Sin esto el navegador no permite soltar: el destino por defecto
              // de un arrastre es «aquí no».
              evento.preventDefault()
              setEncima(indice)
            }}
            onDragLeave={() => setEncima((actual) => (actual === indice ? null : actual))}
            onDrop={(evento) => {
              evento.preventDefault()
              soltar(indice)
            }}
            onDragEnd={() => {
              origen.current = null
              setEncima(null)
            }}
            sx={{
              alignItems: 'center',
              gap: 0.75,
              px: 0.75,
              // Fila compacta (P12): trece filas a 56 px eran 730 px de lista en
              // la columna de configuración del taller.
              py: 0.5,
              borderRadius: `${R.md}px`,
              border: '1px solid',
              borderColor: encima === indice ? 'var(--accent)' : 'var(--border)',
              bgcolor: 'var(--card)',
              flexWrap: 'wrap',
            }}
          >
            {/* El asa. Decorativa a propósito: quien no usa ratón tiene las dos
                flechas, que hacen lo mismo y se anuncian por su nombre. */}
            <Box
              aria-hidden
              title={t('settings.design.home.drag')}
              sx={{ display: 'flex', color: 'var(--muted)', cursor: busy ? 'default' : 'grab' }}
            >
              <DragIndicatorRoundedIcon fontSize="small" />
            </Box>

            <Switch
              size="small"
              checked={seccion.enabled}
              disabled={busy}
              onChange={(event) => onEncender(seccion.id, event.target.checked)}
              inputProps={{ 'aria-label': `${t('settings.design.home.enabled')}: ${nombre}` }}
            />

            <Typography sx={{ flex: 1, minWidth: 120, fontSize: TS.body, fontWeight: 700 }}>
              {nombre}
            </Typography>

            {SECTIONS_WITH_MAX_ITEMS.has(seccion.id) && (
              <TextField
                size="small"
                type="number"
                label={t('settings.design.home.maxItems')}
                disabled={busy}
                value={seccion.maxItems ?? ''}
                onChange={(event) => onLimitar(seccion.id, event.target.value)}
                inputProps={{
                  min: MAX_ITEMS_LIMITS.min,
                  max: MAX_ITEMS_LIMITS.max,
                  'aria-label': `${t('settings.design.home.maxItems')}: ${nombre}`,
                }}
                sx={{ width: 96 }}
              />
            )}

            <Stack direction="row" sx={{ gap: 0.25 }}>
              <IconButton
                type="button"
                size="small"
                disabled={busy || indice === 0}
                aria-label={`${t('settings.design.home.up')}: ${nombre}`}
                onClick={() => onReordenar(indice, indice - 1)}
              >
                <ArrowUpwardRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                type="button"
                size="small"
                disabled={busy || indice === secciones.length - 1}
                aria-label={`${t('settings.design.home.down')}: ${nombre}`}
                onClick={() => onReordenar(indice, indice + 1)}
              >
                <ArrowDownwardRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        )
      })}
    </Stack>
  )
}
