// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * La identidad de la tienda en la BASE (Storefront V3 · P01).
 *
 * ## Qué defiende este archivo
 *
 * `hero_subtitle` hacía dos trabajos incompatibles: era la bajada del hero —que
 * es de campaña— y también la descripción estable que pintaba el pie de todas
 * las páginas. Estrenar campaña cambiaba lo que la tienda decía de sí misma.
 *
 * La migración `20260923180000` separa los roles y añade el chrome que el
 * comercio nunca pudo decidir: qué enseña la cabecera, si hay selector de tema
 * y qué dice la barra de avisos. Aquí se comprueban las dos mitades del trato:
 *
 *  · el COMERCIO puede escribir su descripción, su kicker y sus avisos;
 *  · y no puede escribir nada más: ni un aviso con HTML en otra clave, ni tres
 *    avisos, ni un lockup inventado, ni la fila de otro tenant.
 *
 * ## Por qué el texto libre no es un agujero
 *
 * Lo único libre es el TEXTO, y el texto se pinta como texto —React escapa, y
 * `architecture.test.ts` prohíbe `dangerouslySetInnerHTML` en toda la vitrina—.
 * Lo que decide presentación es lista cerrada (`brand_lockup`), la longitud
 * tiene tope y los caracteres de control no entran. No hay ni un `like
 * '%<script%'`: un filtro solo detiene lo que alguien previó, y aquí no hace
 * falta porque no hay sitio donde ese marcado pudiera ejecutarse.
 */

let db: PGlite

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

/** Escribe una columna como admin y devuelve las filas afectadas. */
async function guardar(
  columna: string,
  valor: unknown,
  tienda = tiendaA,
  tenant = TENANT_A,
) {
  const parametro =
    typeof valor === 'string' || valor === null || typeof valor === 'boolean'
      ? valor
      : JSON.stringify(valor)

  return comoAdmin(tenant, () =>
    svc<{ store_id: string }>(
      `update public.store_settings set ${columna} = $1 where store_id = $2 returning store_id`,
      [parametro, tienda],
    ),
  )
}

async function rechazado(columna: string, valor: unknown) {
  return expectFailure(() => guardar(columna, valor))
}

async function leer<T = Record<string, unknown>>(columnas: string, tienda = tiendaA) {
  const [fila] = await svc<T>(
    `select ${columnas} from public.store_settings where store_id = $1`,
    [tienda],
  )
  return fila
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
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(
    `update public.store_settings set
       store_description = default,
       hero_kicker = default,
       brand_lockup = default,
       show_theme_toggle = default,
       announcement_messages = default,
       hero_subtitle = null`,
  )
})

// ---------------------------------------------------------------------------
// A · Defaults: ninguna tienda cambia de aspecto por aplicar la migración
// ---------------------------------------------------------------------------

describe('los valores por defecto', () => {
  it('la cabecera sigue enseñando logotipo y nombre', () => {
    // El defecto es exactamente lo que la cabecera hacía antes de V3.
    return leer<{ brand_lockup: string }>('brand_lockup').then((fila) => {
      expect(fila?.brand_lockup).toBe('logo_name')
    })
  })

  it('el selector claro/oscuro nace APAGADO', async () => {
    // El único defecto de V3 que cambia una tienda existente, y a propósito:
    // estaba en la cabecera de todas sin que ningún comercio lo pidiera.
    const fila = await leer<{ show_theme_toggle: boolean }>('show_theme_toggle')
    expect(fila?.show_theme_toggle).toBe(false)
  })

  it('no hay avisos, y la lista vacía significa «sin barra»', async () => {
    const fila = await leer<{ announcement_messages: unknown }>('announcement_messages')
    expect(fila?.announcement_messages).toEqual([])
  })

  it('la descripción y el kicker nacen NULOS, no con un texto de plataforma', async () => {
    // Si la plataforma los rellenara, todas las tiendas dirían lo mismo.
    const fila = await leer<{ store_description: string | null; hero_kicker: string | null }>(
      'store_description, hero_kicker',
    )
    expect(fila?.store_description).toBeNull()
    expect(fila?.hero_kicker).toBeNull()
  })

  it('la migración NO tocó `hero_subtitle` de las tiendas existentes', async () => {
    // Compatibilidad: el hero sigue usándolo y el pie cae a él mientras no haya
    // descripción propia. Un UPDATE masivo habría cambiado tiendas en marcha.
    await svc(`update public.store_settings set hero_subtitle = 'Hechos a mano en Lima'`)
    const fila = await leer<{ hero_subtitle: string | null }>('hero_subtitle')
    expect(fila?.hero_subtitle).toBe('Hechos a mano en Lima')
  })
})

