/**
 * integrations-assistant — Integraciones con IA (fase 10 de EBIM_AI_SEQUENCE).
 *
 * Dos modos, los dos de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — proveedores,
 *              errores AGRUPADOS por proveedor/operación/clase/huella con su
 *              código HTTP, disyuntores abiertos, webhooks con entregas
 *              fallidas, bandeja de entrada y errores de la API de socio; o UN
 *              mensaje (`outbox_id`) con sus intentos.
 *  - `explain` (+ `question` opcional): la INTERPRETACIÓN IA — qué significan
 *              los errores de API/webhook/ERP, qué tienen en común los grupos,
 *              qué patrones se observan y qué verificar (lista cerrada).
 *
 * Lo que ve el modelo: solo `ai_integrations_facts` (SECURITY INVOKER, RLS de
 * quien llama, roles de `integrations`), sin payloads, URL ni secretos, con
 * TODO texto de error saneado por `observability/redact.ts` y una última
 * pasada sobre el prompt completo.
 *
 * Lo que NO puede hacer: reintentar, reproducir, cerrar disyuntores, rotar
 * credenciales ni modificar una integración. No hay ningún camino de
 * escritura ni de comando remoto.
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
import {
  CONFIG_INTEGRACIONES,
  ESQUEMA_INTEGRACIONES,
  SISTEMA_INTEGRACIONES,
  hechosDeIntegraciones,
} from '../_shared/aiIntegrations.ts'
import { sanitizePromptForModel, sanitizeTextForModel } from '../_shared/observability/redact.ts'

const FEATURE = 'integrations'
const ALLOWED_FIELDS = ['mode', 'outbox_id', 'locale', 'question'] as const
const MODES = ['signals', 'explain'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'integrations-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const outboxId = optionalUuid(body, 'outbox_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = sanitizeTextForModel(optionalText(body, 'question', MAX_PREGUNTA), MAX_PREGUNTA)
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    // Guard de rol en SQL (403 antes de gastar); mensaje ajeno o invisible = 404.
    const { data: raw, error } = await client.rpc('ai_integrations_facts', { p_outbox_id: outboxId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El mensaje no existe o no es visible')
    const hechos = hechosDeIntegraciones(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'El mensaje no existe o no es visible')

    const system = sistemaExplicable(hechos)
    if (mode === 'signals' || (hechos.signals.length === 0 && !question)) {
      const motivo = mode === 'signals' ? null : 'vacia'
      return { status: 200, body: { data: { data: null, motivo, interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    type ConContexto = ExplicacionRevisada & ReturnType<typeof contextoExplicable>
    const resultado = await ejecutarIA<ExplicacionModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `integraciones · ${hechos.scope} · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const r = revisarExplicacion(data, hechos, CONFIG_INTEGRACIONES, Boolean(question))
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
            system: sistemaConFrontera(SISTEMA_INTEGRACIONES),
            user: sanitizePromptForModel(datosDeExplicacion(hechos, CONFIG_INTEGRACIONES, locale, question)),
            schema: ESQUEMA_INTEGRACIONES,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
