/**
 * Reducir imágenes ANTES de subirlas (Storefront V3 · P11).
 *
 * ## El problema, con números
 *
 * Una foto de teléfono actual son 3000 × 4000 px y entre 4 y 8 MB. La vitrina la
 * pinta a 400 px de ancho. El comercio sube el archivo entero, el bucket lo
 * guarda entero y cada visitante lo descarga entero — y si pasa del tope, el
 * formulario lo rechaza y el comercio se queda sin foto, que es peor.
 *
 * Aquí se reduce en el navegador, antes de subir: el lado mayor baja al máximo
 * razonable para el uso y el archivo pasa a pesar unas decenas de kilobytes. La
 * tienda se ve igual, el bucket ocupa una fracción y —lo que más importa— deja
 * de rechazarse la foto que el comercio tiene.
 *
 * ## Por qué en el cliente y no en un servicio
 *
 * Porque el stack no tiene generación de derivados y meter un servicio de
 * imágenes es infraestructura nueva, con su coste, su clave y su punto de fallo.
 * El navegador ya trae `createImageBitmap` y `canvas`, que es todo lo que hace
 * falta para una sola imagen bien dimensionada. Una sola imagen razonable es
 * mejor que un juego de derivados a medias con URLs que se rompen.
 *
 * ## Las cinco reglas que lo hacen seguro
 *
 * 1. **Si no hace falta, no se toca.** Una imagen que ya está por debajo del
 *    máximo se sube tal cual: recomprimir lo que ya estaba bien solo pierde
 *    calidad.
 * 2. **Si sale más grande, se descarta.** El resultado se compara con el
 *    original y gana el más pequeño. Una «optimización» que engorda el archivo
 *    es un fallo silencioso.
 * 3. **Si algo falla, se sube el original.** Sin `canvas`, sin
 *    `createImageBitmap`, con una imagen que el navegador no sabe decodificar o
 *    con la memoria justa: el camino de siempre sigue ahí. Nadie se queda sin
 *    subir su foto porque esta utilidad no pudo ayudar.
 * 4. **La proporción no se toca.** Ni recortes ni rellenos: eso lo decide quien
 *    pinta, no quien guarda.
 * 5. **Nada de SVG.** No está entre los tipos aceptados —un SVG es código— y
 *    aquí ni se intenta: un vector no se «redimensiona» a píxeles sin perder
 *    justo lo que lo hacía vector.
 *
 * ## WebP, con condición
 *
 * WebP es entre un 25 % y un 35 % más pequeño que JPEG a la misma calidad y
 * admite transparencia, así que sirve igual para un logotipo con fondo
 * transparente que para una foto. Se usa **solo si el navegador sabe
 * escribirlo** —se comprueba mirando el tipo del resultado, no la cadena del
 * agente— y solo si el archivo sale más pequeño. Si no, se mantiene el tipo de
 * origen; y un PNG con transparencia nunca se convierte a JPEG, que no la tiene.
 */

/** Tipos que esta utilidad sabe redibujar. El resto se sube tal cual. */
const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

/** Los que pueden traer transparencia y no pueden acabar en JPEG. */
const CON_ALFA = new Set(['image/png', 'image/webp', 'image/avif'])

/**
 * Calidad de la recompresión con pérdida.
 *
 * 0,82 es el punto donde, en fotos de producto, la diferencia deja de verse a
 * tamaño de pantalla y el archivo ya ha bajado la mayor parte de lo que va a
 * bajar. Por encima de 0,9 el ahorro se vuelve marginal; por debajo de 0,75
 * aparecen bloques en los degradados —el cielo de una foto de exterior o el
 * fondo de un estudio.
 */
const CALIDAD = 0.82

/**
 * El lado mayor máximo para cada uso, en píxeles.
 *
 * No son dogma: son el ancho al que de verdad se pinta cada cosa, multiplicado
 * por dos para pantallas de alta densidad, redondeado hacia arriba.
 *
 *  · `logo` 1200 — se pinta a 44 px en el muro de marcas y a 120 en la cabecera.
 *    Mil doscientos deja margen para una cabecera a sangre en un portátil
 *    retina y sigue siendo un archivo diminuto.
 *  · `category` 1800 — una puerta de familia ocupa como mucho media pantalla de
 *    escritorio, y la pieza principal del mosaico el doble de área.
 *  · `banner` 2400 — es la única imagen que se pinta al ancho COMPLETO de la
 *    ventana, así que necesita el máximo de la lista.
 *  · `product` 2400 — la galería de la ficha permite ampliar (lupa), y ahí sí se
 *    mira el detalle: recortarla a 1200 se notaría justo en el gesto en el que
 *    alguien está decidiendo si compra.
 */
export const MAX_SIDE: Record<ImageUse, number> = {
  logo: 1200,
  category: 1800,
  banner: 2400,
  product: 2400,
}

export type ImageUse = 'logo' | 'category' | 'banner' | 'product'

