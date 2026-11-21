// @vitest-environment node
/**
 * P14-SaaS · la API EMPRESARIAL contra Postgres real.
 *
 * Lo que no puede fallar, porque de esto depende que el sistema de un tercero
 * lea y escriba en la tienda de un cliente y solo en la suya:
 *
 *  - el vocabulario de scopes es el MISMO en Postgres, en el dominio y en el
 *    borde, y ninguna ruta pide un permiso que no exista;
 *  - un secreto no se guarda en claro, se devuelve una sola vez y no se puede
 *    releer ni siquiera siendo `owner`;
 *  - un token no autoriza lo que su credencial no concede, y pedir de más no
 *    amplía nada (RFC 6749 §3.3);
 *  - desactivar o rotar revoca los tokens vivos EN EL ACTO;
 *  - el límite de tasa cuenta y decide en la misma transacción;
 *  - la misma clave de idempotencia dos veces es UNA operación, y con otro
 *    contenido es un conflicto explícito;
 *  - **ninguna función de recurso acepta el tenant**: lo deriva de la fila de
 *    la credencial, así que un borde con un fallo no puede cruzar tenants.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'
import { API_SCOPES, API_VERSION } from '../../src/domain/api.ts'
import { API_SCOPES as EDGE_SCOPES } from '../functions/_shared/api/contract.ts'
import { API_ROUTES } from '../functions/_shared/api/routes.ts'

type Row = Record<string, unknown>

let db: PGlite
const ENTITLEMENT = 'ecommerce.integrations.enterprise'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d9'

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function asUser<T = Row>(
  tenant: typeof TENANT_A,
  query: string,
  params: unknown[] = [],
  overrides: Parameters<typeof claimsFor>[1] = {},
): Promise<T[]> {
  return asRole(db, 'authenticated', claimsFor(tenant, overrides), async () => {
    return (await db.query<T>(query, params)).rows
  })
}

async function sync(tenant: typeof TENANT_A, entitlements: string[]): Promise<void> {
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [tenant.organizationId, tenant.companyId, entitlements],
  )
}

interface Credential {
  id: string
  client_id: string
  client_secret: string
}

async function createCredential(
  tenant: typeof TENANT_A,
  scopes: string[],
  name = 'erp',
): Promise<Credential> {
  const [row] = await asUser<{ data: Credential }>(
    tenant,
    `select public.api_client_create($1, $2) as data`,
    [name, scopes],
  )
  return row?.data as Credential
}

async function issueToken(credential: Credential, scopes: string[] | null = null): Promise<string> {
  const [row] = await svc<{ data: { access_token: string } }>(
    `select public.api_token_issue($1, $2, $3) as data`,
    [credential.client_id, credential.client_secret, scopes],
  )
  return String(row?.data.access_token)
}

async function authenticate(token: string, scope: string | null): Promise<Row> {
  const [row] = await svc<{ data: Row }>(
    `select public.api_authenticate(ebim.hash_token($1), $2) as data`,
    [token, scope],
  )
  return row?.data as Row
}

let storeA = ''
let storeB = ''

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId,
        tenant.companyId,
        tenant.slug,
        `Cuenta ${tenant.slug}`,
        tenant.adminEmail,
        tenant.ownerId,
        tenant.storeSlug,
        `Tienda ${tenant.slug}`,
      ])
    }
    await db.query(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
    )
  })

  // El alta de tenant deja la tienda en borrador; para crear pedidos tiene que
  // estar publicada, igual que en los demas bancos de prueba.
  await svc(`update public.stores set status = 'active'`)

  const stores = await svc<{ id: string; slug: string }>(`select id, slug from public.stores`)
  storeA = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
  storeB = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)

  for (const [tenant, store] of [
    [TENANT_A, storeA],
    [TENANT_B, storeB],
  ] as const) {
    await svc(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
          status, published_at)
       values ($1, $2, $3, $4, $5, $6, 100.00, 'PEN', 50, 'published', now())`,
      [
        tenant.organizationId,
        tenant.companyId,
        store,
        `SKU-${tenant.slug}`,
        `producto-${tenant.slug}`,
        `Producto ${tenant.slug}`,
      ],
    )
  }
}, 180_000)

beforeEach(async () => {
  await svc(`delete from public.api_idempotency`)
  await svc(`delete from public.api_requests`)
  await svc(`delete from public.api_access_tokens`)
  await svc(`delete from public.api_clients`)
  await sync(TENANT_A, [ENTITLEMENT])
  await sync(TENANT_B, [ENTITLEMENT])
})

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('el vocabulario de permisos es el mismo en los tres sitios', () => {
  it('Postgres, el dominio y el borde declaran los mismos scopes', async () => {
    const [row] = await svc<{ scopes: string[] }>(`select ebim.api_scope_catalog() as scopes`)
    const fromDb = [...(row?.scopes ?? [])].sort()

    expect(fromDb).toEqual([...API_SCOPES].sort())
    expect([...EDGE_SCOPES].sort()).toEqual([...API_SCOPES].sort())
  })

  /**
   * La comprobación que impide una promesa sin nada detrás: si una ruta pidiera
   * un permiso que la base no reconoce, ninguna credencial podría tenerlo y esa
   * ruta sería inalcanzable para siempre — sin que nada fallara.
   */
  it('ninguna ruta declarada pide un scope que la base no reconoce', async () => {
    const [row] = await svc<{ scopes: string[] }>(`select ebim.api_scope_catalog() as scopes`)
    const known = new Set(row?.scopes ?? [])
    const unknown = API_ROUTES.filter((route) => !known.has(route.scope)).map((r) => r.path)
    expect(unknown).toEqual([])
  })

  it('todas las rutas declaradas están en la versión servida', () => {
    const wrong = API_ROUTES.filter((route) => !route.path.startsWith(`/${API_VERSION}/`))
    expect(wrong).toEqual([])
  })
})

