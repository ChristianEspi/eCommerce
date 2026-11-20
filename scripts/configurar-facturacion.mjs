/**
 * Conecta el planificador con `invoicing-worker` (facturación fase 2).
 *
 * Lo que hace, en orden:
 *  1. Genera la clave del trabajador y la guarda como secreto de funciones
 *     (`EBIM_INVOICING_WORKER_KEY`).
 *  2. Deja en Vault la URL y la clave que usa el cron `ecommerce-invoicing-worker`
 *     (`invoicing_worker_url`, `invoicing_worker_key`).
 *
 * Las credenciales de Nubefact NO van aquí: son de cada sociedad y las carga su
 * owner/admin desde Configuración (o `invoicing_nubefact_configure`).
 *
 * Cada ejecución rota la clave. Uso:  node scripts/configurar-facturacion.mjs
 * Con `--quitar` borra el destino de Vault y el cron deja de llamar.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const SUPABASE_URL = env.VITE_SUPABASE_URL.replace(/\/+$/, '')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const QUITAR = process.argv.includes('--quitar')

async function api(method, path, body) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`

async function vaultUpsert(name, value) {
  await api('POST', '/database/query', {
    query: `do $$ declare v uuid; begin
      select id into v from vault.secrets where name = ${lit(name)};
      if v is null then perform vault.create_secret(${lit(value)}, ${lit(name)});
      else perform vault.update_secret(v, ${lit(value)}); end if;
    end $$;`,
  })
}

async function vaultDelete(name) {
  await api('POST', '/database/query', { query: `delete from vault.secrets where name = ${lit(name)};` })
}

if (QUITAR) {
  await vaultDelete('invoicing_worker_url')
  await vaultDelete('invoicing_worker_key')
} else {
  const clave = randomBytes(36).toString('base64url')
  await api('POST', '/secrets', [{ name: 'EBIM_INVOICING_WORKER_KEY', value: clave }])
  await vaultUpsert('invoicing_worker_url', `${SUPABASE_URL}/functions/v1/invoicing-worker`)
  await vaultUpsert('invoicing_worker_key', clave)
}

const [cron] = await api('POST', '/database/query', {
  query: `select jobname, schedule, active from cron.job where jobname = 'ecommerce-invoicing-worker'`,
})
console.log(
  JSON.stringify(
    {
      proyecto: REF,
      destino_en_vault: !QUITAR,
      cron: cron ?? 'no programado (¿falta aplicar la migración 20261120120000?)',
    },
    null,
    2,
  ),
)
