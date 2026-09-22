/**
 * inventory-assistant — Inventario con IA (fase 05 de EBIM_AI_SEQUENCE).
 *
 * Dos modos, los dos de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — riesgo de quiebre,
 *              exceso, inmovilizados, alta rotación, movimientos atípicos,
 *              ERP caducado — por producto, con severidad y revisión por regla.
 *  - `analyze` (+ `question` opcional): la INTERPRETACIÓN IA de ese mismo lote
 *              —por qué importa cada señal y qué revisar— y la respuesta a
 *              una pregunta («¿Qué productos corren riesgo de quiebre?»).
 *
 * Lo que ve el modelo: solo `ai_inventory_facts` (SECURITY INVOKER, RLS de
 * quien llama, roles de la funcionalidad `inventory`, módulo
 * `inventory.multiwarehouse`) y la pregunta, delimitados como dato no
 * confiable. El tenant sale del JWT.
 *
 * Lo que NO puede hacer: ajustar existencias, cambiar puntos de pedido, crear
 * compras ni proponer cantidades. No hay camino de escritura; la revisión
 * sugerida es una pestaña de la pantalla, de lista cerrada.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, rejectUnknownFields, requireEnum, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_INVENTARIO,
  MAX_LOTE,
  MAX_PREGUNTA,
  SISTEMA_INVENTARIO,
  contextoDeInventario,
  datosDeInventario,
  hechosDeInventario,
  inventarioDelSistema,
  revisarInventario,
  type InventarioModelo,
  type InventarioRevisado,
} from '../_shared/aiInventory.ts'

const FEATURE = 'inventory'
const ALLOWED_FIELDS = ['mode', 'store_id', 'locale', 'question'] as const
const MODES = ['signals', 'analyze'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'inventory-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = requireUuid(body, 'store_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    if (mode === 'signals' && question) throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `signals` no admite `question`')

    const client = userClient(request, trace)
    // RLS + guard de rol y módulo en SQL: sin la funcionalidad es 403 antes de
    // gastar nada; tienda ajena, también.
    const { data: raw, error } = await client.rpc('ai_inventory_facts', { p_store_id: storeId, p_limit: MAX_LOTE })
    if (error) throw fromDatabaseError(error)
    const hechos = hechosDeInventario(raw)
    if (!hechos) throw fromDatabaseError(null)

    const system = {
      items: inventarioDelSistema(hechos),
      total_tracked: hechos.metrics.total_tracked?.value ?? null,
      ...contextoDeInventario(hechos),
    }
    if (mode === 'signals') {
      return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
    }
    // Sin señales: nada que interpretar. Ni modelo ni cuota.
    if (hechos.items.length === 0) {
      return { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    type ConContexto = InventarioRevisado & ReturnType<typeof contextoDeInventario>
    const resultado = await ejecutarIA<InventarioModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `inventario · analisis · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const revision = revisarInventario(data, hechos, Boolean(question))
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return {
            ok: true,
            value: { ...revision.value, ...contextoDeInventario(hechos) },
            reply: revision.value.answer || revision.value.overview || revision.value.items.map((i) => i.ref).join(', '),
          }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<InventarioModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_INVENTARIO),
            user: datosDeInventario(hechos, locale, question),
            schema: ESQUEMA_INVENTARIO,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
