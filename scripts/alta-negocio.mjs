/**
 * Alta de un NEGOCIO nuevo en QAS: cuenta (tenant) + sociedad + owner + su
 * primera tienda, en un solo paso y sin catálogo.
 *
 * Es el mismo camino que usaron `seed-porta.mjs` y `seed-surtidora-andes.mjs`
 * (owner con los claims del contrato, alta atómica por `bootstrap_tenant`),
 * sacado a un comando reutilizable. Una tienda MÁS para un negocio que ya existe
 * NO se hace aquí: la crea su owner en el backoffice, Tiendas → «Nueva tienda».
 * Ver `docs/operacion/ALTA_DE_TIENDAS.md`.
 *
 * Por defecto SOLO MUESTRA EL PLAN y comprueba que se puede hacer. Escribe en
 * la base únicamente con `--aplicar`. QAS es compartido: no se lanza sin que el
 * operador lo haya pedido.
 *
 *   node scripts/alta-negocio.mjs --listar
 *   node scripts/alta-negocio.mjs --cuenta "Ferretería Sol S.A.C." --tienda "Ferretería Sol" \
 *        --slug ferreteria-sol --owner owner@ferreteriasol.demo [--moneda PEN] \
 *        [--modulos arranque|completo] [--activar] [--aplicar]
 *
 * Contraseña del owner: la variable de entorno ALTA_OWNER_PASSWORD (en las
 * demos, la contraseña de suite). Si no viene, una aleatoria que se imprime UNA
 * sola vez. Nunca escrita en este archivo.
 *
 * Reglas que se comprueban ANTES de escribir:
 *   · slug con el formato de la base (minúsculas, números y guiones) y libre;
 *   · correo válido, nunca @ebim.pe (contrato: el operador no es actor de un
 *     tenant) y que no sea ya miembro de otra cuenta;
 *   · moneda existente en `public.currencies`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Todos los módulos vendibles. `arranque` deja el paquete que aplica `bootstrap_tenant`. */
const MODULOS_COMPLETO = [
  'ecommerce.ai.assist', 'ecommerce.ai.catalog.copy', 'ecommerce.ai.content', 'ecommerce.ai.insights',
  'ecommerce.analytics.advanced', 'ecommerce.catalog.advanced', 'ecommerce.content.cms',
  'ecommerce.content.white_label', 'ecommerce.credit.management', 'ecommerce.customers.b2b',
  'ecommerce.fulfillment', 'ecommerce.fulfillment.routing', 'ecommerce.integrations.enterprise',
  'ecommerce.inventory.multiwarehouse', 'ecommerce.invoicing', 'ecommerce.orders.advanced',
  'ecommerce.payments', 'ecommerce.planning.demand', 'ecommerce.pricing.lists', 'ecommerce.promotions',
  'ecommerce.sales.force', 'ecommerce.sales.performance', 'ecommerce.sales.territory',
  'ecommerce.trade.assortments', 'ecommerce.trade.quotes',
]

const SLUG = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Argumentos ────────────────────────────────────────────────────────────
function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[name] = true
    else {
      out[name] = next
      i += 1
    }
  }
  return out
}
const A = args(process.argv.slice(2))

// ── Configuración ─────────────────────────────────────────────────────────
function env() {
  const values = Object.fromEntries(
    readFileSync(join(ROOT, '.env'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      }),
  )
  return { ...values, ...process.env }
}
const E = env()
const cfg = {
  url: (E.VITE_SUPABASE_URL ?? '').replace(/\/$/, ''),
  ref: E.VITE_SUPABASE_URL ? new URL(E.VITE_SUPABASE_URL).hostname.split('.')[0] : '',
  token: E.SUPABASE_ACCESS_TOKEN,
  secret: E.SUPABASE_SECRET_KEY,
}
if (!cfg.ref || !cfg.token || !cfg.secret) {
  console.error('Faltan VITE_SUPABASE_URL, SUPABASE_ACCESS_TOKEN o SUPABASE_SECRET_KEY en .env')
  process.exit(1)
}

const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`)

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${cfg.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`SQL ${response.status}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

async function authAdmin(path, init = {}) {
  const response = await fetch(`${cfg.url}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.secret}`,
      apikey: cfg.secret,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null }
}

