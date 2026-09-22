// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AI_FEATURES } from '../functions/_shared/aiCore.ts'
import { COPILOT_TOOLS, COPILOT_TOOL_IDS, herramientasDisponibles } from '../functions/_shared/aiCopilot.ts'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * La capa de herramientas del Copilot sobre Postgres real (fase 11).
 *
 *  1. Paridad TS ↔ SQL: lista de herramientas y funcionalidad de origen.
 *  2. `ai_copilot_tools()`: cada rol ve SOLO las herramientas de sus
 *     funcionalidades y de los módulos contratados.
 *  3. Un usuario SIN PERMISO no obtiene datos por el Copilot: las funciones de
 *     cada herramienta lo rechazan en la base aunque se las llame directamente
 *     (`SIN_PERMISO` / `MODULO_NO_CONTRATADO`), igual que la IA de su módulo.
 *  4. A nunca ve a B (producto, búsqueda, ventas, tienda ajena).
 *  5. Solo lectura (STABLE + SECURITY INVOKER) y anon sin EXECUTE.
 */

let db: PGlite
const storeOf: Record<string, string> = {}
const VIEWER = '0a000000-0000-4000-8000-00000000fb01'
const ORDERS = '0a000000-0000-4000-8000-00000000fb02'
const REP = '0a000000-0000-4000-8000-00000000fb03'
const CATALOG = '0a000000-0000-4000-8000-00000000fb04'
const producto: Record<string, string> = {}

type Json = Record<string, unknown>

