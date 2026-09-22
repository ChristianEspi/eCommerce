/**
 * sales-assistant — Fuerza de ventas con IA (fase 06 de EBIM_AI_SEQUENCE).
 *
 * Tres modos sobre UNA visita, todos de SOLO LECTURA:
 *  - `signals`   (sin IA ni cuota): el CÁLCULO DEL SISTEMA — la visita, el 360
 *                reducido del cliente y sus señales.
 *  - `prepare`   Preparar visita: resumen, últimos movimientos, pendientes,
 *                productos relevantes y preguntas sugeridas.
 *  - `follow_up` Generar seguimiento: BORRADOR de mensaje post-visita (+ `notes`
 *                del vendedor y `tone`). No se envía: no hay camino de envío;
 *                la persona lo edita, lo copia y decide.
 *
 * Lo que ve el modelo: solo `ai_visit_facts` (SECURITY INVOKER, RLS de quien
 * llama —la visita es del vendedor que la hace u owner/admin—, roles de
 * `sales`, módulo `sales.force`, cartera, crédito solo con permiso) y las notas,
 * delimitadas como dato no confiable. El borrador ni siquiera ve cifras.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, rejectUnknownFields, requireEnum, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_SEGUIMIENTO,
  ESQUEMA_VISITA,
  MAX_NOTAS,
  SISTEMA_SEGUIMIENTO,
  SISTEMA_VISITA,
  TONOS,
  clienteDelSistema,
  contextoDeCliente,
  contextoDeSeguimiento,
  datosDeSeguimiento,
  datosDeVisita,
  hechosDeCliente,
  revisarPreparacion,
  revisarSeguimiento,
  type SeguimientoModelo,
  type SeguimientoRevisado,
  type VisitaModelo,
  type VisitaRevisada,
} from '../_shared/aiCustomers.ts'

const FEATURE = 'sales'
const ALLOWED_FIELDS = ['mode', 'visit_id', 'locale', 'notes', 'tone'] as const
const MODES = ['signals', 'prepare', 'follow_up'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'sales-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const visitId = requireUuid(body, 'visit_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const notes = optionalText(body, 'notes', MAX_NOTAS)
    const tone = body.tone === undefined ? 'formal' : requireEnum(body, 'tone', TONOS)
    if (mode !== 'follow_up' && (notes || body.tone !== undefined)) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`notes` y `tone` solo valen en el modo `follow_up`')
    }

    const client = userClient(request, trace)
    // Guard de rol y módulo en SQL (403 antes de gastar); visita invisible
    // (de otro vendedor, de otra sociedad o de un cliente fuera de cartera) = 404.
    const { data: raw, error } = await client.rpc('ai_visit_facts', { p_visit_id: visitId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'La visita no existe o no es visible')
    const hechos = hechosDeCliente(raw)
    if (!hechos || !hechos.visit) throw notFound('NO_ENCONTRADO', 'La visita no existe o no es visible')

    const system = { ...clienteDelSistema(hechos), ...contextoDeCliente(hechos) }
    if (mode === 'signals') {
      return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    const puertos = { hayProveedor: hayProveedorIA, consumir: medidor.consumir, registrar: medidor.registrar }

    if (mode === 'prepare') {
      type ConContexto = VisitaRevisada & ReturnType<typeof contextoDeCliente>
      const resultado = await ejecutarIA<VisitaModelo, ConContexto>(
        {
          feature: FEATURE,
          prompt: `visita · preparar · ${locale}`,
          revisar: (data) => {
            const revision = revisarPreparacion(data, hechos)
            if (!revision.ok) return { ok: false, motivo: revision.motivo }
            return { ok: true, value: { ...revision.value, ...contextoDeCliente(hechos) }, reply: revision.value.summary }
          },
        },
        {
          ...puertos,
          llamar: () =>
            pedirJson<VisitaModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_VISITA),
              user: datosDeVisita(hechos, locale),
              schema: ESQUEMA_VISITA,
            }),
        },
      )
      return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
    }

    // follow_up: BORRADOR. Contexto sin cifras: solo cliente, productos y tareas.
    const contexto = { generated_at: hechos.generatedAt, ...contextoDeSeguimiento(hechos) }
    type ConContexto = SeguimientoRevisado & typeof contexto
    const resultado = await ejecutarIA<SeguimientoModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `visita · seguimiento · ${tone} · ${locale}`,
        revisar: (data) => {
          const revision = revisarSeguimiento(data, hechos, notes)
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return { ok: true, value: { ...revision.value, ...contexto }, reply: revision.value.subject }
        },
      },
      {
        ...puertos,
        llamar: () =>
          pedirJson<SeguimientoModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_SEGUIMIENTO),
            user: datosDeSeguimiento(hechos, locale, tone, notes),
            schema: ESQUEMA_SEGUIMIENTO,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