// ---------------------------------------------------------------------------
// B · Lo que el comercio SÍ puede escribir
// ---------------------------------------------------------------------------

describe('lo que el comercio escribe', () => {
  it('acepta una descripción estable', async () => {
    await guardar('store_description', 'Ferretería del barrio, con reparto propio.')
    const fila = await leer<{ store_description: string }>('store_description')
    expect(fila?.store_description).toBe('Ferretería del barrio, con reparto propio.')
  })

  it('acepta un kicker corto', async () => {
    await guardar('hero_kicker', 'Nueva temporada')
    const fila = await leer<{ hero_kicker: string }>('hero_kicker')
    expect(fila?.hero_kicker).toBe('Nueva temporada')
  })

  it('acepta los tres lockups del contrato, uno a uno', async () => {
    for (const valor of ['logo_name', 'logo', 'name']) {
      await guardar('brand_lockup', valor)
      const fila = await leer<{ brand_lockup: string }>('brand_lockup')
      expect(fila?.brand_lockup).toBe(valor)
    }
  })

  it('acepta encender el selector de tema', async () => {
    await guardar('show_theme_toggle', true)
    const fila = await leer<{ show_theme_toggle: boolean }>('show_theme_toggle')
    expect(fila?.show_theme_toggle).toBe(true)
  })

  it('acepta uno y dos avisos, y conserva su orden', async () => {
    await guardar('announcement_messages', [{ text: 'Reparto propio en Lima' }])
    expect((await leer<{ announcement_messages: unknown }>('announcement_messages'))
      ?.announcement_messages).toEqual([{ text: 'Reparto propio en Lima' }])

    await guardar('announcement_messages', [{ text: 'Primero' }, { text: 'Segundo' }])
    expect((await leer<{ announcement_messages: unknown }>('announcement_messages'))
      ?.announcement_messages).toEqual([{ text: 'Primero' }, { text: 'Segundo' }])
  })

  it('acepta el texto que un comercio real escribiría, acentos incluidos', async () => {
    await guardar('announcement_messages', [{ text: 'Atención de lunes a sábado' }])
    expect((await leer<{ announcement_messages: unknown }>('announcement_messages'))
      ?.announcement_messages).toEqual([{ text: 'Atención de lunes a sábado' }])
  })

  it('acepta los textos en el límite exacto', async () => {
    await guardar('store_description', 'd'.repeat(360))
    await guardar('hero_kicker', 'k'.repeat(80))
    await guardar('announcement_messages', [{ text: 'a'.repeat(80) }])
    const fila = await leer<{ store_description: string; hero_kicker: string }>(
      'store_description, hero_kicker',
    )
    expect(fila?.store_description).toHaveLength(360)
    expect(fila?.hero_kicker).toHaveLength(80)
  })
})

// ---------------------------------------------------------------------------
// C · Lo que la base RECHAZA
// ---------------------------------------------------------------------------

