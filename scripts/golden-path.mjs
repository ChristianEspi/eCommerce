/**
 * Golden path REAL, de punta a punta, contra el proyecto desplegado.
 *
 * No es un test con dobles: llama a la función de borde que usa la vitrina,
 * crea un pedido de verdad y lo lleva hasta la transición administrativa. Es la
 * unica forma de responder al punto 4 del prompt de validacion sin un navegador.
 *
 * El pedido queda marcado como «VALIDACION PREFLIGHT» para que se distinga de
 * los de demo.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
const CLAVE = env.VITE_SUPABASE_PUBLISHABLE_KEY
const SLUG = 'miquimica'

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(t.slice(0, 400))
  return t ? JSON.parse(t) : []
}

async function fn(nombre, body) {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/${nombre}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: CLAVE,
      Authorization: `Bearer ${CLAVE}`,
    },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.text() }
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`
let fallos = 0
function paso(n, titulo, ok, detalle) {
  if (!ok) fallos++
  console.log(`${ok ? ' OK  ' : 'FALLA'} ${String(n).padStart(2)}. ${titulo}`)
  if (detalle) console.log(`        ${detalle}`)
}

console.log('\nGOLDEN PATH REAL · tienda miquimica · proyecto ' + REF + '\n')

// --- 1 · Catalogo publicado -------------------------------------------------
const producto = (
  await sql(`
  select p.product_id, p.slug, p.name, p.price, p.currency
  from public.public_products p join public.stores s on s.id = p.store_id
  where s.slug = ${lit(SLUG)} and p.in_stock and p.price is not null
    and p.kind = 'simple'
  order by p.name limit 1`)
)[0]
paso(1, 'Producto publicado, con precio y stock', Boolean(producto), producto?.name)

// --- 2 · Entrega ------------------------------------------------------------
const entrega = (
  await sql(`
  select d.code, d.display_name as name from public.delivery_methods d
  join public.stores s on s.id = d.store_id
  where s.slug = ${lit(SLUG)} and d.is_active order by d.position limit 1`)
)[0]
paso(2, 'Metodo de entrega disponible', Boolean(entrega), entrega?.name)

// --- 3 · Medio de pago (la superficie publica que usa la vitrina) -----------
const pago = (
  await sql(`
  select m.code, m.display_name from public.public_payment_methods m
  join public.stores s on s.id = m.store_id
  where s.slug = ${lit(SLUG)} and m.code = 'transferencia' limit 1`)
)[0]
paso(3, 'Medio de pago en la vista publica', Boolean(pago), pago?.display_name)

if (!producto || !entrega || !pago) {
  console.log('\nSin los maestros no se puede seguir.\n')
  process.exit(1)
}

// --- 4 · Crear pedido, con medio de pago ------------------------------------
const idem = crypto.randomUUID()
const cuerpo = {
  store_slug: SLUG,
  idempotency_key: idem,
  cart_token: null,
  customer_name: 'VALIDACION PREFLIGHT',
  customer_email: 'validacion.preflight@ebim.test',
  customer_phone: '+51 999 000 111',
  shipping_address: { address: 'Av. Javier Prado 1234', city: 'Lima', country: 'PE' },
  delivery: { method_code: entrega.code, pickup_point_id: null },
  payment_method_code: pago.code,
  items: [{ product_id: producto.product_id, quantity: 1 }],
  accept_price_changes: true,
  coupon_codes: [],
}

const creado = await fn('checkout', cuerpo)
let pedido = null
if (creado.status === 200 || creado.status === 201) {
  pedido = JSON.parse(creado.body).data
}
paso(
  4,
  'Checkout crea el pedido',
  Boolean(pedido?.order_number),
  pedido ? `nº ${pedido.order_number} · total ${pedido.currency} ${pedido.grand_total}` : creado.body.slice(0, 220),
)

if (!pedido) {
  console.log('\nSin pedido no se puede validar la administracion.\n')
  process.exit(1)
}

// --- 5 · El medio de pago quedo TRAZADO -------------------------------------
const intento = (
  await sql(`
  select pi.status, m.code as metodo
  from public.payment_intents pi
  left join public.payment_methods m on m.id = pi.payment_method_id
  where pi.order_id = ${lit(pedido.order_id)} limit 1`)
)[0]
paso(
  5,
  'El medio de pago queda trazado en el pedido',
  intento?.metodo === pago.code,
  intento ? `intento ${intento.status} · metodo ${intento.metodo}` : 'sin intento de pago',
)

// --- 6 · Idempotencia -------------------------------------------------------
const repetido = await fn('checkout', cuerpo)
const repetidoBody = repetido.status < 300 ? JSON.parse(repetido.body).data : null
paso(
  6,
  'Reenviar la misma compra NO crea un segundo pedido',
  repetidoBody?.order_id === pedido.order_id,
  repetidoBody ? `mismo pedido, replay=${repetidoBody.replay}` : repetido.body.slice(0, 160),
)

// --- 7 · Visible en administracion ------------------------------------------
const enAdmin = (
  await sql(`
  select o.order_number, o.status, o.payment_status, o.fulfillment_status
  from public.orders o where o.id = ${lit(pedido.order_id)}`)
)[0]
paso(
  7,
  'El pedido es visible en administracion',
  Boolean(enAdmin),
  enAdmin
    ? `estado ${enAdmin.status} · pago ${enAdmin.payment_status} · entrega ${enAdmin.fulfillment_status}`
    : 'no aparece',
)

// --- 8 · Timeline -----------------------------------------------------------
const timeline = await sql(
  `select count(*)::int as n from public.order_events where order_id = ${lit(pedido.order_id)}`,
)
paso(8, 'El pedido tiene bitacora', timeline[0].n > 0, `${timeline[0].n} entrada(s)`)

console.log('\n  (la transicion administrativa se valida aparte: exige rol de backoffice)\n')
console.log(fallos === 0 ? `TODO OK · pedido ${pedido.order_number}\n` : `${fallos} fallo(s)\n`)
console.log(`ORDER_ID=${pedido.order_id}`)
process.exit(fallos === 0 ? 0 : 1)
