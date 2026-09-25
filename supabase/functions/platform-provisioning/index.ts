/**
 * platform-provisioning — EBIM MasterAdmin da de alta y consulta tenants de
 * eCommerce (contrato GENERIC v1).
 *
 * Clase de confianza PLATFORM_M2M: la autentica un JWT ES256 de MasterAdmin, NO
 * un JWT de Supabase. Por eso `verify_jwt = false` (supabase/config.toml): el
 * gateway rechazaría el token de MasterAdmin antes de llegar aquí. La
 * verificación completa vive en `_shared/platformProvisioning/m2m.ts` y la hace
 * el handler ANTES de crear el cliente con service-role.
 *
 * Sin CORS a propósito: es servidor a servidor y ningún navegador debe llamarla.
 *
 * Secretos (solo NOMBRES; los valores viven en `supabase secrets`):
 *   EBIM_MASTERADMIN_M2M_ENABLED              "true" para encender; otro valor = 503
 *   EBIM_MASTERADMIN_M2M_ISSUER               masteradmin.ebim
 *   EBIM_MASTERADMIN_M2M_AUDIENCE             ecommerce.ebim
 *   EBIM_MASTERADMIN_M2M_SUBJECT              masteradmin-provisioning (exacto; si falta, 503)
 *   EBIM_MASTERADMIN_M2M_ALGORITHM            ES256 (único valor aceptado)
 *   EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME   segundos, 1..300 (MasterAdmin firma con 120)
 *   EBIM_MASTERADMIN_M2M_CREATE_SCOPE         ecommerce:tenant:create
 *   EBIM_MASTERADMIN_M2M_READ_SCOPE           ecommerce:tenant:read
 *   EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64       Base64 del PEM `BEGIN PUBLIC KEY` (P-256)
 */
import { createClient } from 'npm:@supabase/supabase-js@2.48.0'
import { handleProvisioningRequest } from '../_shared/platformProvisioning/handler.ts'
import {
  importMasterAdminPublicKey,
  loadM2MConfig,
} from '../_shared/platformProvisioning/m2m.ts'
import { createRpcRepository } from '../_shared/platformProvisioning/repository.ts'
import { edgeSecurityHeaders } from '../_shared/securityHeaders.ts'

/**
 * El handler ya pone las cabeceras de seguridad del borde en cada respuesta;
 * esto es la red por debajo: si una respuesta llegara sin alguna, se completa
 * aquí sin pisar lo que el handler decidió.
 */
function secured(response: Response): Response {
  for (const [name, value] of Object.entries(edgeSecurityHeaders())) {
    if (!response.headers.has(name)) response.headers.set(name, value)
  }
  return response
}

const config = loadM2MConfig(Deno.env)
let publicKeyPromise: Promise<CryptoKey> | null = null

Deno.serve(async (req) =>
  secured(await handleProvisioningRequest(req, {
    config,
    publicKey: () => {
      if (!config) return Promise.reject(new Error('M2M no configurado'))
      // Se importa una vez por instancia; si falla, se reintenta en la próxima petición.
      publicKeyPromise ??= importMasterAdminPublicKey(config.publicKeyB64).catch((e) => {
        publicKeyPromise = null
        throw e
      })
      return publicKeyPromise
    },
    repository: () => {
      const url = Deno.env.get('SUPABASE_URL')
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      // Sin credenciales de servidor, el handler lo convierte en PROVISIONING_FAILED.
      if (!url || !key) throw new Error('Faltan credenciales de servidor')
      return createRpcRepository(
        createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
      )
    },
    log: (event) => console.log(JSON.stringify(event)),
  })),
)
