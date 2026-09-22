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
 *     tiene contratado `ai.catalog.copy` y el módulo `catalog`, y que el ROL
 *     puede redactar fichas (owner/admin/catalog). Si no, no se llama al
 *     modelo: cobrar una acción para no llamar a nadie es cobrar por nada.
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
 * un motivo tipado (`AiErrorKind`) más el `interaction_id` para el pulgar en
 * contexto. El recorrido es el común de `_shared/aiPipeline.ts`. Quien pidió el borrador se queda como estaba, que es exactamente
 * donde estaba antes de pulsar. Un botón que revienta la pantalla es peor que un
 * botón que no trae nada.
 *
 * ## Dos modos, una funcionalidad (fase 03)
 *
 *  - `draft` (por defecto, contrato previo): `{ draft, motivo, interaction_id }`.
 *  - `assist`: asistente de ficha (`_shared/aiPim.ts`). Título, descripciones,
 *    SEO, categoría, atributos faltantes, normalización, duplicados y
 *    etiquetas en UNA llamada (una unidad de cuota). Categorías, atributos y
 *    candidatos se leen aquí con el JWT de quien pide y viajan al modelo como
 *    lista cerrada con referencias; lo que no está en la lista no sale. Lo
 *    determinista (atributos faltantes, candidatos por similitud) viaja en
 *    `system` SIEMPRE, haya IA o no. Nada se guarda: aplicar es de una persona.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalUuid, rejectUnknownFields, requireEnum, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_PIM,
  PIM_MAX_TOKENS,
  PIM_TASKS,
  PIM_TIMEOUT_MS,
  SISTEMA_PIM,
  construirContexto,
  datosParaPim,
  isPimTask,
  resumenParaTraza,
  revisarSugerencias,
  sistemaParaFront,
  tareasEfectivas,
  tokensDeBusqueda,
  type PimTask,
  type RespuestaModeloPim,
  type SugerenciasPim,
} from '../_shared/aiPim.ts'
import {
  ESQUEMA_FICHA,
  SISTEMA_FICHA,
  datosDeProducto,
  revisarBorrador,
} from '../_shared/aiCopy.ts'

const FEATURE = 'catalog.copy'
const ALLOWED_FIELDS = ['product_id', 'mode', 'tasks', 'store_id', 'locale'] as const
const MODES = ['draft', 'assist'] as const
const LOCALES = ['es', 'en'] as const

type Cliente = ReturnType<typeof userClient>
type Filas = ReadonlyArray<Record<string, unknown>>

/** `tasks` ausente = todas. Una tarea desconocida es un error del cliente. */
function leerTareas(body: Record<string, unknown>): PimTask[] {
  if (body.tasks === undefined) return [...PIM_TASKS]
  const crudo = body.tasks
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > PIM_TASKS.length) {
    throw badRequest('TAREAS_INVALIDAS', '`tasks` debe ser una lista no vacia de tareas conocidas')
  }
  if (!crudo.every(isPimTask)) {
    throw badRequest('TAREAS_INVALIDAS', `Tareas admitidas: ${PIM_TASKS.join(', ')}`)
  }
  return [...new Set(crudo)]
}

async function leer(
  consulta: PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>,
): Promise<Filas> {
  const { data, error } = await consulta
  if (error) throw fromDatabaseError(error)
  return Array.isArray(data) ? (data as Filas) : []
}

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
    const mode = body.mode === undefined ? 'draft' : requireEnum(body, 'mode', MODES)
    if (
      mode === 'draft' &&
      (body.tasks !== undefined || body.store_id !== undefined || body.locale !== undefined)
    ) {
      throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `draft` solo admite `product_id`')
    }

    const client = userClient(request, trace)

    if (mode === 'assist') {
      return await asistirFicha(client, {
        productId,
        storeId: optionalUuid(body, 'store_id'),
        tareas: leerTareas(body),
        locale: body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES),
      })
    }

    // La RLS decide. Si el producto es de otro tenant, esto no devuelve fila y
    // la respuesta es 404 — la misma que si no existiera, que es lo correcto:
    // distinguirlas confirma que existe.
    const { data: producto, error } = await client
      .from('admin_products')
      .select('id, sku, name, brand_name, category_name')
      .eq('id', productId)
      .maybeSingle()

    if (error) throw fromDatabaseError(error)
    // Código estable primero: sin él, el texto viajaba como `code` y el navegador
    // no lo sabía traducir. Lo encontró `npm run check:edge`.
    if (!producto) throw notFound('PRODUCTO_NO_ENCONTRADO', 'El producto no existe o no es de esta sociedad')

    const medidor = medidorDeUsuario(client)

    const resultado = await ejecutarIA<{ description?: unknown }, string>(
      {
        feature: FEATURE,
        prompt: `${producto.sku} · ${producto.name}`,
        // El estado que se guarda distingue lo que puede pasar: `bloqueada` es
        // el candado sanitario y `vacia` es que no hubo con qué redactar.
        revisar: (data) => {
          const revisado = revisarBorrador(data.description)
          if (revisado.ok) return { ok: true, value: revisado.description, reply: revisado.description }
          return { ok: false, motivo: revisado.motivo === 'clinica' ? 'bloqueada' : 'vacia' }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<{ description?: unknown }>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_FICHA),
            user: datosDeProducto({
              name: String(producto.name ?? ''),
              brandName: (producto.brand_name as string | null) ?? null,
              categoryName: (producto.category_name as string | null) ?? null,
              sku: String(producto.sku ?? ''),
            }),
            schema: ESQUEMA_FICHA,
          }),
      },
    )

    return {
      status: 200,
      body: {
        data: {
          draft: resultado.data,
          // Compatibilidad: la pantalla de fichas ya entendía `clinica`.
          motivo: resultado.motivo === 'bloqueada' ? 'clinica' : resultado.motivo,
          interaction_id: resultado.interactionId,
        },
      },
    }
  },
)

