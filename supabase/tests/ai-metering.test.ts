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

/** Contrata una capacidad cualquiera: es lo que hace del uso de IA un addon. */
async function contratar(tenant: typeof TENANT_A, capability: string) {
  await svc(
    `insert into public.tenant_entitlements
       (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, $3, true, 'hub')
     on conflict (organization_id, company_id, entitlement_code)
       do update set is_active = true`,
    [tenant.organizationId, tenant.companyId, `ecommerce.${capability}`],
  )
}

/** Consume una unidad de la funcionalidad que se le diga. */
async function consumirDe(tenant: typeof TENANT_A, feature: string) {
  return comoAdmin(tenant, async () => {
    const rows = await svc<{ r: Record<string, unknown> }>(
      `select ebim.ai_consume($1, 1) as r`,
      [feature],
    )
    return rows[0]?.r as Record<string, unknown>
  })
}

async function consumir(tenant: typeof TENANT_A, unidades = 1) {
  // Fase 12: por JWT solo se consume de una en una (`BAD_UNITS` si no). Las
  // peticiones de varias unidades son del núcleo de servidor, que es donde se
  // prueba el «no descontar a medias».
  if (unidades !== 1) {
    const rows = await svc<{ r: Record<string, unknown> }>(
      `select ebim.ai_consume_for($1, $2, 'assistant', $3) as r`,
      [tenant.organizationId, tenant.companyId, unidades],
    )
    return rows[0]?.r as Record<string, unknown>
  }
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
  // Fase 01: una traza por JWT canjea el ticket de un consumo. Un ticket que
  // sobreviva a su prueba dejaría registrar a la siguiente sin consumir.
  await svc(`delete from public.ai_tickets`)
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

  it('fase 12 (D9): la vitrina tiene techo por tienda y hora, y al saltar no gasta', async () => {
    await contratarIA(TENANT_A)
    await svc(
      `insert into public.ai_quotas (organization_id, company_id, plan, trial_quota)
       values ($1, $2, 'trial', 100)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    // Techo bajo configurado por la tienda (sin migración), como el resto de
    // límites públicos.
    await svc(
      `insert into public.store_settings (store_id, organization_id, company_id, config)
       select s.id, s.organization_id, s.company_id, '{"rate_limits":{"ai.assistant":2}}'::jsonb
         from public.stores s where s.slug = $1
       on conflict (store_id) do update set config = excluded.config`,
      [TENANT_A.storeSlug],
    )
    const pedir = async () =>
      (
        await svc<{ r: Record<string, unknown> }>(
          `select public.ai_consume_for_store($1, 'assistant', 1) as r`,
          [TENANT_A.storeSlug],
        )
      )[0]?.r as Record<string, unknown>

    // La ventana es acumulativa: las pruebas anteriores de la vitrina ya
    // anotaron intentos en esta tienda.
    await svc(`delete from public.public_rate_events`)
    try {
      expect((await pedir()).allowed).toBe(true)
      expect((await pedir()).allowed).toBe(true)
      const frenada = await pedir()
      expect(frenada.allowed).toBe(false)
      expect(frenada.reason).toBe('RATE_LIMITED')
      expect((await estado(TENANT_A)).used).toBe(2)
    } finally {
      await svc(`delete from public.public_rate_events`)
      await svc(`update public.store_settings set config = config - 'rate_limits'`)
    }
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
    await consumir(TENANT_A)
    await comoAdmin(TENANT_A, () =>
      svc(
        `select ebim.ai_record('assistant', 'ai', 'm', 'escríbeme a juan.perez@correo.com', 'ok')`,
      ),
    )

    const filas = await svc<{ prompt_excerpt: string }>(
      `select prompt_excerpt from public.ai_interactions`,
    )

    expect(filas).toHaveLength(1)
    expect(filas[0]?.prompt_excerpt).not.toContain('juan.perez@correo.com')
  })

  it('la lee quien administra el espacio, y solo de su sociedad', async () => {
    await contratarIA(TENANT_A)
    await consumir(TENANT_A)
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
    await consumir(TENANT_A)
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
    await consumir(TENANT_A)
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
  it('las funciones del modulo existen en `public`', async () => {
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
      // Fase 07: candidatos de surtido (reposición, venta cruzada,
      // complemento) calculados en SQL. INVOKER, roles de `quotes`, cartera.
      'ai_assortment_facts',
      // Fase 08: cobranza (cartera o cliente). INVOKER, roles de `credit` +
      // `credit.management`; solo lectura.
      'ai_collections_facts',
      'ai_consume',
      'ai_consume_for_store',
      // Fase 11: herramientas del Copilot. `ai_copilot_tools` describe qué
      // herramientas tiene quien llama (rol + módulo); productos, ficha y
      // ventas son datasets INVOKER + STABLE con su propio guard.
      'ai_copilot_product',
      'ai_copilot_products',
      'ai_copilot_sales_facts',
      'ai_copilot_tools',
      // Fase 06: el resumen 360 del cliente y el dataset de la visita.
      // INVOKER, roles de su funcionalidad + cartera del vendedor + crédito
      // solo con permiso; solo lectura.
      'ai_customer_facts',
      // Fase 02: el dataset reducido del analista del dashboard. SECURITY
      // INVOKER (RLS de quien llama) y solo owner/admin; no toca cuota.
      'ai_dashboard_facts',
      'ai_entitlement',
      'ai_feedback',
      // Fase 08: entregas (tienda o una entrega) sin dirección, contacto ni guía.
      'ai_fulfillment_facts',
      // Fase 10: integraciones (proveedores, errores agrupables, disyuntores,
      // webhooks, API) o un mensaje; sin payloads, URL ni secretos. INVOKER.
      'ai_integrations_facts',
      // Fase 05: los datasets de inventario y planificación (señales de
      // existencia, previsión frente a venta y el sugerido v2 sin recalcular).
      // INVOKER, roles de su funcionalidad + módulo; solo lectura.
      'ai_inventory_facts',
      // Fase 10: salud + incidentes agrupados o un incidente con su hilo.
      // INVOKER, roles de `operations`; sin notas de resolución ni hilos.
      'ai_ops_facts',
      // Fase 04: los datasets de la IA de pedidos (detalle, lote de atención
      // y búsqueda con filtros tipados). INVOKER, roles de `orders`, solo
      // lectura; no tocan cuota.
      'ai_order_facts',
      'ai_orders_attention',
      'ai_orders_search',
      // Fase 08: pagos (tienda o un cobro); códigos de error, nunca el detalle.
      'ai_payments_facts',
      'ai_planning_facts',
      // Fase 09: reglas de UNA promoción (tal cual) y candidatos por regla.
      // INVOKER, roles de `promotions` + módulo; sin precios, stock ni cupones.
      'ai_promotion_facts',
      // Fase 07: texto interpretado → candidatos reales de cliente y producto.
      'ai_quote_resolve',
      'ai_record',
      'ai_record_for_store',
      // Fase 09: reseñas agregadas + muestra con marcas por regla, sin autor.
      // INVOKER, roles de `reviews` + módulo `catalog`; solo lectura.
      'ai_reviews_facts',
      'ai_suggestion_facts',
      // El desglose por modulo: con UN presupuesto compartido, es lo que
      // responde en que se esta yendo.
      'ai_usage_by_feature',
      'ai_visit_facts',
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

/**
 * Cada uso de IA es un ADDON, y se activa por separado.
 *
 * Antes `ai_consume_for` comprobaba `ai.assist` con el nombre escrito a mano
 * dentro, así que `p_feature` solo etiquetaba la traza: contratar el asistente
 * de la vitrina abría también cualquier otro uso que se añadiera después. Un
 * addon que se activa solo no es un addon, y eso es lo que se fija aquí.
 */
describe('cada uso de IA se contrata por separado', () => {
  it('contratar el asistente NO abre la redaccion de fichas', async () => {
    await contratar(TENANT_A, 'ai.assist')

    expect((await consumirDe(TENANT_A, 'assistant')).allowed).toBe(true)

    const ficha = await consumirDe(TENANT_A, 'catalog.copy')
    expect(ficha.allowed).toBe(false)
    expect(ficha.reason).toBe('DISABLED')
  })

  it('contratada la suya, la redaccion de fichas consume igual', async () => {
    await contratar(TENANT_A, 'ai.assist')
    await contratar(TENANT_A, 'ai.catalog.copy')

    const ficha = await consumirDe(TENANT_A, 'catalog.copy')
    expect(ficha.allowed).toBe(true)
  })

  /**
   * Y comparten presupuesto.
   *
   * El entitlement es la puerta; la cuota es el presupuesto. Partirlo en un
   * contador por addon inventa una contabilidad que el proveedor no tiene: el
   * coste real son tokens y son una sola factura.
   */
  it('los dos addons gastan del MISMO contador', async () => {
    await contratar(TENANT_A, 'ai.assist')
    await contratar(TENANT_A, 'ai.catalog.copy')
    await svc(
      `insert into public.ai_quotas (organization_id, company_id, plan, trial_quota)
       values ($1, $2, 'trial', 2)
       on conflict (organization_id, company_id) do update set trial_quota = 2`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    expect((await consumirDe(TENANT_A, 'assistant')).allowed).toBe(true)
    expect((await consumirDe(TENANT_A, 'catalog.copy')).allowed).toBe(true)

    // La tercera no cabe, venga del módulo que venga.
    const tercera = await consumirDe(TENANT_A, 'assistant')
    expect(tercera.allowed).toBe(false)
    expect(tercera.reason).toBe('TRIAL_EXPIRED')
  })

  /**
   * Lo que no está declarado se deniega, en vez de caer al asistente.
   *
   * Si alguien añade un uso nuevo y olvida declararlo, tiene que romperse
   * ruidosamente y no gastar en silencio la cuota contratada para otra cosa.
   */
  it('una funcionalidad sin capacidad declarada no gasta la de nadie', async () => {
    await contratar(TENANT_A, 'ai.assist')

    const inventada = await consumirDe(TENANT_A, 'lo.que.sea')
    expect(inventada.allowed).toBe(false)
    expect(inventada.reason).toBe('FEATURE_NO_DECLARADA')
  })

  it('el saldo dice QUE esta activado, no solo cuanto queda', async () => {
    await contratar(TENANT_A, 'ai.catalog.copy')

    const saldo = await estado(TENANT_A)
    expect(saldo.enabled).toBe(true)
    // Fase 01: el mapa lista TODAS las funcionalidades declaradas; solo la
    // contratada (con su módulo, `catalog`, baseline) está abierta.
    const features = saldo.features as Record<string, boolean>
    expect(features).toMatchObject({
      assistant: false,
      'catalog.copy': true,
      insights: false,
    })
    expect(Object.entries(features).filter(([, on]) => on).map(([f]) => f)).toEqual([
      'catalog.copy',
    ])
  })

  it('sin ninguna contratada no se anuncia un saldo que no se puede gastar', async () => {
    const saldo = await estado(TENANT_B)
    expect(saldo.enabled).toBe(false)
    const features = saldo.features as Record<string, boolean>
    expect(features).toMatchObject({
      assistant: false,
      'catalog.copy': false,
      insights: false,
    })
    expect(Object.values(features).every((on) => on === false)).toBe(true)
  })
})
