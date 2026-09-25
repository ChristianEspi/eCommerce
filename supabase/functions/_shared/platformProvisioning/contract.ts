/**
 * Contrato GENERIC v1 de EBIM MasterAdmin → comando de alta de eCommerce.
 *
 * MasterAdmin manda el MISMO cuerpo a todos los productos de la suite
 * (`masteradmin/docs/platform-provisioning/ADAPTERS.md` §3). Aquí se valida, se
 * traduce a lo que eCommerce sabe guardar y se normaliza antes de hashear. La
 * tabla REQUERIDO / OPCIONAL / IGNORADO está en
 * `docs/platform-provisioning/MASTERADMIN_GENERIC_CONTRACT.md`.
 *
 * Qué es un tenant en eCommerce: una fila de `public.tenants` cuya PK es el
 * `organization_id`, más la SOCIEDAD (`company_id`) que llevan la membresía y
 * cada fila de negocio. La sociedad no tiene tabla propia y las tiendas las crea
 * el owner (ADR 018). Así se mapea:
 *
 *   masterAdmin.tenantId        → controlPlaneTenantId (llave del mapeo)
 *   tenantCode                  → tenants.slug
 *   organization.displayName    → tenants.name
 *   adminEmail                  → tenants.admin_email + owner PREPROVISIONED
 *   (derivado)                  → organization_id / company_id (UUIDv5)
 *
 * Normalizar ANTES de hashear hace funcionar la idempotencia: dos peticiones que
 * solo difieren en mayúsculas del correo, espacios u orden de claves son la
 * MISMA operación. Lo que eCommerce no guarda (RUC, país, moneda, plan,
 * company.name, requestId…) no entra en el hash.
 *
 * Portable (sin Deno.*): lo prueba Vitest desde `supabase/tests/`.
 */

export type DeploymentMode = 'SHARED' | 'PARTNER_DEDICATED' | 'TENANT_DEDICATED'

export const PRODUCT_CODE = 'ecommerce'
export const CONTRACT_VERSION = 'v1'

/**
 * Namespace UUIDv5 de los ids internos de eCommerce.
 * = uuid5(NAMESPACE_URL, "https://ecommerce.ebim/platform-provisioning/v1").
 *
 * NO CAMBIAR NUNCA una vez que haya tenants aprovisionados: cambiaría los ids
 * que se derivan del tenant de MasterAdmin y un reintento chocaría con el tenant
 * que ya existe. Otra estrategia exige una constante `_V2` que conviva con esta.
 */
export const ECOMMERCE_PROVISIONING_NS_V1 = 'e9b4cc1e-6540-5856-b56d-73d220a346ac'

export interface CreateTenantCommand {
  controlPlaneTenantId: string
  organization: { id: string; slug: string; name: string }
  company: { id: string }
  admin: { email: string }
  deploymentMode: DeploymentMode
}

/** Lo que MasterAdmin manda y eCommerce no guarda en el tenant: solo rastro. */
export interface CreateTenantContext {
  tenantName: string | null
  tenantType: string | null
  environment: string | null
  organizationCode: string | null
  companyCode: string | null
  companyName: string | null
  currency: string | null
  planCode: string | null
  requestId: string | null
}

export interface FieldError {
  field: string
  issue: string
}

/** Comando validado al que todavía le faltan los ids internos. */
export interface DraftCommand {
  controlPlaneTenantId: string
  slug: string
  organizationName: string
  email: string
  deploymentMode: DeploymentMode
  context: CreateTenantContext
}