describe('credenciales', () => {
  it('el secreto se devuelve UNA vez y la base solo guarda su sha256', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    expect(credential.client_secret).toMatch(/^[a-f0-9]{64}$/)
    expect(credential.client_id).toMatch(/^ec_[a-f0-9]{32}$/)

    const [row] = await svc<{ secret_hash: string; secret_hint: string }>(
      `select secret_hash, secret_hint from public.api_clients where id = $1`,
      [credential.id],
    )
    expect(row?.secret_hash).not.toBe(credential.client_secret)
    expect(row?.secret_hint).toBe(credential.client_secret.slice(-6))

    const [hashed] = await svc<{ ok: boolean }>(
      `select ebim.hash_token($1) = $2 as ok`,
      [credential.client_secret, row?.secret_hash],
    )
    expect(hashed?.ok).toBe(true)
  })

  it('ni el propietario puede leer el hash: el GRANT es por COLUMNA', async () => {
    await createCredential(TENANT_A, ['order.read'])
    const message = await expectFailure(() =>
      asUser(TENANT_A, `select secret_hash from public.api_clients`),
    )
    expect(message).toMatch(/permission denied|secret_hash/i)

    // Y lo que sí puede leer, lo lee.
    const rows = await asUser<{ client_id: string }>(
      TENANT_A,
      `select client_id, secret_hint, scopes from public.api_clients`,
    )
    expect(rows).toHaveLength(1)
  })

  it('escribir el hash a mano tampoco se puede: elegirlo es elegir el secreto', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const message = await expectFailure(() =>
      asUser(TENANT_A, `update public.api_clients set secret_hash = repeat('a', 64) where id = $1`, [
        credential.id,
      ]),
    )
    expect(message).toMatch(/permission denied|secret_hash/i)
  })

  it('un viewer no crea credenciales', async () => {
    const message = await expectFailure(() =>
      asUser(TENANT_A, `select public.api_client_create('erp', array['order.read'])`, [], {
        sub: VIEWER_USER,
        email: 'lector@tenant-a.com',
        companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
      }),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('sin el addon contratado, crear una credencial se deniega', async () => {
    await sync(TENANT_A, [])
    const message = await expectFailure(() => createCredential(TENANT_A, ['order.read']))
    expect(message).toMatch(/SIN_MODULO/)
  })

  it('un scope inventado no entra ni por la funcion ni por la tabla', async () => {
    const porFuncion = await expectFailure(() =>
      createCredential(TENANT_A, ['universo.destruir']),
    )
    expect(porFuncion).toMatch(/SCOPE_DESCONOCIDO/)

    const porTabla = await expectFailure(() =>
      svc(
        `insert into public.api_clients
           (organization_id, company_id, name, client_id, secret_hash, secret_hint, scopes)
         values ($1, $2, 'x', 'ec_' || repeat('0', 32), repeat('a', 64), 'aaaaaa',
                 array['universo.destruir'])`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ),
    )
    expect(porTabla).toMatch(/api_clients_scopes_known|violates check/i)
  })

  it('anon no puede rozar ninguna de las cuatro tablas', async () => {
    for (const table of ['api_clients', 'api_access_tokens', 'api_requests', 'api_idempotency']) {
      const message = await expectFailure(() =>
        asRole(db, 'anon', null, async () => db.query(`select * from public.${table}`)),
      )
      expect(`${table}: ${message}`).toMatch(/permission denied/i)
    }
  })
})

describe('OAuth 2.0 · client_credentials', () => {
  it('emite un token con los scopes concedidos', async () => {
    const credential = await createCredential(TENANT_A, ['order.read', 'stock.read'])
    const [row] = await svc<{ data: Record<string, unknown> }>(
      `select public.api_token_issue($1, $2) as data`,
      [credential.client_id, credential.client_secret],
    )
    expect(row?.data.token_type).toBe('Bearer')
    expect(String(row?.data.scope).split(' ').sort()).toEqual(['order.read', 'stock.read'])
    expect(String(row?.data.access_token)).toMatch(/^[a-f0-9]{64}$/)
  })

  /** Un token no puede llevar dentro lo que su credencial no concede. */
  it('pedir de mas no amplia nada: se emite la interseccion', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const [row] = await svc<{ data: Record<string, unknown> }>(
      `select public.api_token_issue($1, $2, array['order.read','order.create']) as data`,
      [credential.client_id, credential.client_secret],
    )
    expect(row?.data.scope).toBe('order.read')
  })

  it('pedir SOLO lo no concedido no emite token', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const message = await expectFailure(() => issueToken(credential, ['order.create']))
    expect(message).toMatch(/SCOPE_INSUFICIENTE/)
  })

  /**
   * El mismo mensaje para «no existe» y «secreto incorrecto». Distinguirlos
   * convierte adivinar credenciales en adivinar solo secretos.
   */
  it('cliente inexistente y secreto incorrecto dan EXACTAMENTE el mismo error', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])

    const malSecreto = await expectFailure(() =>
      svc(`select public.api_token_issue($1, $2)`, [credential.client_id, 'a'.repeat(64)]),
    )
    const noExiste = await expectFailure(() =>
      svc(`select public.api_token_issue($1, $2)`, [`ec_${'0'.repeat(32)}`, 'a'.repeat(64)]),
    )
    expect(malSecreto).toBe(noExiste)
    expect(malSecreto).toMatch(/CREDENCIAL_INVALIDA/)
  })

  it('una credencial desactivada no emite token', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    await svc(`update public.api_clients set is_active = false where id = $1`, [credential.id])
    const message = await expectFailure(() => issueToken(credential))
    expect(message).toMatch(/CREDENCIAL_INVALIDA/)
  })

  it('desactivar la credencial REVOCA los tokens ya emitidos, en el acto', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const token = await issueToken(credential)
    expect(await authenticate(token, 'order.read')).toBeTruthy()

    await svc(`update public.api_clients set is_active = false where id = $1`, [credential.id])

    const message = await expectFailure(() => authenticate(token, 'order.read'))
    expect(message).toMatch(/TOKEN_INVALIDO/)
  })

  it('rotar el secreto revoca los tokens que salieron del anterior', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const token = await issueToken(credential)

    const [rotated] = await asUser<{ data: Credential }>(
      TENANT_A,
      `select public.api_client_rotate_secret($1) as data`,
      [credential.id],
    )
    expect(rotated?.data.client_id).toBe(credential.client_id)
    expect(rotated?.data.client_secret).not.toBe(credential.client_secret)

    const message = await expectFailure(() => authenticate(token, 'order.read'))
    expect(message).toMatch(/TOKEN_INVALIDO/)

    // Y el secreto viejo ya no vale para pedir otro.
    const viejo = await expectFailure(() => issueToken(credential))
    expect(viejo).toMatch(/CREDENCIAL_INVALIDA/)
  })

  it('rotar deja constancia en la bitacora', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    await asUser(TENANT_A, `select public.api_client_rotate_secret($1)`, [credential.id])
    // `audit_log` es append-only para TODOS —ni `service_role` la puede vaciar—
    // asi que se filtra por la credencial de este caso y no por la accion sola.
    const rows = await svc<{ action: string }>(
      `select action from public.audit_log
        where action = 'api_client.secret_rotated' and entity_id = $1`,
      [credential.id],
    )
    expect(rows).toHaveLength(1)
  })
})

