/**
 * credit-assistant — Cobranza con IA (fase 08 de EBIM_AI_SEQUENCE).
 *
 * Tres modos, los tres de SOLO LECTURA:
 *  - `signals`  (sin IA ni cuota): el CÁLCULO DEL SISTEMA — deuda, tramos,
 *               documentos vencidos, cobros sin aplicar y señales por regla, de
 *               la cartera o de un cliente (`customer_id`).
 *  - `explain`  (+ `question` opcional): la INTERPRETACIÓN IA de ese cálculo,
 *               con acciones de seguimiento de lista cerrada.
 *  - `reminder` (`customer_id` obligatorio, `tone`, `notes?`): BORRADOR de un
 *               recordatorio de pago. Nunca se envía.
 *
 * Lo que ve el modelo: solo `ai_collections_facts` (SECURITY INVOKER, RLS de
 * quien llama, roles de `credit` + `credit.management`) delimitado como dato no
 * confiable. El tenant sale del JWT.
 *
 * Lo que NO puede hacer: cambiar el límite, bloquear, desbloquear ni aprobar
 * excepciones. No hay ningún camino de escritura.
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
  CONFIG_CREDITO,
  ESQUEMA_COBRANZA,
  SISTEMA_COBRANZA,
  SISTEMA_RECORDATORIO,
  contextoDeRecordatorio,
  datosDeRecordatorio,
  hayQueRecordar,
  hechosDeCobranza,
  prohibidoEnRecordatorio,
} from '../_shared/aiCredit.ts'

const FEATURE = 'credit'
const ALLOWED_FIELDS = ['mode', 'customer_id', 'locale', 'question', 'notes', 'tone'] as const
const MODES = ['signals', 'explain', 'reminder'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'credit-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const customerId = optionalUuid(body, 'customer_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    const notes = optionalText(body, 'notes', MAX_NOTAS)
    const tone = body.tone === undefined ? 'formal' : requireEnum(body, 'tone', TONOS)
    if (mode !== 'explain' && question) throw badRequest('CAMPO_NO_PERMITIDO', '`question` solo vale en el modo `explain`')
    if (mode !== 'reminder' && (notes || body.tone !== undefined)) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`notes` y `tone` solo valen en el modo `reminder`')
    }
    if (mode === 'reminder' && !customerId) throw badRequest('CAMPO_REQUERIDO', 'El recordatorio necesita `customer_id`')

    const client = userClient(request, trace)
    // RLS + guard de rol y módulo en SQL: sin la funcionalidad es 403 antes de
    // gastar nada; un cliente invisible (ajeno) es 404.
    const { data: raw, error } = await client.rpc('ai_collections_facts', { p_customer_id: customerId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')
    const hechos = hechosDeCobranza(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')

    const system = sistemaExplicable(hechos)
    const sinIA = (motivo: 'vacia' | null) => ({
      status: 200,
      body: { data: { data: null, motivo, interaction_id: null, system } },
    })
    if (mode === 'signals') return sinIA(null)

    const medidor = medidorDeUsuario(client)
    const puertos = { hayProveedor: hayProveedorIA, consumir: medidor.consumir, registrar: medidor.registrar }

    if (mode === 'reminder') {
      // Sin documentos abiertos no hay nada que recordar: ni modelo ni cuota.
      if (!hayQueRecordar(hechos)) return sinIA('vacia')
      const resultado = await ejecutarIA<BorradorModelo, BorradorRevisado>(
        {
          feature: FEATURE,
          prompt: `cobranza · recordatorio · ${locale} · ${tone}`,
          revisar: (data) => {
            const r = revisarBorrador(data, contextoDeRecordatorio(hechos), notes, prohibidoEnRecordatorio)
            return r.ok ? { ok: true, value: r.value, reply: r.value.subject } : { ok: false, motivo: r.motivo }
          },
        },
        {
          ...puertos,
          llamar: () =>
            pedirJson<BorradorModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_RECORDATORIO),
              user: datosDeRecordatorio(hechos, locale, tone, notes),
              schema: ESQUEMA_BORRADOR,
            }),
        },
      )
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
    }

    // Nada detectado y nada preguntado: no hay qué explicar y no se gasta.
    if (hechos.signals.length === 0 && !question) return sinIA('vacia')
    type ConContexto = ExplicacionRevisada & ReturnType<typeof contextoExplicable>
    const resultado = await ejecutarIA<ExplicacionModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `cobranza · ${hechos.scope} · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const r = revisarExplicacion(data, hechos, CONFIG_CREDITO, Boolean(question))
          if (!r.ok) return { ok: false, motivo: r.motivo }
          return { ok: true, value: { ...r.value, ...contextoExplicable(hechos) }, reply: r.value.answer || r.value.overview }
        },
      },
      {
        ...puertos,
        llamar: () =>
          pedirJson<ExplicacionModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_COBRANZA),
            user: datosDeExplicacion(hechos, CONFIG_CREDITO, locale, question),
            schema: ESQUEMA_COBRANZA,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
