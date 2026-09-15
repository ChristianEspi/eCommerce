// @vitest-environment node
/**
 * P16-SaaS · La línea base de seguridad, contra Postgres REAL.
 *
 * Esto no repite lo que ya defienden `rls-tenant-isolation`, `audit-log` o
 * `integration-monitor`. Lo que se prueba aquí es lo que **no tenía dueño**:
 *
 *  1. **La superficie anónima es una lista cerrada.** Dieciocho funciones de
 *     `public` puede ejecutarlas `anon`. La lista está escrita abajo con el
 *     motivo de cada una: añadir una decimonovena sin decirlo pone el test rojo.
 *     Es el mismo mecanismo que `REFERENCE_CATALOG` en `schema-invariants`.
 *  2. **Las claves ajenas llevan el tenant dentro.** No de nueve tablas: de
 *     todas. La regla se comprueba sobre el catálogo, así que una FK futura
 *     escrita a mano cae aquí.
 *  3. **La barra invertida en un enlace del tenant.** Es la regresión del
 *     hallazgo que abre la fase: `/\evil.com` pasaba el CHECK y el navegador la
 *     resolvía a otro dominio.
 *  4. **Los dos techos de tasa nuevos**, incluida la propiedad que los hace
 *     aceptables: DEGRADAN, no niegan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA: string
let storeB: string
let productA: string
let channelA: string

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'
const B = String.fromCharCode(92)

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}
async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}
async function anon(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'anon', null, () => sql(query, params))
}
async function member(query: string, params: unknown[] = [], tenant = TENANT_A): Promise<Row[]> {
  return asRole(db, 'authenticated', claimsFor(tenant), () => sql(query, params))
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const [tenant, storeSlug] of [
    [TENANT_A, STORE_A_SLUG],
    [TENANT_B, STORE_B_SLUG],
  ] as const) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.slug,
      tenant.adminEmail, tenant.ownerId, storeSlug,
    ])
  }
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0, tax_inclusive = false`)

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
  storeB = String(stores.find((s) => s.slug === STORE_B_SLUG)?.id)

  // El oraculo de cupones solo existe si la sociedad tiene contratado el modulo:
  // sin `ecommerce.promotions`, `ebim.apply_promotions` sale por la puerta de
  // `entitled: false` y ni mira los codigos. Sin esto, el test del contador
  // pasaria por el motivo equivocado.
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(
      `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
      [tenant.organizationId, tenant.companyId, ['ecommerce.promotions']],
    )
  }

  const channels = await svc(`select id, store_id from public.channels where is_default`)
  channelA = String(channels.find((c) => c.store_id === storeA)?.id)

  const rows = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at)
     values ($1, $2, $3, 'A-SILLA', 'silla', 'Silla', '100.00', 'PEN', 50, 'published', now())
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  productA = String(rows[0]?.id)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ===========================================================================
// 1 · La superficie anónima
// ===========================================================================

/**
 * Lo que `anon` puede ejecutar, y POR QUÉ puede.
 *
 * Cada entrada dice qué protege a esa función de ser un problema. Las tres
 * categorías, y ninguna otra vale para entrar aquí:
 *
 *  · `publicado` — solo lee lo que la tienda ya publica. La RLS es la autoridad.
 *  · `secreto`   — exige un valor con entropía suficiente para que adivinarlo
 *                  no sea un ataque, sino aritmética imposible.
 *  · `techo`     — escribe o revela algo, y por eso lleva límite de tasa.
 *  · `recogido`  — escribe, y no puede llevar techo sin negar una venta, así que
 *                  lo que escribe se RECOGE. La cuarta clase nació en P16 al
 *                  mirar de cerca `cart_open`: estaba clasificada como `secreto`
 *                  «token de 256 bits» y eso solo es verdad cuando el invitado
 *                  YA tiene token. Cuando llega sin él —la primera visita— la
 *                  función no lee: crea la fila y le entrega el token. Es la
 *                  única de las dieciocho que escribe sin presentar nada, y
 *                  clasificarla como protegida por un secreto era describir la
 *                  mitad amable de su contrato.
 */
const ANON_SURFACE: Record<
  string,
  { clase: 'publicado' | 'secreto' | 'techo' | 'recogido'; porque: string }
