import { Fragment } from 'react'
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
 */
export function HomeComposer({ layout, data }: { layout: HomeLayout; data: HomeSectionData }) {
  return (
    <>
      {layout.sections.map((section) => {
        if (!section.enabled) return null

        const pintar = HOME_SECTIONS[section.id]
        if (!pintar) return null

        const contenido = pintar(data, section.maxItems)
        if (contenido === null || contenido === undefined || contenido === false) return null

        return <Fragment key={section.id}>{contenido}</Fragment>
      })}
    </>
  )
}
