import { describe, expect, it } from 'vitest'
import {
  BRAND_LOCKUPS,
  DEFAULT_BRAND_LOCKUP,
  IDENTITY_LIMITS,
  resolveBrandLockup,
  resolveHeroKicker,
  resolveShowThemeToggle,
  resolveStoreDescription,
  sanitizeAnnouncements,
} from './identity'

/**
 * La identidad de la tienda con roles semánticos (Storefront V3 · P01).
 *
 * ## Qué protege este archivo
 *
 * La separación que da sentido a la fase: **estrenar campaña no puede cambiar lo
 * que la tienda dice de sí misma en el pie**. Hasta V3 los dos textos eran el
 * mismo campo, así que cambiar el hero cambiaba el pie de todas las páginas.
 *
 * Y la regla de siempre, aquí otra vez: lo que el comercio no escribió no se
 * inventa. La plataforma no genera un aviso, ni redacta una descripción, ni
 * rellena un kicker. El único respaldo que existe es texto que el comercio ya
 * había escrito, y se apaga solo en cuanto escribe el campo nuevo.
 */

describe('la descripción de la tienda se separa del hero', () => {
  it('usa la descripción propia cuando existe', () => {
    expect(
      resolveStoreDescription({
        store_description: 'Atendemos en Lima desde 1998.',
        hero_subtitle: 'Campaña de invierno',
      }),
    ).toBe('Atendemos en Lima desde 1998.')
  })

  it('una tienda ANTERIOR a V3 no pierde su pie el día del despliegue', () => {
    // El respaldo de compatibilidad: hasta V3 la descripción del pie ERA la
    // bajada del hero, y una tienda que ya funcionaba no puede quedarse con el
    // pie en blanco por aplicar una migración.
    expect(
      resolveStoreDescription({ store_description: null, hero_subtitle: 'Hechos a mano en Lima' }),
    ).toBe('Hechos a mano en Lima')
  })

  it('en cuanto se escribe la descripción, los dos campos se desacoplan', () => {
    // Es el motivo entero de la fase: a partir de aquí, cambiar la campaña del
    // hero no toca lo que dice el pie.
    const antes = resolveStoreDescription({
      store_description: 'Ferretería del barrio, con reparto propio.',
      hero_subtitle: 'Campaña de invierno',
    })
    const despues = resolveStoreDescription({
      store_description: 'Ferretería del barrio, con reparto propio.',
      hero_subtitle: 'Liquidación de verano',
    })

    expect(antes).toBe(despues)
  })

  it('sin ninguno de los dos no se inventa nada', () => {
    expect(resolveStoreDescription({ store_description: null, hero_subtitle: null })).toBe('')
    expect(resolveStoreDescription({})).toBe('')
  })

  it('los espacios y los saltos de línea no cuentan como descripción', () => {
    expect(resolveStoreDescription({ store_description: '   ', hero_subtitle: 'De campaña' })).toBe(
      'De campaña',
    )
    // Un `\n` guardado ahí produce un salto que nadie escribió a propósito.
    expect(resolveStoreDescription({ store_description: 'Dos\nlíneas' })).toBe('Dos líneas')
  })

  it('se acota al mismo tope que la base', () => {
    const largo = 'a'.repeat(IDENTITY_LIMITS.descriptionMax + 50)
    expect(resolveStoreDescription({ store_description: largo })).toHaveLength(
      IDENTITY_LIMITS.descriptionMax,
    )
  })
})

describe('el kicker del hero', () => {
  it('es el texto del comercio, recortado', () => {
    expect(resolveHeroKicker('  Nueva temporada  ')).toBe('Nueva temporada')
  })

  it('vacío significa que no se pinta, no un texto por defecto', () => {
    // Si la plataforma rellenara el kicker, todas las tiendas dirían lo mismo
    // encima de su titular.
    expect(resolveHeroKicker(null)).toBe('')
    expect(resolveHeroKicker(undefined)).toBe('')
    expect(resolveHeroKicker(42)).toBe('')
  })

  it('se acota a una línea', () => {
    expect(resolveHeroKicker('x'.repeat(200))).toHaveLength(IDENTITY_LIMITS.kickerMax)
  })
})

