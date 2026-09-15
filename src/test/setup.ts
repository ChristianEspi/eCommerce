import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/dom'
import { registerBackofficeMessages } from '@/shared/i18n/messages'
import { esBackoffice } from '@/shared/i18n/messages.es.backoffice'

/**
 * El español del backoffice, ya cargado (cierre · certificación).
 *
 * En la aplicación lo trae la ruta `/app` antes de pintar. Las pruebas montan
 * las pantallas sin pasar por esa ruta, así que aquí se registra de entrada:
 * es el estado en el que cualquier pantalla del backoffice se pinta de verdad.
 */
registerBackofficeMessages(esBackoffice)

/**
 * Margen de espera de los `findBy*`.
 *
 * El defecto de Testing Library es 1 s, y las pantallas del router real llegan
 * por `React.lazy`: con la suite entera corriendo en paralelo, resolver ese
 * import puede pasar del segundo en una máquina cargada y el test falla por
 * lento, no por roto. Subirlo no oculta ningún fallo —una aserción que no se
 * cumple sigue fallando— pero quita el falso negativo que depende del hardware.
 */
configure({ asyncUtilTimeout: 5000 })

/**
 * Lo que jsdom no trae y ProseMirror da por hecho.
 *
 * TipTap mide el documento para colocar el cursor —`elementFromPoint`,
 * `Range.getClientRects`— y jsdom no implementa nada que dependa de un motor de
 * maquetación. Sin estos huecos, cada prueba que monta el editor de contenido
 * revienta con un error suelto aunque sus aserciones pasen.
 *
 * Devuelven CERO, no medidas inventadas: en jsdom no hay geometría que medir, y
 * fingir uma caja de 100 px llevaría a probar posiciones que no existen. Lo que
 * se prueba del editor es lo que escribe, no dónde queda el cursor.
 */
const emptyRect = () => ({
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON: () => ({}),
})

if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => null
}
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => emptyRect() as DOMRect
  }
}
