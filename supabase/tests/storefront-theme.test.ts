// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * El Theme Engine en la BASE: `theme_preset`, `storefront_style` y `home_layout`.
 *
 * ## Qué se prueba aquí y qué no
 *
 * P01 dejó la normalización en TypeScript, que es la defensa de LECTURA: lo
 * raro no rompe la vitrina, cae al valor seguro. Esto es la otra mitad, la de
 * ESCRITURA: lo raro no entra. Son capas distintas y las dos hacen falta —
 * quitar la de aquí dejaría la basura guardada esperando a que algún consumidor
 * futuro (una API, un ERP, un informe) la leyera sin normalizar.
 *
 * ## Por qué el rechazo es por ESQUEMA y no por heurística
 *
 * No hay un solo `like '%<script%'` en estas pruebas ni en la migración. La
 * lista de claves es cerrada y la de valores también, así que `css`, `html`,
 * `onClick` o `backgroundUrl` no se rechazan por sospechosas: se rechazan
 * porque no están nombradas. Un filtro solo detiene lo que alguien previó.
 */

let db: PGlite

const LECTOR = '0a000000-0000-4000-8000-0000000000f1'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

/** Sesión de owner/admin de la sociedad indicada. */
async function comoAdmin<T>(tenant: typeof TENANT_A, run: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claimsFor(tenant), run)
}

async function comoAnon<T>(run: () => Promise<T>): Promise<T> {
  return asRole(db, 'anon', null, run)
}

let tiendaA = ''
let tiendaB = ''

/** Escribe un campo del tema como admin y devuelve las filas afectadas. */
async function guardar(campo: string, valor: unknown, tienda = tiendaA, tenant = TENANT_A) {
  return comoAdmin(tenant, () =>
    svc<{ store_id: string }>(
      `update public.store_settings set ${campo} = $1 where store_id = $2 returning store_id`,
      [valor, tienda],
    ),
  )
}

/** El mismo update, pero esperando que la base lo RECHACE. */
async function rechazado(campo: string, valor: unknown) {
  return expectFailure(() => guardar(campo, valor))
}

const ESTILO_COMPLETO = {
  headerVariant: 'compact',
  heroVariant: 'statement',
  productCardVariant: 'compact',
  categoryVariant: 'pills',
  contentWidth: 'xl',
  imageRatio: 'portrait',
  sectionSpacing: 'spacious',
}

const LAYOUT_VALIDO = {
  version: 1,
  sections: [
    { id: 'hero', enabled: true },
    { id: 'offers', enabled: true, maxItems: 8 },
    { id: 'brands', enabled: false, maxItems: 24 },
    { id: 'trust', enabled: true },
  ],
}

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
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, LECTOR],
  )
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(
    `update public.store_settings
        set theme_preset = default, storefront_style = default, home_layout = default`,
  )
})

// ---------------------------------------------------------------------------
// A · Defaults
// ---------------------------------------------------------------------------