export interface OptimizedImage {
  /** El archivo que hay que subir: el reducido, o el original si no se tocó. */
  readonly file: File
  /** Ancho y alto reales, cuando se pudieron leer. */
  readonly width: number | null
  readonly height: number | null
  /** ¿Se reescribió el archivo? Sirve para decírselo a quien lo subió. */
  readonly changed: boolean
}

/** Las dimensiones de una imagen, o `null` si el navegador no puede leerlas. */
export async function readImageSize(
  file: Blob,
): Promise<{ width: number; height: number } | null> {
  // `createImageBitmap` es la vía directa y no necesita el DOM. Donde no exista
  // —navegadores viejos, jsdom— se cae a un `<img>` con una URL de objeto.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close?.()
      return size
    } catch {
      // Sigue al respaldo: un tipo que el decodificador no soporta no es un
      // error de programa.
    }
  }

  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') return null

  const url = URL.createObjectURL(file)
  try {
    return await new Promise<{ width: number; height: number } | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Deja la imagen lista para subir: reducida si hacía falta, intacta si no.
 *
 * **Nunca lanza.** Cualquier fallo devuelve el archivo original, porque el
 * objetivo es que la tienda tenga su foto, no que la foto sea perfecta.
 */
export async function optimizeImageFile(file: File, use: ImageUse): Promise<OptimizedImage> {
  const intacto: OptimizedImage = { file, width: null, height: null, changed: false }

  // Lo que no es un mapa de bits no se redibuja. (SVG no llega aquí: no está
  // entre los tipos aceptados en ningún flujo.)
  if (!RASTER.has(file.type)) return intacto

  const size = await readImageSize(file)
  if (!size || size.width <= 0 || size.height <= 0) return intacto

  const lado = Math.max(size.width, size.height)
  const limite = MAX_SIDE[use]
  const medidas: OptimizedImage = { file, width: size.width, height: size.height, changed: false }

  // Regla 1: si ya cabe, no se toca. Recomprimir lo que estaba bien solo pierde
  // calidad, y además haría un archivo nuevo por cada guardado.
  if (lado <= limite) return medidas

  const escala = limite / lado
  const ancho = Math.max(1, Math.round(size.width * escala))
  const alto = Math.max(1, Math.round(size.height * escala))

  const redibujado = await redibujar(file, ancho, alto)
  // Regla 3: sin lienzo o con un fallo de decodificación, el original.
  if (!redibujado) return medidas

  // Regla 2: gana el más pequeño. Una «optimización» que engorda es un fallo.
  if (redibujado.size >= file.size) return medidas

  const nombre = renombrar(file.name, redibujado.type)
  return {
    file: new File([redibujado], nombre, {
      type: redibujado.type,
      lastModified: file.lastModified,
    }),
    width: ancho,
    height: alto,
    changed: true,
  }
}

/** Dibuja la imagen a otro tamaño y devuelve el blob, o `null` si no se puede. */
async function redibujar(file: File, ancho: number, alto: number): Promise<Blob | null> {
  try {
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    if (!ctx) return null

    const fuente = await decodificar(file)
    if (!fuente) return null
    // Suavizado alto: al reducir mucho, el remuestreo rápido deja bordes
    // dentados que se ven sobre todo en texto dentro de la imagen.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(fuente, 0, 0, ancho, alto)
    cerrar(fuente)

    /**
     * Primero WebP, que es el que de verdad ahorra. Si el navegador no sabe
     * escribirlo, `toBlob` devuelve un PNG: se comprueba el tipo del resultado
     * —no la cadena del agente— y si no es WebP se vuelve a intentar con el
     * tipo de origen.
     */
    const webp = await aBlob(lienzo, 'image/webp')
    if (webp?.type === 'image/webp') return webp

    // Un PNG con transparencia no puede acabar en JPEG: perdería el fondo.
    const destino = CON_ALFA.has(file.type) ? 'image/png' : 'image/jpeg'
    return await aBlob(lienzo, destino)
  } catch {
    return null
  }
}

/** La imagen como algo que `drawImage` acepte. */
async function decodificar(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Al respaldo.
    }
  }
  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') return null

  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const elemento = new Image()
    elemento.onload = () => resolve(elemento)
    elemento.onerror = () => resolve(null)
    elemento.src = url
  })
  URL.revokeObjectURL(url)
  return img
}

function cerrar(fuente: ImageBitmap | HTMLImageElement): void {
  if ('close' in fuente && typeof fuente.close === 'function') fuente.close()
}

function aBlob(lienzo: HTMLCanvasElement, tipo: string): Promise<Blob | null> {
  if (typeof lienzo.toBlob !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    lienzo.toBlob((blob) => resolve(blob), tipo, CALIDAD)
  })
}

/** El nombre con la extensión que le corresponde al tipo nuevo. */
function renombrar(nombre: string, tipo: string): string {
  const extension = tipo === 'image/webp' ? 'webp' : tipo === 'image/png' ? 'png' : 'jpg'
  const base = nombre.replace(/\.[^.]+$/, '') || 'imagen'
  return `${base}.${extension}`
}
