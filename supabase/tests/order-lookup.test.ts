// @vitest-environment node
/**
 * El comprador anónimo vuelve a su pedido (P11), sobre Postgres real.
 *
 * Lo que no puede fallar:
 *  - `orders` sigue CERRADA a `anon`: la única puerta es la función;
 *  - hace falta el token, y uno correcto de OTRO pedido tampoco vale;
 *  - un número de pedido correcto sin token no revela ni que existe;
 *  - la respuesta no filtra el token, ni los ids de tenant, ni el id interno;
 *  - el token no es legible ni siquiera con sesión del backoffice.
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

let db: PGlite
let storeA: string
let producto: string
let pedidoUno: Row
let pedidoDos: Row

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function asAnon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function checkout(email: string): Promise<Row> {
  await svc(`delete from public.checkout_attempts`)
  const rows = await svc(
    `select public.create_order_for_slug(
        $1, $2, jsonb_build_array(jsonb_build_object('product_id', $3::text, 'quantity', 2)),
        'Ana Compradora', '+51 999 111 222', '{"address":"Av. Primavera 120"}'::jsonb, null) as result`,
    [TENANT_A.storeSlug, email, producto],
  )
  return rows[0]?.result as Row
}

async function lookup(orderNumber: string, token: string): Promise<Row> {
  const rows = await asAnon(
    `select public.order_by_token($1, $2, $3) as result`,
    [TENANT_A.storeSlug, orderNumber, token],
  )
  return rows[0]?.result as Row
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    TENANT_A.slug,
    TENANT_A.adminEmail,
    TENANT_A.ownerId,
    TENANT_A.storeSlug,
  ])
  const [store] = await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug])
  storeA = String(store?.id)
  await svc(`update public.stores set status = 'active' where id = $1`, [storeA])

  const [row] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'SOFA-1', 'sofa-1', 'Sofá', '900.00', 'PEN', 40, 'published', now())
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  producto = String(row?.id)

  pedidoUno = await checkout('uno@compradora.test')
  pedidoDos = await checkout('dos@compradora.test')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('el token llega al comprador', () => {
  it('create_order devuelve un token de 64 caracteres', () => {
    expect(typeof pedidoUno.access_token).toBe('string')
    expect(String(pedidoUno.access_token)).toHaveLength(64)
  })

  it('cada pedido tiene el suyo', () => {
    expect(pedidoUno.access_token).not.toBe(pedidoDos.access_token)
  })
})

describe('con el token correcto se recupera el pedido', () => {
  it('devuelve importes, estado y líneas', async () => {
    const order = await lookup(
      String(pedidoUno.order_number),
      String(pedidoUno.access_token),
    )
    expect(order.order_number).toBe(pedidoUno.order_number)
    expect(order.status).toBe('pending')
    expect(order.grand_total).toBe(pedidoUno.grand_total)
    expect(Array.isArray(order.items)).toBe(true)
    expect((order.items as unknown[]).length).toBe(1)
  })

  it('no filtra el token ni nada con lo que pivotar', async () => {
    const order = await lookup(
      String(pedidoUno.order_number),
      String(pedidoUno.access_token),
    )
    for (const campo of [
      'access_token',
      'organization_id',
      'company_id',
      'store_id',
      'channel_id',
      'id',
      'customer_email',
    ]) {
      expect(`${campo}: ${campo in order}`).toBe(`${campo}: false`)
    }
  })
})

describe('el medio de pago, para que la confirmación sepa qué decir', () => {
  it('sin intento de cobro, payment_method es null', async () => {
    const order = await lookup(String(pedidoDos.order_number), String(pedidoDos.access_token))
    expect(order.payment_method).toBeNull()
  })

  it('devuelve familia, nombre e instrucciones del ÚLTIMO intento, y nada del proveedor', async () => {
    const [pedido] = await svc(`select id from public.orders where order_number = $1`, [pedidoUno.order_number])
    const medio = async (codigo: string, familia: string, nombre: string, minutos: number) => {
      const [metodo] = await svc(
        `insert into public.payment_methods
           (organization_id, company_id, store_id, code, kind, display_name, instructions, capture_mode, is_active)
         values ($1, $2, $3, $4, $5::public.payment_method_kind, $6, 'Ten el monto exacto.', 'manual', true)
         returning id`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, codigo, familia, nombre],
      )
      await svc(
        `insert into public.payment_intents
           (organization_id, company_id, store_id, order_id, payment_method_id,
            currency, amount, idempotency_key, created_at)
         values ($1, $2, $3, $4, $5, 'PEN', '10.00', $6, now() + make_interval(mins => $7))`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, pedido?.id, metodo?.id, `int-${codigo}`, minutos],
      )
    }
    await medio('yape-test', 'wallet', 'Yape', 0)
    // El comprador cambió de idea: manda el más reciente.
    await medio('efectivo-test', 'cash', 'Pago en efectivo', 1)

    const order = await lookup(String(pedidoUno.order_number), String(pedidoUno.access_token))
    expect(order.payment_method).toEqual({
      code: 'efectivo-test',
      kind: 'cash',
      display_name: 'Pago en efectivo',
      instructions: 'Ten el monto exacto.',
    })
  })
})

describe('sin el token no hay pedido', () => {
  it('el número correcto sin token no revela ni que existe', async () => {
    const message = await expectFailure(() =>
      lookup(String(pedidoUno.order_number), 'x'.repeat(64)),
    )
    expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })

  it('el token de OTRO pedido no sirve', async () => {
    const message = await expectFailure(() =>
      lookup(String(pedidoUno.order_number), String(pedidoDos.access_token)),
    )
    expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })

  it('un número inexistente da el MISMO error que un token malo', async () => {
    const inexistente = await expectFailure(() =>
      lookup('EC-19000101-99999', String(pedidoUno.access_token)),
    )
    const tokenMalo = await expectFailure(() =>
      lookup(String(pedidoUno.order_number), 'y'.repeat(64)),
    )
    // Mensajes distintos permitirían enumerar números de pedido, que son
    // correlativos: EC-fecha-00001, 00002...
    expect(inexistente).toBe(tokenMalo)
  })

  it('una tienda suspendida deja de servir sus pedidos', async () => {
    await svc(`update public.stores set status = 'suspended' where id = $1`, [storeA])
    const message = await expectFailure(() =>
      lookup(String(pedidoUno.order_number), String(pedidoUno.access_token)),
    )
    expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
    await svc(`update public.stores set status = 'active' where id = $1`, [storeA])
  })
})

describe('la tabla sigue cerrada', () => {
  it('anon no puede leer orders por la puerta de siempre', async () => {
    const message = await expectFailure(() => asAnon(`select order_number from public.orders`))
    expect(message).toMatch(/permission denied|denied/i)
  })

  it('anon no puede leer la tabla de tokens', async () => {
    const message = await expectFailure(() => asAnon(`select token from public.order_tokens`))
    expect(message).toMatch(/permission denied|denied/i)
  })

  it('el backoffice ve los tokens de SUS pedidos y no puede escribirlos', async () => {
    // No es una fuga: su personal ya ve el pedido entero, y con el token puede
    // reenviarle al comprador el enlace cuando lo pierda. Lo que no puede es
    // reescribirlo — un secreto que el cliente reescribe no es un secreto.
    const propios = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const r = await db.query<Row>(`select token from public.order_tokens`)
      return r.rows
    })
    expect(propios.length).toBeGreaterThanOrEqual(2)

    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
        await db.query(`update public.order_tokens set token = $1`, ['z'.repeat(64)])
      }),
    )
    expect(message).toMatch(/permission denied|denied/i)
  })

  it('otro tenant no ve ni un token ajeno', async () => {
    const ajenos = await asRole(db, 'authenticated', claimsFor(TENANT_B), async () => {
      const r = await db.query<Row>(`select token from public.order_tokens`)
      return r.rows
    })
    expect(ajenos).toHaveLength(0)
  })

  it('pero el backoffice sí sigue viendo sus pedidos', async () => {
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const r = await db.query<Row>(`select order_number from public.orders`)
      return r.rows
    })
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })
})
