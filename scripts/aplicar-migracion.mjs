/**
 * Aplica UNA migracion del repositorio al proyecto, por la API de gestion.
 *
 * Existe porque `supabase db push` pide la contrasena de la base de forma
 * interactiva y este entorno no la tiene. Lee el archivo tal cual: lo que se
 * aplica es exactamente lo que queda versionado.
 *
 * Uso: node scripts/aplicar-migracion.mjs supabase/migrations/<archivo>.sql
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const archivo = process.argv[2]
if (!archivo) {
  console.error('Uso: node scripts/aplicar-migracion.mjs <ruta al .sql>')
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
const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
const sql = readFileSync(join(ROOT, archivo), 'utf8')

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
})
const cuerpo = await r.json()
if (!r.ok) {
  console.error('FALLO:', JSON.stringify(cuerpo))
  process.exit(1)
}
console.log(`Aplicada: ${archivo}`)
