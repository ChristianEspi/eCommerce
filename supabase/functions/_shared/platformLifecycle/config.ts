/**
 * Configuración del receptor `lifecycle.v1`. FAIL-CLOSED como la de
 * entitlements: si falta algo, no hay configuración y las rutas responden 503.
 *
 * Reutiliza la verificación M2M de provisioning (misma clave pública, emisor,
 * audiencia y sujeto) y el ENTORNO y el código de producto del receptor de
 * entitlements. Sus scopes son PROPIOS: una credencial que solo da de alta o
 * solo escribe entitlements no puede suspender a nadie.
 *
 * Secretos nuevos (solo NOMBRES; los valores viven en `supabase secrets`):
 *   EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE   ecommerce:lifecycle:write
 *   EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE    ecommerce:lifecycle:read
 * Reutilizados:
 *   EBIM_ENTITLEMENTS_ENVIRONMENT                DEV | QAS | DEMO | PRD (el de ESTE proyecto)
 *   EBIM_ENTITLEMENTS_PRODUCT_CODE               opcional, `ecommerce` por defecto
 */
import { loadM2MConfig, type M2MConfig } from '../platformProvisioning/m2m.ts'
import type { LifecycleEnvironment } from './contract.ts'

type Env = { get(key: string): string | undefined }

export interface LifecycleConfig {
  m2m: M2MConfig
  writeScope: string
  readScope: string
  environment: LifecycleEnvironment
  productCode: string
}

const ENVIRONMENTS: LifecycleEnvironment[] = ['DEV', 'QAS', 'DEMO', 'PRD']
const SCOPE_RE = /^[a-z0-9]+:lifecycle:(write|read)$/

export function loadLifecycleConfig(env: Env): LifecycleConfig | null {
  const m2m = loadM2MConfig(env)
  if (!m2m) return null

  const writeScope = (env.get('EBIM_MASTERADMIN_M2M_LIFECYCLE_WRITE_SCOPE') || '').trim()
  const readScope = (env.get('EBIM_MASTERADMIN_M2M_LIFECYCLE_READ_SCOPE') || '').trim()
  const environment = (env.get('EBIM_ENTITLEMENTS_ENVIRONMENT') || '').trim() as LifecycleEnvironment
  const productCode = (env.get('EBIM_ENTITLEMENTS_PRODUCT_CODE') || 'ecommerce').trim()

  if (!SCOPE_RE.test(writeScope) || !writeScope.endsWith(':write')) return null
  if (!SCOPE_RE.test(readScope) || !readScope.endsWith(':read')) return null
  // Un scope de alta o de entitlements reutilizado aquí sería un permiso silencioso.
  const others = [
    m2m.createScope,
    m2m.readScope,
    (env.get('EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE') || '').trim(),
    (env.get('EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE') || '').trim(),
  ]
  if (others.some((s) => s !== '' && (s === writeScope || s === readScope))) return null
  if (!ENVIRONMENTS.includes(environment)) return null
  if (!/^[a-z0-9]+$/.test(productCode)) return null

  return { m2m, writeScope, readScope, environment, productCode }
}
