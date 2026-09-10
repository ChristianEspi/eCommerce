// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * La IA como capacidad medida, contra Postgres real.
 *
 * El diseño viene de GMAO, que lo tiene en producción, pero con la clave de
 * ESTA app: `organization_id` + `company_id`, no un `tenant_id` único. Copiar
 * la firma de GMAO tal cual habría roto el aislamiento el día que una cuenta
 * tenga dos sociedades, y es justo lo que estas pruebas vigilan.
 *
 * La regla que define la frontera: **el contador es plano de cobro**. Nadie que
 * hable PostgREST con su token puede leerlo ni tocarlo; se llega a él por
 * funciones `security definer` que solo hablan de tu propia sociedad.
 */

let db: PGlite

const ENTITLEMENT = 'ecommerce.ai.assist'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const result = await db.query<T>(query, params)
  return result.rows
}

async function comoAdmin<T>(tenant: typeof TENANT_A, fn: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claimsFor(tenant), fn)
}

/** Contrata la IA para la sociedad. Es un entitlement del hub, no un flag. */
async function contratarIA(tenant: typeof TENANT_A) {
  await svc(
    `insert into public.tenant_entitlements
       (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, $3, true, 'hub')
     on conflict (organization_id, company_id, entitlement_code)
       do update set is_active = true`,
    [tenant.organizationId, tenant.companyId, ENTITLEMENT],
  )
}

async function consumir(tenant: typeof TENANT_A, unidades = 1) {
  return comoAdmin(tenant, async () => {
    const rows = await svc<{ r: Record<string, unknown> }>(
      `select ebim.ai_consume('assistant', $1) as r`,
      [unidades],
    )
    return rows[0]?.r as Record<string, unknown>
  })
}

async function estado(tenant: typeof TENANT_A) {
  return comoAdmin(tenant, async () => {
    const rows = await svc<{ r: Record<string, unknown> }>(`select ebim.ai_entitlement() as r`)
    return rows[0]?.r as Record<string, unknown>
  })
}

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
  }
  // `bootstrap_tenant` deja la tienda en borrador. La vitrina solo responde
  // sobre tiendas activas, y eso es parte de lo que se prueba aquí.
  await svc(`update public.stores set status = 'active'`)
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  // Cada prueba parte de cero: el contador es acumulativo por diseño y una
  // prueba que herede el gasto de la anterior mide otra cosa.
  await svc(`delete from public.ai_usage`)
  await svc(`delete from public.ai_interactions`)
  await svc(`delete from public.ai_quotas`)
  await svc(`delete from public.tenant_entitlements where entitlement_code = $1`, [ENTITLEMENT])
})

describe('la capacidad manda sobre la cuota', () => {
  it('sin contratar, no hay nada que medir', async () => {
    // Decir «te quedan 25» a quien no lo tiene contratado es peor que decir
    // que no lo tiene: sugiere que existe un botón que en realidad no está.
    const resultado = await consumir(TENANT_A)

    expect(resultado.allowed).toBe(false)
    expect(resultado.reason).toBe('DISABLED')
    expect(resultado.status).toBe('disabled')
  })

  it('sin contratar, el medidor tampoco inventa un saldo', async () => {
    const info = await estado(TENANT_A)

    expect(info.enabled).toBe(false)
    expect(info.status).toBe('disabled')
    expect(info.remaining).toBeUndefined()
  })

  it('contratada, descuenta y devuelve el saldo', async () => {
    await contratarIA(TENANT_A)

    const primera = await consumir(TENANT_A)

    expect(primera.allowed).toBe(true)
    expect(primera.plan).toBe('trial')
    expect(primera.used).toBe(1)
    expect(primera.quota).toBe(25)
    expect(primera.remaining).toBe(24)
  })
})

