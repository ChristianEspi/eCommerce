/**
 * Fixtures de los E2E multi-commerce (H09-H11), SOLO para una pila LOCAL.
 *
 * ## Qué deja preparado
 *
 * Sobre la tienda `miquimica` de `supabase/seed.sql` + `supabase/demo-data.sql`:
 *
 *  · un CONSUMIDOR: cuenta de acceso sin vínculo con ninguna empresa;
 *  · un COMERCIO (trade): cliente «Bodega E2E» en el segmento `mayorista`, con
 *    una cuenta sin controles corporativos y su comprador activo;
 *  · una EMPRESA (enterprise): cliente «Corporativo E2E» en el segmento
 *    `clinicas` (lista `convenio`), con crédito a 30 días, ORDEN DE COMPRA
 *    obligatoria (N05) y su comprador activo;
 *  · un comprador con DOS cuentas (N01): «E2E Multi Andina» (segmento
 *    `mayorista`, la más antigua) y «E2E Multi Boreal» (convenio de cliente
 *    propio sobre el producto de los E2E), para el selector «Comprando para».
 *    Su elección guardada se borra en cada pasada: arranca siempre en la
 *    cuenta más antigua;
 *  · los addons implementados activos para la sociedad (como en DEV);
 *  · existencia repuesta y el limitador de checkout vacío, para poder repetir.
 *
 * Idempotente: correrlo dos veces deja lo mismo. Las contraseñas NO están aquí
 * ni se imprimen: llegan por variables de entorno.
 *
 * ## Por qué se niega a correr fuera de localhost
 *
 * Usa la clave de servicio para crear usuarios y fichas. Contra el proyecto de
 * DEV/QAS dejaría compradores de prueba en la demo real. La guarda es el host de
 * la URL, no una bandera que alguien pueda olvidar poner.
 *
 * Uso:
 *   E2E_SUPABASE_URL=http://127.0.0.1:55321 E2E_SERVICE_ROLE_KEY=... \
 *   E2E_CONSUMER_EMAIL=... E2E_CONSUMER_PASSWORD=... \
 *   E2E_TRADE_EMAIL=... E2E_TRADE_PASSWORD=... \
 *   E2E_ENTERPRISE_EMAIL=... E2E_ENTERPRISE_PASSWORD=... \
 *   E2E_MULTI_EMAIL=... E2E_MULTI_PASSWORD=... \
 *   node scripts/e2e-local-fixtures.mjs
 */

const env = process.env
const faltan = [
  'E2E_SUPABASE_URL',
  'E2E_SERVICE_ROLE_KEY',
  'E2E_CONSUMER_EMAIL',
  'E2E_CONSUMER_PASSWORD',
  'E2E_TRADE_EMAIL',
  'E2E_TRADE_PASSWORD',
  'E2E_ENTERPRISE_EMAIL',
  'E2E_ENTERPRISE_PASSWORD',
  'E2E_MULTI_EMAIL',
  'E2E_MULTI_PASSWORD',
].filter((name) => !env[name])
if (faltan.length > 0) {
  console.error(`Faltan variables: ${faltan.join(', ')}`)
  process.exit(1)
}