describe('A · una tienda que nunca configuró nada', () => {
  it('nace en universal, sin estilo propio y con el layout V1 vacío', async () => {
    const [fila] = await svc<{ theme_preset: string; storefront_style: unknown; home_layout: unknown }>(
      `select theme_preset, storefront_style, home_layout
         from public.store_settings where store_id = $1`,
      [tiendaA],
    )

    expect(fila?.theme_preset).toBe('universal')
    expect(fila?.storefront_style).toEqual({})
    // Vacío NO significa "Home en blanco": significa "usa el orden heredado".
    // El orden vive en el contrato de P01 y `normalizeHomeLayout` lo completa;
    // copiarlo aquí crearía dos fuentes de verdad para lo mismo.
    expect(fila?.home_layout).toEqual({ version: 1, sections: [] })
  })

  it('una tienda NUEVA obtiene los mismos defaults sin declararlos', async () => {
    // Es también la prueba de la tienda YA EXISTENTE: `add column ... default`
    // rellena las filas anteriores con ese mismo valor.
    const [nueva] = await svc<{ id: string }>(
      `insert into public.stores (organization_id, company_id, slug, name, status, currency)
       values ($1, $2, 'tienda-nueva', 'Tienda nueva', 'active', 'PEN') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(
      `insert into public.store_settings (store_id, organization_id, company_id)
       values ($1, $2, $3)`,
      [nueva?.id, TENANT_A.organizationId, TENANT_A.companyId],
    )

    const [fila] = await svc<{ theme_preset: string; storefront_style: unknown; home_layout: unknown }>(
      `select theme_preset, storefront_style, home_layout
         from public.store_settings where store_id = $1`,
      [nueva?.id],
    )

    expect(fila).toEqual({
      theme_preset: 'universal',
      storefront_style: {},
      home_layout: { version: 1, sections: [] },
    })

    await svc(`delete from public.stores where id = $1`, [nueva?.id])
  })
})

// ---------------------------------------------------------------------------
// B y C · El preset es una lista cerrada
// ---------------------------------------------------------------------------

describe('B · los cuatro presets', () => {
  it.each(['universal', 'retail', 'premium', 'catalog'])('acepta %s', async (preset) => {
    expect(await guardar('theme_preset', preset)).toHaveLength(1)

    const [fila] = await svc<{ theme_preset: string }>(
      `select theme_preset from public.store_settings where store_id = $1`,
      [tiendaA],
    )
    expect(fila?.theme_preset).toBe(preset)
  })
})

describe('C · cualquier otro nombre de tema', () => {
  // `pharmacy` y `fashion` están aquí a propósito: son los nombres que pediría
  // quien confunda el tema con el rubro. No existen, y esta es la barrera.
  it.each(['Retail', 'RETAIL', ' retail', 'pharmacy', 'fashion', 'default', ''])(
    'rechaza %j',
    async (preset) => {
      expect(await rechazado('theme_preset', preset)).toMatch(/store_settings_theme_preset|violates/i)
    },
  )

  it('rechaza el nulo: la tienda siempre tiene tema', async () => {
    await rechazado('theme_preset', null)
  })
})

// ---------------------------------------------------------------------------
// D y E · storefront_style
// ---------------------------------------------------------------------------

describe('D · un estilo dentro del contrato', () => {
  it('acepta el objeto completo', async () => {
    expect(await guardar('storefront_style', JSON.stringify(ESTILO_COMPLETO))).toHaveLength(1)

    const [fila] = await svc<{ storefront_style: Record<string, string> }>(
      `select storefront_style from public.store_settings where store_id = $1`,
      [tiendaA],
    )
    expect(fila?.storefront_style).toEqual(ESTILO_COMPLETO)
  })

  it('acepta un objeto PARCIAL: lo que no se pisa lo pone el preset', async () => {
    expect(
      await guardar('storefront_style', JSON.stringify({ contentWidth: 'xl' })),
    ).toHaveLength(1)
  })

  it('acepta el objeto vacío', async () => {
    expect(await guardar('storefront_style', '{}')).toHaveLength(1)
  })
})

describe('E · un estilo fuera del contrato', () => {
  const FUERA: Array<[string, unknown]> = [
    // Las cuatro formas de intentar meter presentación arbitraria. Ninguna
    // llega a un filtro: la clave no está nombrada, así que no entra.
    ['CSS crudo', { css: '.sf-scope{display:none}' }],
    ['HTML crudo', { html: '<script>alert(1)</script>' }],
    ['un manejador', { onClick: 'fetch("//evil")' }],
    ['una URL', { backgroundUrl: 'https://evil.example/x.png' }],
    // El valor sí está nombrado, pero no es de la lista.
    ['una variante inventada', { headerVariant: 'mega' }],
    ['una anchura inventada', { contentWidth: 'full' }],
    ['mayúsculas', { imageRatio: 'Portrait' }],
    // El tipo tampoco vale: la lista es de strings.
    ['un número donde va una opción', { sectionSpacing: 3 }],
    ['un booleano', { heroVariant: true }],
    ['un objeto anidado', { headerVariant: { variant: 'compact' } }],
    // Fuera del contrato A PROPÓSITO (P01): tres enteros libres no son una
    // elección entre opciones nombradas.
    ['gridColumns', { gridColumns: { xs: 11, sm: 11, lg: 11 } }],
  ]

  it.each(FUERA)('rechaza %s', async (_caso, valor) => {
    await rechazado('storefront_style', JSON.stringify(valor))
  })

  it.each([
    ['un array', '[]'],
    ['un string', '"compact"'],
    ['un número', '7'],
    // Como JSON crudo y no como objeto de JavaScript: `{ __proto__: ... }` en
    // un literal cambia el prototipo y `JSON.stringify` lo deja en `{}`, con lo
    // que la prueba pasaría sin haber probado nada.
    ['contaminación de prototipo', '{"__proto__": {"admin": true}}'],
    ['un constructor', '{"constructor": "x"}'],
  ])('rechaza %s en la raíz', async (_caso, valor) => {
    await rechazado('storefront_style', valor)
  })

  it('rechaza el nulo', async () => {
    await rechazado('storefront_style', null)
  })
})

// ---------------------------------------------------------------------------
// F y G · home_layout
// ---------------------------------------------------------------------------

describe('F · un orden de Home válido', () => {
  it('acepta secciones conocidas, con y sin tope', async () => {
    expect(await guardar('home_layout', JSON.stringify(LAYOUT_VALIDO))).toHaveLength(1)

    const [fila] = await svc<{ home_layout: typeof LAYOUT_VALIDO }>(
      `select home_layout from public.store_settings where store_id = $1`,
      [tiendaA],
    )
    expect(fila?.home_layout).toEqual(LAYOUT_VALIDO)
  })

  it('acepta la lista vacía', async () => {
    expect(await guardar('home_layout', JSON.stringify({ version: 1, sections: [] }))).toHaveLength(1)
  })

  it.each([1, 24])('acepta maxItems = %i', async (tope) => {
    expect(
      await guardar(
        'home_layout',
        JSON.stringify({ version: 1, sections: [{ id: 'offers', enabled: true, maxItems: tope }] }),
      ),
    ).toHaveLength(1)
  })
})

describe('G · un orden de Home inválido', () => {
  const FUERA: Array<[string, unknown]> = [
    ['una sección que no existe', { version: 1, sections: [{ id: 'banner-ads', enabled: true }] }],
    ['una sección con nombre de rubro', { version: 1, sections: [{ id: 'pharmacy', enabled: true }] }],
    ['una versión futura', { version: 2, sections: [] }],
    ['una versión que no es número', { version: '1', sections: [] }],
    ['sin versión', { sections: [] }],
    ['sin secciones', { version: 1 }],
    ['secciones que no son lista', { version: 1, sections: { hero: true } }],
    ['una clave de más en la raíz', { version: 1, sections: [], css: 'x' }],
    ['una sección sin enabled', { version: 1, sections: [{ id: 'hero' }] }],
    ['enabled que no es booleano', { version: 1, sections: [{ id: 'hero', enabled: 'si' }] }],
    ['una sección sin id', { version: 1, sections: [{ enabled: true }] }],
    ['una clave de más en la sección', { version: 1, sections: [{ id: 'hero', enabled: true, html: '<b>' }] }],
    ['una sección que no es objeto', { version: 1, sections: ['hero'] }],
    ['un tope de cero', { version: 1, sections: [{ id: 'offers', enabled: true, maxItems: 0 }] }],
    ['un tope negativo', { version: 1, sections: [{ id: 'offers', enabled: true, maxItems: -3 }] }],
    ['un tope desbordado', { version: 1, sections: [{ id: 'offers', enabled: true, maxItems: 25 }] }],
    ['un tope con decimales', { version: 1, sections: [{ id: 'offers', enabled: true, maxItems: 3.5 }] }],
    ['un tope que es texto', { version: 1, sections: [{ id: 'offers', enabled: true, maxItems: '8' }] }],
    [
      'la misma sección dos veces',
      { version: 1, sections: [{ id: 'hero', enabled: true }, { id: 'hero', enabled: false }] },
    ],
  ]

  it.each(FUERA)('rechaza %s', async (_caso, valor) => {
    await rechazado('home_layout', JSON.stringify(valor))
  })

  it.each([
    ['un array', '[]'],
    ['un string', '"hero"'],
  ])('rechaza %s en la raíz', async (_caso, valor) => {
    await rechazado('home_layout', valor)
  })

  it('rechaza el nulo', async () => {
    await rechazado('home_layout', null)
  })
})

// ---------------------------------------------------------------------------
// H e I · Quién puede escribir
// ---------------------------------------------------------------------------

describe('H · aislamiento entre sociedades', () => {
  it('el admin de otra sociedad no cambia el tema de esta tienda', async () => {
    const filas = await guardar('theme_preset', 'premium', tiendaA, TENANT_B)

    expect(filas).toHaveLength(0)

    const [fila] = await svc<{ theme_preset: string }>(
      `select theme_preset from public.store_settings where store_id = $1`,
      [tiendaA],
    )
    expect(fila?.theme_preset).toBe('universal')
  })

  it('ni siquiera LEE la fila de la otra sociedad', async () => {
    const filas = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      svc(`select store_id from public.store_settings where store_id = $1`, [tiendaA]),
    )

    expect(filas).toHaveLength(0)
  })

  it('cada sociedad conserva su propio tema', async () => {
    await guardar('theme_preset', 'retail', tiendaA, TENANT_A)
    await guardar('theme_preset', 'premium', tiendaB, TENANT_B)

    const filas = await svc<{ store_id: string; theme_preset: string }>(
      `select store_id, theme_preset from public.store_settings`,
    )
    expect(filas.find((f) => f.store_id === tiendaA)?.theme_preset).toBe('retail')
    expect(filas.find((f) => f.store_id === tiendaB)?.theme_preset).toBe('premium')
  })
})

describe('I · un miembro sin rol administrativo', () => {
  const claimsLector = () =>
    claimsFor(TENANT_A, {
      sub: LECTOR,
      email: 'lector@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
    })

  it('no cambia el tema', async () => {
    const filas = await asRole(db, 'authenticated', claimsLector(), () =>
      svc(
        `update public.store_settings set theme_preset = 'catalog'
          where store_id = $1 returning store_id`,
        [tiendaA],
      ),
    )

    expect(filas).toHaveLength(0)
  })

  it('no cambia el orden de la Home', async () => {
    const filas = await asRole(db, 'authenticated', claimsLector(), () =>
      svc(
        `update public.store_settings set home_layout = $1
          where store_id = $2 returning store_id`,
        [JSON.stringify(LAYOUT_VALIDO), tiendaA],
      ),
    )

    expect(filas).toHaveLength(0)
  })

  it('pero sigue pudiendo LEER la configuración de su tienda', async () => {
    // Un lector es miembro: negarle la lectura rompería el backoffice, no lo
    // protegería. Lo que no puede es escribir.
    const filas = await asRole(db, 'authenticated', claimsLector(), () =>
      svc(`select theme_preset from public.store_settings where store_id = $1`, [tiendaA]),
    )

    expect(filas).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// J · Lo que ve el comprador anónimo
// ---------------------------------------------------------------------------

describe('J · public_stores', () => {
  it('publica los tres campos del tema', async () => {
    await guardar('theme_preset', 'premium')
    await guardar('storefront_style', JSON.stringify(ESTILO_COMPLETO))
    await guardar('home_layout', JSON.stringify(LAYOUT_VALIDO))

    const [fila] = await comoAnon(() =>
      svc<Record<string, unknown>>(`select * from public.public_stores where slug = $1`, [
        TENANT_A.storeSlug,
      ]),
    )

    expect(fila?.theme_preset).toBe('premium')
    expect(fila?.storefront_style).toEqual(ESTILO_COMPLETO)
    expect(fila?.home_layout).toEqual(LAYOUT_VALIDO)
  })

  it('NO publica identificadores de tenant ni configuración interna', async () => {
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

  it('anon no puede ESCRIBIR el tema, solo leerlo', async () => {
    const error = await expectFailure(() =>
      comoAnon(() =>
        svc(`update public.store_settings set theme_preset = 'catalog' where store_id = $1`, [
          tiendaA,
        ]),
      ),
    )

    expect(error).toMatch(/permission denied|denegado/i)
  })
})

// ---------------------------------------------------------------------------
// K · El tema NO es premium
// ---------------------------------------------------------------------------

describe('K · el tema no depende de content.white_label', () => {
  it('la tienda de prueba NO tiene el addon contratado', async () => {
    const [fila] = await svc<{ tiene: boolean }>(
      `select ebim.company_is_entitled($1, $2, 'content.white_label') as tiene`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(fila?.tiene).toBe(false)
  })

  it('aun así puede elegir tema, estilo y orden de Home', async () => {
    const filas = await comoAdmin(TENANT_A, () =>
      svc<{ store_id: string }>(
        `update public.store_settings
            set theme_preset = 'catalog', storefront_style = $1, home_layout = $2
          where store_id = $3 returning store_id`,
        [JSON.stringify(ESTILO_COMPLETO), JSON.stringify(LAYOUT_VALIDO), tiendaA],
      ),
    )

    expect(filas).toHaveLength(1)
  })

  it('y sigue SIN poder encender lo que sí es premium', async () => {
    // La otra mitad del contrato: abrir el tema no abrió el white-label.
    const filas = await comoAdmin(TENANT_A, () =>
      svc(`update public.store_settings set white_label = true where store_id = $1 returning store_id`, [
        tiendaA,
      ]),
    ).catch(() => [])

    expect(filas).toHaveLength(0)
  })

  it('retirar entitlements no borra el tema', async () => {
    // `reset_premium_branding` apaga lo premium cuando el hub retira el addon.
    // El tema no es premium, así que tiene que sobrevivir a esa limpieza.
    await guardar('theme_preset', 'retail')

    await svc(`delete from public.tenant_entitlements where organization_id = $1`, [
      TENANT_A.organizationId,
    ])

    const [fila] = await svc<{ theme_preset: string }>(
      `select theme_preset from public.store_settings where store_id = $1`,
      [tiendaA],
    )
    expect(fila?.theme_preset).toBe('retail')
  })
})