describe('la cuota', () => {
  it('contratado sin configurar NO significa sin límite', async () => {
    // No hay fila en `ai_quotas` y aun así hay tope. Un módulo de pago que se
    // activa sin cuota es una factura abierta.
    await contratarIA(TENANT_A)

    const info = await estado(TENANT_A)

    expect(info.enabled).toBe(true)
    expect(info.plan).toBe('trial')
    expect(info.quota).toBe(25)
  })

  it('el bucket de prueba se agota y no se renueva', async () => {
    await contratarIA(TENANT_A)
    await svc(
      `insert into public.ai_quotas (organization_id, company_id, plan, trial_quota)
       values ($1, $2, 'trial', 2)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    expect((await consumir(TENANT_A)).allowed).toBe(true)
    expect((await consumir(TENANT_A)).allowed).toBe(true)

    const tercera = await consumir(TENANT_A)
    expect(tercera.allowed).toBe(false)
    expect(tercera.reason).toBe('TRIAL_EXPIRED')
    expect(tercera.remaining).toBe(0)
  })

  it('el plan activo cuenta contra el mes natural', async () => {
    await contratarIA(TENANT_A)
    await svc(
      `insert into public.ai_quotas (organization_id, company_id, plan, monthly_quota)
       values ($1, $2, 'active', 3)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    await consumir(TENANT_A)
    const info = await estado(TENANT_A)

    // El periodo es la clave, y por eso el reinicio mensual no necesita
    // ningún proceso: la fila del mes que viene todavía no existe.
    expect(info.period).toMatch(/^\d{6}$/)
    expect(info.quota).toBe(3)
    expect(info.used).toBe(1)
  })

  it('una petición de más unidades de las que quedan no descuenta a medias', async () => {
    await contratarIA(TENANT_A)
    await svc(
      `insert into public.ai_quotas (organization_id, company_id, plan, trial_quota)
       values ($1, $2, 'trial', 5)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    await consumir(TENANT_A, 4)
    const excesiva = await consumir(TENANT_A, 3)

    expect(excesiva.allowed).toBe(false)
    // Lo importante no es el rechazo, es que el contador NO se movió: servir
    // media acción y cobrarla entera es peor que no servirla.
    expect((await estado(TENANT_A)).used).toBe(4)
  })

  it('mirar el medidor no gasta cuota', async () => {
    await contratarIA(TENANT_A)
    await consumir(TENANT_A)

    await estado(TENANT_A)
    await estado(TENANT_A)

    expect((await estado(TENANT_A)).used).toBe(1)
  })
})

describe('la vitrina pública', () => {
  it('un visitante anónimo también gasta cuota de la sociedad', async () => {
    // Es el caso que MÁS hay que medir: el único que cualquiera en internet
    // puede disparar en bucle. La sociedad sale del slug de la tienda, porque
    // no hay JWT del que sacarla.
    await contratarIA(TENANT_A)

    const resultado = await svc<{ r: Record<string, unknown> }>(
      `select public.ai_consume_for_store($1, 'assistant', 1) as r`,
      [TENANT_A.storeSlug],
    )

    expect(resultado[0]?.r.allowed).toBe(true)
    expect((await estado(TENANT_A)).used).toBe(1)
  })

  it('la tienda de una sociedad sin IA contratada no gasta nada', async () => {
    const resultado = await svc<{ r: Record<string, unknown> }>(
      `select public.ai_consume_for_store($1, 'assistant', 1) as r`,
      [TENANT_A.storeSlug],
    )

    expect(resultado[0]?.r.allowed).toBe(false)
    expect(resultado[0]?.r.reason).toBe('DISABLED')
  })

  it('un slug que no existe no llega ni a mirar la cuota', async () => {
    // Una tienda apagada o inventada no puede consumir el saldo de nadie.
    const fallo = await expectFailure(() =>
      svc(`select public.ai_consume_for_store('tienda-que-no-existe', 'assistant', 1)`),
    )

    expect(fallo).toMatch(/TIENDA_NO_DISPONIBLE/i)
  })

  it('la vitrina no cuela la cuota de OTRA sociedad', async () => {
    // El slug decide la sociedad. Pedir con el slug de A nunca puede descontar
    // de B, por mucho que quien llame sea `service_role`.
    await contratarIA(TENANT_A)
    await contratarIA(TENANT_B)

    await svc(`select public.ai_consume_for_store($1, 'assistant', 1)`, [TENANT_A.storeSlug])

    expect((await estado(TENANT_A)).used).toBe(1)
    expect((await estado(TENANT_B)).used).toBe(0)
  })
})

describe('la traza', () => {
  it('suma tokens al contador sin gastar una acción', async () => {
    // Las dos cosas ocurren en momentos distintos: la cuota se descuenta ANTES
    // de llamar al proveedor y los tokens solo se conocen DESPUÉS.
    await contratarIA(TENANT_A)
    await consumir(TENANT_A)

    await comoAdmin(TENANT_A, () =>
      svc(`select ebim.ai_record('assistant', 'ai', 'claude-haiku-4-5', 'hola', 'qué tal', 120, 40, 900)`),
    )

    const filas = await svc<{
      used: number
      input_tokens: string
      output_tokens: string
      cache_read_tokens: string
    }>(`select used, input_tokens, output_tokens, cache_read_tokens from public.ai_usage`)

    expect(filas[0]?.used).toBe(1)
    expect(Number(filas[0]?.input_tokens)).toBe(120)
    expect(Number(filas[0]?.output_tokens)).toBe(40)
    expect(Number(filas[0]?.cache_read_tokens)).toBe(900)
  })

  it('redacta lo que la persona escribió', async () => {
    // Un prompt de compra lleva dentro texto libre, y ahí puede ir un correo.
    await contratarIA(TENANT_A)
    await comoAdmin(TENANT_A, () =>
      svc(
        `select ebim.ai_record('assistant', 'ai', 'm', 'escríbeme a juan.perez@correo.com', 'ok')`,
      ),
    )

    const filas = await svc<{ prompt_excerpt: string }>(
      `select prompt_excerpt from public.ai_interactions`,
    )

    expect(filas[0]?.prompt_excerpt).not.toContain('juan.perez@correo.com')
  })

  it('la lee quien administra el espacio, y solo de su sociedad', async () => {
    await contratarIA(TENANT_A)
    await comoAdmin(TENANT_A, () => svc(`select ebim.ai_record('assistant', 'ai', 'm', 'a', 'b')`))

    const propias = await comoAdmin(TENANT_A, () =>
      svc(`select id from public.ai_interactions`),
    )
    const ajenas = await comoAdmin(TENANT_B, () => svc(`select id from public.ai_interactions`))

    expect(propias).toHaveLength(1)
    expect(ajenas).toHaveLength(0)
  })

  it('el pulgar solo admite arriba o abajo', async () => {
    await contratarIA(TENANT_A)
    const creada = await comoAdmin(TENANT_A, async () => {
      const rows = await svc<{ id: string }>(
        `select ebim.ai_record('assistant', 'ai', 'm', 'a', 'b') as id`,
      )
      return rows[0]?.id as string
    })

    const valido = await comoAdmin(TENANT_A, async () => {
      const rows = await svc<{ ok: boolean }>(`select ebim.ai_feedback($1, 1::smallint) as ok`, [
        creada,
      ])
      return rows[0]?.ok
    })
    const invalido = await comoAdmin(TENANT_A, async () => {
      const rows = await svc<{ ok: boolean }>(`select ebim.ai_feedback($1, 7::smallint) as ok`, [
        creada,
      ])
      return rows[0]?.ok
    })

    expect(valido).toBe(true)
    expect(invalido).toBe(false)
  })

  it('nadie opina sobre la traza de otra sociedad', async () => {
    await contratarIA(TENANT_A)
    const creada = await comoAdmin(TENANT_A, async () => {
      const rows = await svc<{ id: string }>(
        `select ebim.ai_record('assistant', 'ai', 'm', 'a', 'b') as id`,
      )
      return rows[0]?.id as string
    })

    const ajeno = await comoAdmin(TENANT_B, async () => {
      const rows = await svc<{ ok: boolean }>(`select ebim.ai_feedback($1, -1::smallint) as ok`, [
        creada,
      ])
      return rows[0]?.ok
    })

    expect(ajeno).toBe(false)
  })
})

describe('la puerta que PostgREST ve', () => {
  it('las cuatro funciones existen en `public`', async () => {
    // `ebim` no está expuesto: sin envoltorio, `rpc('ai_consume')` responde
    // «function not found» y el fallo se lee como un problema de permisos
    // cuando es de enrutado.
    const filas = await svc<{ proname: string }>(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'ai\\_%'
        order by 1`,
    )

    expect(filas.map((f) => f.proname)).toEqual([
      'ai_consume',
      'ai_consume_for_store',
      'ai_entitlement',
      'ai_feedback',
      'ai_record',
      'ai_record_for_store',
    ])
  })

  it('las variantes con sociedad explícita son solo de servidor', async () => {
    // Llevan la sociedad como argumento y NO comprueban pertenencia. Concedidas
    // a `authenticated`, cualquiera vaciaría la cuota de otro tenant
    // escribiendo su uuid.
    const filas = await svc<{ f: string; auth: boolean; anon: boolean }>(
      `select f as f,
              has_function_privilege('authenticated', f, 'EXECUTE') as auth,
              has_function_privilege('anon', f, 'EXECUTE') as anon
         from unnest(array[
           'ebim.ai_consume_for(uuid, uuid, text, integer)',
           'ebim.ai_entitlement_for(uuid, uuid)',
           'public.ai_consume_for_store(text, text, integer)'
         ]) as f`,
    )

    for (const fila of filas) {
      expect(fila.auth, fila.f).toBe(false)
      expect(fila.anon, fila.f).toBe(false)
    }
  })

  it('un visitante anónimo no puede gastar la cuota del tenant', async () => {
    // La vitrina llama al asistente por su Edge Function, que es quien tiene la
    // clave del proveedor. Dar EXECUTE a `anon` sería dejar que cualquiera que
    // abra la tienda consuma el saldo de la sociedad.
    const filas = await svc<{ puede: boolean }>(
      `select has_function_privilege('anon', 'public.ai_consume(text, integer)', 'EXECUTE') as puede`,
    )

    expect(filas[0]?.puede).toBe(false)
  })
})

describe('el plano de cobro no se toca desde fuera', () => {
  it('el contador no es legible con un token de usuario', async () => {
    await contratarIA(TENANT_A)
    await consumir(TENANT_A)

    const fallo = await comoAdmin(TENANT_A, () =>
      expectFailure(() => svc(`select * from public.ai_usage`)),
    )

    expect(fallo).toMatch(/permission denied/i)
  })

  it('la cuota no se la sube el propio tenant', async () => {
    // Quien puede subirse su propia cuota no tiene cuota.
    await contratarIA(TENANT_A)

    const fallo = await comoAdmin(TENANT_A, () =>
      expectFailure(() =>
        svc(
          `insert into public.ai_quotas (organization_id, company_id, plan, monthly_quota)
           values ($1, $2, 'active', 999999)`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        ),
      ),
    )

    expect(fallo).toMatch(/permission denied/i)
  })
})
