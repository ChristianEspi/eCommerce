/**
 * Alta de un usuario B2B, que hoy no tiene modulo.
 *
 * La identidad es del hub y eCommerce solo la reconoce: por eso el portal
 * vincula (pega un UUID) pero no crea cuentas, y por eso esto vive en un script
 * y no en una pantalla. Cuando exista la invitacion por correo de la fase de
 * identidad, esto sobra.
 *
 * Hace dos cosas y las deja verificadas:
 *   1. crea el acceso en Auth con `email_confirm`, que NO manda correo;
 *   2. lo vincula a la cuenta de empresa en estado `active` — con `invited` la
 *      persona entra pero ve el precio de catalogo, porque `ebim.pricing_actor`
 *      exige el vinculo activo.
 *
 * Uso: node scripts/crear-usuario-b2b.mjs <correo> <contrasena> "<cuenta>" [limite]
 *      El limite vacio = sin limite propio. OJO: el limite personal NO manda a
 *      autorizacion, RECHAZA la compra que lo supere (`LIMITE_DE_AUTORIZACION`).
 *
 * La clave de servicio se lee del `.env` y no se imprime nunca.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [correo, contrasena, cuenta = 'Policlinico Andino', limite] = process.argv.slice(2)

if (!correo || !contrasena) {
  console.error('Uso: node scripts/crear-usuario-b2b.mjs <correo> <contrasena> "<cuenta>" [limite]')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const URL_BASE = env.VITE_SUPABASE_URL
const SECRETO = env.SUPABASE_SECRET_KEY
const REF = new globalThis.URL(URL_BASE).hostname.split('.')[0]
if (!SECRETO) {
  console.error('Falta SUPABASE_SECRET_KEY en .env')
  process.exit(1)
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(cuerpo))
  return cuerpo
}

const escapar = (texto) => String(texto).replace(/'/g, "''")

// ---- 1 · El acceso -------------------------------------------------------
// `email_confirm: true` es lo que evita el correo: la cuenta nace confirmada y
// no hay nada que confirmar. Sin esto, con `mailer_autoconfirm` en false, saldria
// un correo de verificacion a un buzon real.
const existentes = await sql(
  `select id, email from auth.users where lower(email) = lower('${escapar(correo)}')`,
)

let userId = existentes[0]?.id ?? null

if (userId) {
  console.log(`· El acceso ya existia: ${correo}`)
} else {
  const alta = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SECRETO,
      Authorization: `Bearer ${SECRETO}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: correo, password: contrasena, email_confirm: true }),
  })
  const creado = await alta.json()
  if (!alta.ok) throw new Error(`No se pudo crear el acceso: ${JSON.stringify(creado)}`)
  userId = creado.id
  console.log(`· Acceso creado y confirmado, sin enviar correo: ${correo}`)
}

// ---- 2 · El vinculo con la empresa ---------------------------------------
const filas = await sql(`
  with cuenta as (
    select a.id, a.organization_id, a.company_id, a.name
      from public.business_accounts a
     where a.name ilike '%${escapar(cuenta)}%' and a.is_active
     limit 1
  )
  insert into public.business_account_users
    (organization_id, company_id, business_account_id, user_id, email, role, status, spending_limit)
  select c.organization_id, c.company_id, c.id, '${escapar(userId)}'::uuid,
         '${escapar(correo)}', 'buyer', 'active',
         ${limite ? `${Number(limite)}::numeric` : 'null'}
    from cuenta c
   where not exists (
     select 1 from public.business_account_users x
      where x.business_account_id = c.id and x.user_id = '${escapar(userId)}'::uuid)
  returning business_account_id, email, role, status, spending_limit`)

if (filas.length === 0) console.log('· El vinculo ya existia; no se toco.')
else console.log('· Vinculado a la cuenta en estado activo.')

// ---- 3 · Lo que quedo, leido de la base -----------------------------------
const comprobacion = await sql(`
  select u.email, bu.role, bu.status, bu.spending_limit, a.name as cuenta,
         c.name as cliente, s.code as segmento, bu.user_id
    from public.business_account_users bu
    join public.business_accounts a on a.id = bu.business_account_id
    left join public.customers c on c.id = a.customer_id
    left join public.customer_segments s on s.id = c.segment_id
    join auth.users u on u.id = bu.user_id
   where lower(u.email) = lower('${escapar(correo)}')`)

console.log('\n=== Como quedo ===')
console.table(comprobacion)
console.log(`\nId de usuario (por si lo quieres pegar en el portal): ${userId}`)