async function svc<T = Json>(query: string, params: unknown[] = []) {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function como<T>(claims: ReturnType<typeof claimsFor> | null, query: string, params: unknown[] = []) {
  return asRole(db, claims ? 'authenticated' : 'anon', claims, async () => {
    const rows = (await db.query<{ r: T }>(query, params)).rows
    return rows[0]!.r
  })
}

const dueno = (tenant = TENANT_A) => claimsFor(tenant)
const conRol = (userId: string) => ({ ...claimsFor(TENANT_A), sub: userId })

async function contratar(tenant: typeof TENANT_A, capability: string, activo = true) {
  await svc(
    `insert into public.tenant_entitlements
       (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, $3, $4, 'hub')
     on conflict (organization_id, company_id, entitlement_code) do update set is_active = $4`,
    [tenant.organizationId, tenant.companyId, `ecommerce.${capability}`, activo],
  )
}

async function nuevoProducto(tenant: typeof TENANT_A, sku: string, nombre: string, status = 'published') {
  const rows = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, regexp_replace(lower($4), '[^a-z0-9-]', '-', 'g'), $5, '12.50', 'PEN', 10, $6::public.product_status,
             case when $6 = 'published' then now() end)
     returning id`,
    [tenant.organizationId, tenant.companyId, storeOf[tenant.slug], sku, nombre, status],
  )
  producto[sku] = rows[0]!.id
  return rows[0]!.id
}

async function pedido(tenant: typeof TENANT_A, numero: string, total: string, diasAtras: number) {
  await svc(
    `insert into public.orders
       (organization_id, company_id, store_id, channel_id, order_number, status, customer_email,
        currency, subtotal, grand_total, placed_at)
     values ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
             $4, 'paid', 'secreto@cliente.com', 'PEN', $5, $5, now() - make_interval(days => $6))`,
    [tenant.organizationId, tenant.companyId, storeOf[tenant.slug], numero, total, diasAtras],
  )
}

const herramientas = (claims: ReturnType<typeof claimsFor>) => como<Json>(claims, `select public.ai_copilot_tools() as r`)
const productos = (claims: ReturnType<typeof claimsFor>, store: string, text: string | null = null, status: string | null = null) =>
  como<Json>(claims, `select public.ai_copilot_products($1, $2, $3, 10) as r`, [store, text, status])
const ficha = (claims: ReturnType<typeof claimsFor>, id: string, store: string) =>
  como<Json | null>(claims, `select public.ai_copilot_product($1, $2) as r`, [id, store])
const ventas = (claims: ReturnType<typeof claimsFor>, store: string, dias: number) =>
  como<Json>(claims, `select public.ai_copilot_sales_facts($1, $2) as r`, [store, dias])

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
    const rows = await svc<{ id: string }>(`select id from public.stores where slug = $1`, [tenant.storeSlug])
    storeOf[tenant.slug] = rows[0]!.id
    await contratar(tenant, 'ai.insights')
  }
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer'),
            ($1, $2, $4, 'pedidos@tenant-a.com', 'orders'),
            ($1, $2, $5, 'vendedor@tenant-a.com', 'sales_rep'),
            ($1, $2, $6, 'catalogo@tenant-a.com', 'catalog')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER, ORDERS, REP, CATALOG],
  )

  await nuevoProducto(TENANT_A, 'PARA-500', 'Paracetamol 500')
  await nuevoProducto(TENANT_A, 'IBU-400', 'Ibuprofeno 400', 'draft')
  await nuevoProducto(TENANT_A, 'PCT_100%', 'Producto con comodines')
  await nuevoProducto(TENANT_B, 'SECRETO-B', 'Paracetamol de B')

  // A: 300 en los últimos 7 días frente a 100 los 7 anteriores.
  await pedido(TENANT_A, 'A-1', '200.00', 1)
  await pedido(TENANT_A, 'A-2', '100.00', 3)
  await pedido(TENANT_A, 'A-3', '100.00', 10)
  await pedido(TENANT_B, 'B-1', '99999.00', 2)
})

afterAll(async () => {
  await db?.close()
})

describe('paridad TS ↔ SQL', () => {
  it('misma lista de herramientas y misma funcionalidad de origen', async () => {
    const ids = await svc<{ f: string[] }>(`select ebim.ai_copilot_tool_ids() as f`)
    expect(ids[0]!.f).toEqual([...COPILOT_TOOL_IDS])
    for (const tool of COPILOT_TOOL_IDS) {
      const rows = await svc<{ f: string }>(`select ebim.ai_copilot_tool_feature($1) as f`, [tool])
      expect(rows[0]!.f, tool).toBe(COPILOT_TOOLS[tool].feature)
    }
    const nada = await svc<{ f: string | null }>(`select ebim.ai_copilot_tool_feature('run_sql') as f`)
    expect(nada[0]!.f).toBeNull()
  })

  it('copilot en el registro SQL: ai.insights, sin módulo, todos los roles', async () => {
    const rows = await svc<{ cap: string; mod: string | null; roles: string[] }>(
      `select ebim.ai_capability_for('copilot') as cap,
              ebim.ai_module_capability_for('copilot') as mod,
              ebim.ai_feature_roles('copilot')::text[] as roles`,
    )
    expect(rows[0]!.cap).toBe(AI_FEATURES.copilot.capability)
    expect(rows[0]!.mod).toBeNull()
    expect([...rows[0]!.roles].sort()).toEqual([...AI_FEATURES.copilot.roles].sort())
  })
})

describe('herramientas por rol y módulo', () => {
  it('owner: todo menos inventario (módulo no contratado)', async () => {
    const r = await herramientas(dueno())
    const disponibles = herramientasDisponibles(r)
    expect(disponibles).toContain('dashboard_summary')
    expect(disponibles).toContain('search_products')
    expect(disponibles).not.toContain('inventory_summary')
    const inv = (r.tools as Json[]).find((t) => t.tool === 'inventory_summary')
    expect(inv).toMatchObject({ available: false, reason: 'MODULO_NO_CONTRATADO' })
  })

  it('con el módulo contratado aparece inventario', async () => {
    await contratar(TENANT_A, 'inventory.multiwarehouse')
    expect(herramientasDisponibles(await herramientas(dueno()))).toContain('inventory_summary')
    await contratar(TENANT_A, 'inventory.multiwarehouse', false)
  })

  it('sales_rep: solo cliente (ni ventas, ni pedidos, ni productos)', async () => {
    expect(herramientasDisponibles(await herramientas(conRol(REP)))).toEqual(['customer_summary'])
  })

  it('viewer: pedidos y clientes, nunca ventas ni productos', async () => {
    const d = herramientasDisponibles(await herramientas(conRol(VIEWER)))
    expect(d).toEqual(['search_orders', 'order_detail', 'orders_attention', 'customer_summary'])
  })

  it('catalog: productos, sin pedidos ni ventas', async () => {
    const d = herramientasDisponibles(await herramientas(conRol(CATALOG)))
    expect(d).toEqual(['search_products', 'product_detail'])
  })

  it('sin tenant en el token ⇒ SIN_PERMISO; anon sin EXECUTE', async () => {
    const msg = await expectFailure(() =>
      herramientas({ ...claimsFor(TENANT_A), org_id: undefined as unknown as string, active_company: undefined as unknown as string }),
    )
    expect(msg).toMatch(/SIN_PERMISO|permission/)
    expect(await expectFailure(() => como(null, `select public.ai_copilot_tools() as r`))).toMatch(/permission denied/)
  })

  it('todos los roles pueden gastar cuota del Copilot (con ai.insights contratado)', async () => {
    for (const user of [VIEWER, ORDERS, REP, CATALOG]) {
      const r = await como<Json>(conRol(user), `select ebim.ai_consume('copilot', 1) as r`)
      expect(r.allowed, user).toBe(true)
    }
  })
})

describe('SIN PERMISO: la base rechaza la herramienta aunque se llame directamente', () => {
  it('ventas: viewer, orders, sales_rep y catalog ⇒ SIN_PERMISO', async () => {
    for (const user of [VIEWER, ORDERS, REP, CATALOG]) {
      const msg = await expectFailure(() => ventas(conRol(user), storeOf[TENANT_A.slug]!, 7))
      expect(msg, user).toMatch(/SIN_PERMISO/)
    }
  })

  it('productos: viewer, orders y sales_rep ⇒ SIN_PERMISO', async () => {
    for (const user of [VIEWER, ORDERS, REP]) {
      expect(await expectFailure(() => productos(conRol(user), storeOf[TENANT_A.slug]!))).toMatch(/SIN_PERMISO/)
      expect(await expectFailure(() => ficha(conRol(user), producto['PARA-500']!, storeOf[TENANT_A.slug]!))).toMatch(/SIN_PERMISO/)
    }
  })

  it('pedidos e inventario reutilizados: sales_rep sin pedidos, inventario sin módulo', async () => {
    expect(
      await expectFailure(() => como(conRol(REP), `select public.ai_orders_search($1) as r`, [storeOf[TENANT_A.slug]])),
    ).toMatch(/SIN_PERMISO/)
    expect(
      await expectFailure(() => como(dueno(), `select public.ai_inventory_facts($1, 15) as r`, [storeOf[TENANT_A.slug]])),
    ).toMatch(/MODULO_NO_CONTRATADO/)
    expect(
      await expectFailure(() => como(conRol(REP), `select public.ai_dashboard_facts($1) as r`, [storeOf[TENANT_A.slug]])),
    ).toMatch(/SIN_PERMISO/)
  })
})

describe('productos', () => {
  it('búsqueda por texto literal, con conteos de la tienda y tope', async () => {
    const r = await productos(conRol(CATALOG), storeOf[TENANT_A.slug]!, 'paracetamol')
    expect(r.total).toBe(1)
    const rows = r.rows as Json[]
    expect(rows.map((x) => x.sku)).toEqual(['PARA-500'])
    expect(rows[0]).toMatchObject({ status: 'published', price: '12.50', currency: 'PEN' })
    expect(r.counts).toMatchObject({ total: 3, published: 2, draft: 1 })
    expect(r.limit).toBe(10)
  })

  it('los comodines del texto son literales', async () => {
    const todo = await productos(dueno(), storeOf[TENANT_A.slug]!, '%')
    expect((todo.rows as Json[]).map((x) => x.sku)).toEqual(['PCT_100%'])
    const guion = await productos(dueno(), storeOf[TENANT_A.slug]!, '_')
    expect((guion.rows as Json[]).map((x) => x.sku)).toEqual(['PCT_100%'])
  })

  it('estado de lista; valor fuera ⇒ FILTRO_INVALIDO', async () => {
    const draft = await productos(dueno(), storeOf[TENANT_A.slug]!, null, 'draft')
    expect((draft.rows as Json[]).map((x) => x.sku)).toEqual(['IBU-400'])
    expect(await expectFailure(() => productos(dueno(), storeOf[TENANT_A.slug]!, null, 'deleted'))).toMatch(/FILTRO_INVALIDO/)
  })

  it('A nunca encuentra a B, ni por texto ni por tienda', async () => {
    const r = await productos(dueno(), storeOf[TENANT_A.slug]!, 'SECRETO')
    expect(r.total).toBe(0)
    expect(await expectFailure(() => productos(dueno(), storeOf[TENANT_B.slug]!))).toMatch(/SIN_PERMISO/)
  })

  it('ficha reducida; producto de B ⇒ NULL (404)', async () => {
    const f = await ficha(conRol(CATALOG), producto['PARA-500']!, storeOf[TENANT_A.slug]!)
    expect(f).toMatchObject({ product: { sku: 'PARA-500', status: 'published', has_description: false } })
    // La descripción completa no viaja: solo si existe.
    expect(Object.keys((f as { product: Json }).product)).not.toContain('description')
    expect(await ficha(dueno(), producto['SECRETO-B']!, storeOf[TENANT_A.slug]!)).toBeNull()
  })
})

describe('ventas', () => {
  it('ventana frente a la anterior, calculada en SQL, sin ver a B', async () => {
    const r = await ventas(dueno(), storeOf[TENANT_A.slug]!, 7)
    expect(r.days).toBe(7)
    expect(r.current).toMatchObject({ gross_sales: '300.00', orders: 2 })
    expect(r.previous).toMatchObject({ gross_sales: '100.00', orders: 1 })
    expect(r.gross_delta_pct).toBe('200.0')
    expect(JSON.stringify(r)).not.toContain('99999')
    expect(JSON.stringify(r)).not.toContain('secreto@cliente.com')
  })

  it('solo ventanas cerradas; tienda ajena ⇒ SIN_PERMISO', async () => {
    expect(await expectFailure(() => ventas(dueno(), storeOf[TENANT_A.slug]!, 45))).toMatch(/CAMPO_INVALIDO/)
    expect(await expectFailure(() => ventas(dueno(), storeOf[TENANT_B.slug]!, 7))).toMatch(/SIN_PERMISO/)
  })
})

describe('solo lectura', () => {
  it('las funciones nuevas son STABLE + SECURITY INVOKER y anon no las ejecuta', async () => {
    const rows = await svc<{ proname: string; provolatile: string; prosecdef: boolean; anon: boolean }>(
      `select p.proname, p.provolatile::text, p.prosecdef,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('ai_copilot_tools', 'ai_copilot_products', 'ai_copilot_product', 'ai_copilot_sales_facts')`,
    )
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.provolatile, r.proname).toBe('s')
      expect(r.prosecdef, r.proname).toBe(false)
      expect(r.anon, r.proname).toBe(false)
    }
  })
})
