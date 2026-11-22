/**
 * order-intake — el pedido desde una foto, un PDF o un texto libre (2026-11-19).
 *
 * Un comprador B2B no repone tecleando SKU: tiene la orden de compra de su
 * sistema en PDF, una foto de la lista que le dejó el almacén o un mensaje
 * «3 cajas de donecil 10 y un doxiplus». Esta función convierte eso en líneas
 * del pedido rápido para que la persona las revise y las mande al carrito.
 *
 * ## El orden, y quién decide qué
 *
 *  1. **Sesión y freno por comprador** (`ai_intake_check`): sin sesión no se lee
 *     nada —el SKU no es público— y una sesión no puede comerse la cuota de la
 *     tienda subiendo fotos en bucle.
 *  2. **El archivo se valida aquí** (tipo de lista cerrada, firma de bytes,
 *     tamaño) antes de gastar cuota. No se guarda: viaja al proveedor y se
 *     descarta.
 *  3. **El modelo LEE** (`ejecutarIA` · funcionalidad `intake`, cuota de la
 *     tienda). Devuelve texto, cantidad, unidad y un SKU solo si estaba escrito.
 *  4. **El catálogo DECIDE** qué producto es cada línea, con el buscador de la
 *     vitrina y reglas deterministas (`proponerLinea`). El modelo no ve el
 *     catálogo y no puede nombrar un producto.
 *  5. **No se escribe nada.** La respuesta son propuestas; el pedido rápido las
 *     valida (`resolve_order_lines_for_slug`) y el carrito aplica precio,
 *     surtido, existencia y crédito, como siempre.
 *
 * Sin proveedor, sin cuota o con el modelo caído responde 200 con `data: null`
 * y el motivo tipado: el pedido rápido de siempre sigue en la misma pantalla.
 *
 * ## `purpose: 'quote'` — «Mejora esta cotización» (2026-11-20)
 *
 * El archivo es la cotización de OTRO proveedor. Mismo camino, mismo freno y
 * misma cuota (funcionalidad `intake`); el modelo además copia el precio
 * unitario de cada línea, la moneda y si lleva IGV. Cada línea vuelve con
 * `precio_competencia`. El precio de ESTA tienda no sale de aquí: lo calcula
 * el servidor de precios con la sesión del comprador, como el carrito.
 */
import { assertNoTenantInPayload } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { AppError, badRequest, fromDatabaseError, unauthorized } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, rejectUnknownFields, requireEnum, requireSlug } from '../_shared/validation.ts'
import { serviceClient, userClient } from '../_runtime/clients.ts'
import { errorCode } from '../_shared/observability/logger.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeTienda } from '../_runtime/aiMeter.ts'
import { delimitarDatos, sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA, type ResultadoIA } from '../_shared/aiPipeline.ts'
import { resumenAdjuntos, validarAdjunto, type AdjuntoIA } from '../_shared/aiAttachments.ts'
import {
  ESQUEMA_COTIZACION,
  ESQUEMA_INTAKE,
  INTAKE_MAX_PRESENTACIONES,
  INTAKE_MAX_TEXTO,
  SISTEMA_COTIZACION,
  SISTEMA_INTAKE,
  agruparPresentaciones,
  conPresentaciones,
  consultaDeLinea,
  leerResolucion,
  palabraPrincipal,
  propuestaPorCodigo,
  type CodigoResuelto,
  type LineaLeida,
  proponerLinea,
  resumenIntake,
  revisarCotizacion,
  revisarIntake,
  type CotizacionRevisada,
  type FilaVariante,
  type HitCatalogo,
  type LecturaRevisada,
  type LineaLeidaCotizacion,
  type LineaPropuesta,
  type Presentacion,
  type RespuestaModeloCotizacion,
  type RespuestaModeloIntake,
  type ResultadoBusqueda,
} from '../_shared/aiIntake.ts'
import { sanitizeTextForModel } from '../_shared/observability/redact.ts'

const FEATURE = 'intake'
const ALLOWED_FIELDS = ['store_slug', 'text', 'file', 'locale', 'purpose'] as const
const LOCALES = ['es', 'en'] as const
const PURPOSES = ['order', 'quote'] as const

/** Un PDF de 6 MB en base64 son ~8 MB; con el resto del JSON, este techo. */
const MAX_BODY_BYTES = 9_500_000

