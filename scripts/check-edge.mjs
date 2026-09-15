#!/usr/bin/env node
/**
 * Gate de tipos de las Edge Functions con Deno (cierre, item 14).
 *
 * `tsc` del frontend no ve el borde: los `index.ts` y `_runtime/*` usan globales
 * de Deno y especificadores `npm:`, y quedan fuera de `tsconfig.json`. Sin esto
 * un error de tipos en una Edge Function solo aparece al desplegar. La primera
 * ejecución encontró dos: `catalog-copy` mandaba el texto del error como código
 * y `_shared/userProvisioning.ts` no compilaba con el TypeScript de Deno.
 *
 * ## Qué comprueba
 *
 * TODOS los `.ts` bajo `supabase/functions` salvo los `*.test.ts` (que corren en
 * Vitest): los puntos de entrada y también lo compartido que todavía nadie
 * importa. Sale con el código de `deno check`; con 0 archivos, sale con 1 —un
 * gate que no mira nada no puede decir «verde»—.
 *
 * ## Con qué Deno, en este orden
 *
 *  1. `DENO_BIN`, si está definida.
 *  2. `deno` en el PATH.
 *  3. El paquete oficial `deno` de npm, en la versión FIJADA abajo, vía `npx`.
 *     No es devDependency a propósito: `engine-strict` rechaza hoy la
 *     instalación en el Node del contrato por una dependencia de ESLint, y el
 *     gate no puede depender de tocar el árbol de dependencias.
 *
 * Si ninguno está disponible, falla. Nunca se salta en silencio.
 *
 * ## Configuración propia
 *
 * `scripts/deno.check.json`: sin ella Deno hereda el `tsconfig.json` del
 * frontend y resuelve `npm:` contra su `node_modules`, que no es lo que hace el
 * runtime de Supabase. No vive en `supabase/functions` para no cambiar cómo se
 * despliega nada.
 *
 * Uso:  node scripts/check-edge.mjs        (o `npm run check:edge`)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Versión del paquete oficial `deno` de npm cuando no hay Deno instalado. */
export const DENO_VERSION = '2.9.6'

function repoRoot() {
  try {
    return fileURLToPath(new URL('..', import.meta.url))
  } catch {
    return process.cwd()
  }
}

const ROOT = repoRoot()

/** Los `.ts` que se comprueban, en orden estable y con barras `/`. */
export function listEdgeFiles(root = ROOT) {
  const base = join(root, 'supabase', 'functions')
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        out.push(relative(root, full).split(sep).join('/'))
      }
    }
  }
  if (existsSync(base)) walk(base)
  return out.sort()
}

/** Argumentos de `deno check`. Nada de `--no-check` ni de `--allow-*`. */
export function checkArgs(files) {
  return ['check', '--quiet', '--config', 'scripts/deno.check.json', ...files]
}

function onPath(command) {
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore', shell: false })
  return probe.status === 0
}

/**
 * Cómo invocar Deno: `{ command, prefix }`, o `null` si no hay forma.
 * `env` y `probe` se inyectan para poder probar el orden sin Deno de verdad.
 */
export function resolveDeno(env = process.env, probe = onPath) {
  if (env.DENO_BIN) return { command: env.DENO_BIN, prefix: [], source: 'DENO_BIN' }
  if (probe('deno')) return { command: 'deno', prefix: [], source: 'PATH' }

  // `npx` por su script de Node y no por `npx.cmd`: así los argumentos viajan
  // como lista también en Windows, sin pasar por una shell.
  const candidates = [
    env.npm_execpath ? join(dirname(env.npm_execpath), 'npx-cli.js') : null,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].filter(Boolean)
  const npx = candidates.find((candidate) => existsSync(candidate))
  if (!npx) return null
  return { command: process.execPath, prefix: [npx, '--yes', `deno@${DENO_VERSION}`], source: `npm deno@${DENO_VERSION}` }
}

function main() {
  const files = listEdgeFiles()
  if (files.length === 0) {
    console.error('check:edge — no hay ningún .ts bajo supabase/functions: el gate no puede pasar sin mirar nada.')
    return 1
  }
  const deno = resolveDeno()
  if (!deno) {
    console.error('check:edge — no hay Deno: define DENO_BIN, instala deno o deja disponible npx.')
    return 1
  }
  console.log(`check:edge — ${files.length} archivos con ${deno.source}`)
  const run = spawnSync(deno.command, [...deno.prefix, ...checkArgs(files)], { cwd: ROOT, stdio: 'inherit' })
  if (run.error) {
    console.error(`check:edge — no se pudo ejecutar Deno: ${run.error.message}`)
    return 1
  }
  if (run.status === 0) console.log('check:edge — sin errores de tipos ni de imports.')
  return run.status ?? 1
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
})()

if (invokedDirectly) process.exit(main())
