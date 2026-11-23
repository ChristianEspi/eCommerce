import { describe, expect, it } from 'vitest'
import { plainAnalystText, type MarkerContext } from './aiAnalyst'

/**
 * 2026-11-22 · El Copilot decía «60 días días»: la cifra en días ya se pinta
 * con su unidad y el modelo la escribía otra vez detrás del marcador.
 */
const context: MarkerContext = {
  metrics: {
    'T1.days': { kind: 'days', value: '60' },
    'T1.count': { kind: 'count', value: '3' },
  },
  entities: {},
}
const labels = { days: '{n} días' }

describe('cifras en días dentro del texto de la IA', () => {
  it('no repite la unidad que el modelo escribe detrás del marcador', () => {
    expect(plainAnalystText('Inactivos hace {{T1.days}} días o más.', context, 'es', labels)).toBe(
      'Inactivos hace 60 días o más.',
    )
    expect(plainAnalystText('Umbral: {{T1.days}} dia.', context, 'es', labels)).toBe('Umbral: 60 días.')
  })

  it('sin unidad detrás, la pone la cifra', () => {
    expect(plainAnalystText('Umbral de {{T1.days}} para todos.', context, 'es', labels)).toBe(
      'Umbral de 60 días para todos.',
    )
  })

  it('no se come palabras que solo empiezan igual ni toca otras cifras', () => {
    expect(plainAnalystText('Hace {{T1.days}} diarios', context, 'es', labels)).toBe('Hace 60 días diarios')
    expect(plainAnalystText('{{T1.count}} días', context, 'es', labels)).toBe('3 días')
  })
})