describe('scope boundary', () => {
  it('un token vale para lo concedido y no para lo demas', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const token = await issueToken(credential)

    const context = await authenticate(token, 'order.read')
    expect(context.organization_id).toBe(TENANT_A.organizationId)
    expect(context.company_id).toBe(TENANT_A.companyId)

    const message = await expectFailure(() => authenticate(token, 'order.create'))
    expect(message).toMatch(/SCOPE_INSUFICIENTE/)
  })

  it('un token caducado no autentica, y lo dice con su propio codigo', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const token = await issueToken(credential)
    // La ventana tiene un CHECK (`expires_at > issued_at`): un token caducado es
  // uno que se emitio antes, no uno con las fechas al reves.
    await svc(
      `update public.api_access_tokens
          set issued_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'`,
    )

    const message = await expectFailure(() => authenticate(token, 'order.read'))
    expect(message).toMatch(/TOKEN_EXPIRADO/)
  })

  /**
   * Quitarle un scope a la credencial NO cambia un token ya emitido: caduca
   * solo. Lo contrario —recalcular en cada llamada— haría que un permiso
   * retirado a mitad de una sincronía rompiera una operación por la mitad.
   */
  it('los scopes de un token emitido no cambian al cambiar los de la credencial', async () => {
    const credential = await createCredential(TENANT_A, ['order.read', 'stock.read'])
    const token = await issueToken(credential)
    await svc(`update public.api_clients set scopes = array['order.read'] where id = $1`, [
      credential.id,
    ])
    expect(await authenticate(token, 'stock.read')).toBeTruthy()
  })
})

