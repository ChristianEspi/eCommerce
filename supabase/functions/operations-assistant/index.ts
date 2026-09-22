/**
 * operations-assistant — Operaciones con IA (fase 10 de EBIM_AI_SEQUENCE).
 *
 * Dos modos, los dos de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — salud del tenant,
 *              incidentes agrupados por tipo y código con sus marcas (pico,
 *              recurrente, crítico, viejo), colas y compras atascadas; o UN
 *              incidente (`event_id`) con su hilo.
 *  - `explain` (+ `question` opcional): la INTERPRETACIÓN IA — resumen,
 *              qué tienen en común los grupos, qué pasó en el hilo y qué
 *              verificar (lista cerrada).
 *
 * Lo que ve el modelo: solo `ai_ops_facts` (SECURITY INVOKER, RLS de quien
 * llama, roles de `operations`) con TODO texto libre saneado por
 * `observability/redact.ts` (tokens, JWT, cabeceras, cookies, cadenas de
 * conexión, correos, teléfonos, documentos) y una última pasada sobre el
 * prompt completo. Sin payloads ni identificadores de hilo.
 *
 * Lo que NO puede hacer: resolver incidentes, reintentar, reiniciar ni
 * ejecutar nada. No hay ningún camino de escritura ni de comando.
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
  MAX_PREGUNTA,
  contextoExplicable,
  datosDeExplicacion,
  revisarExplicacion,
  sistemaExplicable,
  type ExplicacionModelo,
  type ExplicacionRevisada,
} from '../_shared/aiExplain.ts'
import { CONFIG_OPS, ESQUEMA_OPERACIONES, SISTEMA_OPERACIONES, hechosDeOperaciones } from '../_shared/aiOperations.ts'
import { sanitizePromptForModel, sanitizeTextForModel } from '../_shared/observability/redact.ts'

const FEATURE = 'operations'
const ALLOWED_FIELDS = ['mode', 'event_id', 'locale', 'question'] as const
const MODES = ['signals', 'explain'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'operations-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const eventId = optionalUuid(body, 'event_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    // La pregunta de la persona también se sanea: pegar un token en el
    // cuadro de texto no puede mandarlo al proveedor.
    const question = sanitizeTextForModel(optionalText(body, 'question', MAX_PREGUNTA), MAX_PREGUNTA)
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    // Guard de rol en SQL (403 antes de gastar); incidente ajeno o invisible = 404.
    const { data: raw, error } = await client.rpc('ai_ops_facts', { p_event_id: eventId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El incidente no existe o no es visible')
    const hechos = hechosDeOperaciones(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'El incidente no existe o no es visible')

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
        prompt: `operaciones · ${hechos.scope} · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const r = revisarExplicacion(data, hechos, CONFIG_OPS, Boolean(question))
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
            system: sistemaConFrontera(SISTEMA_OPERACIONES),
            user: sanitizePromptForModel(datosDeExplicacion(hechos, CONFIG_OPS, locale, question)),
            schema: ESQUEMA_OPERACIONES,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
