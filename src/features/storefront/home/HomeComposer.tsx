import { Fragment } from 'react'
import { StoreSectionFrame } from '../components/StoreSectionFrame'
import { resolveSectionPresentation } from '../theme/presentation'
import type { HomeLayout } from '../theme/types'
import { HOME_SECTIONS } from './SectionRegistry'
import type { HomeSectionData } from './types'

/**
 * Pinta la portada en el orden que el comercio configuró.
 *
 * ## Lo que hace, dicho entero
 *
 * Recorre el orden guardado, se salta lo apagado, busca en el registro y pinta.
 * Nada más. No decide qué datos hay, no consulta nada y no sabe qué es una
 * oferta: eso sigue siendo de `StoreHomePage`.
 *
 * ## Las tres cosas que NO puede hacer, y por qué
 *
 * **No puede pintar una sección que no conoce.** El orden llega ya normalizado
 * —identificadores de una lista cerrada—, así que un `id` inventado no llega
 * hasta aquí. Aun así se comprueba: es la última barrera antes del `render`, y
 * una configuración escrita a mano no debería tumbar la portada.
 *
 * **No puede repetir una sección.** El orden normalizado ya viene sin
 * repetidos, y con `key` por identificador React protestaría si los hubiera.
 *
 * **No puede dejar un hueco.** Una sección sin datos devuelve `null` y
 * desaparece. Nada de envolver cada una en un `<Box>` que ocupe aunque esté
 * vacía: el `gap` del contenedor se aplica a lo que EXISTE, y un envoltorio
 * vacío deja un espacio que nadie sabe de dónde sale.
 *
 * ## El ritmo, desde Storefront V3 · P06
 *
 * Lo que sí decide ahora es el MARCO de cada sección: sobre qué superficie va y
 * si llega al ancho del contenido o al de la ventana. Se resuelve aquí —una vez,
 * con la presentación guardada y el tema— y se envuelve en `StoreSectionFrame`,
 * que es el único sitio del repositorio donde vive el truco del full-bleed.
 *
 * Se resuelve aquí y no dentro de cada sección por el mismo motivo por el que el
 * reparto de productos se hace en `StoreHomePage`: si cada sección decidiera su
 * propio ancho, trece componentes tendrían trece copias del mismo cálculo y la
 * primera que lo escribiera mal arrastraría la página de lado.
 *
 * El marco no se pinta cuando no hace falta —superficie plana y ancho
 * contenido, que son los defectos de casi todas las secciones de casi todas las
 * tiendas—: trece envoltorios que no hacen nada son trece nodos de más.
 */
export function HomeComposer({ layout, data }: { layout: HomeLayout; data: HomeSectionData }) {
  return (
    <>
      {layout.sections.map((section) => {
        if (!section.enabled) return null

        const pintar = HOME_SECTIONS[section.id]
        if (!pintar) return null

        /**
         * La presentación, resuelta con lo guardado y el tema (V3 · P06).
         *
         * Nunca devuelve `auto`: quien pinta recibe una decisión tomada. Y una
         * sección que no guardó nada recibe lo que su tema considera correcto,
         * que para Universal es exactamente lo que la portada hacía antes.
         */
        const presentacion = resolveSectionPresentation({
          id: section.id,
          presentation: section.presentation,
          preset: data.theme.preset,
          categoryVariant: data.theme.style.categoryVariant,
          productCardVariant: data.theme.style.productCardVariant,
        })

        const contenido = pintar(data, section.maxItems, presentacion)
        if (contenido === null || contenido === undefined || contenido === false) return null

        return (
          <Fragment key={section.id}>
            <StoreSectionFrame presentation={presentacion} sectionId={section.id}>
              {contenido}
            </StoreSectionFrame>
          </Fragment>
        )
      })}
    </>
  )
}
