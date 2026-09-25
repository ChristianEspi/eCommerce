import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SIDE, optimizeImageFile, readImageSize } from './imageOptimizer'

/**
 * La reducción de imágenes antes de subir (Storefront V3 · P11).
 *
 * ## Qué defiende este archivo
 *
 * Las cinco reglas que hacen que esto sea seguro de poner en medio de cuatro
 * flujos de subida que ya funcionaban:
 *
 *  1. lo que ya cabe no se toca —recomprimir lo que estaba bien solo pierde
 *     calidad—;
 *  2. si el resultado sale más grande, se descarta;
 *  3. si algo falla, se sube el ORIGINAL: nadie se queda sin subir su foto
 *     porque el navegador no tenga `canvas`;
 *  4. la proporción no se toca;
 *  5. lo que no es un mapa de bits no se redibuja.
 *
 * Y que la transparencia no se pierda: un logotipo con fondo transparente no
 * puede acabar en JPEG.
 *
 * ## Por qué los dobles son tan explícitos
 *
 * jsdom no trae `createImageBitmap`, y su `canvas` no dibuja ni exporta nada.
 * Los dos se sustituyen aquí por dobles que se comportan como el navegador en
 * cada caso que hay que probar —incluido el de fallar—, porque lo que se está
 * probando es precisamente la decisión que se toma con lo que devuelven.
 */

/** Un archivo con un tamaño declarado. El contenido no se lee nunca. */
function archivo(nombre: string, tipo: string, bytes: number): File {
  const file = new File([new Uint8Array(1)], nombre, { type: tipo })
  // `size` es de solo lectura en `File`: se redefine porque las reglas que se
  // prueban comparan TAMAÑOS, no contenido.
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

/** Hace que el navegador simulado sepa leer imágenes de este tamaño. */
function conDecodificador(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: vi.fn() })),
  )
}

/**
 * Un lienzo que exporta lo que se le diga.
 *
 * `soporta` es la lista de tipos que este navegador sabe escribir: con
 * `['image/png']` se simula uno sin WebP, que es la razón de que el código
 * mire el TIPO del resultado y no la cadena del agente.
 */
function conLienzo(options: {
  bytes: number
  soporta?: readonly string[]
  sinContexto?: boolean
  sinToBlob?: boolean
}) {
  const soporta = options.soporta ?? ['image/webp', 'image/png', 'image/jpeg']
  const dibujadas: { ancho: number; alto: number }[] = []

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') {
      // Cualquier otro elemento se crea de verdad.
      return Object.getPrototypeOf(document).createElement.call(document, tag)
    }
    const lienzo = {
      width: 0,
      height: 0,
      getContext: () =>
        options.sinContexto
          ? null
          : {
              imageSmoothingEnabled: false,
              imageSmoothingQuality: 'low',
              drawImage: (_fuente: unknown, _x: number, _y: number, ancho: number, alto: number) => {
                dibujadas.push({ ancho, alto })
              },
            },
      ...(options.sinToBlob
        ? {}
        : {
            toBlob: (cb: (blob: Blob | null) => void, tipo: string) => {
              // Como el navegador: si no sabe escribir ese tipo, devuelve PNG.
              const real = soporta.includes(tipo) ? tipo : 'image/png'
              const blob = new Blob([new Uint8Array(1)], { type: real })
              Object.defineProperty(blob, 'size', { value: options.bytes })
              cb(blob)
            },
          }),
    }
    return lienzo as unknown as HTMLElement
  })

  return dibujadas
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lo que ya cabe no se toca', () => {
  it('una imagen por debajo del máximo se sube tal cual', async () => {
    conDecodificador(900, 600)
    const original = archivo('foto.jpg', 'image/jpeg', 300_000)

    const resultado = await optimizeImageFile(original, 'product')

    expect(resultado.changed).toBe(false)
    expect(resultado.file).toBe(original)
    // Y aun así se devuelven las medidas: quien sube puede querer avisar.
    expect(resultado.width).toBe(900)
    expect(resultado.height).toBe(600)
  })

  it('justo en el máximo tampoco se toca', async () => {
    conDecodificador(MAX_SIDE.product, 1200)
    const original = archivo('foto.jpg', 'image/jpeg', 300_000)

    expect((await optimizeImageFile(original, 'product')).changed).toBe(false)
  })
})

