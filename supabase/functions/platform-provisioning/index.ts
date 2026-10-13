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
 *
 * Entitlements (contrato `ebim.entitlements/v1`, rutas ADITIVAS
 * `PUT|GET /tenants/{id}/entitlements` y `GET /entitlements/manifest`): ver
 * `_shared/platformEntitlements/config.ts`. Sin sus secretos, solo esas rutas
 * responden 503; las de provisioning no cambian.
 *
 * Lifecycle (contrato `lifecycle.v1`, rutas ADITIVAS
 * `PUT|GET /tenants/{id}/lifecycle`): ver `_shared/platformLifecycle/config.ts`
 * y `docs/platform-provisioning/LIFECYCLE.md`. Sin sus scopes, solo esas rutas
 * responden 503.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.48.0'
import { handleProvisioningRequest } from '../_shared/platformProvisioning/handler.ts'
import {
  importMasterAdminPublicKey,
  loadM2MConfig,
} from '../_shared/platformProvisioning/m2m.ts'
import { createRpcRepository } from '../_shared/platformProvisioning/repository.ts'
import { loadEntitlementsConfig } from '../_shared/platformEntitlements/config.ts'
import { handleEntitlementsRequest, isEntitlementsRoute } from '../_shared/platformEntitlements/handler.ts'
import { createEntitlementsRpcRepository } from '../_shared/platformEntitlements/repository.ts'
import { loadLifecycleConfig } from '../_shared/platformLifecycle/config.ts'
import { handleLifecycleRequest, isLifecycleRoute } from '../_shared/platformLifecycle/handler.ts'
import { createLifecycleRpcRepository } from '../_shared/platformLifecycle/repository.ts'
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

// ── Entitlements (CCP fase 09): se despachan ANTES y no tocan provisioning ──
const entitlementsConfig = loadEntitlementsConfig(Deno.env)
let entitlementsKeyPromise: Promise<CryptoKey> | null = null

function serveEntitlements(req: Request): Promise<Response> {
  return handleEntitlementsRequest(req, {
    config: entitlementsConfig,
    publicKey: () => {
      if (!entitlementsConfig) return Promise.reject(new Error('Entitlements no configurado'))
      entitlementsKeyPromise ??= importMasterAdminPublicKey(entitlementsConfig.m2m.publicKeyB64).catch((e) => {
        entitlementsKeyPromise = null
        throw e
      })
      return entitlementsKeyPromise
    },
    repository: () => {
      const url = Deno.env.get('SUPABASE_URL')
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (!url || !key) throw new Error('Faltan credenciales de servidor')
      return createEntitlementsRpcRepository(
        createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
      )
    },
    log: (event) => console.log(JSON.stringify(event)),
  })
}

// ── Lifecycle (lifecycle.v1): también se despacha ANTES y no toca lo demás ──
const lifecycleConfig = loadLifecycleConfig(Deno.env)
let lifecycleKeyPromise: Promise<CryptoKey> | null = null

function serveLifecycle(req: Request): Promise<Response> {
  return handleLifecycleRequest(req, {
    config: lifecycleConfig,
    publicKey: () => {
      if (!lifecycleConfig) return Promise.reject(new Error('Lifecycle no configurado'))
      lifecycleKeyPromise ??= importMasterAdminPublicKey(lifecycleConfig.m2m.publicKeyB64).catch((e) => {
        lifecycleKeyPromise = null
        throw e
      })
      return lifecycleKeyPromise
    },
    repository: () => {
      const url = Deno.env.get('SUPABASE_URL')
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (!url || !key) throw new Error('Faltan credenciales de servidor')
      return createLifecycleRpcRepository(
        createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
      )
    },
    log: (event) => console.log(JSON.stringify(event)),
  })
}

Deno.serve(async (req) => isLifecycleRoute(req.url) ? secured(await serveLifecycle(req)) :
  isEntitlementsRoute(req.url) ? secured(await serveEntitlements(req)) :
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
