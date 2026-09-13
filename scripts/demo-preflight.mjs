/**
 * Preflight de la demo: ¿se pueden recorrer las tres experiencias de punta a punta?
 *
 * ## Por qué VERIFICA y no siembra
 *
 * Los seeds de este repositorio ya existen y son idempotentes, pero volver a
 * correrlos contra un proyecto que ya tiene 573 productos y 18 pedidos no es
 * gratis: los catálogos de `seed-miquimica-catalog.mjs` y `seed-demo-catalog.mjs`
 * se solapan sobre la misma tienda, y una demo a dos días vista no es el momento
 * de descubrir qué pasa al ejecutarlos otra vez.
 *
 * Así que esto MIDE. Cada comprobación dice qué falta y con qué se arregla, y
 * solo se siembra lo que el informe señale. Correrlo no cambia ni una fila: son
 * consultas de lectura.
 *
 * ## Qué mide, y por qué esas cosas
 *
 * No mide «hay datos»: mide **lo que la vitrina puede pintar y cobrar**, que es
 * distinto. Un producto sin precio en lista activa existe en `products` y no
 * existe para el comprador, y descubrirlo delante del cliente es la clase de
 * fallo que este archivo evita.
 *
 * Desde el hardening multi-commerce (H13) mide cuatro grupos, en el orden del
 * guion de demo:
 *
 *  · STORE      — tienda, tema, marca, familias, catálogo, existencia, addons
 *                 y las migraciones del hardening.
 *  · B2C        — producto comprable, entrega, pago, país por defecto y, si se
 *                 declara, la cuenta del consumidor de demo.
 *  · TRADE      — el comercio de demo: cuenta activa, sin controles
 *                 corporativos, con lista vigente y un precio verificable.
 *  · ENTERPRISE — la empresa de demo: cuenta activa, con procesos
 *                 corporativos, lista vigente, precio verificable y sin bloqueo.
 *
 * TRADE y ENTERPRISE solo se evalúan si se declara el correo del usuario de demo
 * (`DEMO_TRADE_EMAIL`, `DEMO_ENTERPRISE_EMAIL`); sin él se informan como
 * pendientes y el veredicto es FAIL, porque esa parte de la demo no está lista.
 *
 * ## Dónde pregunta
 *
 *  · Por defecto, al proyecto remoto por la API de gestión (`VITE_SUPABASE_URL` +
 *    `SUPABASE_ACCESS_TOKEN`, del entorno o de `.env`).
 *  · Con `PREFLIGHT_DB_CONTAINER=<contenedor>`, a una pila LOCAL por `docker exec
 *    psql`. Es lo que usa el hardening contra su pila de pruebas.
 *
 * Nunca imprime contraseñas, tokens ni claves. Los correos salen enmascarados.
 *
 * Uso:  node scripts/demo-preflight.mjs [slug]        (por defecto `miquimica`)
 *       DEMO_TRADE_EMAIL=... DEMO_ENTERPRISE_EMAIL=... DEMO_CONSUMER_EMAIL=... \
 *       node scripts/demo-preflight.mjs miquimica
 *
 * Salida: una línea por comprobación, los motivos accionables y
 * `DEMO_PREFLIGHT = PASS` o `DEMO_PREFLIGHT = FAIL`. Termina con código 1 si
 * algo bloquea la demo, para poder encadenarlo en un gate.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = process.argv[2] ?? 'miquimica'

const archivoEnv = join(ROOT, '.env')
const env = {
  ...(existsSync(archivoEnv)
    ? Object.fromEntries(
        readFileSync(archivoEnv, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#') && line.includes('='))
          .map((line) => {
            const i = line.indexOf('=')
            return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
          }),
      )
    : {}),
  ...process.env,
}

const CONTENEDOR = env.PREFLIGHT_DB_CONTAINER
let destino

/** Ejecuta una consulta de LECTURA y devuelve las filas. */
let sql
if (CONTENEDOR) {
  destino = `pila local (${CONTENEDOR})`
  sql = async (query) => {
    const salida = execFileSync(
      'docker',
      ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
        `select coalesce(json_agg(t), '[]'::json) from (${query}) t`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return JSON.parse(salida.trim() || '[]')
  }
} else {
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_ACCESS_TOKEN) {
    console.error('Faltan VITE_SUPABASE_URL o SUPABASE_ACCESS_TOKEN (entorno o .env), o PREFLIGHT_DB_CONTAINER para una pila local.')
    console.log('\nDEMO_PREFLIGHT = FAIL\n')
    process.exit(1)
  }
  const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
  destino = `proyecto ${REF}`
  sql = async (query) => {
    const respuesta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const cuerpo = await respuesta.text()
    if (!respuesta.ok) throw new Error(cuerpo.slice(0, 300))
    return cuerpo ? JSON.parse(cuerpo) : []
  }
}

