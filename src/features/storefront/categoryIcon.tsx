/**
 * La cara de una familia del catalogo.
 *
 * El resolvedor se movió a `shared/ui/categoryIcon.tsx` en Storefront V2 · P03:
 * el backoffice enseña el MISMO respaldo en el cajón de la categoría —la caja
 * que se ve sin foto tiene que ser la que verá el comprador— y dos tablas de
 * palabras se habrían separado a la primera familia nueva.
 *
 * Se reexporta desde aquí para no tocar los sitios de la vitrina que ya la
 * importaban de este módulo.
 */
export { iconoDe } from '@/shared/ui/categoryIcon'
