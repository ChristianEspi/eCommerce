// @vitest-environment node
/**
 * Administración de canales (cierre · item 7), sobre Postgres real.
 *
 * Lo que no puede fallar:
 *  - cambiar el canal por defecto deja SIEMPRE exactamente uno, y la vitrina
 *    sigue teniendo por dónde vender;
 *  - repetir el cambio no escribe nada (idempotente);
 *  - solo owner/admin de la sociedad dueña lo cambia, y un canal ajeno responde
 *    igual que uno que no existe;
 *  - un canal inactivo o cerrado (B2B/interno) no puede ser el de defecto;
 *  - por PostgREST nadie deja la tienda sin canal por defecto: ni desactivarlo,
 *    ni cerrarlo, ni borrarlo, ni mover la marca a mano.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'

type Row = Record<string, unknown>

const LECTOR_A = '0a000000-0000-4000-8000-0000000000e1'

let db: PGlite
let storeA: string
let storeB: string
let publicoA: string
let internoA: string
async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function comoDueno<T = Row>(
  tenant: typeof TENANT_A,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole(db, 'authenticated', claimsFor(tenant), async () => (await db.query<T>(query, params)).rows)
}

async function comoLector<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(
    db,
    'authenticated',
    claimsFor(TENANT_A, { sub: LECTOR_A, email: 'lector@tenant-a.com' }),
    async () => (await db.query<T>(query, params)).rows,
  )
}

async function canalNuevo(code: string, kind: 'b2c' | 'b2b' | 'internal', activo = true): Promise<string> {
  const [row] = await svc(
    `insert into public.channels
       (organization_id, company_id, store_id, code, name, kind, requires_auth, is_active)
     values ($1, $2, $3, $4, $4, $5::public.channel_kind, $6, $7)
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, code, kind, kind !== 'b2c', activo],
  )
  return String(row?.id)
}

async function defectosDe(storeId: string): Promise<string[]> {
  const rows = await svc(`select id from public.channels where store_id = $1 and is_default`, [storeId])
  return rows.map((r) => String(r.id))
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
  }

  const stores = await svc(`select id, slug from public.stores`)
  storeA = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
  storeB = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)
  await svc(`update public.stores set status = 'active'`)

  publicoA = (await defectosDe(storeA))[0] as string
  internoA = await canalNuevo('interno', 'internal')

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, LECTOR_A],
  )
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('cambiar el canal por defecto', () => {
  it('quita la marca al anterior y se la pone al nuevo, en una sola llamada', async () => {
    const web = await canalNuevo('web-2', 'b2c')

    const [res] = await comoDueno(TENANT_A, `select public.channel_set_default($1) as r`, [web])
    expect(res?.r).toMatchObject({ channel_id: web, previous_default_id: publicoA, changed: true })

    // Nunca cero ni dos: la vitrina elige el defecto con un select por
    // is_default, y cualquiera de los dos estados la deja sin canal o eligiendo
    // al azar.
    expect(await defectosDe(storeA)).toEqual([web])

    // Y la regla de la vitrina lo ve ya: el cambio no es solo una marca.
    // Como superusuario: `ebim.public_channel` no se concede a nadie, la llaman las puertas definer.
    const [pc] = (await db.query<Row>(`select (ebim.public_channel($1)).id as id`, [storeA])).rows
    expect(pc?.id).toBe(web)

    await comoDueno(TENANT_A, `select public.channel_set_default($1)`, [publicoA])
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })

  it('pedir el que ya es por defecto no cambia nada (idempotente)', async () => {
    const antes = await svc(`select updated_at from public.channels where store_id = $1 order by id`, [storeA])

    const [res] = await comoDueno(TENANT_A, `select public.channel_set_default($1) as r`, [publicoA])
    expect(res?.r).toMatchObject({ channel_id: publicoA, changed: false })

    const despues = await svc(`select updated_at from public.channels where store_id = $1 order by id`, [storeA])
    expect(despues).toEqual(antes)
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })

  it('un canal inactivo no puede ser el de defecto', async () => {
    const apagado = await canalNuevo('apagado', 'b2c', false)
    const message = await expectFailure(() =>
      comoDueno(TENANT_A, `select public.channel_set_default($1)`, [apagado]),
    )
    expect(message).toMatch(/CANAL_INACTIVO/)
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })

  it('un canal cerrado (interno/B2B) tampoco: la vitrina pública entra por el de defecto', async () => {
    const message = await expectFailure(() =>
      comoDueno(TENANT_A, `select public.channel_set_default($1)`, [internoA]),
    )
    expect(message).toMatch(/CANAL_POR_DEFECTO_PUBLICO/)
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })
})
describe('quién puede cambiarlo', () => {
  it('un miembro que no es owner/admin recibe el mismo error que un canal inexistente', async () => {
    const web = await canalNuevo('web-lector', 'b2c')
    const message = await expectFailure(() =>
      comoLector(`select public.channel_set_default($1)`, [web]),
    )
    expect(message).toMatch(/CANAL_NO_ENCONTRADO/)
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })

  it('el dueño de OTRO tenant no puede tocar el canal ajeno', async () => {
    const web = await canalNuevo('web-intruso', 'b2c')
    const ajeno = await expectFailure(() =>
      comoDueno(TENANT_B, `select public.channel_set_default($1)`, [web]),
    )
    const inexistente = await expectFailure(() =>
      comoDueno(TENANT_B, `select public.channel_set_default($1)`, [
        '0c000000-0000-4000-8000-000000000999',
      ]),
    )
    // Mismo código para los dos: distinguirlos serviría para averiguar uuids.
    expect(ajeno).toMatch(/CANAL_NO_ENCONTRADO/)
    expect(inexistente).toMatch(/CANAL_NO_ENCONTRADO/)
    expect(await defectosDe(storeA)).toEqual([publicoA])
    expect(await defectosDe(storeB)).toHaveLength(1)
  })

  it('anon no puede ejecutarla', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query(`select public.channel_set_default($1)`, [publicoA])),
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('por PostgREST nadie deja la tienda sin canal por defecto', () => {
  it('desactivar el canal por defecto se rechaza con su motivo', async () => {
    const message = await expectFailure(() =>
      comoDueno(TENANT_A, `update public.channels set is_active = false where id = $1`, [publicoA]),
    )
    expect(message).toMatch(/CANAL_POR_DEFECTO_NO_DESACTIVABLE/)
  })

  it('cerrar el canal por defecto (pasarlo a B2B) también', async () => {
    const message = await expectFailure(() =>
      comoDueno(
        TENANT_A,
        `update public.channels set kind = 'b2b', requires_auth = true where id = $1`,
        [publicoA],
      ),
    )
    expect(message).toMatch(/CANAL_POR_DEFECTO_PUBLICO/)
  })

  it('mover la marca a mano se rechaza: eso son dos escrituras con un hueco en medio', async () => {
    const quitar = await expectFailure(() =>
      comoDueno(TENANT_A, `update public.channels set is_default = false where id = $1`, [publicoA]),
    )
    expect(quitar).toMatch(/CANAL_DEFECTO_SOLO_POR_FUNCION/)
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })

  it('borrar el canal por defecto se rechaza', async () => {
    const message = await expectFailure(() =>
      comoDueno(TENANT_A, `delete from public.channels where id = $1`, [publicoA]),
    )
    expect(message).toMatch(/CANAL_POR_DEFECTO_NO_BORRABLE/)
  })

  it('un canal que NO es el de defecto sí se desactiva y se edita', async () => {
    const rows = await comoDueno(
      TENANT_A,
      `update public.channels set is_active = false, name = 'Colaboradores 2026'
        where id = $1 returning is_active, name`,
      [internoA],
    )
    expect(rows).toEqual([{ is_active: false, name: 'Colaboradores 2026' }])
    await svc(`update public.channels set is_active = true where id = $1`, [internoA])
  })

  it('el dueño crea un canal cerrado y la base exige la sesión que le corresponde', async () => {
    const rows = await comoDueno(
      TENANT_A,
      `insert into public.channels (organization_id, company_id, store_id, code, name, kind, requires_auth)
       values ($1, $2, $3, 'mayorista', 'Mayorista', 'b2b', true) returning kind, is_default`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    expect(rows).toEqual([{ kind: 'b2b', is_default: false }])
  })

  it('un lector no crea canales (policy de 130000)', async () => {
    const message = await expectFailure(() =>
      comoLector(
        `insert into public.channels (organization_id, company_id, store_id, code, name, kind)
         values ($1, $2, $3, 'lector', 'Lector', 'b2c')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(message).toMatch(/row-level security|policy/i)
  })

  it('las operaciones de servidor siguen pudiendo (la guarda es solo para authenticated)', async () => {
    await svc(`update public.channels set is_active = false where id = $1`, [publicoA])
    await svc(`update public.channels set is_active = true where id = $1`, [publicoA])
    expect(await defectosDe(storeA)).toEqual([publicoA])
  })
})

describe('resumen de catálogo por canal', () => {
  it('cuenta los productos declarados; cero significa todo el catálogo', async () => {
    const [prod] = await svc(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
       values ($1, $2, $3, 'SUM-1', 'sum-1', 'Sum', '10.00', 'PEN', 5, 'published', now()) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    await svc(
      `insert into public.product_channels (organization_id, company_id, store_id, product_id, channel_id)
       values ($1, $2, $3, $4, $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, prod?.id, internoA],
    )

    const filas = await comoDueno(
      TENANT_A,
      `select channel_id, product_count::int as n from public.channel_catalog_summary($1)`,
      [storeA],
    )
    const porCanal = new Map(filas.map((f) => [String(f.channel_id), Number(f.n)]))
    expect(porCanal.get(internoA)).toBe(1)
    expect(porCanal.get(publicoA)).toBe(0)
  })

  it('otro tenant no ve el resumen ajeno (security invoker: manda la RLS)', async () => {
    const filas = await comoDueno(TENANT_B, `select * from public.channel_catalog_summary($1)`, [storeA])
    expect(filas).toEqual([])
  })
})