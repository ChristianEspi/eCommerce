/**
 * Dibujar un PDF en canvas con pdf.js (2026-11-20).
 *
 * Por qué pdf.js y no un `<iframe>`: el visor del navegador no existe en
 * Android dentro de un iframe (descarga el archivo) y en iOS muestra solo la
 * primera página. Esta tienda es mobile-first; con pdf.js se ve igual en todas.
 *
 * Se importa bajo demanda (`import()`): pdf.js pesa y solo hace falta al abrir
 * un PDF. El worker sale del mismo origen (`worker-src 'self'`), y pdf.js 6 no
 * usa `eval`, así que la CSP no se afloja.
 */

export interface RenderedPage {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
}

type PdfJs = typeof import('pdfjs-dist')

let loader: Promise<PdfJs> | null = null

async function pdfjs(): Promise<PdfJs> {
  if (!loader) {
    loader = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })()
  }
  return loader
}

/**
 * Dibuja todas las páginas al ancho pedido (CSS px), nítidas en pantallas de
 * alta densidad. Devuelve los canvas para que el componente los coloque.
 */
export async function renderPdf(bytes: Uint8Array, cssWidth: number, maxPages = 30): Promise<RenderedPage[]> {
  const lib = await pdfjs()
  // pdf.js se queda con el buffer: se le pasa una copia para no vaciar el original.
  const task = lib.getDocument({ data: bytes.slice(), useSystemFonts: true })
  const doc = await task.promise
  try {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2)
    const pages: RenderedPage[] = []
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n += 1) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = (cssWidth / base.width) * ratio
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, viewport }).promise
      pages.push({ canvas, width: viewport.width / ratio, height: viewport.height / ratio })
    }
    return pages
  } finally {
    void task.destroy()
  }
}

/** Base64 → bytes (lo que devuelve la Edge Function). */
export function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