const lit = (valor) => `'${String(valor).replace(/'/g, "''")}'`

/** `ana.perez@empresa.com` → `a***@empresa.com`. */
const enmascarar = (correo) => {
  const [usuario, dominio] = String(correo).split('@')
  return dominio ? `${usuario.slice(0, 1)}***@${dominio}` : '***'
}

const TIENDA = `(select s.* from public.stores s where s.slug = ${lit(SLUG)})`

/** Un conteo con mínimo: el formato de las doce comprobaciones originales. */
function conteo(grupo, paso, minimo, arreglo, query) {
  return {
    grupo,
    paso,
    arreglo,
    async evaluar() {
      const filas = await sql(query)
      const n = Number(filas[0]?.n ?? 0)
      return { ok: n >= minimo, detalle: `${n} (mín. ${minimo})` }
    },
  }
}

// ---------------------------------------------------------------------------
// STORE
// ---------------------------------------------------------------------------
const STORE = [
  conteo('STORE', 'Tienda activa', 1, 'supabase/seed.sql',
    `select count(*)::int as n from public.stores where slug = ${lit(SLUG)} and status = 'active'`),
  {
    grupo: 'STORE',
    paso: 'Tema válido y marca',
    arreglo: 'Configuración → Diseño de tienda / Marca',
    async evaluar() {
      const [fila] = await sql(`select ps.theme_preset, ps.accent_color, ps.name from public.public_stores ps where ps.slug = ${lit(SLUG)}`)
      const tema = fila?.theme_preset
      const ok = ['universal', 'retail', 'premium', 'catalog'].includes(tema) && Boolean(fila?.accent_color) && Boolean(fila?.name)
      return { ok, detalle: fila ? `tema ${tema}, acento ${fila.accent_color ? 'sí' : 'no'}` : 'sin fila en public_stores' }
    },
  },
  conteo('STORE', 'Categorías raíz activas', 4, 'supabase/demo-data.sql',
    `select count(*)::int as n from public.categories c join public.stores s on s.id = c.store_id
      where s.slug = ${lit(SLUG)} and c.parent_id is null and c.is_active`),
  conteo('STORE', 'Productos que la vitrina puede pintar', 20, 'node scripts/seed-miquimica-catalog.mjs',
    `select count(*)::int as n from public.public_products p join public.stores s on s.id = p.store_id where s.slug = ${lit(SLUG)}`),
  conteo('STORE', 'Productos con foto', 20, 'node scripts/seed-product-images.mjs',
    `select count(*)::int as n from public.public_products p join public.stores s on s.id = p.store_id
      where s.slug = ${lit(SLUG)} and p.primary_image_path is not null`),
  conteo('STORE', 'Productos con precio', 20, 'supabase/demo-data.sql (listas de precios)',
    `select count(*)::int as n from public.public_products p join public.stores s on s.id = p.store_id
      where s.slug = ${lit(SLUG)} and coalesce(p.price, p.price_from) is not null`),
  conteo('STORE', 'Productos con stock', 10, 'node scripts/seed-miquimica-catalog.mjs',
    `select count(*)::int as n from public.public_products p join public.stores s on s.id = p.store_id
      where s.slug = ${lit(SLUG)} and p.in_stock`),
  conteo('STORE', 'Productos rebajados (para el hero)', 3, 'node scripts/seed-demo-discounts.mjs',
    `select count(*)::int as n from public.public_products p join public.stores s on s.id = p.store_id
      where s.slug = ${lit(SLUG)} and p.compare_at_price is not null`),
  conteo('STORE', 'Promociones vigentes', 1, 'node scripts/seed-miquimica-promos.mjs',
    `select count(*)::int as n from public.promotions p join public.stores s on s.id = p.store_id
      where s.slug = ${lit(SLUG)} and p.status = 'active' and now() between p.valid_from and p.valid_to`),
  // Uno basta: la portada NO se compone solo de bloques de CMS.
  conteo('STORE', 'Bloques de portada activos', 1, 'supabase/home-compose-miquimica.sql',
    `select count(*)::int as n from public.content_blocks b join public.content_pages g on g.id = b.page_id
      join public.stores s on s.id = b.store_id where s.slug = ${lit(SLUG)} and g.kind = 'home' and b.is_active`),
  conteo('STORE', 'Almacenes con existencias', 1, 'supabase/demo-data.sql (warehouses)',
    `select count(*)::int as n from public.warehouses w join public.stores s on s.organization_id = w.organization_id
      where s.slug = ${lit(SLUG)}`),
  {
    // Sin este addon, `ebim.active_price_lists` no devuelve NINGUNA lista y todo
    // se cotiza a catálogo en silencio: ni mayorista ni convenio.
    grupo: 'STORE',
    paso: 'Addon de listas de precio activo',
    arreglo: 'hub: activar ecommerce.pricing.lists para la sociedad (en local: scripts/e2e-local-fixtures.mjs)',
    async evaluar() {
      const [fila] = await sql(`select count(*)::int as n from public.tenant_entitlements e join ${TIENDA} s
        on s.organization_id = e.organization_id and s.company_id = e.company_id
        where e.entitlement_code = 'ecommerce.pricing.lists' and e.is_active`)
      return { ok: Number(fila?.n) > 0, detalle: Number(fila?.n) > 0 ? 'activo' : 'NO activo: todo cobraría a catálogo' }
    },
  },
  {
    grupo: 'STORE',
    paso: 'Migraciones del hardening aplicadas',
    arreglo: 'aplicar 20260913100000, 20260913110000 y 20260913120000 (docs/demo-hardening/FINAL_REPORT.md, QAS)',
    async evaluar() {
      const [fila] = await sql(`select
          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('my_consumer_orders','my_consumer_order_detail','my_checkout_profile','checkout_link_order_buyer','my_commerce_context'))::int as funciones,
          (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'order_buyers')::int as tabla,
          (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'public_stores' and column_name = 'default_country')::int as pais`)
      const ok = Number(fila?.funciones) === 5 && Number(fila?.tabla) === 1 && Number(fila?.pais) === 1
      return { ok, detalle: `funciones ${fila?.funciones}/5, order_buyers ${fila?.tabla}/1, default_country ${fila?.pais}/1` }
    },
  },
]

