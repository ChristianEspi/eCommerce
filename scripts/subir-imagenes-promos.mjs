/**
 * Mete en el bucket las fotos de campaña que estaban colgando de terceros.
 *
 * ## Que problema arregla
 *
 * `seed-promo-images.mjs` guardo en `promotions.image_url` la URL de Flickr y
 * de Wikimedia tal cual, sin bajar el archivo. En desarrollo se veia; en el
 * despliegue no, porque la CSP del sitio solo admite imagenes del propio
 * dominio y del proyecto de Supabase:
 *
 *     img-src 'self' data: blob: https://<proyecto>.supabase.co
 *
 * Asi que el navegador bloqueaba SIETE imagenes y la consola se llenaba de
 * avisos de seguridad. La CSP no estaba mal: lo que estaba mal era tener la
 * demo apuntando a servidores de fotos ajenos, contra la regla del repositorio
 * de que las imagenes viven en Supabase Storage con ruta por tenant.
 *
 * ## Que hace
 *
 * Baja cada foto, la sube a `store-assets` en
 * `{organization_id}/{store_id}/promociones/{codigo}-{uuid}.{ext}` —la misma
 * forma que usa el backoffice, que es de donde la policy saca el tenant— y deja
 * en `image_url` la RUTA, no una URL. La URL firmada la pide la vitrina al
 * pintar, porque una firma caduca y guardarla seria guardar una imagen que
 * dentro de una hora no carga.
 *
 * Idempotente: solo toca las filas cuyo `image_url` empieza por `http`. La
 * segunda pasada no encuentra ninguna.
 *
 * Uso: `node scripts/subir-imagenes-promos.mjs`
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const URL_BASE = env.VITE_SUPABASE_URL
const SECRETO = env.SUPABASE_SECRET_KEY
const REF = new URL(URL_BASE).hostname.split('.')[0]

if (!URL_BASE || !SECRETO || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('Faltan VITE_SUPABASE_URL, SUPABASE_SECRET_KEY o SUPABASE_ACCESS_TOKEN en .env')
  process.exit(1)
}

async function sql(query) {
  const respuesta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await respuesta.text()
  if (!respuesta.ok) throw new Error(cuerpo)
  return cuerpo ? JSON.parse(cuerpo) : []
}

/** Comillas de literal SQL. Las rutas las genera este script, pero el codigo
 *  de la campaña sale de la base y no se concatena sin escapar. */
const lit = (valor) => `'${String(valor).replace(/'/g, "''")}'`

/** La extension sale del tipo REAL, no de la URL: media Wikipedia sirve PNG
 *  bajo una direccion `.jpg`, y el bucket acabaria con la extension mintiendo. */
const EXTENSIONES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

async function baja(url) {
  const respuesta = await fetch(url, {
    // Wikimedia rechaza las peticiones sin agente identificable.
    headers: { 'User-Agent': 'ebim-ecommerce-demo/1.0 (seed script)' },
  })
  if (!respuesta.ok) throw new Error(`descarga ${respuesta.status}`)
  const mime = (respuesta.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!EXTENSIONES[mime]) throw new Error(`tipo no admitido: ${mime || 'desconocido'}`)
  return { bytes: Buffer.from(await respuesta.arrayBuffer()), mime }
}

async function borra(ruta) {
  await fetch(`${URL_BASE}/storage/v1/object/store-assets/${ruta}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SECRETO}`, apikey: SECRETO },
  })
}

async function sube(ruta, bytes, mime) {
  const respuesta = await fetch(`${URL_BASE}/storage/v1/object/store-assets/${ruta}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRETO}`,
      apikey: SECRETO,
      'Content-Type': mime,
      'x-upsert': 'false',
      // Ruta con uuid = contenido inmutable: el navegador se la queda.
      'cache-control': 'max-age=604800',
    },
    body: bytes,
  })
  if (!respuesta.ok) throw new Error(`storage ${respuesta.status} ${(await respuesta.text()).slice(0, 200)}`)
}

const pendientes = await sql(`
  select id, code, organization_id, store_id, image_url
  from public.promotions
  where image_url like 'http%'
  order by code;
`)

if (pendientes.length === 0) {
  console.log('Nada que mover: ninguna campaña apunta fuera.')
  process.exit(0)
}

console.log(`${pendientes.length} campañas apuntando fuera del proyecto.`)

let movidas = 0
for (const promo of pendientes) {
  let subida = null
  try {
    const { bytes, mime } = await baja(promo.image_url)
    // La carpeta es `branding` y no `promociones` porque la restriccion
    // `promotions_image_ref` solo admite `{org}/{store}/branding/...`. Es la
    // misma que valida el logo, y esta bien que sea estrecha: es lo que impide
    // que alguien guarde ahi la ruta de OTRO tenant.
    const ruta = `${promo.organization_id}/${promo.store_id}/branding/promocion-${promo.code}-${crypto.randomUUID()}.${EXTENSIONES[mime]}`
    await sube(ruta, bytes, mime)
    subida = ruta
    await sql(
      `update public.promotions set image_url = ${lit(ruta)} where id = ${lit(promo.id)};`,
    )
    subida = null
    console.log(`  ✓ ${promo.code} · ${(bytes.length / 1024).toFixed(0)} kB · ${mime}`)
    movidas++
  } catch (error) {
    // Si subio y no llego a apuntarse, se retira: un objeto que no referencia
    // nadie es basura que nadie va a saber que puede borrar.
    if (subida) await borra(subida)
    // Una que falle no puede dejar las otras seis fuera: se informa y se sigue.
    console.error(`  ✗ ${promo.code} · ${error.message}`)
  }
}

const quedan = await sql(
  "select count(*)::int as n from public.promotions where image_url like 'http%';",
)
console.log(`\nMovidas ${movidas} de ${pendientes.length}. Siguen apuntando fuera: ${quedan[0].n}`)
if (quedan[0].n > 0) process.exit(1)
