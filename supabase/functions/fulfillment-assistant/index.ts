/**
 * fulfillment-assistant — Entregas con IA (fase 08 de EBIM_AI_SEQUENCE).
 *
 * Tres modos, los tres de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — entregas
 *              atrasadas, sin avance, fallidas, parciales, con incidencias del
 *              operador o pruebas de entrega fallidas; de la tienda o de una
 *              entrega (`fulfillment_id`).
 *  - `explain` (+ `question` opcional): la INTERPRETACIÓN IA con acciones de
 *              lista cerrada.
 *  - `message` (`fulfillment_id` obligatorio, `tone`, `notes?`): BORRADOR de un
 *              mensaje al cliente sobre su entrega. Nunca se envía.
 *
 * Lo que ve el modelo: solo `ai_fulfillment_facts` (SECURITY INVOKER, RLS de
 * quien llama, roles de `fulfillment` + módulo): sin dirección, contacto, guía
 * ni datos de quien recibió; las descripciones del operador van delimitadas.
 *
 * Lo que NO puede hacer: despachar, cancelar ni cambiar estados. No hay ningún
 * camino de escritura.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, optionalUuid, rejectUnknownFields, requireEnum, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_BORRADOR,
  MAX_NOTAS,
  MAX_PREGUNTA,
  TONOS,
  contextoExplicable,
  datosDeExplicacion,
  revisarBorrador,
  revisarExplicacion,
  sistemaExplicable,
  type BorradorModelo,
  type BorradorRevisado,
  type ExplicacionModelo,
  type ExplicacionRevisada,
} from '../_shared/aiExplain.ts'
import {
  CONFIG_ENTREGAS,
  ESQUEMA_ENTREGAS,
  SISTEMA_ENTREGAS,
  SISTEMA_MENSAJE_ENTREGA,
  contextoDeMensaje,
  datosDeMensaje,
  hayQueComunicar,
  hechosDeEntregas,
  prohibidoEnMensaje,
} from '../_shared/aiFulfillment.ts'

const FEATURE = 'fulfillment'
const ALLOWED_FIELDS = ['mode', 'store_id', 'fulfillment_id', 'locale', 'question', 'notes', 'tone'] as const
const MODES = ['signals', 'explain', 'message'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'fulfillment-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = requireUuid(body, 'store_id')
    const fulfillmentId = optionalUuid(body, 'fulfillment_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    const notes = optionalText(body, 'notes', MAX_NOTAS)
    const tone = body.tone === undefined ? 'formal' : requireEnum(body, 'tone', TONOS)
    if (mode !== 'explain' && question) throw badRequest('CAMPO_NO_PERMITIDO', '`question` solo vale en el modo `explain`')
    if (mode !== 'message' && (notes || body.tone !== undefined)) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`notes` y `tone` solo valen en el modo `message`')
    }
    if (mode === 'message' && !fulfillmentId) throw badRequest('CAMPO_REQUERIDO', 'El mensaje necesita `fulfillment_id`')

    const client = userClient(request, trace)
    // Guard de rol, módulo y tienda en SQL (403 antes de gastar); entrega
    // invisible o de otra tienda = 404.
    const { data: raw, error } = await client.rpc('ai_fulfillment_facts', {
      p_store_id: storeId,
      p_fulfillment_id: fulfillmentId,
    })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'La entrega no existe o no es visible')
    const hechos = hechosDeEntregas(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'La entrega no existe o no es visible')

    const system = sistemaExplicable(hechos)
    const sinIA = (motivo: 'vacia' | null) => ({
      status: 200,
      body: { data: { data: null, motivo, interaction_id: null, system } },
    })
    if (mode === 'signals') return sinIA(null)

    const medidor = medidorDeUsuario(client)
    const puertos = { hayProveedor: hayProveedorIA, consumir: medidor.consumir, registrar: medidor.registrar }

    if (mode === 'message') {
      // Una entrega cancelada no se comunica desde aquí: ni modelo ni cuota.
      if (!hayQueComunicar(hechos)) return sinIA('vacia')
      const resultado = await ejecutarIA<BorradorModelo, BorradorRevisado>(
        {
          feature: FEATURE,
          prompt: `entregas · mensaje · ${locale} · ${tone}`,
          revisar: (data) => {
            const r = revisarBorrador(data, contextoDeMensaje(hechos), notes, prohibidoEnMensaje)
            return r.ok ? { ok: true, value: r.value, reply: r.value.subject } : { ok: false, motivo: r.motivo }
          },
        },
        {
          ...puertos,
          llamar: () =>
            pedirJson<BorradorModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_MENSAJE_ENTREGA),
              user: datosDeMensaje(hechos, locale, tone, notes),
              schema: ESQUEMA_BORRADOR,
            }),
        },
      )
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
    }

    if (hechos.signals.length === 0 && !question) return sinIA('vacia')
    type ConContexto = ExplicacionRevisada & ReturnType<typeof contextoExplicable>
    const resultado = await ejecutarIA<ExplicacionModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `entregas · ${hechos.scope} · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const r = revisarExplicacion(data, hechos, CONFIG_ENTREGAS, Boolean(question))
          if (!r.ok) return { ok: false, motivo: r.motivo }
          return { ok: true, value: { ...r.value, ...contextoExplicable(hechos) }, reply: r.value.answer || r.value.overview }
        },
      },
      {
        ...puertos,
        llamar: () =>
          pedirJson<ExplicacionModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_ENTREGAS),
            user: datosDeExplicacion(hechos, CONFIG_ENTREGAS, locale, question),
            schema: ESQUEMA_ENTREGAS,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