// ── Listado: el «orden» de lo que hay ─────────────────────────────────────
async function listar() {
  const [row] = await sql(`
    select json_agg(json_build_object(
      'cuenta', t.name, 'estado', t.status,
      'tiendas', (select json_agg(s.name || ' /s/' || s.slug || ' [' || s.status || ']' order by s.name)
                    from public.stores s where s.organization_id = t.organization_id),
      'owners', (select json_agg(distinct m.email) from public.tenant_members m
                  where m.organization_id = t.organization_id and m.role = 'owner' and m.status = 'active')
    ) order by t.name) as r
    from public.tenants t`)
  for (const cuenta of row.r ?? []) {
    console.log(`\n${cuenta.cuenta}  (${cuenta.estado})`)
    console.log(`  owners:  ${(cuenta.owners ?? ['— ninguno —']).join(', ')}`)
    console.log(`  tiendas: ${(cuenta.tiendas ?? ['— ninguna —']).join(' · ')}`)
  }
}

// ── Alta ──────────────────────────────────────────────────────────────────
function plan() {
  const errores = []
  const cuenta = typeof A.cuenta === 'string' ? A.cuenta.trim() : ''
  const tienda = typeof A.tienda === 'string' ? A.tienda.trim() : ''
  const slug = typeof A.slug === 'string' ? A.slug.trim().toLowerCase() : ''
  const owner = typeof A.owner === 'string' ? A.owner.trim().toLowerCase() : ''
  const moneda = typeof A.moneda === 'string' ? A.moneda.trim().toUpperCase() : 'PEN'
  const modulos = typeof A.modulos === 'string' ? A.modulos : 'arranque'

  if (!cuenta) errores.push('--cuenta es obligatorio (razón social o nombre del negocio)')
  if (!tienda) errores.push('--tienda es obligatorio (nombre visible de la tienda)')
  if (!SLUG.test(slug)) errores.push('--slug: minúsculas, números y guiones; 3 a 62 caracteres; sin guion al inicio o al final')
  if (!EMAIL.test(owner)) errores.push('--owner: correo válido del dueño')
  if (/@ebim\.pe$/.test(owner)) errores.push('--owner: un correo @ebim.pe no puede ser dueño de un negocio (contrato)')
  if (!/^[A-Z]{3}$/.test(moneda)) errores.push('--moneda: código de tres letras (PEN, USD, BOB…)')
  if (!['arranque', 'completo'].includes(modulos)) errores.push('--modulos: arranque o completo')

  return { errores, cuenta, tienda, slug, owner, moneda, modulos, activar: Boolean(A.activar) }
}

async function comprobar(p) {
  const problemas = []
  const [r] = await sql(`select json_build_object(
      'slug_tienda', exists(select 1 from public.stores where lower(slug) = ${lit(p.slug)}),
      'slug_cuenta', exists(select 1 from public.tenants where lower(slug) = ${lit(p.slug)}),
      'moneda', exists(select 1 from public.currencies where code = ${lit(p.moneda)}),
      'usuario', (select json_build_object('id', u.id, 'org', u.raw_app_meta_data ->> 'org_id')
                    from auth.users u where lower(u.email) = ${lit(p.owner)}),
      'miembro', exists(select 1 from public.tenant_members m where lower(m.email) = ${lit(p.owner)} and m.status = 'active')
    ) as r`)
  const c = r.r
  if (c.slug_tienda) problemas.push(`ya existe una tienda con la dirección /s/${p.slug}`)
  if (c.slug_cuenta) problemas.push(`ya existe una cuenta con el identificador «${p.slug}»`)
  if (!c.moneda) problemas.push(`la moneda ${p.moneda} no está en public.currencies`)
  if (c.miembro) problemas.push(`${p.owner} ya es miembro de otra cuenta: un usuario pertenece a UNA cuenta. Usa otro correo.`)
  return { problemas, usuarioExistente: c.usuario }
}

