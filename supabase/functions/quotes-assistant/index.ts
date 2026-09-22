/**
 * quotes-assistant — Cotizaciones y surtidos con IA (fase 07 de EBIM_AI_SEQUENCE).
 *
 * Tres modos, ninguno escribe:
 *  - `draft`   (+ `instruction` ≤ 600, `customer_id?`): la IA convierte la
 *              instrucción en TEXTO estructurado (cliente, productos,
 *              cantidades, vigencia, nota) y el SISTEMA lo resuelve contra
 *              entidades reales con `ai_quote_resolve` (candidatos si hay duda).
 *              El precio NO sale de aquí: la pantalla llama a
 *              `quote_draft_preview` (motor de precios) y guarda con
 *              `quote_create_from_draft` tras la confirmación humana.
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA de sugerencias de
 *              surtido para un cliente (`ai_assortment_facts`).
 *  - `suggest` (+ `question?`): la IA prioriza y explica esos candidatos.
 *
 * Lo que ve el modelo: la instrucción de la persona (dato no confiable) o los
 * candidatos del sistema por referencia; nunca el catálogo, SKU, clientes ni
 * precios. El tenant sale del JWT; todo se lee con la RLS de quien llama.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import {
  optionalText,
  optionalUuid,
  rejectUnknownFields,
  requireEnum,
  requireText,
  requireUuid,
} from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_COTIZACION,
  ESQUEMA_SURTIDO,
  MAX_INSTRUCCION,
  MAX_PREGUNTA,
  SISTEMA_COTIZACION,
  SISTEMA_SURTIDO,
  argumentosDeResolucion,
  contextoDeSurtido,
  datosDeInstruccion,
  datosDeSurtido,
  hechosDeSurtido,
  resolucionDelSistema,
  revisarInterpretacion,
  revisarSurtido,
  surtidoDelSistema,
  type InterpretacionModelo,
  type InterpretacionRevisada,
  type SurtidoModelo,
  type SurtidoRevisado,
} from '../_shared/aiQuotes.ts'

const FEATURE = 'quotes'
const ALLOWED_FIELDS = ['mode', 'store_id', 'customer_id', 'locale', 'instruction', 'question'] as const
const MODES = ['draft', 'signals', 'suggest'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'quotes-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = requireUuid(body, 'store_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const client = userClient(request, trace)

    if (mode === 'draft') {
      if (body.question !== undefined) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `draft` no admite `question`')
      const customerId = optionalUuid(body, 'customer_id')
      const instruction = requireText(body, 'instruction', { min: 3, max: MAX_INSTRUCCION })

      // Rol, módulo, tienda y cliente ANTES de gastar: 403/404 sin cuota.
      const previa = await client.rpc('ai_quote_resolve', argumentosDeResolucion(storeId, customerId, null))
      if (previa.error) throw fromDatabaseError(previa.error)
      if (previa.data === null || previa.data === undefined) {
        throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')
      }

      const medidor = medidorDeUsuario(client)
      const resultado = await ejecutarIA<InterpretacionModelo, InterpretacionRevisada>(
        {
          feature: FEATURE,
          prompt: `cotizacion · borrador · ${locale} · ${instruction}`,
          revisar: (data) => {
            const revision = revisarInterpretacion(data, instruction)
            if (!revision.ok) return { ok: false, motivo: revision.motivo }
            return { ok: true, value: revision.value, reply: revision.value.summary || null }
          },
        },
        {
          hayProveedor: hayProveedorIA,
          consumir: medidor.consumir,
          registrar: medidor.registrar,
          llamar: () =>
            pedirJson<InterpretacionModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_COTIZACION),
              user: datosDeInstruccion(instruction, locale),
              schema: ESQUEMA_COTIZACION,
            }),
        },
      )

      // El SISTEMA resuelve lo que la IA leyó; sin interpretación, se queda
      // con la comprobación previa (cliente elegido, si lo hay).
      let resolucion: unknown = previa.data
      if (resultado.data) {
        const r = await client.rpc('ai_quote_resolve', argumentosDeResolucion(storeId, customerId, resultado.data))
        if (r.error) throw fromDatabaseError(r.error)
        resolucion = r.data
      }
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system: resolucionDelSistema(resolucion) } } }
    }

    // ---- Surtido ---------------------------------------------------------
    const customerId = requireUuid(body, 'customer_id')
    if (body.instruction !== undefined) throw badRequest('CAMPO_NO_PERMITIDO', 'El surtido no admite `instruction`')
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const { data: raw, error } = await client.rpc('ai_assortment_facts', { p_store_id: storeId, p_customer_id: customerId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')
    const hechos = hechosDeSurtido(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')

    const system = { ...surtidoDelSistema(hechos), ...contextoDeSurtido(hechos) }
    if (mode === 'signals') {
      return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
    }
    // Sin candidatos no hay nada que priorizar: no se gasta.
    if (hechos.candidates.length === 0) {
      return { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    type ConContexto = SurtidoRevisado & ReturnType<typeof contextoDeSurtido>
    const resultado = await ejecutarIA<SurtidoModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `surtido · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const revision = revisarSurtido(data, hechos, Boolean(question))
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return {
            ok: true,
            value: { ...revision.value, ...contextoDeSurtido(hechos) },
            reply: revision.value.answer || revision.value.overview,
          }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<SurtidoModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_SURTIDO),
            user: datosDeSurtido(hechos, locale, question),
            schema: ESQUEMA_SURTIDO,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