/**
 * Modo `assist`. Todo se lee con el JWT de quien pide: la lista cerrada que ve
 * el modelo es, por construcción, lo que esa persona ya puede ver.
 */
async function asistirFicha(
  client: Cliente,
  peticion: { productId: string; storeId: string | null; tareas: PimTask[]; locale: 'es' | 'en' },
) {
  const { data: producto, error } = await client
    .from('admin_product_masters')
    .select('id, sku, name, description, kind, brand_name, family_name, origin_store_id')
    .eq('id', peticion.productId)
    .maybeSingle()
  if (error) throw fromDatabaseError(error)
  if (!producto) throw notFound('PRODUCTO_NO_ENCONTRADO', 'El producto no existe o no es de esta sociedad')

  const fila = producto as Record<string, unknown>
  const storeId =
    peticion.storeId ?? (typeof fila.origin_store_id === 'string' ? fila.origin_store_id : null)
  const quiere = (t: PimTask) => peticion.tareas.includes(t)
  const nombre = typeof fila.name === 'string' ? fila.name : ''
  const vacio = Promise.resolve([] as Filas)

  const [categorias, publicacion, atributos, opciones, valores, similares] = await Promise.all([
    quiere('category') && storeId
      ? leer(
          client
            .from('categories')
            .select('id, parent_id, name, is_active')
            .eq('store_id', storeId)
            .limit(400),
        )
      : vacio,
    storeId
      ? leer(
          client
            .from('store_products')
            .select('category_id')
            .eq('product_id', peticion.productId)
            .eq('store_id', storeId)
            .limit(1),
        )
      : vacio,
    quiere('attributes')
      ? leer(
          client
            .from('attributes')
            .select('id, code, name, data_type, unit, is_variant_axis, is_active, position')
            .eq('is_active', true)
            .limit(200),
        )
      : vacio,
    quiere('attributes')
      ? leer(
          client
            .from('attribute_values')
            .select('id, attribute_id, label, is_active, position')
            .eq('is_active', true)
            .limit(2000),
        )
      : vacio,
    quiere('attributes')
      ? leer(
          client
            .from('product_attribute_values')
            .select('attribute_id, value_id, value_text, value_number, value_boolean, value_date')
            .eq('product_id', peticion.productId),
        )
      : vacio,
    quiere('duplicates') ? buscarParecidos(client, peticion.productId, nombre) : vacio,
  ])

  const categoriaActual = publicacion[0]?.category_id
  const contexto = construirContexto({
    producto: fila,
    categoriaActualId: typeof categoriaActual === 'string' ? categoriaActual : null,
    categorias,
    atributos,
    opciones,
    valores,
    similares,
  })
  const tareas = tareasEfectivas(peticion.tareas, contexto)
  const system = sistemaParaFront(contexto, tareas)

  // Nada que pedir con estos datos: ni modelo ni cuota.
  if (tareas.length === 0) {
    return {
      status: 200,
      body: { data: { data: null, motivo: 'vacia', interaction_id: null, system } },
    }
  }

  const medidor = medidorDeUsuario(client)
  const resultado = await ejecutarIA<RespuestaModeloPim, SugerenciasPim>(
    {
      feature: FEATURE,
      prompt: `ficha · ${contexto.producto.sku} · ${contexto.producto.name} · ${tareas.join(',')}`,
      revisar: (data) => {
        const revision = revisarSugerencias(data, contexto, tareas)
        if (!revision.ok) return { ok: false, motivo: revision.motivo }
        return { ok: true, value: revision.value, reply: resumenParaTraza(revision.value) }
      },
    },
    {
      hayProveedor: hayProveedorIA,
      consumir: medidor.consumir,
      registrar: medidor.registrar,
      llamar: () =>
        pedirJson<RespuestaModeloPim>({
          feature: FEATURE,
          system: sistemaConFrontera(SISTEMA_PIM),
          user: datosParaPim(contexto, tareas, peticion.locale),
          schema: ESQUEMA_PIM,
          maxTokens: PIM_MAX_TOKENS,
          timeoutMs: PIM_TIMEOUT_MS,
        }),
    },
  )

  return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
}

/**
 * Candidatos a duplicado: prefiltro con `ilike` por las palabras largas del
 * nombre (saneadas a `[a-z]`, sin comas ni paréntesis que rompan el filtro) y
 * la similitud la calcula `construirContexto`, que es determinista.
 */
async function buscarParecidos(client: Cliente, productId: string, nombre: string): Promise<Filas> {
  const tokens = tokensDeBusqueda(nombre)
  if (tokens.length === 0) return []
  return await leer(
    client
      .from('admin_product_masters')
      .select('id, sku, name, brand_name')
      .neq('id', productId)
      .or(tokens.map((t) => `name.ilike.*${t}*`).join(','))
      .limit(40),
  )
}

Deno.serve(handler)
