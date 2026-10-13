/** Lo que admite la base (`ebim.highlights_valid`): 6 frases de 1..120. */
export const MAX_HIGHLIGHTS = 6
export const MAX_HIGHLIGHT_LENGTH = 120

/** Limpia la lista antes de guardar: sin vacíos, sin repetidos, recortada. */
export function cleanHighlights(items: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of items) {
    const text = raw.trim().slice(0, MAX_HIGHLIGHT_LENGTH)
    if (text && !out.includes(text)) out.push(text)
  }
  return out.slice(0, MAX_HIGHLIGHTS)
}
