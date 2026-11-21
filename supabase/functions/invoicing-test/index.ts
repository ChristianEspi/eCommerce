/**
 * `invoicing-test` — el botón «Probar conexión» de Configuración › Facturación.
 *
 * Comprueba que la RUTA y el TOKEN de Nubefact de la sociedad funcionan, SIN
 * emitir nada: consulta un comprobante que no existe (`consultar_comprobante`,
 * B001-99999999). Que Nubefact responda «no existe» (código 24) prueba que la
 * ruta es suya y que el token vale; 10 dice «token», 11 dice «ruta».
 *
 * ## Autorización
 *
 * Solo owner/admin de la sociedad ACTIVA del JWT, comprobado contra la base con
 * el token de quien llama. Las credenciales se leen con service_role y nunca
 * vuelven al navegador: la respuesta es solo un código.
 */
import { assertNotSuiteOperator, tenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { forbidden, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import {
  authHeader,
  buildConsultarComprobante,
  parseCredentials,
  parseNubefactResponse,
} from '../_shared/invoicing/nubefact.ts'
import { rejectUnknownFields } from '../_shared/validation.ts'
import { serviceClient, userClient } from '../_runtime/clients.ts'
import { verifyHubToken } from '../_runtime/verify.ts'

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'invoicing-test',
  },
  async ({ request, body, trace }) => {
    const context = tenantContext(await verifyHubToken(request))
    assertNotSuiteOperator(context.email)
    rejectUnknownFields(body, [])

    const { data: miembro, error } = await userClient(request, trace)
      .from('tenant_members')
      .select('role')
      .eq('user_id', context.userId)
      .eq('company_id', context.companyId)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw fromDatabaseError(error)
    if (!miembro || !['owner', 'admin'].includes(String(miembro.role))) {
      throw forbidden('Hace falta rol owner o admin para probar la facturación')
    }

    const { data: raw, error: e2 } = await serviceClient(trace).rpc('invoicing_credentials_for', {
      p_org: context.organizationId,
      p_company: context.companyId,
      p_provider: 'nubefact',
    })
    if (e2) throw fromDatabaseError(e2)
    const creds = parseCredentials(raw)
    if (!creds) return { status: 200, body: { data: { ok: false, code: 'SIN_CREDENCIALES' } } }

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 15_000)
    try {
      const response = await fetch(creds.ruta, {
        method: 'POST',
        headers: { Authorization: authHeader(creds.token), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConsultarComprobante('receipt', 'B001', '99999999')),
        signal: abort.signal,
        redirect: 'manual',
      })
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }
      const outcome = parseNubefactResponse(response.status, parsed)
      // «No existe» o un resultado: la cuenta respondió con nuestras credenciales.
      const ok = outcome.kind === 'result' || (outcome.kind === 'error' && outcome.code === 'NUBEFACT_24')
      const code = ok ? null : outcome.kind === 'error' ? outcome.code : 'NUBEFACT_RESPUESTA_INESPERADA'
      return { status: 200, body: { data: { ok, code } } }
    } catch {
      return { status: 200, body: { data: { ok: false, code: 'NUBEFACT_SIN_RED' } } }
    } finally {
      clearTimeout(timer)
    }
  },
)

Deno.serve(handler)
