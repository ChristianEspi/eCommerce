import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Las cuatro subidas de imagen, con la reducción de V3 · P11 en medio.
 *
 * ## Qué defiende este archivo, y por qué importa tanto
 *
 * Meter un paso nuevo delante de cuatro flujos que ya funcionaban puede romper
 * tres cosas, y las tres se comprueban aquí:
 *
 *  1. **Que se suba lo REDUCIDO y una sola vez.** Un `upload` de más sería un
 *     objeto huérfano en el bucket por cada foto, y el original entero viajando
 *     por la red justo después de haberlo reducido.
 *  2. **Que la ruta lleve la extensión del archivo que de verdad se sube.** Si
 *     la conversión acabó en WebP y la ruta dice `.jpg`, el objeto queda con un
 *     tipo que no es el suyo y el navegador acaba adivinando.
 *  3. **Que el tenant de la ruta no cambie.** Los dos primeros segmentos son
 *     los que autoriza la policy de Storage y los que exige el CHECK de la
 *     tabla: una ruta con otro orden no se sube ni se guarda, y este paso nuevo
 *     no puede tocarlos.
 *
 * Y la cuarta, que es la que justifica el orden elegido: **una foto de teléfono
 * de 6 MB ahora se sube**. Antes se rechazaba por tamaño aunque reducida pesara
 * doscientos kilobytes, y el producto se quedaba sin foto.
 */

const ORG = 'aaaa1111-1111-4111-8111-111111111111'
const COMPANY = 'bbbb1111-1111-4111-8111-111111111111'
const STORE = 'cccc1111-1111-4111-8111-111111111111'
const PRODUCT = 'dddd1111-1111-4111-8111-111111111111'

/** Lo que el doble de Supabase apuntó. */
const subidas: { bucket: string; path: string; contentType: string; size: number }[] = []

const holder = vi.hoisted(() => ({ falloDeInsert: false }))

vi.mock('@/shared/lib/supabase', () => {
  const storage = {
    from: (bucket: string) => ({
      upload: (path: string, file: File, opciones: { contentType: string }) => {
        subidas.push({ bucket, path, contentType: opciones.contentType, size: file.size })
        return Promise.resolve({ error: null })
      },
      createSignedUrls: () => Promise.resolve({ data: [], error: null }),
    }),
  }
  const client = {
    storage,
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve(
              holder.falloDeInsert
                ? { data: null, error: { code: '42501', message: 'no' } }
                : {
                    data: {
                      id: 'eeee1111-1111-4111-8111-111111111111',
                      product_id: PRODUCT,
                      store_id: STORE,
                      storage_path: subidas.at(-1)?.path ?? '',
                      alt: null,
                      position: 0,
                      is_primary: false,
                    },
                    error: null,
                  },
            ),
        }),
      }),
    }),
  }
  return {
    getSupabaseClient: () => client,
    tryGetSupabaseClient: () => client,
    getStorefrontClient: () => client,
    tryGetStorefrontClient: () => client,
    tryGetStorefrontRpcClient: () => client,
  }
})

const { uploadProductImage } = await import('./api/images')
const { uploadBrandLogo } = await import('./api/brandLogos')
const { uploadCategoryImage } = await import('./api/categoryMedia')

/** Un archivo con tamaño declarado; el contenido no se lee. */
function archivo(nombre: string, tipo: string, bytes: number): File {
  const file = new File([new Uint8Array(1)], nombre, { type: tipo })
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

/** Un navegador que sabe leer imágenes grandes y escribir WebP pequeño. */
function conNavegadorQueReduce(width: number, height: number, bytesFinales: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: vi.fn() })),
  )
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') {
      return Object.getPrototypeOf(document).createElement.call(document, tag)
    }
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
      }),
      toBlob: (cb: (blob: Blob | null) => void, tipo: string) => {
        const blob = new Blob([new Uint8Array(1)], { type: tipo })
        Object.defineProperty(blob, 'size', { value: bytesFinales })
        cb(blob)
      },
    } as unknown as HTMLElement
  })
}