/**
 * Búsquedas en paralelo por tanda: 60 líneas no pueden ser 60 a la vez.
 *
 * 3 y no 6 (2026-11-20): en QAS cada búsqueda de miquimica tarda ~1,5 s sola
 * (calcula precio y foto del catálogo publicado); 5 a la vez se pisaban y
 * TODAS caían por statement timeout, y el pedido entero respondía 500.
 */
const TANDA = 3
const CANDIDATOS = 1 + 3

function motivoDeGuarda(reason: unknown): AppError {
  switch (reason) {
    case 'SIN_SESION':
      return unauthorized('Inicia sesión para subir tu pedido')
    case 'RATE_LIMITED':
      return new AppError('RATE_LIMITED', 'Demasiados pedidos leídos en poco tiempo; prueba en unos minutos', 429)
    default:
      return badRequest('TIENDA_NO_DISPONIBLE', 'La tienda no está disponible')
  }
}

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_STOREFRONT_ORIGINS')),
    service: 'order-intake',
  },
  async ({ request, body, trace, logger }) => {
    const declarado = Number(request.headers.get('content-length') ?? '0')
    if (declarado > MAX_BODY_BYTES) {
      throw new AppError('ARCHIVO_DEMASIADO_GRANDE', 'El archivo supera el tamaño admitido', 413)
    }

    assertNoTenantInPayload(body)
    rejectUnknownFields(body, ALLOWED_FIELDS)
    const storeSlug = requireSlug(body, 'store_slug')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const texto = optionalText(body, 'text', INTAKE_MAX_TEXTO)
    const esCotizacion = (body.purpose === undefined ? 'order' : requireEnum(body, 'purpose', PURPOSES)) === 'quote'

    const adjuntos: AdjuntoIA[] = []
    if (body.file !== undefined && body.file !== null) {
      const file = body.file as Record<string, unknown>
      if (typeof file !== 'object' || Array.isArray(file)) {
        throw badRequest('CAMPO_INVALIDO', '`file` debe ser un objeto { media_type, data }')
      }
      const extra = Object.keys(file).filter((k) => k !== 'media_type' && k !== 'data')
      if (extra.length > 0) throw badRequest('CAMPO_NO_PERMITIDO', `Campo no permitido: ${extra[0]}`)
      const validado = validarAdjunto(file.media_type, file.data)
      if (!validado.ok) {
        throw new AppError(validado.motivo, 'El archivo no se puede leer', validado.motivo === 'ARCHIVO_DEMASIADO_GRANDE' ? 413 : 400)
      }
      adjuntos.push(validado.adjunto)
    }
    if (!texto && adjuntos.length === 0) {
      throw badRequest('PEDIDO_VACIO', 'Sube una foto o un PDF, o escribe tu pedido')
    }

    // 1 · Sesión del comprador y su freno. Con SU JWT: la base sabe quién es.
    const usuario = userClient(request, trace)
    const { data: guarda, error: errorGuarda } = await usuario.rpc('ai_intake_check', { p_store_slug: storeSlug })
    if (errorGuarda) throw fromDatabaseError(errorGuarda)
    if ((guarda as { allowed?: unknown } | null)?.allowed !== true) {
      throw motivoDeGuarda((guarda as { reason?: unknown } | null)?.reason)
    }

    // 2 · Leer. La cuota es de la tienda (resuelta en SQL desde el slug).
    const medidor = medidorDeTienda(serviceClient(trace), storeSlug)
    const instruccion = [
      `Idioma de las notas: ${locale === 'en' ? 'inglés' : 'español'}.`,
      texto
        ? delimitarDatos(esCotizacion ? 'cotizacion_escrita' : 'pedido_escrito', sanitizeTextForModel(texto, INTAKE_MAX_TEXTO) ?? '')
        : esCotizacion
          ? 'La cotización está en el archivo adjunto.'
          : 'El pedido está en el archivo adjunto.',
    ].join('\n\n')

    const resumenEntrada = `${resumenAdjuntos(adjuntos)}${texto ? ` · texto ${texto.length} car.` : ''}`
    const puertos = { hayProveedor: hayProveedorIA, consumir: medidor.consumir, registrar: medidor.registrar }

    const lectura: ResultadoIA<LecturaRevisada | CotizacionRevisada> =
      esCotizacion
        ? await ejecutarIA<RespuestaModeloCotizacion, CotizacionRevisada>(
            {
              feature: FEATURE,
              prompt: `cotización · ${resumenEntrada}`,
              revisar: (data) => {
                const revision = revisarCotizacion(data)
                if (!revision.ok) return { ok: false, motivo: revision.motivo }
                return { ok: true, value: revision.value, reply: `${revision.value.lineas.length} líneas cotizadas leídas` }
              },
            },
            {
              ...puertos,
              llamar: () =>
                pedirJson<RespuestaModeloCotizacion>({
                  feature: FEATURE,
                  system: sistemaConFrontera(SISTEMA_COTIZACION),
                  user: instruccion,
                  schema: ESQUEMA_COTIZACION,
                  adjuntos,
                }),
            },
          )
        : await ejecutarIA<RespuestaModeloIntake, LecturaRevisada>(
            {
              feature: FEATURE,
              prompt: `pedido · ${resumenEntrada}`,
              revisar: (data) => {
                const revision = revisarIntake(data)
                if (!revision.ok) return { ok: false, motivo: revision.motivo }
                return { ok: true, value: revision.value, reply: `${revision.value.lineas.length} líneas leídas` }
              },
            },
            {
              ...puertos,
              llamar: () =>
                pedirJson<RespuestaModeloIntake>({
                  feature: FEATURE,
                  system: sistemaConFrontera(SISTEMA_INTAKE),
                  user: instruccion,
                  schema: ESQUEMA_INTAKE,
                  adjuntos,
                }),
            },
          )

    if (!lectura.data) {
      return { status: 200, body: { data: cuerpoIA({ ...lectura, data: null }) } }
    }

    // 3 · Decidir el producto de cada línea con el catálogo, sin modelo.
    //     Con la sesión del comprador (`authenticated`), no con `anon`: el
    //     buscador es el mismo, público y `security definer`, pero `anon`
    //     corta a los 3 s y `authenticated` a los 8 s. No da más permiso que
    //     el que el comprador ya tiene en la tienda.
    const catalogo = usuario
    async function buscar(consulta: string): Promise<ResultadoBusqueda> {
      if (consulta.length < 2) return { mode: 'empty', items: [] }
      try {
        return await buscarEnCatalogo(consulta)
      } catch (error) {
        // Una búsqueda caída no tumba el pedido: esa línea sale «sin
        // coincidencia» y la persona la resuelve a mano. El resto sigue.
        logger.warn('intake.search_failed', { original_code: errorCode(error) })
        return { mode: 'empty', items: [] }
      }
    }
    async function buscarEnCatalogo(consulta: string): Promise<ResultadoBusqueda> {
      const { data, error } = await catalogo.rpc('catalog_search_for_slug', {
        p_store_slug: storeSlug,
        p_query: consulta,
        p_filters: {},
        p_sort: 'relevance',
        p_limit: CANDIDATOS,
        p_offset: 0,
      })
      if (error) throw fromDatabaseError(error)
      const mode = (['fts', 'fuzzy', 'browse', 'empty'] as const).find((m) => m === data?.mode) ?? 'empty'
      const items = (Array.isArray(data?.items) ? data.items : []) as Array<Record<string, unknown>>
      return {
        mode,
        items: items
          .filter((it) => typeof it.product_id === 'string' && typeof it.name === 'string')
          .map(
            (it): HitCatalogo => ({
              product_id: String(it.product_id),
              slug: String(it.slug ?? ''),
              name: String(it.name),
              sku: typeof it.sku === 'string' && it.sku ? it.sku : null,
              kind: it.kind === 'variant' || it.kind === 'bundle' ? it.kind : 'simple',
              brand_name: typeof it.brand_name === 'string' ? it.brand_name : null,
              in_stock: Boolean(it.in_stock),
            }),
          ),
      }
    }

    const leidas = lectura.data.lineas

    /**
     * 2026-11-22 · Los códigos leídos, verificados con el MISMO verificador del
     * pedido rápido, que reconoce también el SKU de una presentación. Una sola
     * llamada con la sesión del comprador: aplica su surtido y su tienda. Si
     * falla, cada línea sigue su camino por texto.
     */
    const codigosLeidos = [...new Set(leidas.flatMap((l) => (l.sku ? [l.sku] : [])))].slice(0, 100)
    let resueltos = new Map<string, CodigoResuelto>()
    if (codigosLeidos.length > 0) {
      const { data, error } = await catalogo.rpc('resolve_order_lines_for_slug', {
        p_store_slug: storeSlug,
        p_lines: codigosLeidos.map((sku) => ({ sku, quantity: 1 })),
      })
      if (error) logger.warn('intake.codes_failed', { original_code: errorCode(error) })
      else resueltos = leerResolucion(data)
    }

    /** Texto completo y, si no encuentra nada, el nombre comercial solo. */
    async function buscarLinea(linea: LineaLeida): Promise<{ busqueda: ResultadoBusqueda; porPalabra: boolean }> {
      const consulta = consultaDeLinea(linea) || linea.sku || ''
      const busqueda = await buscar(consulta)
      if (busqueda.items.length > 0 && busqueda.mode !== 'empty') return { busqueda, porPalabra: false }
      const palabra = palabraPrincipal(consulta)
      if (!palabra) return { busqueda, porPalabra: false }
      const segunda = await buscar(palabra)
      return segunda.mode === 'fts' && segunda.items.length > 0
        ? { busqueda: segunda, porPalabra: true }
        : { busqueda, porPalabra: false }
    }

    const propuestas: Array<LineaPropuesta & { precio_competencia?: number | null; presentaciones?: Presentacion[] }> = []
    for (let i = 0; i < leidas.length; i += TANDA) {
      const tanda = leidas.slice(i, i + TANDA)
      const resultados = await Promise.all(tanda.map((linea) => buscarLinea(linea)))
      tanda.forEach((linea, j) => {
        const { busqueda, porPalabra } = resultados[j]
        const porTexto = proponerLinea(i + j, linea, busqueda, { codigoAjeno: esCotizacion, porPalabra })
        const codigo = linea.sku ? resueltos.get(linea.sku.toLowerCase()) : undefined
        const propuesta = codigo && linea.sku ? propuestaPorCodigo(porTexto, linea.sku, codigo) : porTexto
        // En cotización, cada línea lleva el precio que puso el OTRO proveedor.
        propuestas.push(
          esCotizacion
            ? { ...propuesta, precio_competencia: (linea as LineaLeidaCotizacion).precio ?? null }
            : propuesta,
        )
      })
    }
    /**
     * 2026-11-22 · Las presentaciones de cada producto con variantes, para
     * elegirlas en la misma fila. Antes la fila solo llevaba a la ficha y, al
     * volver, la lectura se había perdido.
     *
     * Con `serviceClient` porque el SKU de la variante no es legible con la
     * sesión del comprador; el alcance lo fija el `product_id`, que salió del
     * buscador de ESTA tienda (solo productos publicados en ella). El comprador
     * con sesión ya ve SKUs en el pedido rápido: no se le enseña nada nuevo.
     */
    const conVariantes = [
      ...new Set(
        propuestas.flatMap((p) => (conPresentaciones(p) ? [p.coincidencia!.product_id] : [])),
      ),
    ]
    if (conVariantes.length > 0) {
      const { data: filas, error } = await serviceClient(trace)
        .from('product_variants')
        .select('id, product_id, sku, name, position')
        .in('product_id', conVariantes)
        .eq('is_active', true)
        .order('position')
        .order('name')
        .limit(conVariantes.length * INTAKE_MAX_PRESENTACIONES)
      if (error) {
        // Sin presentaciones la fila vuelve a ofrecer la ficha: no tumba la lectura.
        logger.warn('intake.variants_failed', { original_code: errorCode(error) })
      } else {
        const porProducto = agruparPresentaciones((filas ?? []) as FilaVariante[])
        for (let k = 0; k < propuestas.length; k++) {
          const p = propuestas[k]
          if (!conPresentaciones(p)) continue
          propuestas[k] = { ...p, presentaciones: porProducto.get(p.coincidencia!.product_id) ?? [] }
        }
      }
    }

    const cotizacion =
      esCotizacion && 'moneda' in lectura.data
        ? { moneda: lectura.data.moneda, incluye_igv: lectura.data.incluyeIgv }
        : undefined

    return {
      status: 200,
      body: {
        data: {
          data: {
            lineas: propuestas,
            notas: lectura.data.notas,
            resumen: resumenIntake(propuestas),
            ...(cotizacion ? { cotizacion } : {}),
          },
          motivo: null,
          interaction_id: lectura.interactionId,
        },
      },
    }
  },
)

Deno.serve(handler)