// ---------------------------------------------------------------------------
// B2C
// ---------------------------------------------------------------------------
const B2C = [
  {
    grupo: 'B2C',
    paso: 'Producto demo comprable',
    arreglo: 'node scripts/seed-miquimica-catalog.mjs',
    async evaluar() {
      const filas = await sql(`select p.slug from public.public_products p join public.stores s on s.id = p.store_id
        where s.slug = ${lit(SLUG)} and p.in_stock and coalesce(p.price, p.price_from) is not null order by p.published_at desc limit 1`)
      return { ok: filas.length > 0, detalle: filas[0] ? `p. ej. ${filas[0].slug}` : 'ninguno con precio y stock' }
    },
  },
  conteo('B2C', 'Métodos de entrega activos', 2, 'supabase/demo-data.sql (delivery_methods)',
    `select count(*)::int as n from public.delivery_methods d join public.stores s on s.id = d.store_id
      where s.slug = ${lit(SLUG)} and d.is_active`),
  conteo('B2C', 'Medios de pago activos', 2, 'supabase/demo-data.sql (payment_methods)',
    `select count(*)::int as n from public.payment_methods m join public.stores s on s.id = m.store_id
      where s.slug = ${lit(SLUG)} and m.is_active`),
  {
    grupo: 'B2C',
    paso: 'País por defecto del checkout',
    arreglo: 'zonas de entrega activas de UN solo país (Entregas → Red)',
    async evaluar() {
      const [fila] = await sql(`select ps.default_country from public.public_stores ps where ps.slug = ${lit(SLUG)}`)
      return { ok: Boolean(fila?.default_country), detalle: fila?.default_country ?? 'sin país (varios o ninguna zona)' }
    },
  },
  ...(env.DEMO_CONSUMER_EMAIL
    ? [
        {
          grupo: 'B2C',
          paso: `Consumidor de demo ${enmascarar(env.DEMO_CONSUMER_EMAIL)}`,
          arreglo: 'crear la cuenta desde el backoffice (create-user) o Supabase Auth',
          async evaluar() {
            const [fila] = await sql(`select
                (select count(*) from auth.users u where lower(u.email) = lower(${lit(env.DEMO_CONSUMER_EMAIL)}))::int as usuario,
                (select count(*) from public.business_account_users bu join auth.users u on u.id = bu.user_id
                  where lower(u.email) = lower(${lit(env.DEMO_CONSUMER_EMAIL)}) and bu.status = 'active')::int as vinculos`)
            const ok = Number(fila?.usuario) === 1 && Number(fila?.vinculos) === 0
            return {
              ok,
              detalle: Number(fila?.usuario) !== 1 ? 'no existe' : Number(fila?.vinculos) > 0 ? 'tiene cuenta de empresa: no es consumidor' : 'existe, sin empresa',
            }
          },
        },
      ]
    : []),
]