export type ParseResult = { ok: true; draft: DraftCommand } | { ok: false; errors: FieldError[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** El CHECK `tenants_slug_format` de la base: 3 a 62, sin guion al final. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/
export const DEPLOYMENT_MODES: readonly DeploymentMode[] = [
  'SHARED',
  'PARTNER_DEDICATED',
  'TENANT_DEDICATED',
]
/** Contrato §13: un correo de la suite no es actor de negocio de un tenant. */
const SUITE_DOMAIN = '@ebim.pe'

const MAX_NAME = 200
const MAX_EMAIL = 254

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function optionalText(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * Valida el cuerpo GENERIC. Acumula TODOS los errores, con el nombre del campo
 * tal como lo manda MasterAdmin, para que la consola los muestre juntos.
 */
export function parseGenericCreateRequest(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, errors: [{ field: '$', issue: 'must be a JSON object' }] }

  const errors: FieldError[] = []
  const err = (field: string, issue: string) => errors.push({ field, issue })

  const text = (
    obj: Record<string, unknown>,
    field: string,
    key: string,
    max: number,
    required: boolean,
  ): string | null => {
    const v = obj[key]
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (required) err(field, 'required')
      return null
    }
    if (typeof v !== 'string') {
      err(field, 'must be a string')
      return null
    }
    const t = v.trim()
    if (t.length > max) {
      err(field, `max length ${max}`)
      return null
    }
    return t
  }

  // masterAdmin: de quién es el tenant y para qué producto.
  const ma = body.masterAdmin
  if (!isObject(ma)) err('masterAdmin', 'required object')
  const m = isObject(ma) ? ma : {}
  const cptRaw = text(m, 'masterAdmin.tenantId', 'tenantId', 36, true)
  if (cptRaw !== null && !UUID_RE.test(cptRaw)) err('masterAdmin.tenantId', 'must be a UUID')
  if (isObject(ma) && m.productCode !== PRODUCT_CODE) {
    err('masterAdmin.productCode', `must be "${PRODUCT_CODE}"`)
  }
  if (m.contractVersion !== undefined && m.contractVersion !== null && m.contractVersion !== CONTRACT_VERSION) {
    err('masterAdmin.contractVersion', `must be "${CONTRACT_VERSION}"`)
  }

  // tenantCode → tenants.slug
  const tenantCode = text(body, 'tenantCode', 'tenantCode', 62, true)
  const slug = tenantCode?.toLowerCase() ?? null
  if (slug !== null && !SLUG_RE.test(slug)) {
    err('tenantCode', 'lowercase letters, digits and hyphens, 3-62 chars, not starting or ending with a hyphen')
  }

  // adminEmail → owner PREPROVISIONED
  const emailRaw = text(body, 'adminEmail', 'adminEmail', MAX_EMAIL, true)
  const email = emailRaw?.toLowerCase() ?? null
  if (email !== null && !EMAIL_RE.test(email)) err('adminEmail', 'must be an email address')
  else if (email !== null && email.endsWith(SUITE_DOMAIN)) {
    err('adminEmail', 'a suite operator address cannot administer a tenant')
  }

  // organización → tenants.name
  const org = body.organization
  if (!isObject(org)) err('organization', 'required object')
  const o = isObject(org) ? org : {}
  const orgName = text(o, 'organization.displayName', 'displayName', MAX_NAME, true)

  const company = body.company
  const companyPresent = isObject(company)
  if (company !== null && company !== undefined && !companyPresent) {
    err('company', 'must be an object or null')
  }
  const c = companyPresent ? company : {}

  // deploymentMode: contexto, no infraestructura.
  const deploymentMode = DEPLOYMENT_MODES.includes(body.deploymentMode as DeploymentMode)
    ? (body.deploymentMode as DeploymentMode)
    : null
  if (!deploymentMode) err('deploymentMode', `must be one of ${DEPLOYMENT_MODES.join(', ')}`)

  if (errors.length || !cptRaw || !slug || !orgName || !email || !deploymentMode) {
    return { ok: false, errors }
  }

  const plan = isObject(body.plan) ? body.plan : {}
  return {
    ok: true,
    draft: {
      controlPlaneTenantId: cptRaw.toLowerCase(),
      slug,
      organizationName: orgName,
      email,
      deploymentMode,
      context: {
        tenantName: optionalText(body.tenantName),
        tenantType: optionalText(body.tenantType, 40),
        environment: optionalText(body.environment, 20),
        organizationCode: optionalText(o.code),
        companyCode: optionalText(c.code),
        companyName: optionalText(c.name),
        currency: optionalText(c.currency, 3),
        planCode: optionalText(plan.code),
        requestId: optionalText(m.requestId, 36),
      },
    },
  }
}

export interface InternalIds {
  organizationId: string
  companyId: string
}

export type DeriveInternalIds = (controlPlaneTenantId: string) => Promise<InternalIds>

export class InternalIdCollisionError extends Error {
  constructor() {
    super('INTERNAL_ID_COLLISION')
  }
}

function uuidToBytes(uuid: string): Uint8Array<ArrayBuffer> {
  const hex = uuid.replace(/-/g, '')
  const out = new Uint8Array(new ArrayBuffer(16))
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** UUIDv5 (RFC 9562 §5.5): SHA-1(namespace || nombre), versión 5, variante RFC. */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  if (!UUID_RE.test(namespace)) throw new Error('namespace must be a UUID')
  const ns = uuidToBytes(namespace)
  const nameBytes = new TextEncoder().encode(name)
  const data = new Uint8Array(new ArrayBuffer(ns.length + nameBytes.length))
  data.set(ns)
  data.set(nameBytes, ns.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16)
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Ids internos deterministas con separación de dominio: el mismo tenant de
 * MasterAdmin produce siempre la misma organización y la misma sociedad, así que
 * el `externalTenantId` de un reintento no cambia nunca, y organización y
 * sociedad nunca comparten UUID.
 */
export async function deriveInternalIds(
  controlPlaneTenantId: string,
  uuid: (namespace: string, name: string) => Promise<string> = uuidV5,
): Promise<InternalIds> {
  const cpt = controlPlaneTenantId.toLowerCase()
  const organizationId = await uuid(ECOMMERCE_PROVISIONING_NS_V1, `organization:${cpt}`)
  const companyId = await uuid(ECOMMERCE_PROVISIONING_NS_V1, `company:${cpt}`)
  if (organizationId === companyId) throw new InternalIdCollisionError()
  return { organizationId, companyId }
}

export function buildCommand(draft: DraftCommand, ids: InternalIds): CreateTenantCommand {
  return {
    controlPlaneTenantId: draft.controlPlaneTenantId,
    organization: { id: ids.organizationId, slug: draft.slug, name: draft.organizationName },
    company: { id: ids.companyId },
    admin: { email: draft.email },
    deploymentMode: draft.deploymentMode,
  }
}

/** JSON canónico: claves ordenadas a todos los niveles, sin espacios. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`
}

/** SHA-256 hex del comando normalizado. Sin headers, correlation id, token ni contexto. */
export async function hashCommand(command: CreateTenantCommand): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(command)))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
