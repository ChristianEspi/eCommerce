// @vitest-environment node
/**
 * N06 · La libreta de direcciones del consumidor, sobre Postgres real.
 *
 * Lo que no puede fallar:
 *  - cada persona opera SUS direcciones y ninguna más (leer, editar, borrar,
 *    marcar predeterminada);
 *  - una dirección guardada en una tienda no existe en otra, ni del mismo
 *    tenant ni de otro;
 *  - una sola predeterminada por usuario y tienda;
 *  - las funciones no reciben usuario ni aceptan claves ajenas en la dirección.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

const ANA = '0f500000-0000-4000-8000-00000000a001'
const BETO = '0f500000-0000-4000-8000-00000000b001'
const SEGUNDA_TIENDA_A = 'tienda-a-outlet'

let db: PGlite

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@consumidor.test`, org_id: '', companies: [], active_company: '' }
}

async function como<T = unknown>(sub: string, query: string, params: unknown[] = []): Promise<T> {
  const [row] = await asRole(db, 'authenticated', shopper(sub), async () =>
    (await db.query<{ r: T }>(query, params)).rows,
  )
  return row?.r as T
}

const libreta = (sub: string, slug = TENANT_A.storeSlug) =>
  como<Row[]>(sub, `select public.my_consumer_addresses($1) as r`, [slug])

const guardar = (sub: string, address: Record<string, unknown>, id: string | null = null, slug = TENANT_A.storeSlug) =>
  como<Row>(sub, `select public.save_my_consumer_address($1, $2::jsonb, $3) as r`, [slug, JSON.stringify(address), id])

const borrar = (sub: string, id: string, slug = TENANT_A.storeSlug) =>
  como<Row[]>(sub, `select public.delete_my_consumer_address($1, $2) as r`, [slug, id])

const predeterminada = (sub: string, id: string, slug = TENANT_A.storeSlug) =>
  como<Row[]>(sub, `select public.set_default_my_consumer_address($1, $2) as r`, [slug, id])

async function bootstrap(tenant: typeof TENANT_A) {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId,
    tenant.companyId,
    tenant.slug,
    tenant.adminEmail,
    tenant.ownerId,
    tenant.storeSlug,
  ])
}

beforeAll(async () => {
  db = await createTestDatabase()
  await bootstrap(TENANT_A)
  await bootstrap(TENANT_B)
  // Una segunda tienda del MISMO tenant: el aislamiento es por tienda, no solo por tenant.
  await svc(
    `insert into public.stores (organization_id, company_id, slug, name, currency, status)
     values ($1, $2, $3, 'Outlet', 'PEN', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, SEGUNDA_TIENDA_A],
  )
  await svc(`update public.stores set status = 'active'`)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('CRUD propio', () => {
  let casa = ''
  let oficina = ''

  it('la primera dirección que se guarda es la predeterminada, con el tenant de la tienda', async () => {
    const guardada = await guardar(ANA, {
      label: '  Casa ',
      recipient: 'Ana Pérez',
      phone: '+51 999 111 222',
      address: 'Av. Primavera 120',
      reference: 'Portón verde',
      city: 'Lima',
      region: 'Lima',
      postal_code: '15023',
      country: 'pe',
    })
    casa = String(guardada.id)
    expect(guardada).toMatchObject({ label: 'Casa', country: 'PE', is_default: true, address: 'Av. Primavera 120' })
    const [fila] = await svc(`select organization_id, company_id, user_id from public.consumer_addresses where id = $1`, [casa])
    expect(fila).toEqual({ organization_id: TENANT_A.organizationId, company_id: TENANT_A.companyId, user_id: ANA })
  })

  it('la segunda no quita la marca; la lista pone la predeterminada primero', async () => {
    oficina = String((await guardar(ANA, { label: 'Oficina', address: 'Jr. Lampa 55', city: 'Lima' })).id)
    const lista = await libreta(ANA)
    expect(lista.map((a) => [a.label, a.is_default])).toEqual([
      ['Casa', true],
      ['Oficina', false],
    ])
  })

  it('editar cambia los datos y conserva la marca', async () => {
    const editada = await guardar(ANA, { label: 'Casa de Ana', address: 'Av. Primavera 130', city: 'Lima' }, casa)
    expect(editada).toMatchObject({ id: casa, label: 'Casa de Ana', address: 'Av. Primavera 130', is_default: true })
    // Lo que no se manda al editar, se vacía: la dirección se guarda entera.
    expect(editada.reference).toBeUndefined()
  })

  it('marcar otra como predeterminada deja UNA sola', async () => {
    const lista = await predeterminada(ANA, oficina)
    expect(lista.filter((a) => a.is_default).map((a) => a.id)).toEqual([oficina])
    const [n] = await svc<{ n: number }>(
      `select count(*)::int as n from public.consumer_addresses where user_id = $1 and is_default`,
      [ANA],
    )
    expect(n?.n).toBe(1)
  })

  it('guardar una nueva como predeterminada quita la marca a la anterior', async () => {
    const nueva = await guardar(ANA, { label: 'Playa', address: 'Calle Mar 9', is_default: true })
    const lista = await libreta(ANA)
    expect(lista.filter((a) => a.is_default).map((a) => a.id)).toEqual([nueva.id])
    await borrar(ANA, String(nueva.id))
  })

  it('borrar la predeterminada pasa la marca a la más reciente que queda', async () => {
    const lista = await borrar(ANA, oficina)
    expect(lista.map((a) => [a.id, a.is_default])).toEqual([[casa, true]])
  })
})

describe('aislamiento por usuario', () => {
  let deAna = ''

  it('otra persona no ve la libreta ajena', async () => {
    deAna = String((await libreta(ANA))[0]?.id)
    expect(await libreta(BETO)).toEqual([])
  })

  it('ni la edita, ni la borra, ni la marca: mismo error que si no existiera', async () => {
    for (const intento of [
      () => guardar(BETO, { label: 'Robada', address: 'Otra calle 1' }, deAna),
      () => borrar(BETO, deAna),
      () => predeterminada(BETO, deAna),
      () => guardar(BETO, { label: 'X', address: 'Calle 1' }, '0f500000-0000-4000-8000-0000000000ff'),
    ]) {
      expect(await expectFailure(intento)).toMatch(/DIRECCION_NO_ENCONTRADA/)
    }
    const [fila] = await svc(`select label, user_id from public.consumer_addresses where id = $1`, [deAna])
    expect(fila).toEqual({ label: 'Casa de Ana', user_id: ANA })
  })

  it('no se puede declarar el dueño, la tienda ni el tenant dentro de la dirección', async () => {
    for (const campo of ['user_id', 'store_id', 'organization_id', 'company_id', 'id']) {
      const message = await expectFailure(() => guardar(BETO, { label: 'X', address: 'Calle 123', [campo]: ANA }))
      expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
    }
  })
})

describe('aislamiento por tienda y tenant', () => {
  it('lo guardado en una tienda no aparece en otra del mismo tenant ni de otro', async () => {
    expect((await libreta(ANA)).length).toBe(1)
    expect(await libreta(ANA, SEGUNDA_TIENDA_A)).toEqual([])
    expect(await libreta(ANA, TENANT_B.storeSlug)).toEqual([])
  })

  it('una dirección de la tienda A no se toca desde el slug de otra tienda', async () => {
    const deAna = String((await libreta(ANA))[0]?.id)
    expect(await expectFailure(() => borrar(ANA, deAna, TENANT_B.storeSlug))).toMatch(/DIRECCION_NO_ENCONTRADA/)
    expect(await expectFailure(() => predeterminada(ANA, deAna, SEGUNDA_TIENDA_A))).toMatch(/DIRECCION_NO_ENCONTRADA/)
  })

  it('en la otra tienda la primera también es predeterminada: la marca es por tienda', async () => {
    const enB = await guardar(ANA, { label: 'Casa', address: 'Calle Bogotá 1' }, null, TENANT_B.storeSlug)
    expect(enB).toMatchObject({ is_default: true })
    expect((await libreta(ANA)).filter((a) => a.is_default)).toHaveLength(1)
  })

  it('una tienda que no existe o no está activa no admite libreta', async () => {
    expect(await expectFailure(() => libreta(ANA, 'no-existe'))).toMatch(/TIENDA_NO_DISPONIBLE/)
  })
})

describe('validación y superficie', () => {
  it('nombre, dirección y país se validan', async () => {
    expect(await expectFailure(() => guardar(BETO, { label: '   ', address: 'Calle 123' }))).toMatch(/DIRECCION_INVALIDA/)
    expect(await expectFailure(() => guardar(BETO, { label: 'Casa', address: 'ab' }))).toMatch(/DIRECCION_INVALIDA/)
    expect(await expectFailure(() => guardar(BETO, { label: 'Casa', address: 'Calle 123', country: 'Peru' }))).toMatch(
      /DIRECCION_INVALIDA/,
    )
  })

  it('máximo 20 por tienda', async () => {
    for (let i = 0; i < 20; i += 1) await guardar(BETO, { label: `Dir ${i}`, address: `Calle ${i + 100}` })
    expect(await expectFailure(() => guardar(BETO, { label: 'Una más', address: 'Calle 999' }))).toMatch(/LIBRETA_LLENA/)
  })

  it('`anon` no ejecuta ninguna y nadie lee ni escribe la tabla directamente', async () => {
    for (const call of [
      `select public.my_consumer_addresses('tienda-a')`,
      `select public.save_my_consumer_address('tienda-a', '{"label":"x","address":"Calle 1"}'::jsonb, null)`,
      `select public.delete_my_consumer_address('tienda-a', gen_random_uuid())`,
      `select public.set_default_my_consumer_address('tienda-a', gen_random_uuid())`,
    ]) {
      const message = await expectFailure(() => asRole(db, 'anon', null, async () => (await db.query(call)).rows))
      expect(message).toMatch(/permission denied/i)
    }
    expect(
      await expectFailure(() => asRole(db, 'authenticated', shopper(ANA), async () => (await db.query(`select * from public.consumer_addresses`)).rows)),
    ).toMatch(/permission denied/i)
  })

  it('las funciones solo reciben tienda, dirección e id: nunca un usuario', async () => {
    const rows = await svc<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like '%my_consumer_address%'
        order by p.proname`,
    )
    expect(rows).toEqual([
      { name: 'delete_my_consumer_address', args: 'p_store_slug text, p_address_id uuid' },
      { name: 'my_consumer_addresses', args: 'p_store_slug text' },
      { name: 'save_my_consumer_address', args: 'p_store_slug text, p_address jsonb, p_address_id uuid' },
      { name: 'set_default_my_consumer_address', args: 'p_store_slug text, p_address_id uuid' },
    ])
  })
})
