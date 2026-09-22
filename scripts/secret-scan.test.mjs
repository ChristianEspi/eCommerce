// @vitest-environment node
/**
 * El escáner de secretos, comprobado por los dos lados (P16-SaaS).
 *
 * Un gate de seguridad que solo se prueba «en verde» no está probado: lo único
 * que demuestra es que hoy no encuentra nada, que es exactamente lo que haría
 * un escáner roto. Aquí se comprueba lo otro — que **encuentra** — plantando
 * cada clase de credencial y viendo saltar el patrón que le toca.
 */
import { describe, expect, it } from 'vitest'
import { PATTERNS, runSecretScan, serviceRoleJwtFindings } from './secret-scan.mjs'

/** Un JWT con la forma de una clave legacy de Supabase, con el rol dentro. */
function fakeJwt(role) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ iss: 'supabase', ref: 'proyecto', role, iat: 1, exp: 2 }),
    'ZmlybWEtZmFsc2EtcGFyYS1lbC10ZXN0',
  ].join('.')
}

function hits(text, id) {
  const pattern = PATTERNS.find((p) => p.id === id)
  expect(pattern, `patrón ${id} no existe`).toBeTruthy()
  pattern.re.lastIndex = 0
  return (text.match(pattern.re) ?? []).length
}

describe('los patrones encuentran lo que dicen encontrar', () => {
  it('una clave de servicio de Supabase con cuerpo', () => {
    expect(hits('const k = "sb_secret_A1b2C3d4E5f6G7h8"', 'supabase-secret-key')).toBe(1)
  })

  /**
   * El prefijo SOLO no es un hallazgo, y esa es la diferencia que hace usable
   * el gate: `supabase-js` lo lleva dentro para poder validar formatos, y el
   * guard `assertNoServiceKey` lo lleva en su expresión regular. Si el patrón
   * saltara con el prefijo pelado, el escáner daría tres falsos positivos desde
   * el primer día y alguien lo desactivaría en la primera semana.
   */
  it('el prefijo pelado NO es un hallazgo', () => {
    expect(hits('/^sb_secret_|service_role/', 'supabase-secret-key')).toBe(0)
    expect(hits('const PREFIX = "sb_secret_"', 'supabase-secret-key')).toBe(0)
  })

  it('el literal corto de los tests de redacción NO es una clave del proveedor', () => {
    expect(hits('provider key sk-ant-api03-AbCdEfGhIjKlMnOp was rejected', 'anthropic-api-key')).toBe(0)
  })

  it('la clave del proveedor de IA asignada con valor es un hallazgo', () => {
    expect(hits('EBIM_AI_API_KEY=abcdefghijklmnopqrstuvwxyz', 'service-role-assignment')).toBe(1)
  })

  it('una asignación de clave de servidor con valor', () => {
    const text = 'SUPABASE_SERVICE_ROLE_KEY=abcdefghijklmnopqrstuvwxyz'
    expect(hits(text, 'service-role-assignment')).toBe(1)
  })

  it('el comentario del `.env.example` NO es un hallazgo: no tiene valor', () => {
    expect(hits('# SUPABASE_SERVICE_ROLE_KEY=...   # solo bootstrap-tenant', 'service-role-assignment'))
      .toBe(0)
  })

  it.each([
    ['private-key-block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['aws-access-key', 'AKIAIOSFODNN7EXAMPLE'],
    ['stripe-live-key', 'sk_live_abcdefghijklmnop123'],
    ['slack-token', 'xoxb-1234567890-abcdefghij'],
    ['anthropic-api-key', `sk-ant-api03-${'A1b2C3d4E5'.repeat(6)}`],
  ])('%s', (id, text) => {
    expect(hits(text, id)).toBe(1)
  })
})

describe('el detector de JWT decodifica en vez de adivinar', () => {
  it('un JWT con `role: service_role` es un hallazgo', () => {
    const findings = serviceRoleJwtFindings(`const K = "${fakeJwt('service_role')}"`, 'x.js', 'bundle')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.id).toBe('service-role-jwt')
  })

  /**
   * Y este es el motivo de decodificar: una clave legacy ANON en el bundle es
   * CORRECTA. Un detector por forma la marcaría y el gate sería inútil en
   * cualquier proyecto que todavía use claves legacy.
   */
  it('un JWT con `role: anon` NO lo es: esa clave es publicable', () => {
    expect(serviceRoleJwtFindings(`const K = "${fakeJwt('anon')}"`, 'x.js', 'bundle')).toEqual([])
  })

  it('algo que parece un JWT y no lo es se ignora en silencio', () => {
    expect(serviceRoleJwtFindings('eyJabc.defg.hijk no es nada', 'x.js', 'bundle')).toEqual([])
  })
})

describe('el hallazgo no publica el secreto otra vez', () => {
  it('lo que se reporta es el patrón y el sitio, nunca el valor', () => {
    const secreto = fakeJwt('service_role')
    const [finding] = serviceRoleJwtFindings(`const K = "${secreto}"`, 'x.js', 'bundle')
    expect(JSON.stringify(finding)).not.toContain(secreto)
    expect(finding).toMatchObject({ file: 'x.js', scope: 'bundle', hits: 1 })
  })
})

describe('el repositorio, ahora mismo', () => {
  /**
   * Este es el gate. Si `dist/` existe se revisa también el bundle; si no,
   * el escáner lo dice y sigue — para poder ejecutarlo antes del build.
   */
  it('no hay ni un secreto versionado ni `service_role` en el bundle', () => {
    const { findings, code } = runSecretScan({ quiet: true })
    expect(findings).toEqual([])
    expect(code).toBe(0)
    // Lee el repositorio entero (git + ~1400 archivos + `dist/`): con la suite
    // en paralelo compite por disco y CPU con los bancos de BD.
  }, 60_000)
})
