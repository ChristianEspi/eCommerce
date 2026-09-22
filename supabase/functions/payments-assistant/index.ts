/**
 * payments-assistant — Pagos con IA (fase 08 de EBIM_AI_SEQUENCE).
 *
 * Dos modos, los dos de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — cobros fallidos,
 *              con tiempo agotado, autorizados sin capturar, devoluciones,
 *              liquidaciones sin cruzar o con diferencia, códigos de error más
 *              repetidos; de la tienda o de un cobro (`intent_id`).
 *  - `explain` (+ `question` opcional): la INTERPRETACIÓN IA — conciliación,
 *              errores y códigos técnicos explicados, acciones de lista cerrada.
 *
 * Lo que ve el modelo: solo `ai_payments_facts` (SECURITY INVOKER, RLS de quien
 * llama, roles de `payments` + módulo `payments`): CÓDIGOS de error, nunca el
 * detalle libre del proveedor; sin datos del comprador.
 *
 * Lo que NO puede hacer: marcar como pagado, capturar, anular, devolver ni
 * conciliar. No hay ningún camino de escritura.
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
  MAX_PREGUNTA,
  contextoExplicable,
  datosDeExplicacion,
  revisarExplicacion,
  sistemaExplicable,
  type ExplicacionModelo,
  type ExplicacionRevisada,
} from '../_shared/aiExplain.ts'
import { CONFIG_PAGOS, ESQUEMA_PAGOS, SISTEMA_PAGOS, hechosDePagos } from '../_shared/aiPayments.ts'

const FEATURE = 'payments'
const ALLOWED_FIELDS = ['mode', 'store_id', 'intent_id', 'locale', 'question'] as const
const MODES = ['signals', 'explain'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'payments-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = requireUuid(body, 'store_id')
    const intentId = optionalUuid(body, 'intent_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    // Guard de rol, módulo y tienda en SQL (403 antes de gastar); cobro
    // invisible o de otra tienda = 404.
    const { data: raw, error } = await client.rpc('ai_payments_facts', { p_store_id: storeId, p_intent_id: intentId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El cobro no existe o no es visible')
    const hechos = hechosDePagos(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'El cobro no existe o no es visible')

    const system = sistemaExplicable(hechos)
    if (mode === 'signals' || (hechos.signals.length === 0 && !question)) {
      // Sin señales y sin pregunta no hay qué explicar: ni modelo ni cuota.
      const motivo = mode === 'signals' ? null : 'vacia'
      return { status: 200, body: { data: { data: null, motivo, interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    type ConContexto = ExplicacionRevisada & ReturnType<typeof contextoExplicable>
    const resultado = await ejecutarIA<ExplicacionModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `pagos · ${hechos.scope} · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const r = revisarExplicacion(data, hechos, CONFIG_PAGOS, Boolean(question))
          if (!r.ok) return { ok: false, motivo: r.motivo }
          return { ok: true, value: { ...r.value, ...contextoExplicable(hechos) }, reply: r.value.answer || r.value.overview }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<ExplicacionModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_PAGOS),
            user: datosDeExplicacion(hechos, CONFIG_PAGOS, locale, question),
            schema: ESQUEMA_PAGOS,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