> = {
  availability_for_slug: { clase: 'publicado', porque: 'disponibilidad calculada de lo publicado' },
  cart_abandon: { clase: 'secreto', porque: 'token de carrito de 256 bits' },
  cart_open: {
    clase: 'recogido',
    porque:
      'sin token CREA la fila del invitado; un techo aquí negaría la venta, así que se recoge sola (P16)',
  },
  cart_price_drift: { clase: 'secreto', porque: 'token de carrito de 256 bits' },
  cart_replace_lines: { clase: 'secreto', porque: 'token de carrito de 256 bits' },
  catalog_search_for_slug: { clase: 'publicado', porque: 'busca en el catálogo publicado' },
  catalog_suggest_for_slug: { clase: 'publicado', porque: 'sugiere sobre el catálogo publicado' },
  checkout_context: { clase: 'publicado', porque: 'la configuración publicable de la tienda' },
  // P18 · Devuelve `ebim.user_id()` y nada mas: con la clave anonima, `null`.
  // No enseña un dato de nadie —solo le dice a quien pregunta si la base le
  // reconoce a EL— y es `security invoker` a proposito: definer aqui seria una
  // funcion que responde por otro.
  current_buyer: {
    clase: 'publicado',
    porque: 'la sesión del que llama, verificada por PostgREST; con anon devuelve null',
  },
  delivery_options_for_slug: { clase: 'publicado', porque: 'métodos de entrega publicados' },
  gift_card_balance_for_slug: { clase: 'secreto', porque: 'código de 96 bits; no distingue "no existe" de "otra tienda"' },
  order_by_token: { clase: 'secreto', porque: 'token de pedido de 256 bits' },
  price_quote_for_slug: { clase: 'publicado', porque: 'precio del catálogo publicado' },
  // Cierre · relaciones. Resuelve la tienda por el slug y devuelve SOLO ids de
  // relacionados publicados y visibles en el canal público. Ni precio, ni
  // existencia, ni tenant.
  product_relations_for_slug: {
    clase: 'publicado',
    porque: 'ids de relacionados publicados y visibles en el canal público de la tienda',
  },
  promotion_quote_for_slug: { clase: 'techo', porque: 'oráculo de cupones: techo de sondeos fallidos (P16)' },
  return_request_for_slug: { clase: 'secreto', porque: 'exige el token del pedido' },
  returns_by_token: { clase: 'secreto', porque: 'token de pedido de 256 bits' },
  store_navigation_for_slug: { clase: 'publicado', porque: 'el menú de la tienda, ya publicado' },
  store_page_for_slug: { clase: 'publicado', porque: 'la página del CMS, ya publicada' },
  store_promotions_for_slug: {
    clase: 'publicado',
    porque: 'campañas vigentes SIN cupón: la forma del descuento, nunca el código ni el cupo',
  },
  track_events_for_slug: { clase: 'techo', porque: 'ESCRIBE analítica: techo por tienda (P16)' },
}

