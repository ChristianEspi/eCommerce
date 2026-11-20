/**
 * `invoice-pdf` — el PDF de un comprobante, para verlo DENTRO de la web.
 *
 * Nubefact lo sirve con `X-Frame-Options: SAMEORIGIN` y sin CORS: el navegador
 * no puede incrustarlo ni leerlo. Esta función lo trae del emisor y lo devuelve
 * a quien tiene derecho a verlo, para que el visor (pdf.js) lo dibuje.
 *
 * ## Quién lo puede ver
 *
 * Lo decide la BASE con la sesión de quien llama (`invoice_pdf_source`):
 * personal de la sociedad que ya lee comprobantes, o el comprador del pedido.
 * Aquí no se repite esa regla: si la base no da el enlace, no hay PDF.
 *
 * ## No es un proxy
 *
 * La URL sale de la fila del comprobante y la base solo la entrega si es del
 * emisor (nubefact.com / *.pse.pe, https). Aun así aquí se vuelve a comprobar,
 * no se siguen redirecciones y se exige `application/pdf` y un tamaño máximo.
 *
 * Sirve al backoffice y a la tienda («Mi cuenta»): admite los dos orígenes.
 */
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { AppError, badRequest, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { rejectUnknownFields, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'

const MAX_BYTES = 5_000_000
const PDF_URL = /^https:\/\/((www\.)?nubefact\.com|[a-z0-9-]+\.pse\.pe)\/[A-Za-z0-9/_.-]+\.pdf$/

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const handler = serveJson(
  {
    allowedOrigins: [
      ...parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
      ...parseAllowedOrigins(Deno.env.get('EBIM_STOREFRONT_ORIGINS')),
    ],
    service: 'invoice-pdf',
  },
  async ({ request, body, trace }) => {
    rejectUnknownFields(body, ['invoice_id'])
    const invoiceId = requireUuid(body, 'invoice_id')

    const { data, error } = await userClient(request, trace).rpc('invoice_pdf_source', { p_invoice_id: invoiceId })
    if (error) throw fromDatabaseError(error)
    const source = (data ?? {}) as { pdf_url?: unknown; filename?: unknown; title?: unknown }
    const url = typeof source.pdf_url === 'string' ? source.pdf_url : ''
    if (!PDF_URL.test(url)) throw badRequest('PDF_NO_DISPONIBLE', 'El comprobante aún no tiene PDF')

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 15_000)
    let response: Response
    try {
      response = await fetch(url, { redirect: 'manual', signal: abort.signal })
    } catch {
      throw new AppError('EMISOR_SIN_RESPUESTA', 'No se pudo traer el PDF del emisor', 502)
    } finally {
      clearTimeout(timer)
    }
    const type = response.headers.get('content-type') ?? ''
    if (response.status !== 200 || !type.toLowerCase().startsWith('application/pdf')) {
      await response.body?.cancel()
      throw new AppError('PDF_NO_DISPONIBLE', 'El emisor no devolvió el PDF', 502)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw new AppError('PDF_NO_DISPONIBLE', 'El PDF del emisor no tiene un tamaño válido', 502)
    }

    return {
      status: 200,
      body: {
        data: {
          filename: typeof source.filename === 'string' ? source.filename : 'comprobante.pdf',
          title: typeof source.title === 'string' ? source.title : '',
          content_base64: toBase64(bytes),
        },
      },
    }
  },
)

Deno.serve(handler)
