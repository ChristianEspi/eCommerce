// @vitest-environment node
/**
 * El diccionario partido en dos (cierre · certificación), vigilado.
 *
 * La vitrina solo descarga `messages.es.ts`; `messages.es.backoffice.ts` llega
 * por `import()` al entrar en `/app` o `/onboarding`. Eso es seguro mientras
 * NINGÚN archivo que un visitante de la vitrina pueda cargar use un namespace
 * del backoffice: si lo usara, pintaría la clave cruda. Esta prueba no confía en
 * una lista escrita a mano: recorre el grafo de imports desde el arranque y las
 * páginas públicas, igual que lo haría el navegador.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { es as esCore } from './messages.es'
import { esBackoffice } from './messages.es.backoffice'
import { es, loadBackofficeMessages, type MessageKey } from './messages'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ROUTES = join(SRC, 'app', 'routes.tsx')

const STATIC = /(?:^|\n)\s*(?:import|export)\s(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const DYNAMIC = /import\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveSpec(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate
  }
  return null
}

function importsOf(file: string, dynamic: boolean): string[] {
  const text = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of text.matchAll(STATIC)) {
    const target = resolveSpec(file, (match[1] ?? match[2]) as string)
    if (target) found.push(target)
  }
  if (dynamic) {
    for (const match of text.matchAll(DYNAMIC)) {
      const target = resolveSpec(file, match[1] as string)
      if (target) found.push(target)
    }
  }
  return found
}

/** Lo que un visitante de la vitrina puede llegar a cargar. */
function storefrontReachable(): Set<string> {
  const reach = new Set<string>()
  const walk = (file: string, dynamic: boolean) => {
    // Los diccionarios no cuentan: son la cosa que se está midiendo.
    if (reach.has(file) || /[\\/]i18n[\\/]messages\./.test(file)) return
    reach.add(file)
    // En `routes.tsx` no se siguen los `import()`: ahí están TODAS las páginas,
    // también las del backoffice.
    for (const next of importsOf(file, dynamic && file !== ROUTES)) walk(next, dynamic)
  }
  walk(join(SRC, 'main.tsx'), false)
  const publicPages = [...readFileSync(ROUTES, 'utf8').matchAll(DYNAMIC)]
    .map((match) => match[1] as string)
    .filter((spec) => /features\/(storefront|auth|notifications\/StoreUnsubscribePage)/.test(spec))
  expect(publicPages.length).toBeGreaterThan(10)
  for (const spec of publicPages) {
    const file = resolveSpec(ROUTES, spec)
    expect(file, spec).toBeTruthy()
    walk(file as string, true)
  }
  return reach
}

const namespaceOf = (key: string) => key.split('.')[0] as string
const backofficeNamespaces = [...new Set(Object.keys(esBackoffice).map(namespaceOf))].sort()

describe('el diccionario del backoffice no hace falta en la vitrina', () => {
  it('ningún archivo alcanzable desde la vitrina usa un namespace del backoffice', () => {
    const reach = storefrontReachable()
    // Si el recorrido se rompe y no encuentra casi nada, la prueba pasaría sin
    // mirar: se exige un grafo de tamaño real.
    expect(reach.size).toBeGreaterThan(150)

    const offenders: string[] = []
    for (const file of reach) {
      const text = readFileSync(file, 'utf8')
      for (const ns of backofficeNamespaces) {
        if (new RegExp(`['"\`]${ns}\\.`).test(text)) offenders.push(`${file.replace(ROOT, '')} usa '${ns}.'`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('un namespace vive ENTERO en una sola mitad', () => {
    const core = new Set(Object.keys(esCore).map(namespaceOf))
    expect(backofficeNamespaces.filter((ns) => core.has(ns))).toEqual([])
    expect(Object.keys(esBackoffice).filter((key) => key in esCore)).toEqual([])
  })

  it('cargar la parte del backoffice la deja disponible en el mismo diccionario', async () => {
    await loadBackofficeMessages()
    const key = Object.keys(esBackoffice)[0] as MessageKey
    expect(es[key]).toBe((esBackoffice as Record<string, string>)[key])
    // Y lo de la vitrina sigue ahí.
    const coreKey = Object.keys(esCore)[0] as MessageKey
    expect(es[coreKey]).toBe((esCore as Record<string, string>)[coreKey])
  })

  it('las dos puertas del backoffice esperan a su diccionario antes de pintar', () => {
    const routes = readFileSync(ROUTES, 'utf8')
    for (const page of ['AdminLayout', 'OnboardingPage']) {
      const loader = new RegExp(`const ${page} = lazyPage\\(\\(\\) =>[\\s\\S]*?loadBackofficeMessages\\(\\)[\\s\\S]*?\\n\\)`)
      expect(routes, page).toMatch(loader)
    }
  })
})
