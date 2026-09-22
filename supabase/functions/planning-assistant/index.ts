/**
 * planning-assistant — Planificación con IA (fase 05 de EBIM_AI_SEQUENCE).
 *
 * Tres modos, todos de SOLO LECTURA y de EXPLICACIÓN:
 *  - `signals`    (sin IA ni cuota): el CÁLCULO DEL SISTEMA sobre la previsión
 *                 existente — desvíos frente a la venta real, tendencia,
 *                 temporada, confianza baja, productos sin previsión.
 *  - `forecast`   (+ `product_id`, `question` opcionales): la INTERPRETACIÓN IA
 *                 de esa previsión: tendencia, estacionalidad, anomalías,
 *                 previsión frente a venta y factores observables.
 *  - `suggestion` (`customer_id`, `days`): explica, línea a línea, el sugerido
 *                 que calculó `ebim.suggest_order_v2` (`history_seasonal_v2`)
 *                 para ese cliente. Las cantidades viajan en `system` desde el
 *                 motor; el modelo no puede escribir ninguna.
 *
 * Nada aquí produce previsiones ni cantidades de reposición, ni guarda
 * sugerencias: guardar sigue siendo el segundo clic de la persona en el cajón
 * «Generar sugerido», con la validación de la base.
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
  ESQUEMA_PREVISION,
  ESQUEMA_SUGERIDO,
  MAX_PREGUNTA,
  SISTEMA_PREVISION,
  SISTEMA_SUGERIDO,
  VENTANA_MAX,
  VENTANA_MIN,
  contextoDePlanificacion,
  datosDePrevision,
  datosDeSugerido,
  hechosDePlanificacion,
  hechosDeSugerido,
  previsionDelSistema,
  revisarPrevision,
  revisarSugerido,
  sugeridoDelSistema,
  type PrevisionModelo,
  type PrevisionRevisada,
  type SugeridoModelo,
  type SugeridoRevisado,
} from '../_shared/aiPlanning.ts'

const FEATURE = 'planning'
const ALLOWED_FIELDS = ['mode', 'store_id', 'product_id', 'customer_id', 'days', 'locale', 'question'] as const
const MODES = ['signals', 'forecast', 'suggestion'] as const
const LOCALES = ['es', 'en'] as const

function ventana(body: Record<string, unknown>): number {
  const d = body.days
  if (typeof d !== 'number' || !Number.isInteger(d) || d < VENTANA_MIN || d > VENTANA_MAX) {
    throw badRequest('CAMPO_INVALIDO', `\`days\` debe ser un entero entre ${VENTANA_MIN} y ${VENTANA_MAX}`)
  }
  return d
}

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'planning-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = requireUuid(body, 'store_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const productId = optionalUuid(body, 'product_id')
    const question = optionalText(body, 'question', MAX_PREGUNTA)

    const esSugerido = mode === 'suggestion'
    if (esSugerido && (productId || question)) {
      throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `suggestion` no admite `product_id` ni `question`')
    }
    if (!esSugerido && (body.customer_id !== undefined || body.days !== undefined)) {
      throw badRequest('CAMPO_NO_PERMITIDO', 'Solo el modo `suggestion` admite `customer_id` y `days`')
    }
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    const medidor = medidorDeUsuario(client)
    const puertosBase = {
      hayProveedor: hayProveedorIA,
      consumir: medidor.consumir,
      registrar: medidor.registrar,
    }

    // -----------------------------------------------------------------------
    // El sugerido v2, explicado
    // -----------------------------------------------------------------------
    if (esSugerido) {
      const customerId = requireUuid(body, 'customer_id')
      const days = ventana(body)
      // El MOTOR corre dentro de la función SQL, con el JWT de quien pide: la
      // cantidad es la de `suggest_order_v2`, no una que calcule nadie aquí.
      const { data: raw, error } = await client.rpc('ai_suggestion_facts', {
        p_store_id: storeId,
        p_customer_id: customerId,
        p_days: days,
      })
      if (error) throw fromDatabaseError(error)
      if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')
      const hechos = hechosDeSugerido(raw)
      if (!hechos) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')

      const system = { ...sugeridoDelSistema(hechos), ...contextoDePlanificacion(hechos) }
      if (hechos.lines.length === 0) {
        return { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null, system } } }
      }

      type ConContexto = SugeridoRevisado & ReturnType<typeof contextoDePlanificacion>
      const resultado = await ejecutarIA<SugeridoModelo, ConContexto>(
        {
          feature: FEATURE,
          prompt: `planificacion · sugerido · ${hechos.modelCode ?? '-'} · ${days} d · ${locale}`,
          revisar: (data) => {
            const revision = revisarSugerido(data, hechos)
            if (!revision.ok) return { ok: false, motivo: revision.motivo }
            return {
              ok: true,
              value: { ...revision.value, ...contextoDePlanificacion(hechos) },
              reply: revision.value.overview || revision.value.lines.map((l) => l.ref).join(', '),
            }
          },
        },
        {
          ...puertosBase,
          llamar: () =>
            pedirJson<SugeridoModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_SUGERIDO),
              user: datosDeSugerido(hechos, locale),
              schema: ESQUEMA_SUGERIDO,
            }),
        },
      )
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
    }

    // -----------------------------------------------------------------------
    // La previsión existente frente a la venta
    // -----------------------------------------------------------------------
    const { data: raw, error } = await client.rpc('ai_planning_facts', {
      p_store_id: storeId,
      p_product_id: productId,
    })
    if (error) throw fromDatabaseError(error)
    const hechos = hechosDePlanificacion(raw)
    if (!hechos) throw fromDatabaseError(null)

    const system = { ...previsionDelSistema(hechos), ...contextoDePlanificacion(hechos) }
    if (mode === 'signals') {
      return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
    }
    if (hechos.items.length === 0) {
      return { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null, system } } }
    }

    type ConContexto = PrevisionRevisada & ReturnType<typeof contextoDePlanificacion>
    const resultado = await ejecutarIA<PrevisionModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `planificacion · prevision · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const revision = revisarPrevision(data, hechos, Boolean(question))
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return {
            ok: true,
            value: { ...revision.value, ...contextoDePlanificacion(hechos) },
            reply: revision.value.answer || revision.value.overview,
          }
        },
      },
      {
        ...puertosBase,
        llamar: () =>
          pedirJson<PrevisionModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_PREVISION),
            user: datosDePrevision(hechos, locale, question),
            schema: ESQUEMA_PREVISION,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
