/**
 * Configura el correo de Auth del proyecto: remitente SMTP y plantillas.
 *
 * ## Por qué un script y no el panel
 *
 * Lo que se configura a mano en el panel no queda en ningún sitio: la próxima
 * persona no sabe qué asunto tenía el correo de recuperación ni con qué
 * servidor salía. Aquí las plantillas viven en `supabase/templates/` y este
 * script las sube tal cual, así que lo que llega al buzón es lo versionado.
 *
 * ## Por qué `config push` no
 *
 * `supabase config push` sube la sección `[auth]` ENTERA. Este repositorio no
 * la describe completa, así que empujarla pisaría con valores por defecto lo
 * que el proyecto ya tiene —la URL del sitio, las redirecciones permitidas—.
 * Este script toca solo los campos que nombra.
 *
 * ## La clave
 *
 * Se lee de `SMTP_PASS` en `.env`, que no se versiona, y no se imprime nunca.
 * Si falta, el script se niega: configurar el remitente sin clave dejaría Auth
 * intentando enviar con un servidor que lo rechaza, y la recuperación de
 * contraseña fallaría en silencio.
 *
 * Uso:
 *   node scripts/configurar-correo.mjs                   remitente + plantillas
 *   node scripts/configurar-correo.mjs --solo-plantillas solo asuntos y plantillas
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const soloPlantillas = process.argv.includes('--solo-plantillas')

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const REF = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]

/**
 * Resend por SMTP. El usuario es literalmente `resend` y la contraseña es la
 * clave de API: así lo documenta el proveedor, no es un marcador.
 */
const SMTP = {
  smtp_host: 'smtp.resend.com',
  smtp_port: '465',
  smtp_user: 'resend',
  smtp_admin_email: env.SMTP_ADMIN_EMAIL || 'no-responder@grupoebim.com',
  smtp_sender_name: env.SMTP_SENDER_NAME || 'eCommerce by EBIM',
  // El límite por defecto sin servidor propio es 2 por hora para todo el
  // proyecto: una demostración con tres personas pidiendo recuperar la
  // contraseña ya lo agota. Con servidor propio Supabase deja subirlo.
  rate_limit_email_sent: 30,
}

/** Asunto y archivo de cada correo que Auth puede enviar hoy. */
const PLANTILLAS = {
  recovery: 'Restablece tu contraseña',
  confirmation: 'Confirma tu correo',
  invite: 'Te dieron acceso',
  magic_link: 'Tu enlace para entrar',
  email_change: 'Confirma tu nuevo correo',
}

const cuerpo = {}
for (const [clave, asunto] of Object.entries(PLANTILLAS)) {
  cuerpo[`mailer_subjects_${clave}`] = asunto
  cuerpo[`mailer_templates_${clave}_content`] = readFileSync(
    join(ROOT, 'supabase', 'templates', `${clave}.html`),
    'utf8',
  )
}

if (!soloPlantillas) {
  if (!env.SMTP_PASS) {
    console.error(
      'Falta SMTP_PASS en .env. Pon ahí la clave de API de Resend y vuelve a ejecutar.\n' +
        'Para subir solo las plantillas: node scripts/configurar-correo.mjs --solo-plantillas',
    )
    process.exit(1)
  }
  Object.assign(cuerpo, SMTP, { smtp_pass: env.SMTP_PASS })
}

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(cuerpo),
})

const respuesta = await r.json().catch(() => ({}))
if (!r.ok) {
  // El cuerpo de error de la API describe el campo que rechaza; no contiene la
  // clave, que solo viaja en la petición.
  console.error(`La API respondió ${r.status}:`, JSON.stringify(respuesta, null, 2))
  process.exit(1)
}

// Solo campos no secretos: la respuesta trae también `smtp_pass`.
console.log(
  JSON.stringify(
    {
      proyecto: REF,
      modo: soloPlantillas ? 'solo plantillas' : 'remitente y plantillas',
      smtp_host: respuesta.smtp_host ?? null,
      smtp_admin_email: respuesta.smtp_admin_email ?? null,
      smtp_sender_name: respuesta.smtp_sender_name ?? null,
      rate_limit_email_sent: respuesta.rate_limit_email_sent ?? null,
      asuntos: Object.fromEntries(
        Object.keys(PLANTILLAS).map((k) => [k, respuesta[`mailer_subjects_${k}`] ?? null]),
      ),
    },
    null,
    2,
  ),
)