describe('qué enseña la cabecera', () => {
  it('por defecto, lo que hacía antes: logotipo y nombre', () => {
    // Ninguna tienda cambia de aspecto por aplicar la migración.
    expect(resolveBrandLockup(null, true)).toBe('logo_name')
    expect(DEFAULT_BRAND_LOCKUP).toBe('logo_name')
  })

  it('respeta las tres opciones del contrato', () => {
    expect([...BRAND_LOCKUPS]).toEqual(['logo_name', 'logo', 'name'])
    for (const valor of BRAND_LOCKUPS) {
      expect(resolveBrandLockup(valor, true)).toBe(valor)
    }
  })

  it('sin logotipo enseña el NOMBRE, aunque pida logotipo', () => {
    // La corrección que evita un hueco donde debería estar la marca. Vive aquí
    // —del lado que pinta— y no como un control desactivado en el formulario:
    // el orden en que alguien rellena un formulario no es asunto del formulario.
    expect(resolveBrandLockup('logo', false)).toBe('name')
    expect(resolveBrandLockup('logo_name', false)).toBe('name')
  })

  it('«solo nombre» CON logotipo se respeta: es una decisión, no un descuido', () => {
    expect(resolveBrandLockup('name', true)).toBe('name')
  })

  it('un valor que no existe cae al defecto en vez de romper la cabecera', () => {
    expect(resolveBrandLockup('editorial', true)).toBe('logo_name')
    expect(resolveBrandLockup(7, true)).toBe('logo_name')
  })
})

describe('el selector claro/oscuro', () => {
  it('viene APAGADO', () => {
    // El único defecto de V3 que cambia una tienda existente, y a propósito:
    // estaba en la cabecera de todas sin que ningún comercio lo pidiera.
    expect(resolveShowThemeToggle(null)).toBe(false)
    expect(resolveShowThemeToggle(undefined)).toBe(false)
  })

  it('se enciende solo con un `true` de verdad', () => {
    expect(resolveShowThemeToggle(true)).toBe(true)
    // Nada de valores «parecidos a verdadero»: un `'true'` guardado por error
    // no debería encender un control en la tienda de alguien.
    expect(resolveShowThemeToggle('true')).toBe(false)
    expect(resolveShowThemeToggle(1)).toBe(false)
  })
})

describe('la barra de avisos', () => {
  it('sin nada guardado, no hay barra', () => {
    expect(sanitizeAnnouncements(undefined)).toEqual([])
    expect(sanitizeAnnouncements([])).toEqual([])
    // Y la plataforma no añade ninguno: «envíos a todo el país» es una
    // afirmación sobre el negocio de otro.
    expect(sanitizeAnnouncements(null)).toEqual([])
  })

  it('pinta los que el comercio escribió, en su orden', () => {
    expect(
      sanitizeAnnouncements([{ text: 'Reparto propio en Lima' }, { text: 'Atención por WhatsApp' }]),
    ).toEqual([{ text: 'Reparto propio en Lima' }, { text: 'Atención por WhatsApp' }])
  })

  it('corta en dos: con tres, nadie lee el tercero', () => {
    const cuatro = [{ text: 'uno' }, { text: 'dos' }, { text: 'tres' }, { text: 'cuatro' }]
    expect(sanitizeAnnouncements(cuatro)).toEqual([{ text: 'uno' }, { text: 'dos' }])
  })

  it('descarta una entrada corrupta y conserva la buena', () => {
    // Una barra con un aviso bueno y otro roto enseña el bueno.
    expect(sanitizeAnnouncements([{ text: '' }, { text: 'Recogida en tienda' }])).toEqual([
      { text: 'Recogida en tienda' },
    ])
  })

  it('rechaza cualquier clave que no sea `text`', () => {
    // La mitad del contrato: sin esto, un `{"text": "…", "html": "<script>"}`
    // llegaría a la base o, peor, al DOM de la vitrina.
    expect(sanitizeAnnouncements([{ text: 'Hola', html: '<script>x()</script>' }])).toEqual([])
    expect(sanitizeAnnouncements([{ html: '<b>Oferta</b>' }])).toEqual([])
    expect(sanitizeAnnouncements([{ text: 'Hola', url: 'https://otro.sitio' }])).toEqual([])
  })

  it('el marcado guardado como texto se queda en TEXTO', () => {
    // No se limpia el HTML: se conserva como cadena. Quien lo pinta lo hace con
    // `{texto}` de React, que escapa; y `architecture.test.ts` prohíbe
    // `dangerouslySetInnerHTML` en toda la vitrina.
    expect(sanitizeAnnouncements([{ text: '<b>Oferta</b>' }])).toEqual([{ text: '<b>Oferta</b>' }])
  })

  it('sin textos repetidos: dos avisos iguales parecen una barra estropeada', () => {
    expect(sanitizeAnnouncements([{ text: 'Envío gratis' }, { text: 'Envío gratis' }])).toEqual([
      { text: 'Envío gratis' },
    ])
  })

  it('quita los caracteres de control, que descuadran la cabecera', () => {
    expect(sanitizeAnnouncements([{ text: 'Dos\nlíneas' }])).toEqual([{ text: 'Dos líneas' }])
  })

  it('acota cada texto al tope de la base', () => {
    const [aviso] = sanitizeAnnouncements([{ text: 'z'.repeat(300) }])
    expect(aviso?.text).toHaveLength(IDENTITY_LIMITS.announcementTextMax)
  })

  it('lo que no es una lista no es una barra', () => {
    expect(sanitizeAnnouncements({ text: 'Hola' })).toEqual([])
    expect(sanitizeAnnouncements('Hola')).toEqual([])
  })
})
