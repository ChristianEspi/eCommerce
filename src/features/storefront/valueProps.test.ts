import { describe, expect, it } from 'vitest'
import type { MessageKey } from '@/shared/i18n/messages'
import {
  PLATFORM_VALUE_PROPS,
  VALUE_PROPS_LIMITS,
  VALUE_PROP_COPY,
  VALUE_PROP_ICON_KEYS,
  normalizeValueProps,
  resolveValueProps,
  sanitizeValueProps,
} from './valueProps'

/**
 * El contrato de las propuestas de valor.
 *
 * ## Qué se fija aquí, y por qué importa
 *
 * Este archivo es el que impide que vuelva el fallo que P01 arregla: la
 * plataforma afirmando cosas del negocio de otro. Se comprueban tres cosas
 * distintas y ninguna es cosmética:
 *
 *  1. **Lo que la plataforma afirma sola es poco y es cierto.** Solo entrega y
 *     pago seguro, porque las hace el código; atención únicamente si la tienda
 *     dio un canal de contacto. Si alguien añadiera aquí «retiro en tienda»,
 *     estaría afirmando que el comercio tiene local.
 *  2. **Configurar SUSTITUYE.** No se completa la lista del comercio con las de
 *     la plataforma: quien quiso enseñar una cosa no puede acabar enseñando
 *     tres que no escribió.
 *  3. **Nada de aquí lanza.** Es el borde por el que entra una columna que
 *     puede no existir todavía, o un JSON escrito a mano. Una franja rota no
 *     puede dejar la portada en blanco.
 */

/** Traductor de mentira: devuelve la clave, que es lo que hace visible el fallo. */
const t = (key: MessageKey) => `[${key}]`

const VALIDA = { iconKey: 'delivery', title: 'Envíos a todo el país', enabled: true } as const

describe('sanitizeValueProps: lo que se guarda', () => {
  it('conserva una entrada completa tal cual', () => {
    expect(sanitizeValueProps([{ ...VALIDA, body: 'En 48 horas' }])).toEqual([
      { iconKey: 'delivery', title: 'Envíos a todo el país', body: 'En 48 horas', enabled: true },
    ])
  })

  it('lo que no es una lista se lee como lista vacía', () => {
    for (const raro of [null, undefined, 'delivery', 42, {}, { sections: [] }]) {
      expect(sanitizeValueProps(raro)).toEqual([])
    }
  })

  it('descarta la entrada con un icono que este código no dibuja', () => {
    expect(sanitizeValueProps([{ iconKey: 'pharmacist', title: 'Algo', enabled: true }])).toEqual([])
  })

  it('descarta la entrada que no es un objeto y conserva el resto', () => {
    const salida = sanitizeValueProps(['x', null, VALIDA])
    expect(salida).toHaveLength(1)
    expect(salida[0]?.iconKey).toBe('delivery')
  })

  it('el icono repetido se queda en la PRIMERA posición, que es la que el editor eligió', () => {
    const salida = sanitizeValueProps([
      { ...VALIDA, title: 'Primera' },
      { ...VALIDA, title: 'Segunda' },
    ])
    expect(salida).toHaveLength(1)
    expect(salida[0]?.title).toBe('Primera')
  })

  it('corta en cuatro: la franja es de una línea', () => {
    const cinco = VALUE_PROP_ICON_KEYS.slice(0, 5).map((iconKey) => ({
      iconKey,
      title: iconKey,
      enabled: true,
    }))
    expect(sanitizeValueProps(cinco)).toHaveLength(VALUE_PROPS_LIMITS.max)
  })

  it('recorta el texto al tope en vez de dejar que reviente el CHECK', () => {
    const salida = sanitizeValueProps([
      { iconKey: 'delivery', title: 'a'.repeat(200), body: 'b'.repeat(400), enabled: true },
    ])
    expect(salida[0]?.title).toHaveLength(VALUE_PROPS_LIMITS.titleMax)
    expect(salida[0]?.body).toHaveLength(VALUE_PROPS_LIMITS.bodyMax)
  })

  it('un salto de línea no parte la franja en dos', () => {
    const salida = sanitizeValueProps([
      { iconKey: 'delivery', title: 'Envíos\nrápidos', body: 'Hoy\ty mañana', enabled: true },
    ])
    expect(salida[0]?.title).toBe('Envíos rápidos')
    expect(salida[0]?.body).toBe('Hoy y mañana')
  })

  it('el apoyo vacío se OMITE, no se guarda en blanco', () => {
    const salida = sanitizeValueProps([{ ...VALIDA, body: '   ' }])
    expect(salida[0]).not.toHaveProperty('body')
  })

  it('una entrada a medio escribir sobrevive: es el estado normal de un formulario', () => {
    const salida = sanitizeValueProps([{ iconKey: 'warranty', title: '', enabled: true }])
    expect(salida).toHaveLength(1)
    expect(salida[0]?.title).toBe('')
  })

  it('sin `enabled` se asume visible: quien escribió una promesa quería enseñarla', () => {
    expect(sanitizeValueProps([{ iconKey: 'delivery', title: 'Envíos' }])[0]?.enabled).toBe(true)
  })
})

