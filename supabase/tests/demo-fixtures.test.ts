// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase } from './harness'

/**
 * Los fixtures de demostración, aplicados sobre Postgres de verdad.
 *
 * ## Por qué existe esta prueba
 *
 * `seed.sql` y `demo-data.sql` son ochocientas líneas de SQL que nadie ejecuta
 * hasta el día que se siembra el proyecto de DEV — y ese día, un `enum` que ya
 * no existe o un texto que no pasa un CHECK deja el proyecto a medio sembrar,
 * con la mitad de las pantallas vacías y sin una pista de dónde se rompió. Aquí
 * se aplican contra el mismo esquema que la nube, y un fallo sale en la suite.
 *
 * Lo comprueba de punta a punta: que el catálogo entra, que el contenido pasa
 * el CHECK de texto enriquecido (`ebim.rich_text_is_safe`, que NO admite
 * etiquetas), y que el vaciado se lleva lo que dice llevarse dejando en pie al
 * tenant y sus tiendas — que es de donde cuelga la pertenencia del operador.
 *
 * El tenant B no se toca en ningún momento: es el que prueba el aislamiento, y
 * un fixture que lo llenara escondería una fuga de RLS justo donde se mira.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const ORG = 'd0000000-0000-4000-8000-000000000001'
const STORE = 'd0000000-0000-4000-8000-0000000000a1'

function file(name: string): string {
  return readFileSync(join(ROOT, 'supabase', name), 'utf8')
}

let db: PGlite

async function count(table: string, where = `organization_id = '${ORG}'`): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${where}`,
  )
  return result.rows[0]?.n ?? 0
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('los fixtures de la demo se aplican sobre el esquema real', () => {
  it('`seed.sql` deja la botica con su catálogo y su marca', async () => {
    await db.exec(file('seed.sql'))

    const store = await db.query<{ slug: string; name: string }>(
      `select slug, name from public.stores where id = '${STORE}'`,
    )
    expect(store.rows[0]?.slug).toBe('miquimica')

    // Publicados, un borrador y un archivado: es lo que hace visible que la
    // vitrina filtra por estado.
    expect(await count('products', `store_id = '${STORE}'`)).toBe(10)
    // ADR 018: el estado es de la publicación en la tienda.
    expect(await count('store_products', `store_id = '${STORE}' and status = 'published'`)).toBe(8)
    expect(await count('categories', `store_id = '${STORE}' and is_active`)).toBe(3)
  })

  it('`demo-data.sql` llena el backoffice sin violar un solo CHECK', async () => {
    await db.exec(file('demo-data.sql'))

    expect(await count('brands')).toBe(3)
    expect(await count('customers')).toBe(28)
    expect(await count('promotions')).toBe(5)
    expect(await count('inventory_levels')).toBeGreaterThan(20)

    // El contenido enriquecido pasa por `ebim.rich_text_is_safe`: si el texto
    // de la botica llevara una etiqueta, el insert habría fallado aquí.
    const body = await db.query<{ ok: boolean }>(
      `select ebim.rich_text_is_safe(body) as ok
         from public.content_blocks
        where organization_id = '${ORG}' and block_type = 'rich_text'`,
    )
    expect(body.rows.map((row) => row.ok)).toEqual([true])

    // Cada producto acaba con marca y familia: sin esto la faceta de marcas de
    // la vitrina vuelve vacía y el filtro se queda con media cara.
    expect(await count('products', `store_id = '${STORE}' and brand_id is null`)).toBe(0)
    expect(await count('products', `store_id = '${STORE}' and family_id is null`)).toBe(0)
  })

  it('el vaciado se lleva los datos y deja en pie al tenant y sus tiendas', async () => {
    await db.exec(file('demo-purge.sql'))

    expect(await count('products')).toBe(0)
    expect(await count('customers')).toBe(0)
    expect(await count('content_blocks')).toBe(0)
    expect(await count('brands')).toBe(0)
    expect(await count('warehouses')).toBe(0)

    // Lo que NO se borra: de la tienda cuelga la pertenencia del operador, así
    // que se renombra en vez de desaparecer.
    expect(await count('stores')).toBe(2)
    const tenant = await db.query<{ slug: string; name: string }>(
      `select slug, name from public.tenants where organization_id = '${ORG}'`,
    )
    expect(tenant.rows[0]?.slug).toBe('miquimica')
  })

  it('y después del vaciado los fixtures vuelven a entrar tal cual', async () => {
    // Es la prueba de que el ciclo completo —vaciar y volver a sembrar— es el
    // que se va a correr contra el proyecto de DEV, no una secuencia que solo
    // funciona la primera vez.
    await db.exec(file('seed.sql'))
    await db.exec(file('demo-data.sql'))

    expect(await count('products', `store_id = '${STORE}'`)).toBe(10)
    expect(await count('promotions')).toBe(5)
  })
})