describe('limite de tasa', () => {
  it('cuenta por credencial y levanta al pasarse', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    await svc(`update public.api_clients set rate_limit_per_minute = 2 where id = $1`, [
      credential.id,
    ])

    for (let index = 0; index < 2; index += 1) {
      const [row] = await svc<{ data: Record<string, unknown> }>(
        `select public.api_rate_limit_hit($1, 'GET', '/v1/orders') as data`,
        [credential.id],
      )
      expect(row?.data.limit).toBe(2)
    }

    const message = await expectFailure(() =>
      svc(`select public.api_rate_limit_hit($1, 'GET', '/v1/orders')`, [credential.id]),
    )
    expect(message).toMatch(/LIMITE_DE_TASA/)
  })

  // 2026-11-21 · `/v1/catalog/products:batch` chocaba con el CHECK de la ruta
  // y el socio recibía un 500 sin registro. Toda ruta publicada se registra.
  it('cada ruta publicada de la API se puede registrar', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'], 'todas-las-rutas')
    await svc(`update public.api_clients set rate_limit_per_minute = 1000 where id = $1`, [
      credential.id,
    ])
    for (const route of API_ROUTES) {
      await svc(`select public.api_rate_limit_hit($1, $2, $3)`, [
        credential.id,
        route.method,
        route.path,
      ])
    }
    const rows = await svc(`select route from public.api_requests where api_client_id = $1`, [
      credential.id,
    ])
    expect(rows.map((row) => row.route)).toContain('/v1/catalog/products:batch')
  })

  it('el cupo de un socio no gasta el del otro', async () => {
    const uno = await createCredential(TENANT_A, ['order.read'], 'erp-uno')
    const dos = await createCredential(TENANT_A, ['order.read'], 'erp-dos')
    await svc(`update public.api_clients set rate_limit_per_minute = 1`)

    await svc(`select public.api_rate_limit_hit($1, 'GET', '/v1/orders')`, [uno.id])
    const [row] = await svc<{ data: Record<string, unknown> }>(
      `select public.api_rate_limit_hit($1, 'GET', '/v1/orders') as data`,
      [dos.id],
    )
    expect(row?.data.remaining).toBe(0)
  })
})

