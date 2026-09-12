// @vitest-environment node
/**
 * El envío de correo: plantillas, Microsoft Graph, el hook de Auth y la cola.
 *
 * Todo sin red y sin secretos. Lo que se fija aquí son las decisiones que se
 * rompen en silencio: un nombre de tienda con HTML dentro, un botón con
 * `javascript:`, un 401 que quema los intentos de toda la cola, una firma de
 * hook que se acepta sin comprobar.
 */
import { describe, expect, it } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { buildAuthEmail, verifyAuthHookSignature } from '../functions/_shared/notifications/authHook.ts'
import { dispatchPendingEmails, type ClaimedEmail, type DispatchPorts } from '../functions/_shared/notifications/dispatch.ts'
import {
  GRAPH_ENV_KEYS,
  graphConfigFromEnv,
  graphToken,
  sendGraphMail,
  type GraphConfig,
} from '../functions/_shared/notifications/graph.ts'
import { actionUrl, escapeHtml, renderEmail, TEMPLATE_KINDS } from '../functions/_shared/notifications/templates.ts'

const BASE = 'http://localhost:5173'

const CONFIG: GraphConfig = {
  tenantId: 'tenant',
  clientId: 'client',
  clientSecret: 'secret',
  senderEmail: 'ecommerce@grupoebim.com',
  senderName: 'eCommerce by EBIM',
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

describe('configuración de Graph', () => {
  it('son los cinco secretos del contrato §14', () => {
    expect([...GRAPH_ENV_KEYS]).toEqual([
      'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_SENDER_EMAIL', 'MS_SENDER_NAME',
    ])
  })

  it('dice QUÉ falta, no solo que falta algo', () => {
    const { config, missing } = graphConfigFromEnv((k) => (k === 'MS_TENANT_ID' ? 't' : undefined))
    expect(config).toBeNull()
    expect(missing).toEqual(['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_SENDER_EMAIL', 'MS_SENDER_NAME'])
  })

  it('un valor de espacios cuenta como ausente', () => {
    const env: Record<string, string> = {
      MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: '   ', MS_SENDER_EMAIL: 'e@x.com', MS_SENDER_NAME: 'n',
    }
    expect(graphConfigFromEnv((k) => env[k]).missing).toEqual(['MS_CLIENT_SECRET'])
  })
})

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

describe('plantillas', () => {
  const pedido = {
    order_number: 'EC-00042', grand_total: '120.00', currency: 'PEN',
    store_name: 'Quimica Suiza', store_slug: 'miquimica',
  }

  it('la confirmación nombra el pedido y lleva a la cuenta de ESA tienda', () => {
    const correo = renderEmail('order.confirmed', 'es', pedido, BASE)
    expect(correo?.subject).toBe('Recibimos tu pedido EC-00042')
    expect(correo?.html).toContain('http://localhost:5173/s/miquimica/account')
    expect(correo?.html).toContain('Quimica Suiza')
  })

  it('el remitente es de la suite, pero la marca de la tienda va dentro', () => {
    const correo = renderEmail('order.confirmed', 'es', pedido, BASE)
    expect(correo?.html).toContain('Enviado por eCommerce by EBIM en nombre de Quimica Suiza.')
  })

  it('en inglés si la tienda está en inglés', () => {
    expect(renderEmail('order.confirmed', 'en', pedido, BASE)?.subject).toBe('We received your order EC-00042')
  })

  it('un nombre de tienda con HTML no entra como HTML', () => {
    const correo = renderEmail('order.confirmed', 'es', { ...pedido, store_name: '<script>x</script>' }, BASE)
    expect(correo?.html).not.toContain('<script>')
    expect(correo?.html).toContain('&lt;script&gt;')
  })

  it('el motivo de un rechazo tampoco', () => {
    const correo = renderEmail('order.rejected', 'es', { ...pedido, reason: '<img src=x onerror=alert(1)>' }, BASE)
    expect(correo?.html).not.toContain('<img src=x')
  })

  it('un logo que no es https no se incrusta: se escribe el nombre', () => {
    const correo = renderEmail('order.confirmed', 'es', { ...pedido, store_logo: 'http://inseguro/logo.png' }, BASE)
    expect(correo?.html).not.toContain('<img')
  })

  it('una plantilla que no existe no se inventa', () => {
    expect(renderEmail('order.nada', 'es', {}, BASE)).toBeNull()
  })

  it('hay plantilla para cada aviso por correo que genera la base', () => {
    const DE_LA_BASE = [
      'order.confirmed', 'order.approval_requested', 'order.approved', 'order.rejected',
      'order.shipped', 'member.access_granted', 'member.role_changed', 'member.access_revoked',
      'business_account.invited', 'business_account.activated', 'integration.circuit_opened',
      'suggestion.sent',
    ]
    for (const kind of DE_LA_BASE) expect(`${kind}: ${TEMPLATE_KINDS.includes(kind)}`).toBe(`${kind}: true`)
  })

  it('el aviso de acceso retirado no lleva botón: ya no hay dónde entrar', () => {
    expect(renderEmail('member.access_revoked', 'es', { path: '/app' }, BASE)?.html).not.toContain('<a href')
  })
})

describe('a dónde lleva el botón', () => {
  it('backoffice: la ruta interna que dejó la base', () => {
    expect(actionUrl('order.approval_requested', { path: '/app/orders?order=1' }, BASE))
      .toBe('http://localhost:5173/app/orders?order=1')
  })

  it('una ruta que no es interna no produce enlace', () => {
    expect(actionUrl('order.approval_requested', { path: '//evil.com/x' }, BASE)).toBeNull()
    expect(actionUrl('order.approval_requested', { path: 'https://evil.com' }, BASE)).toBeNull()
  })

  it('un slug raro no produce enlace', () => {
    expect(actionUrl('order.confirmed', { store_slug: '../admin' }, BASE)).toBeNull()
  })

  it('en Auth solo http(s): nunca javascript:', () => {
    expect(actionUrl('auth.recovery', { action_url: 'javascript:alert(1)' }, BASE)).toBeNull()
    expect(actionUrl('auth.recovery', { action_url: 'https://x.supabase.co/auth/v1/verify?t=1' }, BASE))
      .toBe('https://x.supabase.co/auth/v1/verify?t=1')
  })

  it('el sugerido abre directamente su pestaña', () => {
    expect(actionUrl('suggestion.sent', { store_slug: 'miquimica' }, BASE))
      .toBe('http://localhost:5173/s/miquimica/account#sugeridos')
  })

  it('escapeHtml cubre comillas, que es lo que rompe un atributo', () => {
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;')
  })
})

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

function respuesta(status: number, headers: Record<string, string> = {}, body = ''): Response {
  return new Response(status === 202 ? null : body, { status, headers })
}

describe('envío por Graph', () => {
  it('pide el token al tenant de Microsoft con client credentials', async () => {
    let llamada: { url: string; body: string } | null = null
    const token = await graphToken(CONFIG, async (url, init) => {
      llamada = { url, body: String(init?.body) }
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    })
    expect(token).toBe('tok')
    expect(llamada!.url).toBe('https://login.microsoftonline.com/tenant/oauth2/v2.0/token')
    expect(llamada!.body).toContain('grant_type=client_credentials')
    expect(llamada!.body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default')
  })

  it('envía COMO el buzón de la app y sin guardar copia en Enviados', async () => {
    type Cuerpo = { message: { from: { emailAddress: unknown } }; saveToSentItems: boolean }
    let enviado: { url: string; body: Cuerpo } | null = null
    const resultado = await sendGraphMail(CONFIG, 'tok', { to: 'a@b.com', subject: 'S', html: '<p>H</p>' },
      async (url, init) => {
        enviado = { url, body: JSON.parse(String(init?.body)) }
        return respuesta(202, { 'request-id': 'req-1' })
      })

    expect(resultado).toEqual({ ok: true, reference: 'req-1' })
    expect(enviado!.url).toBe('https://graph.microsoft.com/v1.0/users/ecommerce%40grupoebim.com/sendMail')
    expect(enviado!.body.message.from.emailAddress).toEqual({ address: 'ecommerce@grupoebim.com', name: 'eCommerce by EBIM' })
    expect(enviado!.body.saveToSentItems).toBe(false)
  })

  it('un 401 o 403 para la pasada y no quema el intento', async () => {
    for (const status of [401, 403]) {
      const r = await sendGraphMail(CONFIG, 'tok', { to: 'a@b.com', subject: 'S', html: 'H' }, async () => respuesta(status))
      expect(r).toEqual({ ok: false, code: 'GRAPH_NO_AUTORIZADO', retryable: true, stopBatch: true })
    }
  })

  it('un 429 espera; un 500 reintenta sin parar la pasada; un 400 no reintenta', async () => {
    const enviar = (status: number) =>
      sendGraphMail(CONFIG, 'tok', { to: 'a@b.com', subject: 'S', html: 'H' }, async () => respuesta(status))
    expect(await enviar(429)).toMatchObject({ retryable: true, stopBatch: true })
    expect(await enviar(503)).toMatchObject({ code: 'GRAPH_503', retryable: true, stopBatch: false })
    expect(await enviar(400)).toMatchObject({ code: 'GRAPH_400', retryable: false, stopBatch: false })
  })

  it('sin red, para la pasada', async () => {
    const r = await sendGraphMail(CONFIG, 'tok', { to: 'a@b.com', subject: 'S', html: 'H' }, async () => {
      throw new TypeError('fetch failed')
    })
    expect(r).toMatchObject({ code: 'GRAPH_SIN_RED', stopBatch: true })
  })
})

// ---------------------------------------------------------------------------
// Hook de Auth
// ---------------------------------------------------------------------------

describe('firma del hook de Auth', () => {
  const clave = randomBytes(32)
  const secreto = `v1,whsec_${clave.toString('base64')}`
  const cuerpo = JSON.stringify({ user: { email: 'a@b.com' } })
  const ahora = 1_800_000_000

  function firmar(id: string, ts: number, body: string, key = clave): string {
    return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`
  }

  it('acepta la firma buena', async () => {
    expect(await verifyAuthHookSignature({
      secret: secreto, id: 'msg_1', timestamp: String(ahora), signature: firmar('msg_1', ahora, cuerpo),
      body: cuerpo, nowSeconds: ahora,
    })).toBe(true)
  })

  it('rechaza un cuerpo cambiado', async () => {
    expect(await verifyAuthHookSignature({
      secret: secreto, id: 'msg_1', timestamp: String(ahora), signature: firmar('msg_1', ahora, cuerpo),
      body: cuerpo.replace('a@b.com', 'victima@b.com'), nowSeconds: ahora,
    })).toBe(false)
  })

  it('rechaza una firma con otro secreto', async () => {
    expect(await verifyAuthHookSignature({
      secret: secreto, id: 'msg_1', timestamp: String(ahora),
      signature: firmar('msg_1', ahora, cuerpo, randomBytes(32)), body: cuerpo, nowSeconds: ahora,
    })).toBe(false)
  })

  it('rechaza una llamada repetida de hace una hora', async () => {
    const antes = ahora - 3600
    expect(await verifyAuthHookSignature({
      secret: secreto, id: 'msg_1', timestamp: String(antes), signature: firmar('msg_1', antes, cuerpo),
      body: cuerpo, nowSeconds: ahora,
    })).toBe(false)
  })

  it('sin cabeceras, no', async () => {
    expect(await verifyAuthHookSignature({
      secret: secreto, id: null, timestamp: null, signature: null, body: cuerpo, nowSeconds: ahora,
    })).toBe(false)
  })

  it('acepta si UNA de varias firmas vale, que es como se rota el secreto', async () => {
    const buena = firmar('msg_1', ahora, cuerpo)
    expect(await verifyAuthHookSignature({
      secret: secreto, id: 'msg_1', timestamp: String(ahora), signature: `v1,basura ${buena}`,
      body: cuerpo, nowSeconds: ahora,
    })).toBe(true)
  })
})

describe('del hook al correo', () => {
  it('recuperar contraseña arma el enlace de verificación del proyecto', () => {
    const correo = buildAuthEmail({
      user: { email: 'cespinoza@grupoebim.com' },
      email_data: { token_hash: 'h4sh', email_action_type: 'recovery', redirect_to: 'http://localhost:5173/nueva-clave' },
    }, 'https://proyecto.supabase.co')

    expect(correo?.to).toBe('cespinoza@grupoebim.com')
    expect(correo?.kind).toBe('auth.recovery')
    const url = new URL(correo!.params.action_url)
    expect(url.origin + url.pathname).toBe('https://proyecto.supabase.co/auth/v1/verify')
    expect(url.searchParams.get('token')).toBe('h4sh')
    expect(url.searchParams.get('type')).toBe('recovery')
    expect(url.searchParams.get('redirect_to')).toBe('http://localhost:5173/nueva-clave')
  })

  it('un tipo que no se usa no se inventa', () => {
    expect(buildAuthEmail({ user: { email: 'a@b.com' }, email_data: { token_hash: 'h', email_action_type: 'reauthentication' } }, 'https://p.supabase.co')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// La cola
// ---------------------------------------------------------------------------

function puertos(outcomes: Array<Awaited<ReturnType<DispatchPorts['send']>>>, emails: ClaimedEmail[], token: string | null = 'tok') {
  const registro = { completed: [] as string[], failed: [] as Array<[string, string, boolean]>, sentTo: [] as string[] }
  const ports: DispatchPorts = {
    claim: async () => emails,
    token: async () => token,
    complete: async (id) => { registro.completed.push(id) },
    fail: async (id, code, retryable) => { registro.failed.push([id, code, retryable]) },
    send: async (_t, message) => {
      registro.sentTo.push(message.to)
      return outcomes.shift() ?? { ok: true, reference: null }
    },
  }
  return { ports, registro }
}

const correo = (id: string, kind = 'order.confirmed'): ClaimedEmail => ({
  id, kind, locale: 'es', to_address: `${id}@b.com`, attempts: 1,
  params: { order_number: 'EC-1', grand_total: '1', currency: 'PEN', store_slug: 'tienda' },
})

describe('vaciar la cola', () => {
  it('envía y cierra cada correo', async () => {
    const { ports, registro } = puertos([], [correo('a'), correo('b')])
    const informe = await dispatchPendingEmails(ports, { limit: 10, baseUrl: BASE })
    expect(informe).toEqual({ claimed: 2, sent: 2, failed: 0, stoppedBy: null })
    expect(registro.completed).toEqual(['a', 'b'])
  })

  it('sin token, devuelve todo a la cola sin enviar nada', async () => {
    const { ports, registro } = puertos([], [correo('a'), correo('b')], null)
    const informe = await dispatchPendingEmails(ports, { limit: 10, baseUrl: BASE })
    expect(informe.stoppedBy).toBe('GRAPH_TOKEN')
    expect(registro.sentTo).toEqual([])
    expect(registro.failed.every(([, , retry]) => retry)).toBe(true)
  })

  it('un 401 a mitad para la pasada y devuelve el resto sin gastarle un intento definitivo', async () => {
    const { ports, registro } = puertos(
      [{ ok: true, reference: null }, { ok: false, code: 'GRAPH_NO_AUTORIZADO', retryable: true, stopBatch: true }],
      [correo('a'), correo('b'), correo('c')],
    )
    const informe = await dispatchPendingEmails(ports, { limit: 10, baseUrl: BASE })
    expect(informe).toEqual({ claimed: 3, sent: 1, failed: 2, stoppedBy: 'GRAPH_NO_AUTORIZADO' })
    expect(registro.sentTo).toEqual(['a@b.com', 'b@b.com'])
    expect(registro.failed).toEqual([['b', 'GRAPH_NO_AUTORIZADO', true], ['c', 'GRAPH_NO_AUTORIZADO', true]])
  })

  it('una plantilla desconocida falla sin reintento y no para a los demás', async () => {
    const { ports, registro } = puertos([], [correo('a', 'no.existe'), correo('b')])
    const informe = await dispatchPendingEmails(ports, { limit: 10, baseUrl: BASE })
    expect(informe.sent).toBe(1)
    expect(registro.failed).toEqual([['a', 'PLANTILLA_DESCONOCIDA', false]])
  })

  it('cola vacía: ni siquiera pide token', async () => {
    let pidio = false
    const { ports } = puertos([], [])
    ports.token = async () => { pidio = true; return 'tok' }
    await dispatchPendingEmails(ports, { limit: 10, baseUrl: BASE })
    expect(pidio).toBe(false)
  })
})