describe('la superficie anónima es una lista cerrada', () => {
  it('`anon` no puede ejecutar ninguna función de `public` fuera de la lista', async () => {
    const rows = await sql(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.rolname = 'anon'
      where n.nspname = 'public' and has_function_privilege(r.oid, p.oid, 'EXECUTE')
      order by 1
    `)
    expect(rows.map((row) => String(row.name))).toEqual(Object.keys(ANON_SURFACE).sort())
  })

  /**
   * El reparto por clase, fijado por número. `docs/SECURITY_BASELINE.md` §1.6
   * publica esta tabla; sin este test, el documento y el código se separan en la
   * primera función nueva y nadie se entera hasta la siguiente auditoría.
   */
  it('el reparto por clase es 11 publicado · 7 secreto · 2 techo · 1 recogido', () => {
    const cuenta = { publicado: 0, secreto: 0, techo: 0, recogido: 0 }
    for (const entry of Object.values(ANON_SURFACE)) cuenta[entry.clase] += 1
    expect(cuenta).toEqual({ publicado: 11, secreto: 7, techo: 2, recogido: 1 })
  })

  /**
   * La clase `recogido` no es una excusa para no poner techo: obliga a que
   * exista la recogida. Si alguien clasifica así una función nueva, tiene que
   * haber una purga que la respalde — y la conducta se compra entera en
   * `guest-cart-retention.test.ts`.
   */
  it('lo clasificado como `recogido` tiene de verdad quien lo recoja', async () => {
    const recogidas = Object.entries(ANON_SURFACE).filter(([, e]) => e.clase === 'recogido')
    expect(recogidas.map(([name]) => name)).toEqual(['cart_open'])

    const rows = await sql(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'ebim' and p.proname = 'sweep_empty_guest_carts'
    `)
    expect(rows).toHaveLength(1)

    const cuerpo = await sql(`
      select pg_get_functiondef(p.oid) as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'cart_open'
    `)
    expect(String(cuerpo[0]?.src)).toContain('sweep_empty_guest_carts')
  })

  it('cada entrada de la lista dice POR QUÉ puede estar', () => {
    for (const [name, entry] of Object.entries(ANON_SURFACE)) {
      expect(`${name}: ${entry.porque.length > 20}`).toBe(`${name}: true`)
    }
  })

  /**
   * `anon` no escribe NINGUNA tabla directamente. Lo que escribe lo escribe una
   * función `SECURITY DEFINER` con su autorización dentro — que es donde se
   * puede razonar sobre ella.
   */
  it('`anon` no tiene ni un GRANT de escritura, ni de tabla ni de columna', async () => {
    const tabla = await sql(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `)
    const columna = await sql(`
      select table_name, column_name, privilege_type from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and privilege_type in ('INSERT', 'UPDATE')
    `)
    expect({ tabla, columna }).toEqual({ tabla: [], columna: [] })
  })

  /**
   * Las ayudas de `ebim` que `anon` puede ejecutar tienen que ser PUROS: si una
   * fuera volátil estaría escribiendo, y entonces sería superficie pública sin
   * que nadie la hubiera declarado como tal.
   */
  it('ninguna función de `ebim` ALCANZABLE por `anon` puede escribir', async () => {
    const rows = await sql(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
      join pg_roles r on r.rolname = 'anon'
      where n.nspname = 'ebim' and has_function_privilege(r.oid, p.oid, 'EXECUTE')
        and p.provolatile = 'v'
        and t.typname <> 'trigger'
      order by 1
    `)
    expect(rows).toEqual([])
  })

  /**
   * La consulta de arriba descarta las funciones que devuelven `trigger`, y hay
   * que demostrar por qué se puede: Postgres se niega a invocarlas fuera de un
   * disparador, así que el privilegio de EXECUTE que arrastran por el
   * `GRANT ... TO PUBLIC` por defecto no es superficie alcanzable. Sin este
   * test la exclusión sería una suposición.
   */
  it('una función de disparador no se puede llamar aunque `anon` tenga EXECUTE', async () => {
    const message = await expectFailure(() => anon(`select ebim.sync_order_axes()`))
    expect(message).toMatch(/trigger/i)
  })

  it('las funciones del contador de tasa no las alcanza el cliente', async () => {
    const rows = await sql(`
      select p.proname as name, roles.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as roles(rolname)
      join pg_roles r on r.rolname = roles.rolname
      where p.proname in ('public_rate_exceeded', 'public_rate_record', 'public_rate_limit',
                          'purge_public_rate_events')
        and n.nspname in ('ebim', 'public')
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(rows).toEqual([])
  })
})

// ===========================================================================
// 2 · Claves ajenas con el tenant dentro
// ===========================================================================

describe('claves ajenas tenant-safe', () => {
  async function foreignKeys(): Promise<Array<{ fk: string; child: string; cols: string }>> {
    const rows = await sql(`
      select con.conname as fk, src.relname as child,
             (select string_agg(a.attname, ',' order by k.ord)
                from unnest(con.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace n on n.oid = src.relnamespace
      where con.contype = 'f' and n.nspname = 'public'
        and exists (
          select 1 from pg_attribute a
          where a.attrelid = tgt.oid and a.attname = 'organization_id' and not a.attisdropped
        )
    `)
    return rows.map((row) => ({
      fk: String(row.fk),
      child: String(row.child),
      cols: String(row.cols),
    }))
  }

  const SCOPED = /organization_id|company_id|store_id/

  it('hay claves ajenas que comprobar', async () => {
    expect((await foreignKeys()).length).toBeGreaterThan(200)
  })

  /**
   * La regla, en dos mitades. Una FK hacia una tabla con tenant vale si:
   *
   *  · arrastra una columna de alcance (`organization_id`, `company_id` o
   *    `store_id`) — entonces el aislamiento es de la propia clave; **o**
   *  · su tabla hija tiene OTRA clave ajena que sí la arrastra. Son las FK de
   *    guarda (`product_variants_kind_fk`, `variant_attribute_values_axis_fk`…):
   *    no anclan el tenant porque otra ya lo hizo, y su trabajo es comprobar un
   *    discriminador.
   *
   * Lo que la regla prohíbe es una tabla hija cuya ÚNICA relación con el padre
   * no lleve el tenant: ahí sí puede aparecer una fila que cruce inquilinos.
   */
  it('toda FK a una tabla de tenant lleva alcance, o su tabla lo lleva en otra FK', async () => {
    const all = await foreignKeys()
    const anchored = new Set(all.filter((fk) => SCOPED.test(fk.cols)).map((fk) => fk.child))
    const huerfanas = all
      .filter((fk) => !SCOPED.test(fk.cols) && !anchored.has(fk.child))
      .map((fk) => `${fk.child}.${fk.fk}(${fk.cols})`)
    expect(huerfanas).toEqual([])
  })

  /**
   * Regresión nominal de P16: estas nueve eran de una sola columna. Se listan
   * por nombre para que volver atrás sea imposible de hacer sin querer.
   */
  it.each([
    ['api_access_tokens', 'api_access_tokens_client_fk'],
    ['api_idempotency', 'api_idempotency_client_fk'],
    ['api_requests', 'api_requests_client_fk'],
    ['carts', 'carts_merged_into_fk'],
    ['integration_messages', 'integration_messages_outbox_fk'],
    ['order_tokens', 'order_tokens_order_fk'],
    ['reconciliation_records', 'reconciliation_records_payment_fk'],
    ['webhook_deliveries', 'webhook_deliveries_outbox_fk'],
    ['webhook_deliveries', 'webhook_deliveries_replay_fk'],
  ])('%s.%s incluye organization_id y company_id', async (child, name) => {
    const rows = await sql(
      `select (select string_agg(a.attname, ',' order by k.ord)
                 from unnest(con.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
        where con.conname = $1 and c.relname = $2`,
      [name, child],
    )
    expect(String(rows[0]?.cols)).toContain('organization_id')
    expect(String(rows[0]?.cols)).toContain('company_id')
  })

  it('un token de pedido no puede declarar una organización distinta a la del pedido', async () => {
    const order = await svc(
      `insert into public.orders
         (organization_id, company_id, store_id, channel_id, order_number, customer_email,
          currency, subtotal, tax_total, grand_total)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'EC-SEC-1', 'c@example.com',
               'PEN', 10, 0, 10)
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, channelA],
    )
    const message = await expectFailure(() =>
      svc(
        `insert into public.order_tokens (order_id, organization_id, company_id)
         values ($1, $2, $3)`,
        [String(order[0]?.id), TENANT_B.organizationId, TENANT_B.companyId],
      ),
    )
    expect(message).toMatch(/order_tokens_order_fk|foreign key/i)
  })
})

// ===========================================================================
// 3 · La barra invertida — regresión del hallazgo de P16
// ===========================================================================

describe('ebim.is_safe_href', () => {
  /**
   * El ataque, en una línea: `new URL('/\evil.com', 'https://tienda.com')` es
   * `https://evil.com/`. Antes de P16 esa cadena pasaba el CHECK como «ruta
   * interna» y quedaba publicada en la vitrina como botón de la tienda.
   */
  it.each([
    `/${B}evil.com`,
    `/${B}/evil.com`,
    `/${B}${B}evil.com`,
    `/ruta${B}rara`,
    `https://ok.com/a${B}b`,
  ])('rechaza %s', async (value) => {
    const rows = await sql(`select ebim.is_safe_href($1) as ok`, [value])
    expect(rows[0]?.ok).toBe(false)
  })

  it('rechaza un esquema partido con un carácter de control', async () => {
    const rows = await sql(`select ebim.is_safe_href('java' || chr(9) || 'script:alert(1)') as ok`)
    expect(rows[0]?.ok).toBe(false)
  })

  it.each(['https://proveedor.com/x', '/s/tienda/cart', 'mailto:a@b.com', 'tel:+51999'])(
    'sigue aceptando %s',
    async (value) => {
      const rows = await sql(`select ebim.is_safe_href($1) as ok`, [value])
      expect(rows[0]?.ok).toBe(true)
    },
  )

  it('un enlace ausente sigue siendo válido: es opcional, no obligatorio', async () => {
    const rows = await sql(`select ebim.is_safe_href(null) as ok`)
    expect(rows[0]?.ok).toBe(true)
  })

  /**
   * La función es la mitad; el CHECK es la que manda. Sin este test, relajar el
   * CHECK sin tocar la función pasaría desapercibido.
   */
  it('el CHECK de `content_blocks` rechaza guardar el botón envenenado', async () => {
    const page = await svc(
      `insert into public.content_pages
         (organization_id, company_id, store_id, slug, title, kind, status)
       values ($1, $2, $3, 'inicio', 'Inicio', 'home', 'published')
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    const message = await expectFailure(() =>
      svc(
        `insert into public.content_blocks
           (organization_id, company_id, store_id, page_id, block_type, title, cta_label, cta_href)
         values ($1, $2, $3, $4, 'banner', 'Oferta', 'Ver', $5)`,
        [
          TENANT_A.organizationId, TENANT_A.companyId, storeA, String(page[0]?.id),
          `/${B}evil.com`,
        ],
      ),
    )
    expect(message).toMatch(/cta_href_safe/)
  })

  it('el mismo bloque con una ruta interna de verdad SÍ se guarda', async () => {
    const page = await svc(
      `insert into public.content_pages
         (organization_id, company_id, store_id, slug, title, kind, status)
       values ($1, $2, $3, 'ofertas', 'Ofertas', 'landing', 'published')
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    const rows = await svc(
      `insert into public.content_blocks
         (organization_id, company_id, store_id, page_id, block_type, title, cta_label, cta_href)
       values ($1, $2, $3, $4, 'banner', 'Oferta', 'Ver', '/s/tienda-a/ofertas')
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, String(page[0]?.id)],
    )
    expect(rows).toHaveLength(1)
  })

  it('un nodo de texto enriquecido con barra invertida invalida el documento', async () => {
    const rows = await sql(
      `select ebim.rich_text_is_safe(jsonb_build_array(
         jsonb_build_object('type', 'paragraph', 'text', 'Mira esto', 'href', $1::text))) as ok`,
      [`/${B}evil.com`],
    )
    expect(rows[0]?.ok).toBe(false)
  })
})

// ===========================================================================
// 4 · Los techos de tasa
// ===========================================================================

describe('techo de tasa de la analítica anónima', () => {
  beforeEach(async () => {
    await svc(`delete from public.public_rate_events`)
    await svc(`update public.store_settings set config = config - 'rate_limits'`)
  })

  async function track(): Promise<number> {
    const rows = await anon(
      `select public.track_events_for_slug($1::text, null, jsonb_build_array(
         jsonb_build_object('type', 'product_view', 'product_id', $2::uuid))) as r`,
      [STORE_A_SLUG, productA],
    )
    return Number((rows[0]?.r as { recorded: number }).recorded)
  }

  it('por debajo del techo, escribe', async () => {
    await svc(
      `update public.store_settings set config = jsonb_build_object('rate_limits',
         jsonb_build_object('analytics.track', 2)) where store_id = $1`,
      [storeA],
    )
    expect(await track()).toBe(1)
    expect(await track()).toBe(1)
  })

  /**
   * La propiedad que hace aceptable un contador COMPARTIDO por tienda: pasarse
   * no es un error, es dejar de medir. Si esto lanzara, quien abusa dejaría sin
   * vitrina al comercio entero.
   */
  it('pasado el techo DESCARTA en vez de fallar: `recorded: 0`, sin excepción', async () => {
    await svc(
      `update public.store_settings set config = jsonb_build_object('rate_limits',
         jsonb_build_object('analytics.track', 2)) where store_id = $1`,
      [storeA],
    )
    await track()
    await track()
    expect(await track()).toBe(0)
    expect(await track()).toBe(0)
  })

  it('descartar no escribe ni un hecho más', async () => {
    await svc(
      `update public.store_settings set config = jsonb_build_object('rate_limits',
         jsonb_build_object('analytics.track', 1)) where store_id = $1`,
      [storeA],
    )
    await track()
    const antes = await svc(`select count(*)::int as n from public.analytics_events`)
    await track()
    await track()
    const despues = await svc(`select count(*)::int as n from public.analytics_events`)
    expect(despues[0]?.n).toBe(antes[0]?.n)
  })

  it('el techo es POR TIENDA: agotar el de A no toca el de B', async () => {
    await svc(
      `update public.store_settings set config = jsonb_build_object('rate_limits',
         jsonb_build_object('analytics.track', 1))`,
    )
    await track()
    expect(await track()).toBe(0)

    const rows = await anon(
      `select public.track_events_for_slug($1::text, null, jsonb_build_array(
         jsonb_build_object('type', 'search', 'term', 'silla'))) as r`,
      [STORE_B_SLUG],
    )
    expect(Number((rows[0]?.r as { recorded: number }).recorded)).toBe(1)
  })

  it('`0` desactiva el techo: escape deliberado del comercio que mide por su cuenta', async () => {
    await svc(
      `update public.store_settings set config = jsonb_build_object('rate_limits',
         jsonb_build_object('analytics.track', 0)) where store_id = $1`,
      [storeA],
    )
    for (let i = 0; i < 5; i += 1) expect(await track()).toBe(1)
    const rows = await svc(`select count(*)::int as n from public.public_rate_events`)
    expect(rows[0]?.n).toBe(0)
  })

  it('el lote de 20 sigue siendo el techo del lote: el de tasa no lo sustituye', async () => {
    const message = await expectFailure(() =>
      anon(
        `select public.track_events_for_slug($1::text, null,
           (select jsonb_agg(jsonb_build_object('type', 'search', 'term', 'x'))
              from generate_series(1, 21)))`,
        [STORE_A_SLUG],
      ),
    )
    expect(message).toMatch(/ANALYTICS_LOTE_EXCESIVO/)
  })
})

describe('techo de sondeo de cupones', () => {
  const items = (id: string) =>
    JSON.stringify([{ product_id: id, quantity: 1 }])

  beforeEach(async () => {
    await svc(`delete from public.public_rate_events`)
    await svc(`update public.store_settings set config = config - 'rate_limits'`)
    await svc(`delete from public.coupons`)
    await svc(`delete from public.promotions`)
  })

  async function quote(codes: string[] | null): Promise<Record<string, unknown>> {
    const rows = await anon(
      `select public.promotion_quote_for_slug($1::text, $2::jsonb, $3::text[]) as r`,
      [STORE_A_SLUG, items(productA), codes],
    )
    return rows[0]?.r as Record<string, unknown>
  }

  /**
   * El contador cuenta FALLOS, no usos. Sin esta distinción, una campaña con
   * diez mil canjes legítimos apagaría sus propios cupones.
   */
  it('un código que NO existe gasta contador', async () => {
    await quote(['no-existe-1'])
    const rows = await svc(
      `select count(*)::int as n from public.public_rate_events
        where surface = 'promotions.coupon_probe'`,
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('una cotización SIN cupones no gasta contador', async () => {
    await quote(null)
    const rows = await svc(`select count(*)::int as n from public.public_rate_events`)
    expect(rows[0]?.n).toBe(0)
  })

  it('un código que SÍ existe no gasta contador, aunque no aplique', async () => {
    const promo = await svc(
      `insert into public.promotions
         (organization_id, company_id, store_id, code, name, kind, status,
          value_percent, requires_coupon)
       values ($1::uuid, $2::uuid, $3::uuid, 'verano', 'Verano', 'percentage', 'active',
               10, true)
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    await svc(
      `insert into public.coupons
         (organization_id, company_id, store_id, promotion_id, code, is_active)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'VERANO10', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, String(promo[0]?.id)],
    )
    await quote(['VERANO10'])
    const rows = await svc(`select count(*)::int as n from public.public_rate_events`)
    expect(rows[0]?.n).toBe(0)
  })

  /**
   * Pasado el techo, el oráculo se apaga y el carrito sigue: la cotización sale
   * igual, sin la lista de cupones. No hay excepción que tumbe la compra.
   */
  it('pasado el techo la cotización SIGUE saliendo, sin cupones', async () => {
    await svc(
      `update public.store_settings set config = jsonb_build_object('rate_limits',
         jsonb_build_object('promotions.coupon_probe', 2)) where store_id = $1`,
      [storeA],
    )
    await quote(['falso-1'])
    await quote(['falso-2'])

    const result = await quote(['falso-3'])
    expect(result).toBeTruthy()
    expect((result.promotions as { coupons: unknown[] }).coupons).toEqual([])
    expect(result.discount_total).toBe('0.00')
  })

  it('un sondeo múltiple gasta un contador por código inexistente', async () => {
    // Codigos de tres caracteres NORMALIZADOS: `ebim.normalize_promo_code`
    // descarta lo que no sea alfanumerico y el motor ignora lo que se queda por
    // debajo de tres. Con `a-1` el sondeo no llegaria ni a contarse.
    await quote(['aaa1', 'bbb2', 'ccc3'])
    const rows = await svc(
      `select count(*)::int as n from public.public_rate_events
        where surface = 'promotions.coupon_probe'`,
    )
    expect(rows[0]?.n).toBe(3)
  })
})

describe('la ventana de tasa es del tenant y no la escribe el cliente', () => {
  beforeEach(async () => {
    await svc(`delete from public.public_rate_events`)
  })

  it('el miembro de A no ve la ventana de B', async () => {
    // Se siembra con un INSERT de servicio y no llamando a
    // `ebim.public_rate_record`: esa función está revocada para TODOS los roles
    // de la aplicación —solo la alcanzan las `SECURITY DEFINER` que la usan— y
    // llamarla desde aquí probaría un permiso que no debe existir.
    await svc(
      `insert into public.public_rate_events (organization_id, company_id, store_id, surface)
       values ($1::uuid, $2::uuid, $3::uuid, 'analytics.track')`,
      [TENANT_B.organizationId, TENANT_B.companyId, storeB],
    )
    const desdeA = await member(`select count(*)::int as n from public.public_rate_events`)
    const desdeB = await member(`select count(*)::int as n from public.public_rate_events`, [], TENANT_B)
    expect({ a: desdeA[0]?.n, b: desdeB[0]?.n }).toEqual({ a: 0, b: 1 })
  })

  it('nadie del cliente puede escribir el contador', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const rows = await sql(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'public_rate_events'
            and grantee = $1 and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
        [role],
      )
      expect(`${role}:${rows.length}`).toBe(`${role}:0`)
    }
  })

  it('la tabla nace con RLS activada y forzada, como el resto', async () => {
    const rows = await sql(`
      select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'public_rate_events'
    `)
    expect(rows[0]).toEqual({ enabled: true, forced: true })
  })

  it('la purga es de servidor, no de cliente', async () => {
    const rows = await sql(`
      select roles.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as roles(rolname)
      join pg_roles r on r.rolname = roles.rolname
      where n.nspname = 'public' and p.proname = 'purge_public_rate_events'
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(rows).toEqual([])
  })
})

// ===========================================================================
// 5 · La lección de la plataforma: esupplier-030
// ===========================================================================

/**
 * `coordinacion/respondidos/2026-08-11-esupplier-030-…-hardening-rls-bitacora.md`
 * documenta tres agujeros CRÍTICOS encontrados en otra app de la suite. No son
 * teóricos —quien los reportó los comprobó con consultas contra su base real— y
 * los tres son de la clase que se cuela en cualquier proyecto que crezca
 * deprisa. Se comprueban aquí contra ESTA base porque una lección de otro
 * equipo que no se convierte en test es una lección que este repositorio va a
 * volver a aprender por su cuenta.
 *
 * La frase que resume el hallazgo 1 y que da sentido a este bloque entero: la
 * tabla llevaba un COMMENT diciendo «append-only por convención», y al lado una
 * policy que dejaba borrarla. **La convención no es un control.**
 */
describe('los tres hallazgos de esupplier-030, contra esta base', () => {
  it('1 · la bitácora no la lee ni la borra `anon` con la clave del bundle', async () => {
    const grants = await sql(`
      select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'audit_log' and grantee = 'anon'
    `)
    expect(grants).toEqual([])

    // Y ni `service_role` puede corregirla: no tiene el GRANT.
    const servicio = await sql(`
      select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'audit_log'
        and grantee = 'service_role' and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    `)
    expect(servicio).toEqual([])
  })

  /**
   * 2 · «`SECURITY DEFINER` con `p_tenant_id` libre y `anon` puede ejecutarla».
   * Aquí no hay ninguna función de `public` que acepte un parámetro de tenant Y
   * sea alcanzable por el cliente: las que lo aceptan son de servidor y están
   * revocadas, y las que alcanza el cliente derivan el tenant del slug o del JWT.
   */
  it('2 · la ORGANIZACIÓN nunca llega por parámetro a algo que alcance el cliente', async () => {
    const rows = await sql(`
      select p.proname as name, roles.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as roles(rolname)
      join pg_roles r on r.rolname = roles.rolname
      where n.nspname = 'public'
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
        and exists (
          select 1
          from unnest(coalesce(p.proargnames, '{}'::text[])) as arg(name)
          where arg.name in ('p_organization_id', 'p_tenant_id', 'p_org_id')
        )
      order by 1, 2
    `)
    expect(rows).toEqual([])
  })

  /**
   * La SOCIEDAD sí puede llegar por parámetro, y es la distinción que el
   * hallazgo de esupplier-030 obliga a hacer bien: elegir entre las sociedades
   * PROPIAS es una función legítima del producto (es el selector de sociedad
   * activa). Lo que la convierte en un agujero es el par «`SECURITY DEFINER` +
   * parámetro libre», porque el definer salta la RLS y entonces el parámetro es
   * la única autorización que queda — y no hay ninguna.
   *
   * Regla: si una función alcanzable por el cliente acepta `p_company_id`,
   * tiene que NO ser `SECURITY DEFINER` (la RLS sigue decidiendo) **y** validar
   * `ebim.can_access` a mano. Las dos, no una.
   */
  it('2b · si acepta la SOCIEDAD, no es definer y valida `can_access`', async () => {
    const rows = await sql(`
      select p.proname as name, p.prosecdef as definer,
             (p.prosrc like '%can_access%') as valida
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.rolname = 'authenticated'
      where n.nspname = 'public'
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
        and 'p_company_id' = any (coalesce(p.proargnames, '{}'::text[]))
      order by 1
    `)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(`${row.name}: definer=${row.definer} valida=${row.valida}`).toBe(
        `${row.name}: definer=false valida=true`,
      )
    }
  })

  /**
   * 3 · «policy `FOR ALL` que mezcla lectura y escritura bajo el mismo
   * predicado». Aquí sí hay policies `FOR ALL`, y son legítimas: las seis son
   * de `authenticated` con `ebim.has_role(owner|admin)`, es decir, el mismo rol
   * para leer y para escribir por decisión. Lo que el hallazgo prohíbe es la
   * variante peligrosa —`USING (true)`— y eso es lo que se comprueba.
   */
  it('3 · ninguna policy de escritura pasa con `true`', async () => {
    const rows = await sql(`
      select tablename, policyname, cmd, roles::text as roles
      from pg_policies
      where schemaname = 'public'
        and cmd <> 'SELECT'
        and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
    `)
    expect(rows).toEqual([])
  })

  it('3b · toda policy `FOR ALL` exige rol, nunca `true`', async () => {
    const rows = await sql(`
      select tablename, policyname, coalesce(qual, '-') as qual
      from pg_policies
      where schemaname = 'public' and cmd = 'ALL'
        and coalesce(qual, '') not like '%has_role%'
      order by 1
    `)
    expect(rows).toEqual([])
  })

  /**
   * El único `USING (true)` del esquema es la LECTURA del catálogo técnico de
   * módulos del producto —que existan las capacidades no es dato de cliente—.
   * Se comprueba por nombre para que un segundo no entre de tapadillo.
   */
  it('el único predicado `true` del esquema es la lectura del catálogo de módulos', async () => {
    const rows = await sql(`
      select tablename, policyname, cmd
      from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
      order by 1
    `)
    expect(rows).toEqual([
      { tablename: 'app_capabilities', policyname: 'app_capabilities_select', cmd: 'SELECT' },
    ])
  })
})