async function aplicar(p, usuarioExistente) {
  const organizationId = randomUUID()
  const companyId = randomUUID()
  const meta = {
    apps: ['ecommerce'],
    org_id: organizationId,
    companies: [{ id: companyId, role: 'owner' }],
    active_company: companyId,
    // QAS no tiene el hub conectado: el hook de demo emite los claims EBIM
    // solo para quien lleva esta marca (20260827120000_dev_demo_auth_hook).
    ebim_demo: true,
  }

  let ownerId
  let password = null
  if (usuarioExistente) {
    ownerId = usuarioExistente.id
    const res = await authAdmin(`users/${ownerId}`, { method: 'PUT', body: JSON.stringify({ app_metadata: meta }) })
    if (!res.ok) throw new Error(`Auth ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
  } else {
    password = E.ALTA_OWNER_PASSWORD || `${randomUUID().replace(/-/g, '').slice(0, 14)}Aa1!`
    const res = await authAdmin('users', {
      method: 'POST',
      body: JSON.stringify({ email: p.owner, password, email_confirm: true, app_metadata: meta }),
    })
    if (!res.ok) throw new Error(`Auth ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
    ownerId = res.body.id
  }

  // Cuenta + sociedad + owner + tienda + ajustes + paquete de arranque: UNA transacción.
  await sql(`select public.bootstrap_tenant(${lit(organizationId)}, ${lit(companyId)}, ${lit(p.slug)}, ${lit(p.cuenta)},
               ${lit(p.owner)}, ${lit(ownerId)}, ${lit(p.slug)}, ${lit(p.tienda)}, ${lit(p.moneda)})`)

  if (p.modulos === 'completo') {
    await sql(`select public.sync_platform_context(${lit(organizationId)}, ${lit(companyId)}, true,
                 ${lit(`{${MODULOS_COMPLETO.join(',')}}`)}::text[], 'provisioning'::public.entitlement_source, 'demo')`)
  }
  if (p.activar) {
    await sql(`update public.stores set status = 'active' where lower(slug) = ${lit(p.slug)}`)
  }

  const [m] = await sql(`select count(*)::int as n from public.tenant_entitlements
                          where company_id = ${lit(companyId)} and is_active`)
  return { organizationId, companyId, ownerId, password, modulosActivos: m.n }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (A.listar) return listar()

  const p = plan()
  console.log('\nAlta de negocio — plan')
  console.log(`  cuenta:   ${p.cuenta || '—'}`)
  console.log(`  tienda:   ${p.tienda || '—'}   → /s/${p.slug || '?'}`)
  console.log(`  owner:    ${p.owner || '—'}`)
  console.log(`  moneda:   ${p.moneda}`)
  console.log(`  módulos:  ${p.modulos}${p.modulos === 'completo' ? ` (${MODULOS_COMPLETO.length})` : ' (paquete de arranque)'}`)
  console.log(`  estado:   ${p.activar ? 'activa (visible al público)' : 'borrador (se activa al terminar de configurarla)'}`)

  if (p.errores.length > 0) {
    console.error('\nNo se puede hacer:')
    for (const e of p.errores) console.error(`  · ${e}`)
    process.exit(1)
  }

  const { problemas, usuarioExistente } = await comprobar(p)
  if (problemas.length > 0) {
    console.error('\nNo se puede hacer:')
    for (const e of problemas) console.error(`  · ${e}`)
    process.exit(1)
  }
  if (usuarioExistente) console.log(`\n  (el usuario ${p.owner} ya existe sin cuenta: se le asigna esta)`)

  if (!A.aplicar) {
    console.log('\nTodo en orden. Nada se ha escrito. Repite con --aplicar para dar el alta.')
    return
  }

  const r = await aplicar(p, usuarioExistente)
  console.log('\nAlta hecha.')
  console.log(`  organization_id: ${r.organizationId}`)
  console.log(`  company_id:      ${r.companyId}`)
  console.log(`  módulos activos: ${r.modulosActivos}`)
  if (r.password && !E.ALTA_OWNER_PASSWORD) {
    console.log(`  contraseña de ${p.owner} (guárdala, no se vuelve a mostrar): ${r.password}`)
  } else if (r.password) {
    console.log(`  contraseña de ${p.owner}: la de ALTA_OWNER_PASSWORD`)
  }
  console.log(`\nSiguiente: entrar al backoffice como ${p.owner} y seguir la lista de docs/operacion/ALTA_DE_TIENDAS.md.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