describe('idempotencia', () => {
  it('la misma clave con el mismo contenido devuelve la PRIMERA respuesta', async () => {
    const credential = await createCredential(TENANT_A, ['order.create'])
    const hash = 'a'.repeat(64)

    const [primera] = await svc<{ data: Record<string, unknown> }>(
      `select public.api_idempotency_begin($1, 'clave-0001', $2) as data`,
      [credential.id, hash],
    )
    expect(primera?.data.status).toBe('nuevo')

    // Todavía en curso: NO se opera dos veces.
    const [enCurso] = await svc<{ data: Record<string, unknown> }>(
      `select public.api_idempotency_begin($1, 'clave-0001', $2) as data`,
      [credential.id, hash],
    )
    expect(enCurso?.data.status).toBe('en_curso')

    await svc(
      `select public.api_idempotency_finish($1, 'clave-0001', 201, '{"number":"EC-1"}'::jsonb)`,
      [credential.id],
    )

    const [repetida] = await svc<{ data: Record<string, unknown> }>(
      `select public.api_idempotency_begin($1, 'clave-0001', $2) as data`,
      [credential.id, hash],
    )
    expect(repetida?.data.status).toBe('repetido')
    expect(repetida?.data.http_status).toBe(201)
    expect((repetida?.data.response as Row).number).toBe('EC-1')
  })

  it('la misma clave con OTRO contenido es un conflicto explicito', async () => {
    const credential = await createCredential(TENANT_A, ['order.create'])
    await svc(`select public.api_idempotency_begin($1, 'clave-0002', $2)`, [
      credential.id,
      'a'.repeat(64),
    ])
    const message = await expectFailure(() =>
      svc(`select public.api_idempotency_begin($1, 'clave-0002', $2)`, [
        credential.id,
        'b'.repeat(64),
      ]),
    )
    expect(message).toMatch(/IDEMPOTENCIA_CONFLICTO/)
  })

  it('la respuesta guardada NO se puede leer desde el backoffice', async () => {
    const credential = await createCredential(TENANT_A, ['order.create'])
    await svc(`select public.api_idempotency_begin($1, 'clave-0003', $2)`, [
      credential.id,
      'a'.repeat(64),
    ])
    const message = await expectFailure(() =>
      asUser(TENANT_A, `select response from public.api_idempotency`),
    )
    expect(message).toMatch(/permission denied|response/i)

    // La metadata sí: que hubo una operación y con qué resultado.
    const rows = await asUser(TENANT_A, `select idempotency_key, status from public.api_idempotency`)
    expect(rows).toHaveLength(1)
  })
})

