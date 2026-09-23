/**
 * Una o dos iniciales de un nombre, para el hueco de un logo que no existe.
 *
 * ## Por qué vive en `shared` y no en la vitrina
 *
 * Porque el respaldo tiene que ser EL MISMO en los dos lados. El backoffice
 * enseña las marcas en una tabla y la vitrina las enseña en la portada; si cada
 * uno calculara sus iniciales, «Laboratorios San Miguel» podría ser «LS» arriba
 * y «LM» abajo, y quien administra la tienda no reconocería en la vitrina lo
 * que acabó de configurar.
 *
 * No decide COLOR: eso sí cambia de lado. La vitrina usa sus tintes de
 * orientación (`--sf-tint-*`, que solo existen dentro de `.sf-scope`) y el
 * backoffice usa el acento de suite. Lo que se comparte es la letra.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}
