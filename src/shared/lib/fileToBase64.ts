/**
 * Un archivo del navegador en base64, sin el prefijo `data:` (2026-11-19).
 *
 * Lo usan las lecturas con IA (pedido desde foto, ficha del proveedor): el
 * archivo viaja en el JSON a la Edge Function y allí se valida otra vez (tipo,
 * firma de bytes y tamaño) antes de gastar cuota. No se guarda en ningún sitio.
 */
export class FileReadError extends Error {
  constructor() {
    super('ARCHIVO_ILEGIBLE')
    this.name = 'FileReadError'
  }
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new FileReadError())
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.replace(/^data:[^;,]+;base64,/, ''))
    }
    reader.readAsDataURL(file)
  })
}