const BASE = env.E2E_SUPABASE_URL.replace(/\/$/, '')
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Se niega a correr contra ${host}: este script es solo para una pila local.`)
  process.exit(1)
}

const KEY = env.E2E_SERVICE_ROLE_KEY
const SLUG = env.E2E_STORE_SLUG ?? 'miquimica'
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/** Crea la cuenta de acceso o, si ya existe, le pone la contraseña del entorno. */
async function usuario(email, password) {
  const lista = await http('GET', `/auth/v1/admin/users?per_page=1000`)
  const existente = (lista.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (existente) {
    await http('PUT', `/auth/v1/admin/users/${existente.id}`, { password, email_confirm: true })
    return existente.id
  }
  const creado = await http('POST', '/auth/v1/admin/users', { email, password, email_confirm: true })
  return creado.id
}

async function unaFila(path) {
  const filas = await http('GET', path)
  return Array.isArray(filas) ? (filas[0] ?? null) : null
}

async function asegurar(tabla, filtro, fila) {
  const existente = await unaFila(`/rest/v1/${tabla}?${filtro}&select=*`)
  if (existente) {
    const [actualizada] = await http('PATCH', `/rest/v1/${tabla}?${filtro}`, fila)
    return actualizada
  }
  const [creada] = await http('POST', `/rest/v1/${tabla}`, fila)
  return creada
}

const tienda = await unaFila(`/rest/v1/stores?slug=eq.${SLUG}&select=id,organization_id,company_id`)
if (!tienda) {
  console.error(`No existe la tienda «${SLUG}». Aplica supabase/seed.sql y supabase/demo-data.sql.`)
  process.exit(1)
}
const tenant = { organization_id: tienda.organization_id, company_id: tienda.company_id }

async function segmento(code) {
  const fila = await unaFila(
    `/rest/v1/customer_segments?code=eq.${code}&organization_id=eq.${tenant.organization_id}&company_id=eq.${tenant.company_id}&select=id`,
  )
  if (!fila) throw new Error(`Falta el segmento ${code} (supabase/demo-data.sql)`)
  return fila.id
}

async function compradorDeEmpresa({ email, password, code, name, segmentCode, cuentaExtra }) {
  const userId = await usuario(email, password)
  return cuentaDe({ userId, email, code, name, segmentCode, cuentaExtra })
}

async function cuentaDe({ userId, email, code, name, segmentCode, cuentaExtra }) {
  const cliente = await asegurar(
    'customers',
    `code=eq.${code}&organization_id=eq.${tenant.organization_id}&company_id=eq.${tenant.company_id}`,
    { ...tenant, kind: 'company', code, name, email: `compras+${code.toLowerCase()}@e2e.test`, segment_id: await segmento(segmentCode), is_active: true },
  )
  const cuenta = await asegurar(
    'business_accounts',
    `code=eq.${code}&organization_id=eq.${tenant.organization_id}&company_id=eq.${tenant.company_id}`,
    { ...tenant, customer_id: cliente.id, code, name, is_active: true, ...cuentaExtra },
  )
  await asegurar(
    'business_account_users',
    `business_account_id=eq.${cuenta.id}&user_id=eq.${userId}`,
    { ...tenant, business_account_id: cuenta.id, user_id: userId, email, role: 'buyer', status: 'active' },
  )
  return { cliente, cuenta }
}

/**
 * Los addons contratados, como los tiene la sociedad de demo en DEV.
 *
 * Sin `pricing.lists` activo, `ebim.active_price_lists` no devuelve ninguna
 * lista y TODO se cotiza a catálogo en silencio: ni lista base, ni mayorista,
 * ni convenio. En producción esto lo escribe el hub al contratar; aquí, que es
 * una pila local de pruebas, se activan todos los addons implementados.
 */
const capacidades = await http('GET', '/rest/v1/app_capabilities?entitlement_code=not.is.null&select=entitlement_code')
for (const { entitlement_code } of capacidades) {
  await asegurar(
    'tenant_entitlements',
    `organization_id=eq.${tenant.organization_id}&company_id=eq.${tenant.company_id}&entitlement_code=eq.${entitlement_code}`,
    { ...tenant, entitlement_code, is_active: true, source: 'provisioning' },
  )
}

await usuario(env.E2E_CONSUMER_EMAIL, env.E2E_CONSUMER_PASSWORD)

await compradorDeEmpresa({
  email: env.E2E_TRADE_EMAIL,
  password: env.E2E_TRADE_PASSWORD,
  code: 'E2E-TRADE',
  name: 'Bodega E2E',
  segmentCode: 'mayorista',
  cuentaExtra: {
    requires_approval: false,
    purchase_order_required: false,
    credit_limit: null,
    payment_terms_days: 0,
  },
})

await compradorDeEmpresa({
  email: env.E2E_ENTERPRISE_EMAIL,
  password: env.E2E_ENTERPRISE_PASSWORD,
  code: 'E2E-CORP',
  name: 'Corporativo E2E SAC',
  segmentCode: 'clinicas',
  cuentaExtra: {
    requires_approval: false,
    purchase_order_required: true,
    credit_limit: 50000,
    payment_terms_days: 30,
  },
})

/**
 * N01 · un comprador con DOS cuentas en la misma sociedad.
 *
 * Andina es la más antigua (fecha fija) y cotiza con el segmento `mayorista`;
 * Boreal tiene un convenio de CLIENTE sobre el producto de los E2E a un precio
 * claramente menor, así que elegir una u otra cambia el precio a la vista. El
 * importe se deriva del precio de catálogo del producto, no se escribe a mano.
 */
const multiUser = await usuario(env.E2E_MULTI_EMAIL, env.E2E_MULTI_PASSWORD)
await cuentaDe({
  userId: multiUser,
  email: env.E2E_MULTI_EMAIL,
  code: 'E2E-MULTI-A',
  name: 'E2E Multi Andina Distribuciones',
  segmentCode: 'mayorista',
  cuentaExtra: { requires_approval: false, purchase_order_required: false, credit_limit: null, payment_terms_days: 0, created_at: '2026-01-01T00:00:00Z' },
})
const boreal = await cuentaDe({
  userId: multiUser,
  email: env.E2E_MULTI_EMAIL,
  code: 'E2E-MULTI-B',
  name: 'E2E Multi Boreal Corporativo Industrial SAC',
  segmentCode: 'mayorista',
  cuentaExtra: { requires_approval: false, purchase_order_required: false, credit_limit: null, payment_terms_days: 0, created_at: '2026-02-01T00:00:00Z' },
})
const productoMulti = await unaFila(
  `/rest/v1/products?store_id=eq.${tienda.id}&slug=eq.${env.E2E_MULTI_PRODUCT_SLUG ?? 'alcohol-en-gel-70'}&select=id,price`,
)
if (!productoMulti) throw new Error('Falta el producto de los E2E multi-cuenta')
const listaBoreal = await asegurar(
  'price_lists',
  `store_id=eq.${tienda.id}&code=eq.e2e-multi-boreal`,
  { ...tenant, store_id: tienda.id, code: 'e2e-multi-boreal', name: 'Convenio E2E Boreal', currency: 'PEN', valid_from: '2026-01-01T00:00:00Z', valid_to: null, is_active: true, priority: 0 },
)
await asegurar(
  'price_list_assignments',
  `price_list_id=eq.${listaBoreal.id}&customer_id=eq.${boreal.cliente.id}`,
  { ...tenant, store_id: tienda.id, price_list_id: listaBoreal.id, scope: 'customer', customer_id: boreal.cliente.id, is_active: true },
)
await asegurar(
  'price_list_items',
  `price_list_id=eq.${listaBoreal.id}&product_id=eq.${productoMulti.id}&min_quantity=eq.1`,
  { ...tenant, store_id: tienda.id, price_list_id: listaBoreal.id, product_id: productoMulti.id, min_quantity: 1, unit_price: (Math.round(Number(productoMulti.price) * 55) / 100).toFixed(2) },
)
await http('DELETE', `/rest/v1/buyer_account_selections?user_id=eq.${multiUser}`)

/**
 * N04 · una campaña DIRIGIDA a la cuenta Boreal (10 % sobre todo). Andina no la
 * tiene: elegir una u otra cambia el descuento del carrito y del pedido.
 */
const campana = await asegurar(
  'promotions',
  `store_id=eq.${tienda.id}&code=eq.e2e-multi-boreal`,
  { ...tenant, store_id: tienda.id, code: 'e2e-multi-boreal', name: 'Campaña E2E Boreal', kind: 'percentage', status: 'active', value_percent: 10, requires_coupon: false, valid_from: '2026-01-01T00:00:00Z', valid_to: null },
)
await asegurar(
  'promotion_scopes',
  `promotion_id=eq.${campana.id}&scope_kind=eq.all`,
  { ...tenant, store_id: tienda.id, promotion_id: campana.id, promotion_kind: 'percentage', scope_kind: 'all' },
)
await asegurar(
  'promotion_audiences',
  `promotion_id=eq.${campana.id}&audience_kind=eq.business_account`,
  { ...tenant, store_id: tienda.id, promotion_id: campana.id, audience_kind: 'business_account', business_account_id: boreal.cuenta.id },
)

/**
 * Lo que las pasadas anteriores gastaron, repuesto.
 *
 * Cada ejecución crea pedidos de verdad: consume existencia (hasta que el
 * producto sale como agotado y «añadir» ya no responde) y suma intentos al
 * limitador de checkout (hasta el 429). Las dos cosas son el sistema funcionando
 * bien; para que el E2E sea repetible se reponen aquí, por las puertas de
 * servidor de siempre: el saldo por `sync_inventory_level` (entrada del ERP,
 * con su asiento en el libro) y los intentos por `purge_checkout_attempts`.
 */
const niveles = await http('GET', `/rest/v1/inventory_levels?store_id=eq.${tienda.id}&select=id,warehouse_id,product_id,variant_id`)
const marca = Date.now()
let repuestos = 0
for (const nivel of niveles) {
  try {
    await http('POST', '/rest/v1/rpc/sync_inventory_level', {
      p_warehouse_id: nivel.warehouse_id,
      p_product_id: nivel.product_id,
      p_variant_id: nivel.variant_id,
      p_on_hand: 500,
      p_external_ref: `e2e-${marca}-${nivel.id}`,
      p_reason: 'Fixture E2E local',
    })
    repuestos += 1
  } catch (error) {
    // Un nivel antiguo sin variante de un producto que ya lleva existencia por
    // variante: la base lo rechaza, con razón. Se deja como está.
    if (!String(error.message).includes('VARIANTE_REQUERIDA')) throw error
  }
}
if (repuestos === 0) throw new Error('No se pudo reponer ninguna existencia')
await http('POST', '/rest/v1/rpc/purge_checkout_attempts', { p_older_than: '0 seconds' })

console.log(`Fixtures E2E listas en «${SLUG}»: consumidor, comercio (E2E-TRADE), empresa (E2E-CORP) y multi-cuenta (E2E-MULTI-A/B).`)
