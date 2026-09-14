#!/usr/bin/env node
/**
 * Presupuesto de descarga por RECORRIDO, no por chunk (P15-SaaS).
 *
 * El aviso de Vite («some chunks are larger than…») mide el archivo más grande,
 * que no es lo que espera nadie: un visitante de la vitrina descarga el chunk
 * de entrada MÁS el cierre de imports estáticos de su ruta perezosa. Este
 * script calcula ese cierre a partir de `dist/.vite/manifest.json` y lo compara
 * con el techo declarado en `docs/performance-budget.md`.
 *
 * Uso:
 *   npm run build && npm run bundle:report
 *
 * Sale con código 1 si algún recorrido se pasa de su techo, para que se pueda
 * enchufar a un gate sin escribir nada más.
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const MANIFEST = join(DIST, '.vite', 'manifest.json')

/**
 * Recorridos vigilados. La clave es la ruta del módulo tal y como la escribe el
 * manifiesto; el techo es en kB gzip y está justificado en el documento.
 */
const JOURNEYS = [
  {
    name: 'vitrina · portada',
    entry: 'index.html',
    routes: [
      'src/features/storefront/StorefrontLayout.tsx',
      'src/features/storefront/StoreHomePage.tsx',
    ],
    // 400 -> 405 en el hardening multi-commerce (2026-09-13). Motivo en
    // docs/performance-budget.md §2.1: la portada ya medía 399,5 antes de empezar.
    budgetKb: 405,
  },
  {
    name: 'vitrina · ficha de producto',
    entry: 'index.html',
    routes: [
      'src/features/storefront/StorefrontLayout.tsx',
      'src/features/storefront/StoreProductPage.tsx',
    ],
    budgetKb: 400,
  },
  {
    name: 'vitrina · checkout',
    entry: 'index.html',
    routes: [
      'src/features/storefront/StorefrontLayout.tsx',
      'src/features/storefront/StoreCheckoutPage.tsx',
    ],
    budgetKb: 430,
  },
  {
    name: 'backoffice · panel',
    entry: 'index.html',
    routes: ['src/features/admin/AdminLayout.tsx', 'src/features/admin/DashboardPage.tsx'],
    budgetKb: 430,
  },
]

if (!existsSync(MANIFEST)) {
  console.error(`No existe ${MANIFEST}. Ejecuta "npm run build" antes.`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

const gzipCache = new Map()
function gzipBytes(file) {
  if (!gzipCache.has(file)) gzipCache.set(file, gzipSync(readFileSync(join(DIST, file))).length)
  return gzipCache.get(file)
}

/** Cierre de imports ESTÁTICOS. Los dinámicos no se descargan hasta usarlos. */
function closure(keys, seen = new Set()) {
  for (const key of keys) {
    if (seen.has(key)) continue
    const entry = manifest[key]
    if (!entry) {
      console.error(`El manifiesto no conoce "${key}". ¿Cambió de sitio el módulo?`)
      process.exit(1)
    }
    seen.add(key)
    closure(entry.imports ?? [], seen)
  }
  return seen
}

function filesOf(keys) {
  const files = new Set()
  for (const key of closure(keys)) {
    const entry = manifest[key]
    files.add(entry.file)
    for (const css of entry.css ?? []) files.add(css)
  }
  return files
}

let failed = false
const rows = []

for (const journey of JOURNEYS) {
  const shared = filesOf([journey.entry])
  const total = filesOf([journey.entry, ...journey.routes])
  const sum = (set) => [...set].reduce((acc, file) => acc + gzipBytes(file), 0)

  const entryKb = sum(shared) / 1024
  const totalKb = sum(total) / 1024
  const over = totalKb > journey.budgetKb
  if (over) failed = true

  rows.push({
    recorrido: journey.name,
    'entrada kB': entryKb.toFixed(1),
    'ruta kB': (totalKb - entryKb).toFixed(1),
    'total kB': totalKb.toFixed(1),
    'techo kB': journey.budgetKb,
    estado: over ? 'EXCEDE' : 'ok',
  })
}

console.log('\nBytes gzip hasta el primer pintado, por recorrido\n')
console.table(rows)

if (failed) {
  console.error('\nAlgún recorrido se pasa del techo declarado en docs/performance-budget.md.')
  process.exit(1)
}
console.log('Todos los recorridos dentro del techo.\n')