beforeEach(() => {
  subidas.length = 0
  holder.falloDeInsert = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('la foto de producto que antes se rechazaba', () => {
  it('se reduce y se sube, una sola vez y con su extensión real', async () => {
    // 4000 × 3000 y 6 MB: una foto de teléfono cualquiera. El tope de subida
    // son 5 MB, así que antes de P11 esto era un «archivo demasiado pesado».
    conNavegadorQueReduce(4000, 3000, 220_000)

    await uploadProductImage({
      organizationId: ORG,
      companyId: COMPANY,
      storeId: STORE,
      productId: PRODUCT,
      file: archivo('IMG_2041.jpg', 'image/jpeg', 6 * 1024 * 1024),
      position: 0,
    })

    expect(subidas).toHaveLength(1)
    const subida = subidas[0]
    // Lo que viaja NO es el original de 6 MB: es el archivo reescrito.
    expect(subida?.size).toBeLessThan(6 * 1024 * 1024)
    expect(subida?.contentType).toBe('image/webp')
    // La ruta dice lo que el objeto es.
    expect(subida?.path.endsWith('.webp')).toBe(true)
    // Y el tenant de la ruta es el de siempre: es lo que autoriza la policy.
    expect(subida?.path.startsWith(`${ORG}/${STORE}/${PRODUCT}/`)).toBe(true)
  })

  it('una foto que ya cabe se sube intacta: ni se recomprime ni cambia de tipo', async () => {
    conNavegadorQueReduce(900, 600, 10)

    await uploadProductImage({
      organizationId: ORG,
      companyId: COMPANY,
      storeId: STORE,
      productId: PRODUCT,
      file: archivo('ya-optimizada.jpg', 'image/jpeg', 180_000),
      position: 0,
    })

    expect(subidas).toHaveLength(1)
    // El MISMO archivo: mismo tamaño y mismo tipo, sin pasar por el lienzo.
    expect(subidas[0]?.size).toBe(180_000)
    expect(subidas[0]?.contentType).toBe('image/jpeg')
    expect(subidas[0]?.path.endsWith('.jpg')).toBe(true)
  })

  it('sin `canvas` se sube el original, no se pierde la foto', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('Image', undefined)

    await uploadProductImage({
      organizationId: ORG,
      companyId: COMPANY,
      storeId: STORE,
      productId: PRODUCT,
      file: archivo('foto.png', 'image/png', 400_000),
      position: 0,
    })

    expect(subidas).toHaveLength(1)
    expect(subidas[0]?.contentType).toBe('image/png')
  })
})

describe('el logotipo de marca y la foto de familia, igual', () => {
  it('el logotipo se reduce a su máximo y conserva el tenant en la ruta', async () => {
    conNavegadorQueReduce(3000, 3000, 30_000)

    const path = await uploadBrandLogo({
      organizationId: ORG,
      companyId: COMPANY,
      file: archivo('marca.png', 'image/png', 3 * 1024 * 1024),
    })

    expect(subidas).toHaveLength(1)
    expect(subidas[0]?.size).toBeLessThan(3 * 1024 * 1024)
    // La ruta del logotipo lleva `company/` entre los dos identificadores: es
    // la que autoriza la policy y la que exige el CHECK de la tabla de marcas.
    expect(path.startsWith(`${ORG}/company/${COMPANY}/brands/`)).toBe(true)
    expect(path.endsWith('.webp')).toBe(true)
  })

  it('la foto de familia también, y sin subir dos veces', async () => {
    conNavegadorQueReduce(3600, 2400, 90_000)

    const path = await uploadCategoryImage({
      organizationId: ORG,
      storeId: STORE,
      file: archivo('familia.jpg', 'image/jpeg', 4 * 1024 * 1024),
    })

    expect(subidas).toHaveLength(1)
    expect(subidas[0]?.size).toBeLessThan(4 * 1024 * 1024)
    expect(path.startsWith(`${ORG}/${STORE}/`)).toBe(true)
  })
})
