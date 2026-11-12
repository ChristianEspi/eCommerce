/**
 * Configura el trabajador de las fuentes de lectura (`connector-pull`).
 *
 * Lo que hace, en orden:
 *  1. Genera una clave aleatoria para el trabajador (no se imprime).
 *  2. La guarda como secreto de funciones `EBIM_CONNECTOR_PULL_KEY`.
 *  3. Deja en Vault la URL de la función (`connector_pull_url`) y la misma
 *     clave (`connector_pull_key`): es lo que lee la tarea programada
 *     `ecommerce-connector-pull` (migración 20261112120000) para llamarla.
 *  4. Comprueba que la función acepta la clave nueva.
 *
 * Se puede ejecutar las veces que haga falta: cada ejecución ROTA la clave.
 * Lo ejecuta el OPERADOR (escribe secretos del proyecto).
 *
 * Uso: node scripts/configurar-conector.mjs
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
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/connector-pull`

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

/** Escapa un literal para SQL. Los valores son generados aquí, pero no se confía en eso. */
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

const clave = randomBytes(36).toString('base64url')
await api('POST', '/secrets', [{ name: 'EBIM_CONNECTOR_PULL_KEY', value: clave }])
await vaultUpsert('connector_pull_url', FUNCTION_URL)
await vaultUpsert('connector_pull_key', clave)

// El secreto nuevo tarda unos segundos en llegar a la función.
let estado = 0
for (let intento = 0; intento < 10; intento += 1) {
  const r = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'x-ebim-worker-key': clave } })
  estado = r.status
  await r.body?.cancel()
  if (estado === 200) break
  await new Promise((resolve) => setTimeout(resolve, 3000))
}

console.log(
  JSON.stringify(
    {
      proyecto: REF,
      funcion: FUNCTION_URL,
      secreto_de_funcion: 'EBIM_CONNECTOR_PULL_KEY (guardado, no se muestra)',
      vault: ['connector_pull_url', 'connector_pull_key'],
      la_funcion_acepta_la_clave: estado === 200,
      respuesta: estado,
    },
    null,
    2,
  ),
)
