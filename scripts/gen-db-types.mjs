#!/usr/bin/env node
/**
 * Genera `src/shared/lib/database.types.ts` desde el proyecto Supabase enlazado.
 *
 * Existe por un fallo concreto y caro de detectar (R11 del baseline). El script
 * anterior era:
 *
 *     supabase gen types typescript --linked --schema public > src/shared/lib/database.types.ts
 *
 * y esa redirección **trunca el destino antes de ejecutar el comando**. Si el
 * CLI falla —proyecto no enlazado, sesión caducada, red— el archivo queda en
 * cero bytes con un exit code que nadie mira. Pasó: el archivo estuvo
 * commiteado vacío desde `6e66080`, y nadie lo notó porque ningún módulo lo
 * importaba.
 *
 * Aquí se genera a un temporal, se valida, y solo entonces se mueve. Un fallo
 * deja el archivo anterior intacto y devuelve exit 1.
 *
 * Requiere el CLI de Supabase y el proyecto enlazado (`supabase link`).
 *
 * ## Desde una base LOCAL (Release Candidate, R02)
 *
 * `DB_TYPES_DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres npm run db:types`
 * genera contra esa base en vez de contra el proyecto enlazado. Es la forma de
 * obtener los tipos de migraciones que todavía no están aplicadas en DEV/QAS
 * sin tocar DEV/QAS. Solo se admite un host local: un `DB_TYPES_DB_URL` remoto
 * se rechaza, para que nadie apunte esto por error a una base compartida.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(ROOT, 'src', 'shared', 'lib', 'database.types.ts')
// El temporal va JUNTO al destino, no en `os.tmpdir()`: en Windows el temporal
// del usuario suele estar en otra unidad y `rename` entre volumenes falla con
// EXDEV. Un movimiento dentro del mismo directorio es ademas atomico.
const TEMP = `${TARGET}.tmp-${process.pid}`

function fail(reason) {
  rmSync(TEMP, { force: true })
  console.error(`\n[db:types] ${reason}`)
  console.error('[db:types] El archivo anterior NO se ha tocado.')
  process.exit(1)
}

const localDbUrl = process.env.DB_TYPES_DB_URL
let source = ['--linked']
if (localDbUrl) {
  let host = ''
  try {
    host = new URL(localDbUrl).hostname
  } catch {
    fail('DB_TYPES_DB_URL no es una URL de Postgres válida.')
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    fail(`DB_TYPES_DB_URL apunta a ${host}: solo se admite una base local.`)
  }
  source = ['--db-url', `"${localDbUrl}"`]
}

const result = spawnSync(
  'supabase',
  ['gen', 'types', 'typescript', ...source, '--schema', 'public'],
  { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 },
)

if (result.error) fail(`no se pudo ejecutar el CLI de Supabase: ${result.error.message}`)
if (result.status !== 0) {
  fail(`el CLI devolvió ${result.status}.\n${(result.stderr ?? '').trim()}`)
}

const output = result.stdout ?? ''

// Las tres condiciones que el `>` no comprobaba nunca.
if (output.trim().length === 0) fail('el CLI no escribió nada en la salida estándar.')
if (!/export type Database\b/.test(output)) {
  fail('la salida no declara `export type Database`: no es un archivo de tipos válido.')
}
if (!/\bTables:/.test(output)) fail('la salida no contiene tablas: el esquema vino vacío.')

mkdirSync(dirname(TARGET), { recursive: true })
writeFileSync(TEMP, output, 'utf8')

const previousBytes = existsSync(TARGET) ? readFileSync(TARGET, 'utf8').length : 0
renameSync(TEMP, TARGET)

console.log(
  `[db:types] ${TARGET} actualizado (${output.length} caracteres, antes ${previousBytes}).`,
)
