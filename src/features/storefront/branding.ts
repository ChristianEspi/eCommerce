/**
 * Fallbacks visuales de la vitrina.
 *
 * La regla del encargo es que la identidad salga siempre de `store_settings` y
 * que, cuando falte, lo que se pinte sea NEUTRO: ni el isotipo de EBIM haciendo
 * de logo del tenant, ni un color de casa disfrazado de marca suya.
 *
 * `initials` se movió a `shared/lib/initials.ts` en Storefront V2 · P02: el
 * backoffice enseña las mismas marcas en su tabla, y dos cálculos distintos de
 * las mismas iniciales harían que «Laboratorios San Miguel» fuera «LS» arriba y
 * «LM» abajo. Se reexporta desde aquí para no tocar los sitios de la vitrina que
 * ya la importaban de este módulo.
 */
export { initials } from '@/shared/lib/initials'
