/**
 * catalog-copy — redacta el borrador de la ficha de un producto.
 *
 * NO usa `service_role` para leer el producto: actúa con el JWT del usuario, así
 * que quien decide si puede verlo es la RLS. Un backoffice que redacta la ficha
 * de un producto de otro tenant no es una función de IA, es una fuga.
 *
 * ## El orden importa, y este es el orden
 *
 *  1. Sesión válida y no operador de suite.
 *  2. El producto EXISTE y es suyo — con su JWT.
 *  3. Se consume la cuota (`ai_consume`), que además comprueba que la sociedad
 *     tiene contratado `ai.catalog.copy`. Si no, no se llama al modelo: cobrar
 *     una acción para no llamar a nadie es cobrar por nada.
 *  4. Se llama al modelo.
 *  5. Se revisa lo que devolvió, se registra SIEMPRE en la traza y solo entonces
 *     se responde.
 *
 * El paso 5 se hace incluso cuando falla: una llamada que no respondió cuesta lo
 * mismo y es la que más interesa mirar después.
 *
 * ## Se degrada, no se rompe
 *
 * Sin clave, sin cuota o con el modelo caído, responde 200 con `draft: null` y
 * un motivo. Quien pidió el borrador se queda como estaba, que es exactamente
 * donde estaba antes de pulsar. Un botón que revienta la pantalla es peor que un
 * botón que no trae nada.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { rejectUnknownFields, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { AI_DEFAULT_TIMEOUT_MS } from '../_shared/ai.ts'
import {
  ESQUEMA_FICHA,
  SISTEMA_FICHA,
  datosDeProducto,
  revisarBorrador,
} from '../_shared/aiCopy.ts'

const FEATURE = 'catalog.copy'
const ALLOWED_FIELDS = ['product_id'] as const

/** Por qué no hay borrador. Lo lee la pantalla para decir algo que se entienda. */
type Motivo = 'sin_proveedor' | 'sin_cuota' | 'sin_contratar' | 'vacia' | 'clinica' | 'proveedor'

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'catalog-copy',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const productId = requireUuid(body, 'product_id')

    const client = userClient(request, trace)

    // La RLS decide. Si el producto es de otro tenant, esto no devuelve fila y
    // la respuesta es 404 — la misma que si no existiera, que es lo correcto:
    // distinguirlas confirma que existe.
    const { data: producto, error } = await client
      .from('admin_products')
      .select('id, sku, name, brand_name, category_name')
      .eq('id', productId)
      .maybeSingle()

    if (error) throw fromDatabaseError(error)
    if (!producto) throw notFound('El producto no existe o no es de esta sociedad')

    const sinBorrador = (motivo: Motivo) => ({
      status: 200,
      body: { data: { draft: null, motivo } },
    })

    // Ni se mira la cuota si no hay proveedor: gastar una acción para no llamar
    // a nadie es cobrar por nada.
    if (!hayProveedorIA()) return sinBorrador('sin_proveedor')

    const { data: cuota, error: errorCuota } = await client.rpc('ai_consume', {
      p_feature: FEATURE,
      p_units: 1,
    })
    if (errorCuota) throw fromDatabaseError(errorCuota)

    const permitido = (cuota ?? {}) as Record<string, unknown>
    if (permitido.allowed !== true) {
      // `DISABLED` es «no lo tiene contratado» y lo demás es «se le acabó». La
      // pantalla dice cosas distintas: una se resuelve comprando y la otra
      // esperando al mes que viene.
      return sinBorrador(permitido.reason === 'DISABLED' ? 'sin_contratar' : 'sin_cuota')
    }

    const respuesta = await pedirJson<{ description?: unknown }>({
      system: SISTEMA_FICHA,
      user: datosDeProducto({
        name: String(producto.name ?? ''),
        brandName: (producto.brand_name as string | null) ?? null,
        categoryName: (producto.category_name as string | null) ?? null,
        sku: String(producto.sku ?? ''),
      }),
      schema: ESQUEMA_FICHA,
      maxTokens: 300,
      timeoutMs: AI_DEFAULT_TIMEOUT_MS,
    })

    const revisado = revisarBorrador(respuesta.data?.description)

    // El estado que se guarda distingue las tres cosas que pueden pasar, porque
    // son tres problemas distintos: `error` es el proveedor, `blocked` es el
    // candado sanitario y `search` es que no hubo con qué redactar.
    const estado = !respuesta.data
      ? 'error'
      : revisado.ok
        ? 'ai'
        : revisado.motivo === 'clinica'
          ? 'blocked'
          : 'search'

    await client.rpc('ai_record', {
      p_feature: FEATURE,
      p_status: estado,
      p_model: respuesta.model,
      p_prompt: `${producto.sku} · ${producto.name}`,
      p_reply: revisado.ok ? revisado.description : null,
      p_input_tokens: respuesta.usage.inputTokens,
      p_output_tokens: respuesta.usage.outputTokens,
      p_cache_read_tokens: respuesta.usage.cacheReadTokens,
      p_latency_ms: respuesta.latencyMs,
    })

    if (!respuesta.data) return sinBorrador('proveedor')
    if (!revisado.ok) return sinBorrador(revisado.motivo)

    return { status: 200, body: { data: { draft: revisado.description, motivo: null } } }
  },
)

Deno.serve(handler)
