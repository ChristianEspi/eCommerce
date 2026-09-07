/**
 * Preflight de la demo: ¿se puede recorrer el golden path de punta a punta?
 *
 * ## Por qué VERIFICA y no siembra
 *
 * Los seeds de este repositorio ya existen y son idempotentes, pero volver a
 * correrlos contra un proyecto que ya tiene 573 productos y 18 pedidos no es
 * gratis: los catálogos de `seed-miquimica-catalog.mjs` y `seed-demo-catalog.mjs`
 * se solapan sobre la misma tienda, y una demo a dos días vista no es el momento
 * de descubrir qué pasa al ejecutarlos otra vez.
 *
 * Así que esto MIDE. Cada comprobación dice qué falta y con qué script se
 * arregla, y solo se siembra lo que el informe señale. Correrlo no cambia ni una
 * fila: son consultas de lectura.
 *
 * ## Qué mide, y por qué esas cosas
 *
 * Los doce puntos por los que pasa la demo, en el mismo orden en que se
 * recorren. No mide «hay datos»: mide **lo que la vitrina puede pintar**, que es
 * distinto. Un producto sin precio en lista activa existe en `products` y no
 * existe para el comprador, y descubrirlo delante del cliente es la clase de
 * fallo que este archivo evita.
 *
 * Uso:  node scripts/demo-preflight.mjs [slug]
 *       (por defecto, `miquimica`)
 *
 * Salida: una línea por comprobación y un resumen. Termina con código 1 si algo
 * bloquea la demo, para poder encadenarlo en un gate.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = process.argv[2] ?? 'miquimica'

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

if (!env.VITE_SUPABASE_URL || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('Faltan VITE_SUPABASE_URL o SUPABASE_ACCESS_TOKEN en .env')
  process.exit(1)
}

const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]

async function sql(query) {
  const respuesta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await respuesta.text()
  if (!respuesta.ok) throw new Error(cuerpo.slice(0, 300))
  return cuerpo ? JSON.parse(cuerpo) : []
}

const lit = (valor) => `'${String(valor).replace(/'/g, "''")}'`

/**
 * Las doce comprobaciones, en el orden del guion de demo.
 *
 * `minimo` es lo que hace falta para que la pantalla se vea bien, no lo mínimo
 * técnico: cuatro categorías porque con tres la portada queda coja, veinte
 * productos porque con cinco el catálogo parece una maqueta.
 */