// ---------------------------------------------------------------------------
// TRADE y ENTERPRISE — la misma medición con la audiencia esperada.
// ---------------------------------------------------------------------------

/** Misma regla que `deriveCommerceAudience`, en SQL, sobre la cuenta que usa el motor. */
function compradorDeEmpresa(grupo, correo, audienciaEsperada) {
  if (!correo) {
    return [
      {
        grupo,
        paso: 'Usuario de demo declarado',
        arreglo: `declarar DEMO_${grupo}_EMAIL con el correo del comprador de demo`,
        async evaluar() {
          return { ok: false, detalle: `falta DEMO_${grupo}_EMAIL` }
        },
      },
    ]
  }

  const CUENTA = `
    select a.*, c.segment_id, c.id as cliente_id, bu.spending_limit, s.id as tienda_id, s.currency as moneda,
           (select count(*) from public.business_locations l where l.business_account_id = a.id and l.is_active) as sedes,
           count(*) over () as cuentas
    from auth.users u
    join public.business_account_users bu on bu.user_id = u.id and bu.status = 'active'
    join public.business_accounts a on a.id = bu.business_account_id and a.is_active
    join public.customers c on c.id = a.customer_id and c.is_active
    join ${TIENDA} s on s.organization_id = a.organization_id and s.company_id = a.company_id
    where lower(u.email) = lower(${lit(correo)})
    order by a.created_at, a.id`

  return [
    {
      grupo,
      paso: `Usuario ${enmascarar(correo)} y cuenta activa`,
      arreglo: 'node scripts/crear-usuario-b2b.mjs <correo> <contraseña> "<cuenta>" (vínculo activo en la sociedad de la tienda)',
      async evaluar() {
        const filas = await sql(`select name, cuentas from (${CUENTA}) x limit 1`)
        if (filas.length === 0) return { ok: false, detalle: 'sin usuario o sin cuenta activa en esta sociedad' }
        const varias = Number(filas[0].cuentas) > 1
        return { ok: !varias, detalle: varias ? `${filas[0].cuentas} cuentas activas: la demo necesita UNA (sin selector)` : filas[0].name }
      },
    },
    {
      grupo,
      paso: `Audiencia ${audienciaEsperada}`,
      arreglo: audienciaEsperada === 'trade'
        ? 'la cuenta no debe exigir aprobación, OC, tope, crédito ni tener varias sedes'
        : 'la cuenta necesita un proceso corporativo: aprobación, OC, tope, crédito o varias sedes',
      async evaluar() {
        const [fila] = await sql(`select (requires_approval or purchase_order_required or spending_limit is not null
            or coalesce(credit_limit, 0) > 0 or payment_terms_days > 0 or sedes > 1) as corporativa from (${CUENTA}) x limit 1`)
        if (!fila) return { ok: false, detalle: 'sin cuenta' }
        const audiencia = fila.corporativa ? 'enterprise' : 'trade'
        return { ok: audiencia === audienciaEsperada, detalle: `se pintaría como ${audiencia}` }
      },
    },
    {
      grupo,
      paso: 'Lista vigente de su cliente o segmento',
      arreglo: 'Precios → asignar una lista activa y vigente al segmento o al cliente',
      async evaluar() {
        const filas = await sql(`select l.code from (${CUENTA} limit 1) x
          join public.price_list_assignments pa on pa.store_id = x.tienda_id and pa.is_active
           and ((pa.scope = 'customer' and pa.customer_id = x.cliente_id) or (pa.scope = 'segment' and pa.segment_id = x.segment_id))
          join public.price_lists l on l.id = pa.price_list_id and l.is_active and l.currency = x.moneda
           and l.valid_from <= now() and (l.valid_to is null or l.valid_to > now())`)
        return { ok: filas.length > 0, detalle: filas.length > 0 ? filas.map((f) => f.code).join(', ') : 'ninguna' }
      },
    },
    {
      grupo,
      paso: 'Precio comercial verificable',
      arreglo: 'la lista necesita al menos un producto en stock con precio menor que el público',
      async evaluar() {
        const filas = await sql(`select p.slug, it.min_quantity::int as desde from (${CUENTA} limit 1) x
          join public.price_list_assignments pa on pa.store_id = x.tienda_id and pa.is_active
           and ((pa.scope = 'customer' and pa.customer_id = x.cliente_id) or (pa.scope = 'segment' and pa.segment_id = x.segment_id))
          join public.price_lists l on l.id = pa.price_list_id and l.is_active and l.currency = x.moneda
           and l.valid_from <= now() and (l.valid_to is null or l.valid_to > now())
          join public.price_list_items it on it.price_list_id = l.id and it.variant_id is null
          join public.public_products p on p.product_id = it.product_id and p.in_stock and p.price is not null
          where it.unit_price < p.price
          order by it.min_quantity, p.slug limit 1`)
        return {
          ok: filas.length > 0,
          detalle: filas[0] ? `${filas[0].slug} desde ${filas[0].desde} u.` : 'ninguno mejora el precio público',
        }
      },
    },
    {
      grupo,
      paso: 'Checkout habilitado para la cuenta',
      arreglo: 'Crédito → desbloquear la cuenta (credit_status)',
      async evaluar() {
        const [fila] = await sql(`select coalesce(credit_status::text, 'ok') as estado from (${CUENTA}) x limit 1`)
        if (!fila) return { ok: false, detalle: 'sin cuenta' }
        return { ok: fila.estado !== 'blocked', detalle: `crédito ${fila.estado}` }
      },
    },
  ]
}

