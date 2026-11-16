/**
 * Configuración de `tenant-inventory.v1` (inventario y vínculo). FAIL-CLOSED
 * como lifecycle y entitlements: si falta algo, no hay configuración y la ruta
 * responde 503 (`INVENTORY_NOT_CONFIGURED` / `TENANT_LINK_NOT_CONFIGURED`).
 *
 * Reutiliza la verificación M2M de provisioning (misma clave pública, emisor,
 * audiencia y sujeto) y el ENTORNO y el código de producto del receptor de
 * entitlements. Cada ruta tiene su scope PROPIO: listar no vincula, vincular no
 * da de alta ni suspende.
 *
 * Secretos nuevos (solo NOMBRES; los valores viven en `supabase secrets`):
 *   EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE   ecommerce:tenants:list
 *   EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE      ecommerce:tenants:link
 * Reutilizados:
 *   EBIM_ENTITLEMENTS_ENVIRONMENT               DEV | QAS | DEMO | PRD (el de ESTE proyecto)
 *   EBIM_ENTITLEMENTS_PRODUCT_CODE              opcional, `ecommerce` por defecto
 */
import { loadM2MConfig, type M2MConfig } from '../platformProvisioning/m2m.ts'
import type { InventoryEnvironment } from './contract.ts'

type Env = { get(key: string): string | undefined }

export interface InventoryRouteConfig {
  m2m: M2MConfig
  scope: string
  environment: InventoryEnvironment
  productCode: string
}

const ENVIRONMENTS: InventoryEnvironment[] = ['DEV', 'QAS', 'DEMO', 'PRD']

/** Los scopes de los demás canales: reutilizar uno aquí sería un permiso silencioso. */
function otherScopes(env: Env, m2m: M2MConfig, except: string): string[] {
  return [
    m2m.createScope,
    m2m.readScope,
    'EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE',
    'EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE',
    'EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE',
    'EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE',
    'EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE',
    'EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE',
  ]
    .filter((name) => name !== except)
    .map((name) => (name.startsWith('EBIM_') ? (env.get(name) || '').trim() : name))
    .filter((scope) => scope !== '')
}

function load(env: Env, variable: string, pattern: RegExp): InventoryRouteConfig | null {
  const m2m = loadM2MConfig(env)
  if (!m2m) return null

  const scope = (env.get(variable) || '').trim()
  const environment = (env.get('EBIM_ENTITLEMENTS_ENVIRONMENT') || '').trim() as InventoryEnvironment
  const productCode = (env.get('EBIM_ENTITLEMENTS_PRODUCT_CODE') || 'ecommerce').trim()

  if (!pattern.test(scope)) return null
  if (otherScopes(env, m2m, variable).includes(scope)) return null
  if (!ENVIRONMENTS.includes(environment)) return null
  if (!/^[a-z0-9]+$/.test(productCode)) return null

  return { m2m, scope, environment, productCode }
}

/** `GET /tenants`. Sin `EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE` → null (503). */
export function loadInventoryConfig(env: Env): InventoryRouteConfig | null {
  return load(env, 'EBIM_MASTERADMIN_M2M_INVENTORY_READ_SCOPE', /^[a-z0-9]+:tenants:list$/)
}

/** `PUT /tenants/{id}/link`. Sin `EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE` → null (503). */
export function loadTenantLinkConfig(env: Env): InventoryRouteConfig | null {
  return load(env, 'EBIM_MASTERADMIN_M2M_TENANT_LINK_SCOPE', /^[a-z0-9]+:tenants:link$/)
}
