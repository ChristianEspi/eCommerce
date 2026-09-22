/**
 * customers-assistant — Resumen 360 del cliente con IA (fase 06 de EBIM_AI_SEQUENCE).
 *
 * Dos modos, los dos de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — ficha reducida,
 *              señales (inactivo, caída de frecuencia, pagos fallidos, deuda
 *              vencida si hay permiso, productos que dejó de pedir…), últimos
 *              pedidos, productos frecuentes, promociones, visitas.
 *  - `summary` (+ `question` opcional): la INTERPRETACIÓN IA de ese mismo 360.
 *
 * Lo que ve el modelo: solo `ai_customer_facts` (SECURITY INVOKER, RLS de
 * quien llama, roles de `customers`, cartera del vendedor, crédito y visitas
 * solo con permiso) y la pregunta, delimitados como dato no confiable. El
 * tenant sale del JWT; el cliente se identifica por uuid y la base decide si
 * es visible.
 *
 * Lo que NO puede hacer: escribir nada. No hay camino de escritura.
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
  ESQUEMA_CLIENTE_360,
  MAX_PREGUNTA,
  SISTEMA_CLIENTE_360,
  clienteDelSistema,
  contextoDeCliente,
  datosDeCliente,
  hechosDeCliente,
  revisarCliente360,
  type ClienteModelo,
  type ClienteRevisado,
} from '../_shared/aiCustomers.ts'

const FEATURE = 'customers'
const ALLOWED_FIELDS = ['mode', 'customer_id', 'locale', 'question'] as const
const MODES = ['signals', 'summary'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'customers-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const customerId = requireUuid(body, 'customer_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    // RLS + guard de rol en SQL: sin la funcionalidad es 403 antes de gastar
    // nada; un cliente invisible (ajeno o fuera de la cartera) es 404.
    const { data: raw, error } = await client.rpc('ai_customer_facts', { p_customer_id: customerId })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')
    const hechos = hechosDeCliente(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'El cliente no existe o no es visible')

    const system = { ...clienteDelSistema(hechos), ...contextoDeCliente(hechos) }
    if (mode === 'signals') {
      return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    type ConContexto = ClienteRevisado & ReturnType<typeof contextoDeCliente>
    const resultado = await ejecutarIA<ClienteModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `cliente · 360 · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const revision = revisarCliente360(data, hechos, Boolean(question))
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return {
            ok: true,
            value: { ...revision.value, ...contextoDeCliente(hechos) },
            reply: revision.value.answer || revision.value.overview,
          }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<ClienteModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_CLIENTE_360),
            user: datosDeCliente(hechos, locale, question),
            schema: ESQUEMA_CLIENTE_360,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