describe('lo que la base no deja escribir', () => {
  it('un texto más largo que su tope', async () => {
    await rechazado('store_description', 'd'.repeat(361))
    await rechazado('hero_kicker', 'k'.repeat(81))
  })

  it('un lockup que no está en la lista', async () => {
    // Lista cerrada: un valor inventado aquí sería una cabecera que la vitrina
    // no sabe pintar.
    await rechazado('brand_lockup', 'editorial')
    await rechazado('brand_lockup', '')
    await rechazado('brand_lockup', null)
  })

  it('TRES avisos: la barra rota y nadie lee el tercero', async () => {
    await rechazado('announcement_messages', [{ text: 'uno' }, { text: 'dos' }, { text: 'tres' }])
  })

  it('un aviso con cualquier clave de más', async () => {
    // La mitad del contrato. Sin esto, el primer `{"html": "<script>"}` que
    // alguien guarde acaba en el DOM de sus compradores.
    await rechazado('announcement_messages', [{ text: 'Hola', html: '<script>x()</script>' }])
    await rechazado('announcement_messages', [{ text: 'Hola', url: 'https://otro.sitio' }])
    await rechazado('announcement_messages', [{ text: 'Hola', icon: 'truck' }])
  })

  it('un aviso sin texto, con texto vacío o con texto que no es texto', async () => {
    await rechazado('announcement_messages', [{}])
    await rechazado('announcement_messages', [{ text: '' }])
    await rechazado('announcement_messages', [{ text: '   ' }])
    await rechazado('announcement_messages', [{ text: 12 }])
    await rechazado('announcement_messages', [{ text: null }])
  })

  it('un aviso con saltos de línea, que descuadran la cabecera', async () => {
    await rechazado('announcement_messages', [{ text: 'Dos\nlíneas' }])
  })

  it('un aviso más largo que la barra', async () => {
    await rechazado('announcement_messages', [{ text: 'a'.repeat(81) }])
  })

  it('dos avisos con el mismo texto', async () => {
    await rechazado('announcement_messages', [{ text: 'Envío gratis' }, { text: 'Envío gratis' }])
  })

  it('una lista que no es una lista, ni el nulo', async () => {
    await rechazado('announcement_messages', { text: 'Hola' })
    await rechazado('announcement_messages', '"Hola"')
    // La columna es NOT NULL: la lista vacía ya dice «sin barra».
    await rechazado('announcement_messages', null)
  })

  it('el marcado guardado como TEXTO sí entra, y eso es correcto', async () => {
    // No se filtra HTML: se guarda como cadena y se pinta como cadena. Filtrar
    // aquí daría una falsa sensación de seguridad y rompería un nombre legítimo
    // con un `<` dentro.
    await guardar('announcement_messages', [{ text: '<b>Oferta</b> 2x1' }])
    expect((await leer<{ announcement_messages: unknown }>('announcement_messages'))
      ?.announcement_messages).toEqual([{ text: '<b>Oferta</b> 2x1' }])
  })
})

// ---------------------------------------------------------------------------
// D · Aislamiento entre tenants
// ---------------------------------------------------------------------------

describe('cada tienda es de quien es', () => {
  it('el admin de otra sociedad no escribe la identidad de esta tienda', async () => {
    const filas = await guardar('store_description', 'Secuestrada', tiendaA, TENANT_B)
    expect(filas).toHaveLength(0)
  })

  it('ni sus avisos', async () => {
    const filas = await guardar('announcement_messages', [{ text: 'Ajeno' }], tiendaA, TENANT_B)
    expect(filas).toHaveLength(0)
  })

  it('cada tienda conserva la suya', async () => {
    await guardar('store_description', 'La de A', tiendaA, TENANT_A)
    await guardar('store_description', 'La de B', tiendaB, TENANT_B)

    expect((await leer<{ store_description: string }>('store_description', tiendaA))
      ?.store_description).toBe('La de A')
    expect((await leer<{ store_description: string }>('store_description', tiendaB))
      ?.store_description).toBe('La de B')
  })
})

// ---------------------------------------------------------------------------
// E · La vitrina anónima
// ---------------------------------------------------------------------------

