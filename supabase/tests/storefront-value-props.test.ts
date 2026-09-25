// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * `store_settings.value_props` en la BASE: las propuestas de valor de la tienda.
 *
 * ## Qué defiende este archivo
 *
 * La franja bajo la portada anunciaba «Atención farmacéutica» y «Retiro en
 * tienda» en TODAS las tiendas, escritas en el código. Eran afirmaciones sobre
 * la plantilla y el local del comercio que la plataforma no puede sostener. La
 * migración `20260923140000` devuelve esas afirmaciones a quien puede hacerlas,
 * y esto comprueba las dos mitades del trato:
 *
 *  · el COMERCIO puede escribir su promesa, con su texto, en su tienda;
 *  · y no puede escribir nada más: ni HTML, ni una URL, ni un icono inventado,
 *    ni cinco entradas, ni un título de mil caracteres, ni la fila de otro
 *    tenant.
 *
 * ## Por qué el texto libre aquí no es un agujero
 *
 * Porque lo único libre es el TEXTO, y el texto se pinta como texto (React
 * escapa). Lo que decide la presentación —el icono— es lista cerrada, la
 * longitud tiene tope y los caracteres de control no entran. No hay ni un
 * `like '%<script%'` en la migración ni en estas pruebas: un filtro solo
 * detiene lo que alguien previó, y aquí no hace falta porque no hay sitio donde
 * ese marcado pudiera ejecutarse.
 */

let db: PGlite

const LECTOR = '0a000000-0000-4000-8000-0000000000e1'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function comoAdmin<T>(tenant: typeof TENANT_A, run: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claimsFor(tenant), run)
}

async function comoAnon<T>(run: () => Promise<T>): Promise<T> {
  return asRole(db, 'anon', null, run)
}

let tiendaA = ''
let tiendaB = ''

/** Escribe la lista como admin y devuelve las filas afectadas. */
async function guardar(valor: unknown, tienda = tiendaA, tenant = TENANT_A) {
  return comoAdmin(tenant, () =>
    svc<{ store_id: string }>(
      `update public.store_settings set value_props = $1 where store_id = $2 returning store_id`,
      [typeof valor === 'string' || valor === null ? valor : JSON.stringify(valor), tienda],
    ),
  )
}

/** El mismo update, pero esperando que la base lo RECHACE. */
async function rechazado(valor: unknown) {
  return expectFailure(() => guardar(valor))
}

async function leer(tienda = tiendaA) {
  const [fila] = await svc<{ value_props: unknown }>(
    `select value_props from public.store_settings where store_id = $1`,
    [tienda],
  )
  return fila?.value_props
}

const UNA = { iconKey: 'delivery', title: 'Envíos a todo el país', body: 'En 48 horas', enabled: true }

beforeAll(async () => {
  db = await createTestDatabase()

  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      `Cuenta ${tenant.slug}`,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
      `Tienda ${tenant.slug}`,
    ])
  }
  await svc(`update public.stores set status = 'active'`)

  const tiendas = await svc<{ id: string; slug: string }>(`select id, slug from public.stores`)
  tiendaA = String(tiendas.find((t) => t.slug === TENANT_A.storeSlug)?.id)
  tiendaB = String(tiendas.find((t) => t.slug === TENANT_B.storeSlug)?.id)

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector-vp@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, LECTOR],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`update public.store_settings set value_props = default`)
})

// ---------------------------------------------------------------------------
// A · Defaults
// ---------------------------------------------------------------------------

