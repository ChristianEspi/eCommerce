/**
 * `auth-email-hook` — los correos de Supabase Auth, por Microsoft Graph.
 *
 * Recuperar contraseña, confirmar correo, invitación. Auth llama a esta función
 * en lugar de enviar por su cuenta, y la función envía como el buzón de la app
 * (contrato §14). La lógica está en `_shared/notifications/authHook.ts`.
 *
 * ## Autenticación
 *
 * No hay JWT de usuario: la llama Auth. La prueba de que viene de Auth es la
 * firma Standard Webhooks con `AUTH_HOOK_SECRET`. Sin firma válida, 401 y no se
 * envía nada. Por eso `verify_jwt = false` en `config.toml`: el flag de la
 * plataforma pediría un token que Auth no manda.
 *
 * ## Si Graph no está configurado
 *
 * Responde error y Auth se lo dice a quien pidió el correo. Es mejor que
 * «te enviamos un enlace» sin enviar nada, que es lo que el comprador creería.
 */
import { buildAuthEmail, verifyAuthHookSignature, type AuthHookPayload } from '../_shared/notifications/authHook.ts'
import { graphConfigFromEnv, graphToken, sendGraphMail } from '../_shared/notifications/graph.ts'
import { renderEmail } from '../_shared/notifications/templates.ts'
import { edgeSecurityHeaders } from '../_shared/securityHeaders.ts'

/** El formato de error que entiende Auth para trasladarlo al cliente. */
function hookError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { ...edgeSecurityHeaders(), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return hookError(405, 'Solo POST')

  const secret = Deno.env.get('AUTH_HOOK_SECRET') ?? ''
  if (!secret) return hookError(500, 'El envío de correo no está configurado')

  const body = await request.text()
  const valida = await verifyAuthHookSignature({
    secret,
    id: request.headers.get('webhook-id'),
    timestamp: request.headers.get('webhook-timestamp'),
    signature: request.headers.get('webhook-signature'),
    body,
    nowSeconds: Math.floor(Date.now() / 1000),
  })
  if (!valida) return hookError(401, 'Firma inválida')

  let payload: AuthHookPayload
  try {
    payload = JSON.parse(body) as AuthHookPayload
  } catch {
    return hookError(400, 'Cuerpo inválido')
  }

  const correo = buildAuthEmail(payload, Deno.env.get('SUPABASE_URL') ?? '')
  if (!correo) return hookError(400, 'Tipo de correo no soportado')

  const { config } = graphConfigFromEnv((key) => Deno.env.get(key))
  if (!config) return hookError(500, 'El envío de correo no está configurado')

  const rendered = renderEmail(correo.kind, 'es', correo.params, '')
  if (!rendered) return hookError(500, 'Plantilla no disponible')

  const token = await graphToken(config, fetch)
  if (!token) return hookError(502, 'No se pudo autenticar el envío de correo')

  const outcome = await sendGraphMail(config, token, { to: correo.to, ...rendered }, fetch)
  if (!outcome.ok) return hookError(502, 'No se pudo enviar el correo')

  return new Response('{}', {
    status: 200,
    headers: { ...edgeSecurityHeaders(), 'Content-Type': 'application/json' },
  })
})
