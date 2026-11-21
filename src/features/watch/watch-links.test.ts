// @vitest-environment node
/**
 * 2026-11-20 · Los enlaces del centro de vigilancia llevan a una pantalla que
 * EXISTE. «Eventos críticos» enlazó meses a `/app/ops` (página no encontrada)
 * porque nada lo comprobaba: los enlaces viven en SQL y las rutas en React.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { watchModuleFromPath } from './modules'

const ROOT = join(__dirname, '..', '..', '..')

function rutasDelPanel(): Set<string> {
  const routes = readFileSync(join(ROOT, 'src/app/routes.tsx'), 'utf8')
  const rutas = new Set(['/app'])
  for (const m of routes.matchAll(/\{ path: '([a-z-]+)', element:/g)) rutas.add(`/app/${m[1]}`)
  return rutas
}

function enlacesVigentesDeVigilancia(): string[] {
  const dir = join(ROOT, 'supabase/migrations')
  const ultima = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('create or replace function public.watch_findings('))
    .pop()
  if (!ultima) throw new Error('no hay definición de watch_findings')
  const sql = readFileSync(join(dir, ultima), 'utf8')
  return [...sql.matchAll(/'(\/app[^' ]*)'/g)].map((m) => m[1] as string)
}

describe('enlaces del centro de vigilancia', () => {
  it('cada aviso lleva a una ruta del panel que existe', () => {
    const rutas = rutasDelPanel()
    const enlaces = enlacesVigentesDeVigilancia()
    expect(enlaces.length).toBeGreaterThan(5)
    const rotos = enlaces.filter((href) => !rutas.has(href.split(/[?#]/)[0]!.replace(/\/$/, '')))
    expect(rotos).toEqual([])
  })

  it('Operaciones se reconoce como módulo «ops» por su ruta real', () => {
    expect(watchModuleFromPath('/app/operations')).toBe('ops')
    expect(watchModuleFromPath('/app/ops')).toBeNull()
  })
})