describe('lo que no cabe se reduce, conservando la proporción', () => {
  it('escala el lado mayor al máximo del uso y el menor en la misma medida', async () => {
    // Una foto de teléfono típica: 4000 × 3000 y varios megabytes.
    conDecodificador(4000, 3000)
    const dibujadas = conLienzo({ bytes: 180_000 })

    const resultado = await optimizeImageFile(archivo('foto.jpg', 'image/jpeg', 6_000_000), 'logo')

    expect(resultado.changed).toBe(true)
    // 1200 de lado mayor y 900 de menor: la misma proporción 4:3.
    expect(resultado.width).toBe(MAX_SIDE.logo)
    expect(resultado.height).toBe(900)
    expect(dibujadas).toEqual([{ ancho: 1200, alto: 900 }])
  })

  it('cada uso tiene su máximo, y el banner el más alto', async () => {
    // El banner es la única imagen que se pinta al ancho completo de la
    // ventana; el logotipo se pinta a 44 px en el muro de marcas.
    expect(MAX_SIDE.logo).toBeLessThan(MAX_SIDE.category)
    expect(MAX_SIDE.category).toBeLessThan(MAX_SIDE.banner)
    expect(MAX_SIDE.banner).toBe(MAX_SIDE.product)
  })

  it('prefiere WebP, que es lo que de verdad ahorra', async () => {
    conDecodificador(3000, 3000)
    conLienzo({ bytes: 120_000 })

    const resultado = await optimizeImageFile(archivo('logo.png', 'image/png', 4_000_000), 'logo')

    expect(resultado.file.type).toBe('image/webp')
    // Y el nombre acompaña al tipo: un `.png` que contiene WebP es una trampa
    // para el siguiente que lo mire.
    expect(resultado.file.name).toBe('logo.webp')
  })

  it('sin WebP, un PNG con transparencia se queda en PNG y NO acaba en JPEG', async () => {
    // JPEG no tiene canal alfa: convertir ahí un logotipo con fondo
    // transparente le pone un fondo negro o blanco en la vitrina de otro.
    conDecodificador(3000, 3000)
    conLienzo({ bytes: 120_000, soporta: ['image/png', 'image/jpeg'] })

    const resultado = await optimizeImageFile(archivo('logo.png', 'image/png', 4_000_000), 'logo')

    expect(resultado.file.type).toBe('image/png')
    expect(resultado.changed).toBe(true)
  })
})

describe('si sale peor, se descarta', () => {
  it('un resultado más grande que el original no se sube', async () => {
    // Pasa de verdad con imágenes ya optimizadas al máximo: recomprimir añade
    // bytes. Una «optimización» que engorda el archivo es un fallo silencioso.
    conDecodificador(4000, 3000)
    conLienzo({ bytes: 900_000 })
    const original = archivo('foto.jpg', 'image/jpeg', 800_000)

    const resultado = await optimizeImageFile(original, 'product')

    expect(resultado.changed).toBe(false)
    expect(resultado.file).toBe(original)
  })
})

describe('si algo falla, se sube el original', () => {
  it('sin contexto de lienzo', async () => {
    conDecodificador(4000, 3000)
    conLienzo({ bytes: 100, sinContexto: true })
    const original = archivo('foto.jpg', 'image/jpeg', 6_000_000)

    expect((await optimizeImageFile(original, 'product')).file).toBe(original)
  })

  it('sin `toBlob`', async () => {
    conDecodificador(4000, 3000)
    conLienzo({ bytes: 100, sinToBlob: true })
    const original = archivo('foto.jpg', 'image/jpeg', 6_000_000)

    expect((await optimizeImageFile(original, 'product')).file).toBe(original)
  })

  it('si el navegador no puede decodificar la imagen', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('formato no soportado')
      }),
    )
    // Y sin `Image` tampoco hay respaldo: es el caso de jsdom sin nada.
    vi.stubGlobal('Image', undefined)
    const original = archivo('foto.jpg', 'image/jpeg', 6_000_000)

    const resultado = await optimizeImageFile(original, 'product')
    expect(resultado.file).toBe(original)
    expect(resultado.width).toBeNull()
  })

  it('y nunca lanza: el objetivo es que la tienda tenga su foto', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('vaya')
      }),
    )
    vi.stubGlobal('Image', undefined)

    await expect(
      optimizeImageFile(archivo('foto.jpg', 'image/jpeg', 6_000_000), 'banner'),
    ).resolves.toBeDefined()
  })
})

describe('lo que no es un mapa de bits no se redibuja', () => {
  it.each(['image/svg+xml', 'image/gif', 'application/pdf', ''])('%s se sube tal cual', async (tipo) => {
    // Un SVG es código y no está entre los tipos aceptados en ningún flujo;
    // aquí ni se intenta, porque un vector no se «redimensiona» a píxeles sin
    // perder justo lo que lo hacía vector.
    const original = archivo('cosa', tipo, 9_000_000)
    const resultado = await optimizeImageFile(original, 'logo')

    expect(resultado.file).toBe(original)
    expect(resultado.changed).toBe(false)
  })
})

describe('leer las medidas', () => {
  it('usa `createImageBitmap` cuando existe, y lo cierra', async () => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 640, height: 480, close })),
    )

    expect(await readImageSize(new Blob([]))).toEqual({ width: 640, height: 480 })
    // Un bitmap sin cerrar es memoria retenida por cada imagen que se mire.
    expect(close).toHaveBeenCalled()
  })

  it('devuelve `null` donde no se puede leer, en vez de inventar un tamaño', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('Image', undefined)

    expect(await readImageSize(new Blob([]))).toBeNull()
  })
})
