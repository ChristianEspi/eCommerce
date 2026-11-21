/**
 * Configura el correo del proyecto: Microsoft Graph, la cola y el hook de Auth.
 *
 * ## La regla que manda: contrato de plataforma §14
 *
 * Toda la suite envía por Microsoft Graph en modo aplicación, como un buzón
 * dedicado por app. Los secretos `MS_TENANT_ID`, `MS_CLIENT_ID`,
 * `MS_CLIENT_SECRET`, `MS_SENDER_EMAIL` y `MS_SENDER_NAME` los carga el
 * OPERADOR en los secretos de Edge Functions; este script no los pide ni los
 * escribe. Una versión anterior configuraba Resend con un remitente genérico, y
 * el contrato lo prohíbe expresamente.
 *
 * ## Lo que hace, en orden
 *
 *  1. Fija `EBIM_APP_BASE_URL`, la base de los enlaces de los correos.
 *  2. Comprueba si están los cinco secretos `MS_*`.
 *  3. Si ESTÁN: genera la clave del envío y el secreto del hook, los guarda
 *     como secretos de funciones, deja en Vault la URL y la clave que usa el
 *     planificador y activa el hook de envío de correo de Auth.
 *  4. Si NO están pero sí MailHub (`EBIM_MAILHUB_URL` + `EBIM_MAILHUB_TOKEN`,
 *     vía de QAS desde 2026-11-20, ver ecommerce-001 en el buzón): conecta SOLO
 *     la cola. El hook de Auth sigue apagado: envía por Graph, no por MailHub.
 *  5. Si no hay ninguno: desactiva el hook y no deja nada en Vault. Así el
 *     planificador no llama a nada y Auth no intenta enviar por una función que
 *     respondería error.
 *
 * Se puede ejecutar las veces que haga falta. Cada ejecución con Graph
 * configurado rota la clave del envío y el secreto del hook.
 *
 * Uso:
 *   node scripts/configurar-correo.mjs [--base-url http://localhost:5173]
 *
 * Sin `--base-url` no se toca `EBIM_APP_BASE_URL` si ya existe; si no existe,
 * se usa `http://localhost:5173`.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const argBase = process.argv.indexOf('--base-url')
const BASE_URL_ARG = argBase > 0 ? process.argv[argBase + 1].replace(/\/+$/, '') : null
const SUPABASE_URL = env.VITE_SUPABASE_URL.replace(/\/+$/, '')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const MS_KEYS = ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_SENDER_EMAIL', 'MS_SENDER_NAME']

async function api(method, path, body) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/** Escapa un literal para SQL. Los valores son generados aquí, pero no se confía en eso. */
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`

async function vaultUpsert(name, value) {
  await api('POST', '/database/query', {
    query: `do $$ declare v uuid; begin
      select id into v from vault.secrets where name = ${lit(name)};
      if v is null then perform vault.create_secret(${lit(value)}, ${lit(name)});
      else perform vault.update_secret(v, ${lit(value)}); end if;
    end $$;`,
  })
}

async function vaultDelete(name) {
  await api('POST', '/database/query', {
    query: `delete from vault.secrets where name = ${lit(name)};`,
  })
}

// 1. Base de los enlaces.
const previos = new Set(((await api('GET', '/secrets')) ?? []).map((s) => s.name))
const BASE_URL = BASE_URL_ARG ?? (previos.has('EBIM_APP_BASE_URL') ? null : 'http://localhost:5173')
if (BASE_URL) await api('POST', '/secrets', [{ name: 'EBIM_APP_BASE_URL', value: BASE_URL }])

// 2. ¿Está Graph? ¿Y MailHub?
const secretos = await api('GET', '/secrets')
const nombres = new Set((secretos ?? []).map((s) => s.name))
const faltan = MS_KEYS.filter((k) => !nombres.has(k))
const graph = faltan.length === 0
const mailhub = !graph && nombres.has('EBIM_MAILHUB_URL') && nombres.has('EBIM_MAILHUB_TOKEN')

if (graph) {
  // 3. Envío y hook.
  const clave = randomBytes(36).toString('base64url')
  const hookSecret = `v1,whsec_${randomBytes(32).toString('base64')}`

  await api('POST', '/secrets', [
    { name: 'EBIM_NOTIFICATIONS_KEY', value: clave },
    { name: 'AUTH_HOOK_SECRET', value: hookSecret },
  ])
  await vaultUpsert('notifications_dispatch_url', `${SUPABASE_URL}/functions/v1/notifications-dispatch`)
  await vaultUpsert('notifications_dispatch_key', clave)
  await api('PATCH', '/config/auth', {
    hook_send_email_enabled: true,
    hook_send_email_uri: `${SUPABASE_URL}/functions/v1/auth-email-hook`,
    hook_send_email_secrets: hookSecret,
  })
} else if (mailhub) {
  // 4. Solo la cola: el hook de Auth envía por Graph, así que sigue apagado.
  const clave = randomBytes(36).toString('base64url')
  await api('POST', '/secrets', [{ name: 'EBIM_NOTIFICATIONS_KEY', value: clave }])
  await vaultUpsert('notifications_dispatch_url', `${SUPABASE_URL}/functions/v1/notifications-dispatch`)
  await vaultUpsert('notifications_dispatch_key', clave)
  await api('PATCH', '/config/auth', { hook_send_email_enabled: false })
} else {
  // 5. Sin envío: nada que llame a una función que va a fallar.
  await api('PATCH', '/config/auth', { hook_send_email_enabled: false })
  await vaultDelete('notifications_dispatch_url')
  await vaultDelete('notifications_dispatch_key')
}

const auth = await api('GET', '/config/auth')
console.log(
  JSON.stringify(
    {
      proyecto: REF,
      enlaces: BASE_URL ?? '(sin cambios)',
      graph_configurado: graph,
      mailhub_configurado: mailhub,
      secretos_ms_que_faltan: faltan,
      hook_de_auth_activo: Boolean(auth.hook_send_email_enabled),
      smtp_host: auth.smtp_host ?? null,
      planificador: graph || mailhub ? 'con destino en Vault' : 'sin destino: no llama a nada',
    },
    null,
    2,
  ),
)
