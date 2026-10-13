import { describe, expect, it } from 'vitest'
import { MAX_HIGHLIGHTS, cleanHighlights } from './highlights'

describe('cleanHighlights', () => {
  it('quita vacíos y repetidos, recorta y respeta el máximo de la base', () => {
    expect(cleanHighlights(['  Rinde más ', '', 'Rinde más', '   '])).toEqual(['Rinde más'])
    expect(cleanHighlights(['x'.repeat(130)])[0]).toHaveLength(120)
    expect(cleanHighlights(Array.from({ length: 9 }, (_, i) => `Punto ${i}`))).toHaveLength(MAX_HIGHLIGHTS)
  })
})
