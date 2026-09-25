import type { ProductCardVariant } from '../theme/types'

/**
 * Cuánto mide un hueco de una fila de producto, por presentación
 * (Storefront V3 · P05).
 *
 * ## El defecto que cierra
 *
 * `ProductRow` usaba `itemWidth={168}` para todas las tiendas. 168 px es el
 * ancho de una tarjeta de catálogo denso: en Catalog está bien —seis columnas,
 * quien busca sabe qué quiere— y en Premium convierte una portada editorial en
 * una tira de miniaturas.
 *
 * El tema declaraba una personalidad y la fila la deshacía en cuanto la tienda
 * tenía más de seis productos, que es siempre. Era además el fallo más difícil
 * de ver en una captura: cada pieza por separado parecía correcta.
 *
 * ## Por qué vive en su propio archivo
 *
 * Porque son DATOS del sistema de diseño, no lógica de un componente: los
 * consumen la fila y su esqueleto de carga, y mañana los consumirá la vista
 * previa del backoffice para que el taller mida lo que mide la tienda. Tenerlos
 * dentro de `ProductRow` obligaba a exportar una constante desde un archivo de
 * componentes, que es justo lo que rompe la recarga en caliente.
 *
 * ## Y por qué es una tabla y no una fórmula
 *
 * Porque son tres decisiones de diseño, no un cálculo. Una tabla se lee de un
 * vistazo cuando alguien pregunta «¿por qué esta fila mide esto?», y una fórmula
 * hay que ejecutarla en la cabeza.
 */
export const ROW_SLOT_WIDTH: Record<ProductCardVariant, { xs: number; sm: number; md: number }> = {
  /**
   * Denso, para Retail y Catalog: cabe más en la misma pantalla sin que el
   * nombre acabe en tres líneas.
   */
  compact: { xs: 156, sm: 172, md: 184 },
  /** El equilibrio de Universal: la foto se ve y el nombre entra en dos líneas. */
  comfortable: { xs: 176, sm: 208, md: 236 },
  /**
   * Premium: la fotografía es el argumento de venta, así que el hueco es casi
   * el doble que el de un catálogo denso.
   */
  editorial: { xs: 232, sm: 272, md: 304 },
}

/**
 * En el teléfono los tres miden menos que en escritorio, y ninguno llega al
 * ancho de la pantalla.
 *
 * Ese recorte no es estética: es lo que deja ver un trozo de la siguiente
 * tarjeta, y ese trozo es la única señal de que la fila se puede arrastrar. Con
 * el hueco al ancho completo, la fila parece una tarjeta única y nadie la mueve.
 */
export const ROW_SLOT_GAP: Record<ProductCardVariant, number> = {
  compact: 1.5,
  comfortable: 1.5,
  // Más aire entre piezas: en editorial el espacio forma parte del argumento.
  editorial: 2,
}