describe('recursos: el tenant NUNCA es un parametro', () => {
  /**
   * La comprobación estructural, y la más importante de este archivo: si alguna
   * de estas funciones aceptara `organization_id` o `company_id`, un borde con
   * un fallo podría pedirle datos de otro cliente. No se valida el parámetro:
   * **no existe el parámetro**.
   */
  it('ninguna funcion api_* declara organization_id ni company_id', async () => {
    const rows = await svc<{ name: string; args: string }>(`
      select p.proname as name,
             coalesce(array_to_string(p.proargnames, ','), '') as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'api\\_%'
    `)
    expect(rows.length).toBeGreaterThan(5)
    const offenders = rows
      .filter((row) => /organization_id|company_id|tenant/i.test(row.args))
      .map((row) => row.name)
    expect(offenders).toEqual([])
  })

  it('un listado de pedidos solo trae los de SU sociedad', async () => {
    const credA = await createCredential(TENANT_A, ['order.read'])
    const credB = await createCredential(TENANT_B, ['order.read'], 'erp-b')

    for (const [store, email] of [
      [storeA, 'comprador-a@test.com'],
      [storeB, 'comprador-b@test.com'],
    ] as const) {
      const [product] = await svc<{ id: string }>(
        `select id from public.products where store_id = $1`,
        [store],
      )
      await svc(
        `select public.create_order($1, $2,
           jsonb_build_array(jsonb_build_object('product_id', $3::uuid, 'quantity', 1)))`,
        [store, email, product?.id],
      )
    }

    const [listA] = await svc<{ data: { data: Row[] } }>(
      `select public.api_orders_list($1) as data`,
      [credA.id],
    )
    const [listB] = await svc<{ data: { data: Row[] } }>(
      `select public.api_orders_list($1) as data`,
      [credB.id],
    )

    expect(listA?.data.data).toHaveLength(1)
    expect(listB?.data.data).toHaveLength(1)
    expect(listA?.data.data[0]?.customer).toMatchObject({ email: 'comprador-a@test.com' })
    expect(listB?.data.data[0]?.customer).toMatchObject({ email: 'comprador-b@test.com' })
  })

  it('una credencial sin el scope no lee, aunque el tenant sea el suyo', async () => {
    const credential = await createCredential(TENANT_A, ['product.read'])
    const message = await expectFailure(() =>
      svc(`select public.api_orders_list($1)`, [credential.id]),
    )
    expect(message).toMatch(/SCOPE_INSUFICIENTE/)
  })

  it('una credencial desactivada no lee nada', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    await svc(`update public.api_clients set is_active = false where id = $1`, [credential.id])
    const message = await expectFailure(() =>
      svc(`select public.api_orders_list($1)`, [credential.id]),
    )
    expect(message).toMatch(/TOKEN_INVALIDO/)
  })

  it('los importes salen como cadena decimal, no como numero', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    const [product] = await svc<{ id: string }>(
      `select id from public.products where store_id = $1`,
      [storeA],
    )
    await svc(
      `select public.create_order($1, 'decimal@test.com',
         jsonb_build_array(jsonb_build_object('product_id', $2::uuid, 'quantity', 2)))`,
      [storeA, product?.id],
    )
    const [row] = await svc<{ data: { data: Row[] } }>(`select public.api_orders_list($1) as data`, [
      credential.id,
    ])
    const order = row?.data.data.find((item) => (item.customer as Row).email === 'decimal@test.com')
    expect(typeof order?.total).toBe('string')
    expect(String(order?.total)).toMatch(/^\d+\.\d{2}$/)
  })

  it('el alta traduce el SKU y declara el origen `api`, que el socio no elige', async () => {
    const credential = await createCredential(TENANT_A, ['order.create', 'order.read'])
    const [row] = await svc<{ data: Row }>(
      `select public.api_order_create($1, $2::jsonb) as data`,
      [
        credential.id,
        JSON.stringify({
          customer: { email: 'socio@test.com', name: 'Socio' },
          items: [{ sku: `SKU-${TENANT_A.slug}`, quantity: 3 }],
        }),
      ],
    )
    expect(row?.data.source).toBe('api')
    expect((row?.data.items as Row[])[0]).toMatchObject({
      sku: `SKU-${TENANT_A.slug}`,
      quantity: 3,
    })

    const [order] = await svc<{ source_channel: string }>(
      `select source_channel from public.orders where customer_email = 'socio@test.com'`,
    )
    expect(order?.source_channel).toBe('api')
  })

  it('un SKU de OTRA tienda no existe para esta credencial', async () => {
    const credential = await createCredential(TENANT_A, ['order.create'])
    const message = await expectFailure(() =>
      svc(`select public.api_order_create($1, $2::jsonb)`, [
        credential.id,
        JSON.stringify({
          customer: { email: 'cruzado@test.com' },
          items: [{ sku: `SKU-${TENANT_B.slug}`, quantity: 1 }],
        }),
      ]),
    )
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })

  it('el alta por la API queda en la bitacora, con la credencial que la hizo', async () => {
    const credential = await createCredential(TENANT_A, ['order.create', 'order.read'])
    await svc(`select public.api_order_create($1, $2::jsonb)`, [
      credential.id,
      JSON.stringify({
        customer: { email: 'auditado@test.com' },
        items: [{ sku: `SKU-${TENANT_A.slug}`, quantity: 1 }],
      }),
    ])
    const rows = await svc<{ metadata: Row }>(
      `select metadata from public.audit_log
        where action = 'order.created_via_api'
          and metadata ->> 'api_client_id' = $1::text`,
      [credential.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.metadata.client_id).toBe(credential.client_id)
  })

  it('la existencia sale de la MISMA autoridad que usa la vitrina', async () => {
    const credential = await createCredential(TENANT_A, ['stock.read'])
    const [row] = await svc<{ data: Row }>(`select public.api_stock_read($1, $2) as data`, [
      credential.id,
      `SKU-${TENANT_A.slug}`,
    ])
    expect(row?.data.in_stock).toBe(true)
    expect(typeof row?.data.available).toBe('number')
  })

  it('el catalogo y los clientes tambien van por scope', async () => {
    const credential = await createCredential(TENANT_A, ['product.read', 'customer.read'])
    const [productos] = await svc<{ data: { data: Row[] } }>(
      `select public.api_products_list($1) as data`,
      [credential.id],
    )
    expect(productos?.data.data).toHaveLength(1)
    expect(productos?.data.data[0]?.sku).toBe(`SKU-${TENANT_A.slug}`)

    const [clientes] = await svc<{ data: { data: Row[] } }>(
      `select public.api_customers_list($1) as data`,
      [credential.id],
    )
    expect(Array.isArray(clientes?.data.data)).toBe(true)
  })

  it('ni anon ni un usuario con sesion pueden llamar a un recurso de la API', async () => {
    const credential = await createCredential(TENANT_A, ['order.read'])
    for (const role of ['anon', 'authenticated'] as const) {
      const message = await expectFailure(() =>
        asRole(db, role, role === 'anon' ? null : claimsFor(TENANT_A), async () =>
          db.query(`select public.api_orders_list($1)`, [credential.id]),
        ),
      )
      expect(`${role}: ${message}`).toMatch(/permission denied/i)
    }
  })
})