describe('normalizeValueProps: lo que se pinta', () => {
  it('deja fuera lo apagado', () => {
    const salida = normalizeValueProps([
      { ...VALIDA, enabled: false },
      { iconKey: 'warranty', title: 'Garantía', enabled: true },
    ])
    expect(salida.map((prop) => prop.iconKey)).toEqual(['warranty'])
  })

  it('deja fuera lo que no tiene título: un icono suelto no dice nada', () => {
    expect(normalizeValueProps([{ iconKey: 'warranty', title: '  ', enabled: true }])).toEqual([])
  })
})

describe('lo que la plataforma puede afirmar sola', () => {
  /**
   * La prueba que da nombre a la fase. Antes de P01 la franja anunciaba
   * «Atención farmacéutica» y «Retiro en tienda» en TODAS las tiendas: un rubro
   * y un local que el código no conoce. Si alguien las devuelve a esta lista,
   * aquí se ve.
   */
  it('no afirma nada del local ni de la plantilla del comercio', () => {
    const claves = PLATFORM_VALUE_PROPS.map((prop) => prop.iconKey)
    expect(claves).not.toContain('pickup')
    expect(claves).not.toContain('expertise')
    expect(claves).not.toContain('certification')
    expect(claves).not.toContain('warranty')
    expect(claves).not.toContain('returns')
    expect(claves).not.toContain('installments')
  })

  it('son las dos que hace el código, más atención si hay contacto', () => {
    const sinContacto = resolveValueProps({ configured: [], hasContact: false, t })
    expect(sinContacto.map((prop) => prop.iconKey)).toEqual(['delivery', 'payment'])

    const conContacto = resolveValueProps({ configured: [], hasContact: true, t })
    expect(conContacto.map((prop) => prop.iconKey)).toEqual(['delivery', 'payment', 'support'])
  })

  it('el texto sale de i18n, nunca escrito en el componente', () => {
    const [primera] = resolveValueProps({ configured: null, hasContact: false, t })
    expect(primera?.title).toBe(`[${VALUE_PROP_COPY.delivery.title}]`)
    expect(primera?.body).toBe(`[${VALUE_PROP_COPY.delivery.body}]`)
  })

  it('cada icono tiene su par de textos: ninguno se queda sin sugerencia', () => {
    for (const clave of VALUE_PROP_ICON_KEYS) {
      expect(VALUE_PROP_COPY[clave].title).toBe(`store.valueProps.copy.${clave}.title`)
      expect(VALUE_PROP_COPY[clave].body).toBe(`store.valueProps.copy.${clave}.body`)
    }
  })
})

describe('configurar SUSTITUYE, no completa', () => {
  it('una sola propuesta configurada es lo único que se pinta', () => {
    const salida = resolveValueProps({
      configured: [{ iconKey: 'expertise', title: 'Atención farmacéutica', enabled: true }],
      hasContact: true,
      t,
    })
    expect(salida).toEqual([{ iconKey: 'expertise', title: 'Atención farmacéutica', body: '' }])
  })

  it('el texto del comercio se pinta TAL CUAL, sin pasar por i18n', () => {
    const salida = resolveValueProps({
      configured: [{ iconKey: 'delivery', title: 'Envíos 24 h', body: 'Lima y Callao', enabled: true }],
      hasContact: false,
      t,
    })
    expect(salida[0]?.title).toBe('Envíos 24 h')
    expect(salida[0]?.body).toBe('Lima y Callao')
  })

  it('si el comercio lo apagó todo, la franja se queda sin nada que pintar', () => {
    // Y no cae a las de plataforma: apagarlas es una decisión, no un dato que
    // falte. La sección desaparece, como cualquier otra sin contenido.
    expect(
      resolveValueProps({
        configured: [{ ...VALIDA, enabled: false }],
        hasContact: true,
        t,
      }),
    ).toEqual([])
  })

  it('una lista entera de basura cae a las de plataforma en vez de romper', () => {
    const salida = resolveValueProps({
      configured: [{ iconKey: 'x' }, 7, null],
      hasContact: false,
      t,
    })
    expect(salida.map((prop) => prop.iconKey)).toEqual(['delivery', 'payment'])
  })
})
