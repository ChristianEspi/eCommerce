import { test as base, expect, type Page } from '@playwright/test'

/**
 * El mismo `test`, pero la consola cuenta.
 *
 * El punto 8 del prompt de validación pide revisar la consola por errores
 * severos, y «revisar» a mano es lo que nadie hace dos veces. Aquí cada prueba
 * escucha `console.error` y `pageerror` desde el primer píxel y **falla si algo
 * queda ahí**: un error de consola deja de ser algo que se descubre delante del
 * cliente.
 *
 * ## Lo que se deja pasar, y por qué
 *
 * Hay ruido que no dice nada sobre el producto: los avisos de futuras versiones
 * de React Router, el aviso de desarrollo de React DevTools y los fallos de
 * carga de imágenes de terceros. Filtrarlos no es esconder: si TODO cuenta,
 * nadie mira la lista, y el primer error de verdad se pierde entre cinco avisos
 * de una dependencia. Lo que se filtra está aquí, a la vista, y es corto a
 * propósito.
 */
const RUIDO = [
  'React Router Future Flag Warning',
  'Download the React DevTools',
  'Failed to load resource: net::ERR_',
]

export interface Vigilante {
  errores: string[]
}

export const test = base.extend<{ vigilante: Vigilante }>({
  vigilante: async ({ page }, use) => {
    const errores: string[] = []

    page.on('console', (mensaje) => {
      if (mensaje.type() !== 'error') return
      const texto = mensaje.text()
      if (RUIDO.some((patron) => texto.includes(patron))) return
      errores.push(texto)
    })

    // Una excepción no capturada no siempre llega a `console`: es el fallo más
    // grave y el que más fácil se escapa de una revisión manual.
    page.on('pageerror', (error) => errores.push(`pageerror: ${error.message}`))

    await use({ errores })

    expect(errores, `errores de consola:\n${errores.join('\n')}`).toEqual([])
  },
})

export { expect }

/** La tienda de demo. Un solo sitio del que cambiarla. */
export const TIENDA = '/s/miquimica'

/**
 * Espera a que la vitrina tenga contenido de verdad, no solo esqueletos.
 *
 * Sin esto, una prueba puede pasar contra la pantalla de carga: los esqueletos
 * tienen la forma del contenido pero no son el contenido, y es exactamente el
 * fallo que un E2E existe para no tener.
 */
export async function esperarCatalogo(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}
