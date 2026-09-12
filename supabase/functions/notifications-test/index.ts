/**
 * `notifications-test` — el botón «Probar» del correo (contrato §14).
 *
 * Dice si el envío por Microsoft Graph está configurado, qué secretos faltan si
 * no lo está y, si se pide, envía un correo de prueba a quien pulsa el botón.
 *
 * ## Por qué a quien pulsa, y a nadie más
 *
 * El destinatario no llega en el cuerpo. Un botón de prueba que aceptara una
 * dirección sería un formulario para mandar correos desde el buzón de la
 * empresa a quien uno quisiera.
 *
 * ## Autorización
 *
 * Solo `owner` y `admin`, comprobado contra la base con el token del que llama
 * después de verificar su firma: la misma secuencia que `create-user`.
 */
import { assertNotSuiteOperator, tenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { forbidden, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { graphConfigFromEnv, graphToken, sendGraphMail } from '../_shared/notifications/graph.ts'
import { renderEmail } from '../_shared/notifications/templates.ts'
import { rejectUnknownFields } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { verifyHubToken } from '../_runtime/verify.ts'

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'notifications-test',
  },
  async ({ request, body, trace }) => {
    const context = tenantContext(await verifyHubToken(request))
    assertNotSuiteOperator(context.email)
    rejectUnknownFields(body, ['send'])

    const { data: miembro, error } = await userClient(request, trace)
      .from('tenant_members')
      .select('role')
      .eq('user_id', context.userId)
      .eq('company_id', context.companyId)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw fromDatabaseError(error)
    if (!miembro || !['owner', 'admin'].includes(String(miembro.role))) {
      throw forbidden('Hace falta rol owner o admin para probar el correo')
    }

    const { config, missing } = graphConfigFromEnv((key) => Deno.env.get(key))
    const estado = {
      configured: config !== null,
      missing,
      sender_email: config?.senderEmail ?? null,
      sender_name: config?.senderName ?? null,
    }

    if (!config || body.send !== true) {
      return { status: 200, body: { data: { ...estado, sent: false, code: null } } }
    }

    const rendered = renderEmail('mail.test', 'es', {}, Deno.env.get('EBIM_APP_BASE_URL') ?? '')
    const token = rendered ? await graphToken(config, fetch) : null
    if (!rendered || !token) {
      return { status: 200, body: { data: { ...estado, sent: false, code: 'GRAPH_TOKEN' } } }
    }

    const outcome = await sendGraphMail(config, token, { to: context.email, ...rendered }, fetch)
    return {
      status: 200,
      body: { data: { ...estado, sent: outcome.ok, code: outcome.ok ? null : outcome.code } },
    }
  },
)

Deno.serve(handler)