const COMPROBACIONES = [
  {
    paso: 'Tienda activa',
    minimo: 1,
    arreglo: 'supabase/seed.sql',
    query: `select count(*)::int as n from public.stores where slug = ${lit(SLUG)} and status = 'active'`,
  },
  {
    paso: 'Categorías raíz activas',
    minimo: 4,
    arreglo: 'supabase/demo-data.sql',
    query: `select count(*)::int as n from public.categories c
            join public.stores s on s.id = c.store_id
            where s.slug = ${lit(SLUG)} and c.parent_id is null and c.is_active`,
  },
  {
    paso: 'Productos que la vitrina puede pintar',
    minimo: 20,
    arreglo: 'node scripts/seed-miquimica-catalog.mjs',
    query: `select count(*)::int as n from public.public_products p
            join public.stores s on s.id = p.store_id where s.slug = ${lit(SLUG)}`,
  },
  {
    paso: 'Productos con foto',
    minimo: 20,
    arreglo: 'node scripts/seed-product-images.mjs',
    query: `select count(*)::int as n from public.public_products p
            join public.stores s on s.id = p.store_id
            where s.slug = ${lit(SLUG)} and p.primary_image_path is not null`,
  },
  {
    paso: 'Productos con precio',
    minimo: 20,
    arreglo: 'supabase/demo-data.sql (listas de precios)',
    query: `select count(*)::int as n from public.public_products p
            join public.stores s on s.id = p.store_id
            where s.slug = ${lit(SLUG)} and coalesce(p.price, p.price_from) is not null`,
  },
  {
    paso: 'Productos con stock',
    minimo: 10,
    arreglo: 'node scripts/seed-miquimica-catalog.mjs',
    query: `select count(*)::int as n from public.public_products p
            join public.stores s on s.id = p.store_id
            where s.slug = ${lit(SLUG)} and p.in_stock`,
  },
  {
    paso: 'Productos rebajados (para el hero)',
    minimo: 3,
    arreglo: 'node scripts/seed-demo-discounts.mjs',
    query: `select count(*)::int as n from public.public_products p
            join public.stores s on s.id = p.store_id
            where s.slug = ${lit(SLUG)} and p.compare_at_price is not null`,
  },
  {
    paso: 'Métodos de entrega activos',
    minimo: 2,
    arreglo: 'supabase/demo-data.sql (delivery_methods)',
    query: `select count(*)::int as n from public.delivery_methods d
            join public.stores s on s.id = d.store_id
            where s.slug = ${lit(SLUG)} and d.is_active`,
  },
  {
    paso: 'Medios de pago activos',
    minimo: 2,
    arreglo: 'supabase/demo-data.sql (payment_methods)',
    query: `select count(*)::int as n from public.payment_methods m
            join public.stores s on s.id = m.store_id
            where s.slug = ${lit(SLUG)} and m.is_active`,
  },
  {
    paso: 'Promociones vigentes',
    minimo: 1,
    arreglo: 'node scripts/seed-miquimica-promos.mjs',
    query: `select count(*)::int as n from public.promotions p
            join public.stores s on s.id = p.store_id
            where s.slug = ${lit(SLUG)} and p.status = 'active'
              and now() between p.valid_from and p.valid_to`,
  },
  {
    // Uno basta, y no es una rebaja del listón: la portada NO se compone solo
    // de bloques de CMS. El hero de oferta, la franja de servicios, la banda de
    // destacados, el carrusel de promociones y las filas de producto son
    // secciones propias de `StoreHomePage` que no pasan por `content_blocks`.
    // Pedir tres aquí medía una cosa distinta de la que se ve en pantalla.
    paso: 'Bloques de portada activos',
    minimo: 1,
    arreglo: 'supabase/home-compose-miquimica.sql',
    query: `select count(*)::int as n from public.content_blocks b
            join public.content_pages g on g.id = b.page_id
            join public.stores s on s.id = b.store_id
            where s.slug = ${lit(SLUG)} and g.kind = 'home' and b.is_active`,
  },
  {
    paso: 'Almacenes con existencias',
    minimo: 1,
    arreglo: 'supabase/demo-data.sql (warehouses)',
    query: `select count(*)::int as n from public.warehouses w
            join public.stores s on s.organization_id = w.organization_id
            where s.slug = ${lit(SLUG)}`,
  },
]

console.log(`\nPreflight de demo · tienda «${SLUG}» · proyecto ${REF}\n`)
console.log('  ESTADO   COMPROBACIÓN                          TIENE  MÍNIMO')
console.log('  ' + '-'.repeat(66))

let bloqueantes = 0
const pendientes = []

for (const control of COMPROBACIONES) {
  let n = 0
  let roto = false
  try {
    const filas = await sql(control.query)
    n = Number(filas[0]?.n ?? 0)
  } catch (error) {
    roto = true
    console.log(`  ERROR    ${control.paso.padEnd(36)}   ${String(error.message).slice(0, 60)}`)
  }
  if (roto) {
    bloqueantes++
    continue
  }

  const ok = n >= control.minimo
  if (!ok) {
    bloqueantes++
    pendientes.push(control)
  }
  console.log(
    `  ${(ok ? 'OK' : 'FALTA').padEnd(8)} ${control.paso.padEnd(36)} ${String(n).padStart(5)}  ${String(control.minimo).padStart(6)}`,
  )
}

console.log('')
if (bloqueantes === 0) {
  console.log('  El golden path tiene todo lo que necesita.\n')
  process.exit(0)
}

console.log(`  ${bloqueantes} comprobación(es) sin cumplir. Para cada una:\n`)
for (const control of pendientes) {
  console.log(`    ${control.paso}`)
  console.log(`      -> ${control.arreglo}`)
}
console.log('')
process.exit(1)