describe('A · una tienda que nunca tocó la franja', () => {
  it('nace con la lista VACÍA, que significa «usa las de plataforma»', async () => {
    // Vacío no es «franja en blanco»: es «no he dicho nada». Quien decide qué
    // se pinta entonces es `resolveValueProps`, y lo que pinta es solo lo que
    // hace el código (entrega y pago). Copiar ese texto a la fila habría
    // dejado a esta tienda con la redacción de hoy escrita a su nombre.
    expect(await leer()).toEqual([])
  })

  it('una tienda NUEVA obtiene el mismo default sin declararlo', async () => {
    const [nueva] = await svc<{ id: string }>(
      `insert into public.stores (organization_id, company_id, slug, name, status, currency)
       values ($1, $2, 'tienda-vp-nueva', 'Tienda nueva', 'active', 'PEN') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(
      `insert into public.store_settings (store_id, organization_id, company_id)
       values ($1, $2, $3)`,
      [nueva?.id, TENANT_A.organizationId, TENANT_A.companyId],
    )

    expect(await leer(String(nueva?.id))).toEqual([])

    await svc(`delete from public.stores where id = $1`, [nueva?.id])
  })
})

// ---------------------------------------------------------------------------
// B · Lo que sí se puede escribir
// ---------------------------------------------------------------------------

describe('B · una lista dentro del contrato', () => {
  it('acepta una entrada completa y la devuelve tal cual', async () => {
    expect(await guardar([UNA])).toHaveLength(1)
    expect(await leer()).toEqual([UNA])
  })

  it('acepta una entrada sin apoyo: hay promesas que se explican solas', async () => {
    expect(await guardar([{ iconKey: 'payment', title: 'Compra segura', enabled: true }])).toHaveLength(1)
  })

  it('acepta una entrada apagada: apagar es una decisión, no un dato que falte', async () => {
    expect(await guardar([{ ...UNA, enabled: false }])).toHaveLength(1)
  })

  it('acepta las cuatro', async () => {
    const cuatro = ['delivery', 'pickup', 'payment', 'support'].map((iconKey) => ({
      iconKey,
      title: `Promesa ${iconKey}`,
      enabled: true,
    }))
    expect(await guardar(cuatro)).toHaveLength(1)
  })

  it('acepta los doce iconos, uno a uno', async () => {
    const iconos = [
      'delivery', 'pickup', 'payment', 'support', 'returns', 'warranty',
      'installments', 'quality', 'assortment', 'expertise', 'schedule', 'certification',
    ]
    for (const iconKey of iconos) {
      expect(await guardar([{ iconKey, title: 'Promesa', enabled: true }]), iconKey).toHaveLength(1)
    }
  })

  it('el ORDEN de la lista es el orden, y se conserva', async () => {
    // No hay campo `position`: un array ya está ordenado, y un segundo orden
    // dentro de un orden es una fuente de verdad de más.
    await guardar([
      { iconKey: 'warranty', title: 'Garantía', enabled: true },
      { iconKey: 'delivery', title: 'Envíos', enabled: true },
    ])
    const guardadas = (await leer()) as Array<{ iconKey: string }>
    expect(guardadas.map((prop) => prop.iconKey)).toEqual(['warranty', 'delivery'])
  })

  it('acepta el texto en el límite exacto', async () => {
    expect(
      await guardar([{ iconKey: 'delivery', title: 'a'.repeat(40), body: 'b'.repeat(90), enabled: true }]),
    ).toHaveLength(1)
  })

  it('acepta el texto que un comercio real escribiría, acentos incluidos', async () => {
    expect(
      await guardar([
        { iconKey: 'expertise', title: 'Asesoría técnica «in situ»', body: 'Pregúntanos antes de comprar — sin costo', enabled: true },
      ]),
    ).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// C · Lo que no entra
// ---------------------------------------------------------------------------

describe('C · una lista fuera del contrato', () => {
  const FUERA: Array<[string, unknown]> = [
    // Las formas de intentar meter presentación o comportamiento arbitrarios.
    // Ninguna llega a un filtro: la clave no está nombrada, así que no entra.
    ['HTML crudo en una clave nueva', [{ ...UNA, html: '<script>alert(1)</script>' }]],
    ['un manejador', [{ ...UNA, onClick: 'fetch("//evil")' }]],
    ['una URL de imagen', [{ ...UNA, imageUrl: 'https://evil.example/x.png' }]],
    ['un enlace', [{ ...UNA, href: 'javascript:alert(1)' }]],
    ['CSS', [{ ...UNA, css: '.sf-scope{display:none}' }]],
    // El icono es lista cerrada: es presentación, no contenido.
    ['un icono inventado', [{ iconKey: 'pharmacist', title: 'Algo', enabled: true }]],
    ['un icono con mayúsculas', [{ iconKey: 'Delivery', title: 'Algo', enabled: true }]],
    ['un icono con espacios', [{ iconKey: ' delivery', title: 'Algo', enabled: true }]],
    ['sin icono', [{ title: 'Algo', enabled: true }]],
    ['un icono que no es texto', [{ iconKey: 7, title: 'Algo', enabled: true }]],
    // El título es obligatorio y tiene que decir algo.
    ['sin título', [{ iconKey: 'delivery', enabled: true }]],
    ['un título vacío', [{ iconKey: 'delivery', title: '', enabled: true }]],
    ['un título de solo espacios', [{ iconKey: 'delivery', title: '   ', enabled: true }]],
    ['un título desbordado', [{ iconKey: 'delivery', title: 'a'.repeat(41), enabled: true }]],
    ['un título que no es texto', [{ iconKey: 'delivery', title: 42, enabled: true }]],
    // El apoyo es opcional, pero si viene tiene que decir algo.
    ['un apoyo vacío', [{ ...UNA, body: '' }]],
    ['un apoyo desbordado', [{ ...UNA, body: 'b'.repeat(91) }]],
    ['un apoyo que no es texto', [{ ...UNA, body: ['a'] }]],
    // `enabled` es obligatorio: «visible o no» no se adivina en la base.
    ['sin enabled', [{ iconKey: 'delivery', title: 'Algo' }]],
    ['enabled que no es booleano', [{ iconKey: 'delivery', title: 'Algo', enabled: 'si' }]],
    // La forma de la lista.
    ['cinco entradas', [
      { iconKey: 'delivery', title: '1', enabled: true },
      { iconKey: 'pickup', title: '2', enabled: true },
      { iconKey: 'payment', title: '3', enabled: true },
      { iconKey: 'support', title: '4', enabled: true },
      { iconKey: 'returns', title: '5', enabled: true },
    ]],
    ['el mismo icono dos veces', [
      { iconKey: 'delivery', title: 'Una', enabled: true },
      { iconKey: 'delivery', title: 'Otra', enabled: true },
    ]],
    ['una entrada que no es objeto', ['delivery']],
    ['una entrada nula', [null]],
  ]

  it.each(FUERA)('rechaza %s', async (_caso, valor) => {
    await rechazado(valor)
  })

  /**
   * Los caracteres de control, aparte y con nombre.
   *
   * Un salto de línea en el título parte la franja en dos filas y descuadra la
   * rejilla; un tabulador hace lo mismo con menos aspaviento. No es una
   * cuestión de seguridad: es que el tope de 40 caracteres deja de significar
   * nada si cuatro de ellos pueden ser saltos de línea.
   */
  it.each([
    ['un salto de línea en el título', { iconKey: 'delivery', title: 'Envíos\nrápidos', enabled: true }],
    ['un retorno de carro en el título', { iconKey: 'delivery', title: 'Envíos\rrápidos', enabled: true }],
    ['un tabulador en el título', { iconKey: 'delivery', title: 'Envíos\trápidos', enabled: true }],
    ['un salto de línea en el apoyo', { ...UNA, body: 'Hoy\ny mañana' }],
  ])('rechaza %s', async (_caso, entrada) => {
    await rechazado([entrada])
  })

  it.each([
    ['un objeto', '{}'],
    ['un objeto con forma de lista', '{"0": {"iconKey": "delivery"}}'],
    ['un texto', '"delivery"'],
    ['un número', '7'],
    // Como JSON crudo y no como objeto de JavaScript: `{ __proto__: ... }` en
    // un literal cambia el prototipo y `JSON.stringify` lo deja en `{}`, con lo
    // que la prueba pasaría sin haber probado nada.
    ['contaminación de prototipo', '[{"__proto__": {"admin": true}}]'],
  ])('rechaza %s en la raíz', async (_caso, valor) => {
    await rechazado(valor)
  })

  it('rechaza el nulo: la columna es NOT NULL y la lista vacía ya dice «nada»', async () => {
    await rechazado(null)
  })
})

// ---------------------------------------------------------------------------
// D · Quién puede escribir
// ---------------------------------------------------------------------------

describe('D · aislamiento entre sociedades', () => {
  it('el admin de otra sociedad no escribe la franja de esta tienda', async () => {
    const filas = await guardar([UNA], tiendaA, TENANT_B)

    expect(filas).toHaveLength(0)
    expect(await leer()).toEqual([])
  })

  it('cada tienda conserva su propia franja', async () => {
    await guardar([{ iconKey: 'expertise', title: 'Atención farmacéutica', enabled: true }], tiendaA, TENANT_A)
    await guardar([{ iconKey: 'returns', title: 'Cambio de talla', enabled: true }], tiendaB, TENANT_B)

    const propiasA = (await leer(tiendaA)) as Array<{ title: string }>
    const propiasB = (await leer(tiendaB)) as Array<{ title: string }>

    // La prueba del principio multi-industria, dicha con datos: el claim
    // especializado vive en la fila de quien lo escribió y no toca a la otra
    // tienda, que corre EXACTAMENTE el mismo código.
    expect(propiasA.map((p) => p.title)).toEqual(['Atención farmacéutica'])
    expect(propiasB.map((p) => p.title)).toEqual(['Cambio de talla'])
  })
})

describe('E · un miembro sin rol administrativo', () => {
  const claimsLector = () =>
    claimsFor(TENANT_A, {
      sub: LECTOR,
      email: 'lector-vp@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
    })

  it('no escribe la franja', async () => {
    const filas = await asRole(db, 'authenticated', claimsLector(), () =>
      svc(
        `update public.store_settings set value_props = $1
          where store_id = $2 returning store_id`,
        [JSON.stringify([UNA]), tiendaA],
      ),
    )

    expect(filas).toHaveLength(0)
  })

  it('pero sigue pudiendo LEERLA', async () => {
    const filas = await asRole(db, 'authenticated', claimsLector(), () =>
      svc(`select value_props from public.store_settings where store_id = $1`, [tiendaA]),
    )

    expect(filas).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// F · Lo que ve el comprador anónimo
// ---------------------------------------------------------------------------

describe('F · public_stores', () => {
  it('publica la franja, que es contenido de portada', async () => {
    await guardar([UNA])

    const [fila] = await comoAnon(() =>
      svc<Record<string, unknown>>(`select * from public.public_stores where slug = $1`, [
        TENANT_A.storeSlug,
      ]),
    )

    expect(fila?.value_props).toEqual([UNA])
  })

  it('no publica de paso nada interno', async () => {
    const [fila] = await comoAnon(() =>
      svc<Record<string, unknown>>(`select * from public.public_stores where slug = $1`, [
        TENANT_A.storeSlug,
      ]),
    )

    for (const columna of [
      'organization_id',
      'company_id',
      'tax_rate',
      'config',
      'status',
      'order_seq',
      'custom_domain_token',
      'custom_domain_status',
      'email_from_name',
      'email_reply_to',
    ]) {
      expect(Object.keys(fila ?? {})).not.toContain(columna)
    }
  })

  it('sigue siendo security_invoker y sigue filtrando tiendas activas', async () => {
    const [opciones] = await svc<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'public_stores'`,
    )
    expect(opciones?.reloptions ?? []).toContain('security_invoker=on')

    await svc(`update public.stores set status = 'suspended' where id = $1`, [tiendaA])
    const filas = await comoAnon(() =>
      svc(`select slug from public.public_stores where slug = $1`, [TENANT_A.storeSlug]),
    )
    await svc(`update public.stores set status = 'active' where id = $1`, [tiendaA])

    expect(filas).toHaveLength(0)
  })

  it('una tienda sin fila de ajustes devuelve la lista vacía, nunca nulo', async () => {
    // El JOIN es LEFT. Sin el `coalesce` de la vista, la vitrina recibiría
    // `null` en un campo con el que decide qué pintar.
    const [nueva] = await svc<{ id: string }>(
      `insert into public.stores (organization_id, company_id, slug, name, status, currency)
       values ($1, $2, 'tienda-vp-sin-ajustes', 'Sin ajustes', 'active', 'PEN') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    const [fila] = await comoAnon(() =>
      svc<{ value_props: unknown }>(
        `select value_props from public.public_stores where slug = 'tienda-vp-sin-ajustes'`,
      ),
    )
    expect(fila?.value_props).toEqual([])

    await svc(`delete from public.stores where id = $1`, [nueva?.id])
  })

  it('anon puede leerla pero NO escribirla', async () => {
    const error = await expectFailure(() =>
      comoAnon(() =>
        svc(`update public.store_settings set value_props = '[]'::jsonb where store_id = $1`, [
          tiendaA,
        ]),
      ),
    )

    expect(error).toMatch(/permission denied|denegado/i)
  })
})

// ---------------------------------------------------------------------------
// G · La franja no es premium
// ---------------------------------------------------------------------------

describe('G · escribir la franja no depende de content.white_label', () => {
  it('la tienda de prueba NO tiene el addon contratado', async () => {
    const [fila] = await svc<{ tiene: boolean }>(
      `select ebim.company_is_entitled($1, $2, 'content.white_label') as tiene`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(fila?.tiene).toBe(false)
  })

  it('y aun así puede escribir sus propuestas', async () => {
    // Es CONTENIDO de la tienda, del mismo orden que el teléfono de contacto.
    // Cobrar por poder decir «Garantía de 12 meses» sería vender una casilla.
    expect(await guardar([UNA])).toHaveLength(1)
  })

  it('retirar entitlements no borra lo escrito', async () => {
    await guardar([UNA])

    await svc(`delete from public.tenant_entitlements where organization_id = $1`, [
      TENANT_A.organizationId,
    ])

    expect(await leer()).toEqual([UNA])
  })
})