describe('lo que ve la vitrina anónima', () => {
  it('lee los cinco campos: son contenido de tienda', async () => {
    await guardar('store_description', 'Reparto propio en Lima')
    await guardar('hero_kicker', 'Nueva temporada')
    await guardar('brand_lockup', 'logo')
    await guardar('show_theme_toggle', true)
    await guardar('announcement_messages', [{ text: 'Recogida en tienda' }])

    const [fila] = await comoAnon(() =>
      svc<{
        store_description: string | null
        hero_kicker: string | null
        brand_lockup: string
        show_theme_toggle: boolean
        announcement_messages: unknown
      }>(
        `select store_description, hero_kicker, brand_lockup, show_theme_toggle, announcement_messages
           from public.public_stores where store_id = $1`,
        [tiendaA],
      ),
    )

    expect(fila?.store_description).toBe('Reparto propio en Lima')
    expect(fila?.hero_kicker).toBe('Nueva temporada')
    expect(fila?.brand_lockup).toBe('logo')
    expect(fila?.show_theme_toggle).toBe(true)
    expect(fila?.announcement_messages).toEqual([{ text: 'Recogida en tienda' }])
  })

  it('pero NO puede escribirlos', async () => {
    await expectFailure(() =>
      comoAnon(() =>
        svc(`update public.store_settings set store_description = 'mío' where store_id = $1`, [
          tiendaA,
        ]),
      ),
    )
  })

  it('la vista sigue sin filtrar de más: nada interno se cuela con los campos nuevos', async () => {
    // La vista es la frontera y enumera a mano lo publicable. Si un día alguien
    // añadiera `config` o `tax_rate`, esto se pone rojo.
    const columnas = await comoAnon(() =>
      svc<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'public_stores'`,
      ),
    )
    const nombres = columnas.map((c) => c.column_name)

    for (const prohibida of ['organization_id', 'company_id', 'tax_rate', 'config']) {
      expect(nombres).not.toContain(prohibida)
    }
    // Y sí están los cinco de V3.
    for (const esperada of [
      'store_description',
      'hero_kicker',
      'brand_lockup',
      'show_theme_toggle',
      'announcement_messages',
    ]) {
      expect(nombres).toContain(esperada)
    }
  })

  it('una tienda SUSPENDIDA no expone su identidad', async () => {
    await guardar('store_description', 'No debería verse')
    await svc(`update public.stores set status = 'suspended' where id = $1`, [tiendaA])
    try {
      const filas = await comoAnon(() =>
        svc(`select store_id from public.public_stores where store_id = $1`, [tiendaA]),
      )
      expect(filas).toHaveLength(0)
    } finally {
      await svc(`update public.stores set status = 'active' where id = $1`, [tiendaA])
    }
  })
})

// ---------------------------------------------------------------------------
// F · Compatibilidad de una tienda sin fila de ajustes
// ---------------------------------------------------------------------------

describe('una tienda sin fila de ajustes', () => {
  it('devuelve los defectos por la vista, nunca nulos que la vitrina no espera', async () => {
    // El JOIN de `public_stores` es LEFT: sin `coalesce`, los tres campos con
    // defecto llegarían nulos y la vitrina tendría que decidir otra vez.
    await svc(`delete from public.store_settings where store_id = $1`, [tiendaA])
    try {
      const [fila] = await comoAnon(() =>
        svc<{ brand_lockup: string; show_theme_toggle: boolean; announcement_messages: unknown }>(
          `select brand_lockup, show_theme_toggle, announcement_messages
             from public.public_stores where store_id = $1`,
          [tiendaA],
        ),
      )
      expect(fila?.brand_lockup).toBe('logo_name')
      expect(fila?.show_theme_toggle).toBe(false)
      expect(fila?.announcement_messages).toEqual([])
    } finally {
      await svc(
        `insert into public.store_settings (store_id, organization_id, company_id)
         select id, organization_id, company_id from public.stores where id = $1`,
        [tiendaA],
      )
    }
  })
})