const COMPROBACIONES = [
  ...STORE,
  ...B2C,
  ...compradorDeEmpresa('TRADE', env.DEMO_TRADE_EMAIL, 'trade'),
  ...compradorDeEmpresa('ENTERPRISE', env.DEMO_ENTERPRISE_EMAIL, 'enterprise'),
]

console.log(`\nPreflight de demo · tienda «${SLUG}» · ${destino}\n`)
console.log('  GRUPO       ESTADO  COMPROBACIÓN                                      DETALLE')
console.log('  ' + '-'.repeat(100))

const pendientes = []
let grupoAnterior = ''
for (const control of COMPROBACIONES) {
  let resultado
  try {
    resultado = await control.evaluar()
  } catch (error) {
    resultado = { ok: false, detalle: `ERROR ${String(error.message).split('\n')[0].slice(0, 80)}` }
  }
  if (!resultado.ok) pendientes.push({ ...control, detalle: resultado.detalle })
  const grupo = control.grupo === grupoAnterior ? '' : control.grupo
  grupoAnterior = control.grupo
  console.log(
    `  ${grupo.padEnd(11)} ${(resultado.ok ? 'OK' : 'FALTA').padEnd(7)} ${control.paso.padEnd(49)} ${resultado.detalle}`,
  )
}

console.log('')
if (pendientes.length === 0) {
  console.log('  Las tres experiencias tienen todo lo que necesitan.')
  console.log('\nDEMO_PREFLIGHT = PASS\n')
  process.exit(0)
}

console.log(`  ${pendientes.length} comprobación(es) sin cumplir. Para cada una:\n`)
for (const control of pendientes) {
  console.log(`    [${control.grupo}] ${control.paso} — ${control.detalle}`)
  console.log(`      -> ${control.arreglo}`)
}
console.log('\nDEMO_PREFLIGHT = FAIL\n')
process.exit(1)
