/**
 * orders-assistant — Pedidos con IA (fase 04 de EBIM_AI_SEQUENCE).
 *
 * Cuatro modos, todos de SOLO LECTURA:
 *  - `signals`   (detalle, sin IA ni cuota): lo que el SISTEMA detecta en un
 *                pedido —bloqueos, faltantes, siguiente paso esperado—.
 *  - `order`     (detalle): resumen, explicación del estado, bloqueos,
 *                faltantes, siguiente paso, historial y respuesta a una
 *                pregunta («¿Por qué este pedido aún no se entrega?»).
 *  - `attention` (lista): lote pequeño (≤15) de pedidos abiertos que piden
 *                atención («¿Qué pedidos requieren atención?»).
 *  - `search`    (lista): lenguaje natural → FILTROS tipados → búsqueda
 *                controlada en SQL (≤25 filas). El modelo nunca escribe SQL.
 *
 * ## Lo que ve el modelo
 *
 * Solo `ai_order_facts` / `ai_orders_attention` (SECURITY INVOKER, RLS de quien
 * llama, roles de la funcionalidad `orders`, sin correos/teléfonos/direcciones)
 * y la frase de la persona, todo delimitado como dato no confiable. El tenant
 * sale del JWT; del body solo llegan ids que la RLS vuelve a filtrar.
 *
 * ## Lo que NO puede hacer
 *
 * Aprobar, cancelar, marcar pagado, despachar, reembolsar o tocar stock: esta
 * función no tiene ningún camino de escritura. Devuelve `suggested_action`
 * (lista cerrada, validada contra el estado real) y el front abre el flujo
 * normal, donde decide la persona y valida la base.
 *
 * ## Se degrada, no se rompe
 *
 * `ejecutarIA`: sin clave, sin contratar, sin cuota o con el proveedor caído
 * responde 200 con `data: null` y `motivo` tipado; el bloque `system`
 * (determinista) viaja igual, así la pantalla sigue diciendo algo útil.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, optionalUuid, rejectUnknownFields, requireEnum } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_ATENCION,
  ESQUEMA_BUSQUEDA,
  ESQUEMA_PEDIDO,
  MAX_ATENCION,
  MAX_PREGUNTA,
  SISTEMA_ATENCION,
  SISTEMA_BUSQUEDA,
  SISTEMA_PEDIDO,
  argumentosDeBusqueda,
  atencionDelSistema,
  contextoDePedido,
  datosDeAtencion,
  datosDeBusqueda,
  datosDelPedido,
  filasDeBusqueda,
  hechosDeAtencion,
  hechosDelPedido,
  revisarAtencion,
  revisarFiltros,
  revisarPedido,
  type AtencionModelo,
  type AtencionRevisada,
  type BusquedaModelo,
  type FiltrosPedido,
  type PedidoModelo,
  type PedidoRevisado,
} from '../_shared/aiOrders.ts'

const FEATURE = 'orders'
const ALLOWED_FIELDS = ['mode', 'order_id', 'store_id', 'locale', 'question'] as const
const MODES = ['signals', 'order', 'attention', 'search'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'orders-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const orderId = optionalUuid(body, 'order_id')
    const storeId = optionalUuid(body, 'store_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)

    const detalle = mode === 'signals' || mode === 'order'
    if (detalle && !orderId) throw badRequest('PEDIDO_REQUERIDO', 'Este modo exige `order_id`')
    if (detalle && storeId) throw badRequest('CAMPO_NO_PERMITIDO', 'Este modo no admite `store_id`')
    if (!detalle && !storeId) throw badRequest('TIENDA_REQUERIDA', 'Este modo exige `store_id`')
    if (!detalle && orderId) throw badRequest('CAMPO_NO_PERMITIDO', 'Este modo no admite `order_id`')
    if (mode === 'search' && !question) throw badRequest('PREGUNTA_REQUERIDA', 'El modo `search` exige `question`')
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    const medidor = medidorDeUsuario(client)
    const puertosBase = {
      hayProveedor: hayProveedorIA,
      consumir: medidor.consumir,
      registrar: medidor.registrar,
    }

    // -----------------------------------------------------------------------
    // Detalle de un pedido
    // -----------------------------------------------------------------------
    if (detalle) {
      const id = orderId as string
      // RLS + guard de rol en SQL: un rol sin la funcionalidad es 403 antes de
      // gastar nada; un pedido invisible es 404 (nunca «existe pero es ajeno»).
      const { data: raw, error } = await client.rpc('ai_order_facts', { p_order_id: id })
      if (error) throw fromDatabaseError(error)
      if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El pedido no existe o no es visible')
      const hechos = hechosDelPedido(raw)
      if (!hechos) throw notFound('NO_ENCONTRADO', 'El pedido no existe o no es visible')

      const system = { order_id: id, diagnosis: hechos.system, ...contextoDePedido(hechos) }
      if (mode === 'signals') {
        return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
      }

      type ConContexto = PedidoRevisado & ReturnType<typeof contextoDePedido>
      const resultado = await ejecutarIA<PedidoModelo, ConContexto>(
        {
          feature: FEATURE,
          prompt: `pedidos · detalle · ${locale}${question ? ` · ${question}` : ''}`,
          revisar: (data) => {
            const revision = revisarPedido(data, hechos, id, Boolean(question))
            if (!revision.ok) return { ok: false, motivo: revision.motivo }
            return {
              ok: true,
              value: { ...revision.value, ...contextoDePedido(hechos) },
              reply: revision.value.answer || revision.value.summary,
            }
          },
        },
        {
          ...puertosBase,
          llamar: () =>
            pedirJson<PedidoModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_PEDIDO),
              user: datosDelPedido(hechos, locale, question),
              schema: ESQUEMA_PEDIDO,
            }),
        },
      )
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
    }

    const tienda = storeId as string

    // -----------------------------------------------------------------------
    // Lote de atención
    // -----------------------------------------------------------------------
    if (mode === 'attention') {
      const { data: raw, error } = await client.rpc('ai_orders_attention', {
        p_store_id: tienda,
        p_limit: MAX_ATENCION,
      })
      if (error) throw fromDatabaseError(error)
      const hechos = hechosDeAtencion(raw)
      if (!hechos) throw fromDatabaseError(null)
      const system = {
        items: atencionDelSistema(hechos),
        total_open: hechos.metrics.total_open?.value ?? hechos.items.length,
        ...contextoDePedido(hechos),
      }
      // Cola vacía: ni modelo ni cuota. «Nada requiere atención» lo dice la base.
      if (hechos.items.length === 0) {
        return { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null, system } } }
      }

      type ConContexto = AtencionRevisada & ReturnType<typeof contextoDePedido>
      const resultado = await ejecutarIA<AtencionModelo, ConContexto>(
        {
          feature: FEATURE,
          prompt: `pedidos · atencion · ${locale}${question ? ` · ${question}` : ''}`,
          revisar: (data) => {
            const revision = revisarAtencion(data, hechos)
            if (!revision.ok) return { ok: false, motivo: revision.motivo }
            return {
              ok: true,
              value: { ...revision.value, ...contextoDePedido(hechos) },
              reply: revision.value.overview || revision.value.items.map((i) => i.ref).join(', '),
            }
          },
        },
        {
          ...puertosBase,
          llamar: () =>
            pedirJson<AtencionModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_ATENCION),
              user: datosDeAtencion(hechos, locale, question),
              schema: ESQUEMA_ATENCION,
            }),
        },
      )
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
    }

    // -----------------------------------------------------------------------
    // Búsqueda en lenguaje natural → filtros tipados → SQL controlado
    // -----------------------------------------------------------------------
    // Antes de gastar: la tienda y el rol se comprueban con una búsqueda vacía
    // de una fila. Así un 403 no cuesta una unidad de cuota.
    const frase = question as string
    const previa = await client.rpc('ai_orders_search', { p_store_id: tienda, p_limit: 1 })
    if (previa.error) throw fromDatabaseError(previa.error)

    const resultado = await ejecutarIA<BusquedaModelo, { filters: FiltrosPedido; discarded: number }>(
      {
        feature: FEATURE,
        prompt: `pedidos · busqueda · ${frase}`,
        revisar: (data) => {
          const revision = revisarFiltros(data, frase)
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return { ok: true, value: revision.value, reply: JSON.stringify(revision.value.filters) }
        },
      },
      {
        ...puertosBase,
        llamar: () =>
          pedirJson<BusquedaModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_BUSQUEDA),
            user: datosDeBusqueda(frase),
            schema: ESQUEMA_BUSQUEDA,
            // Traducir una frase a filtros es corto: no necesita el techo
            // del detalle.
            maxTokens: 1024,
            timeoutMs: 15000,
          }),
      },
    )

    if (!resultado.data) {
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system: null } } }
    }
    const { data: filas, error } = await client.rpc(
      'ai_orders_search',
      argumentosDeBusqueda(tienda, resultado.data.filters),
    )
    if (error) throw fromDatabaseError(error)
    const encontrados = filasDeBusqueda(filas)
    return {
      status: 200,
      body: {
        data: {
          ...cuerpoIA({ ...resultado, data: { ...resultado.data, ...encontrados } }),
          system: null,
        },
      },
    }
  },
)

Deno.serve(handler)