describe('aislamiento entre tenants', () => {
  it('un tenant no ve las credenciales del otro', async () => {
    await createCredential(TENANT_A, ['order.read'], 'de-a')
    await createCredential(TENANT_B, ['order.read'], 'de-b')

    const desdeA = await asUser<{ name: string }>(TENANT_A, `select name from public.api_clients`)
    expect(desdeA.map((row) => row.name)).toEqual(['de-a'])
  })

  it('un tenant no puede desactivar la credencial del otro', async () => {
    const deB = await createCredential(TENANT_B, ['order.read'], 'de-b')
    const rows = await asUser(
      TENANT_A,
      `update public.api_clients set is_active = false where id = $1 returning id`,
      [deB.id],
    )
    // La RLS no levanta: simplemente no hay fila que actualizar.
    expect(rows).toHaveLength(0)

    const [row] = await svc<{ is_active: boolean }>(
      `select is_active from public.api_clients where id = $1`,
      [deB.id],
    )
    expect(row?.is_active).toBe(true)
  })

  it('un tenant no ve las peticiones ni los tokens del otro', async () => {
    const deB = await createCredential(TENANT_B, ['order.read'], 'de-b')
    await issueToken(deB)
    await svc(`select public.api_rate_limit_hit($1, 'GET', '/v1/orders')`, [deB.id])

    const tokens = await asUser(TENANT_A, `select id from public.api_access_tokens`)
    const requests = await asUser(TENANT_A, `select id from public.api_requests`)
    expect(tokens).toHaveLength(0)
    expect(requests).toHaveLength(0)
  })
})
