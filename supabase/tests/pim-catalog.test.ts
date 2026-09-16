// @vitest-environment node
/**
 * P03-SaaS · El modelo PIM sobre Postgres REAL (PGlite).
 *
 * Un PIM se rompe siempre por el mismo sitio: no por el SQL que no compila,
 * sino por los estados intermedios que el esquema deja existir. Un producto que
 * dice ser simple y tiene cuatro variantes. Un valor "Talla M" colgado del
 * atributo "Color". Un kit dentro de otro kit. Un SKU que en la tabla de
 * productos apunta a una cosa y en la de variantes a otra.
 *
 * Todo eso se impide con constraints, y lo que se comprueba aquí es que de
 * verdad se impide contra una base de datos, no que el DDL "parezca correcto".
 * Y encima de todo, la pregunta que no puede fallar nunca: que el tenant de al
 * lado no ve ni toca nada de esto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA: string
let storeB: string

/** Catálogo de la sociedad A. */
let brandA: string
let familyA: string
let colorAttr: string
let materialAttr: string
let colorRed: string
let colorBlue: string
let sizeAttr: string
let sizeM: string
let uomUnit: string
let uomBox: string

/** Productos de A. */
let simpleA: string
let shirtA: string
let shirtRed: string
let shirtBlue: string
let kitA: string
/** Producto de B, para las pruebas de cruce. */
let productB: string
let brandB: string

const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}

const viewerClaims = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

async function id(query: string, params: unknown[] = []): Promise<string> {
  const rows = await svc(query, params)
  return String(rows[0]?.id)
}

beforeAll(async () => {
  db = await createTestDatabase()

  await svc(
    `select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda A', 'PEN')`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.slug, `Cuenta ${TENANT_A.slug}`,
      TENANT_A.adminEmail, TENANT_A.ownerId, TENANT_A.storeSlug,
    ],
  )
  await svc(
    `select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda B', 'PEN')`,
    [
      TENANT_B.organizationId, TENANT_B.companyId, TENANT_B.slug, `Cuenta ${TENANT_B.slug}`,
      TENANT_B.adminEmail, TENANT_B.ownerId, TENANT_B.storeSlug,
    ],
  )
  await svc(`update public.stores set status = 'active'`)

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
  storeB = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
  )

  // --- Vocabulario de la sociedad A ---------------------------------------
  brandA = await id(
    `insert into public.brands (organization_id, company_id, code, name)
     values ($1, $2, 'aurora', 'Aurora') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  brandB = await id(
    `insert into public.brands (organization_id, company_id, code, name)
     values ($1, $2, 'boreal', 'Boreal') returning id`,
    [TENANT_B.organizationId, TENANT_B.companyId],
  )
  familyA = await id(
    `insert into public.product_families (organization_id, company_id, code, name)
     values ($1, $2, 'textil', 'Textil') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  colorAttr = await id(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, is_variant_axis)
     values ($1, $2, 'color', 'Color', 'option', true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  sizeAttr = await id(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, is_variant_axis)
     values ($1, $2, 'talla', 'Talla', 'option', true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  materialAttr = await id(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, is_variant_axis)
     values ($1, $2, 'material', 'Material', 'option', false) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  colorRed = await id(
    `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
     values ($1, $2, $3, 'rojo', 'Rojo') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, colorAttr],
  )
  colorBlue = await id(
    `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
     values ($1, $2, $3, 'azul', 'Azul') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, colorAttr],
  )
  sizeM = await id(
    `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
     values ($1, $2, $3, 'm', 'M') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, sizeAttr],
  )
  uomUnit = await id(
    `insert into public.units_of_measure (organization_id, company_id, code, name)
     values ($1, $2, 'UND', 'Unidad') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  uomBox = await id(
    `insert into public.units_of_measure (organization_id, company_id, code, name)
     values ($1, $2, 'CAJA', 'Caja x 12') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )

  // --- Productos -----------------------------------------------------------
  const insertProduct = `
    insert into public.products
      (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status,
       published_at, kind)
    values ($1, $2, $3, $4, $5, $5, $6, 'PEN', $7, $8::public.product_status,
            case when $8::text = 'published' then now() else null end, $9::public.product_kind)
    returning id`

  simpleA = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-JABON', 'jabon', '10.00', 100,
    'published', 'simple',
  ])
  shirtA = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-CAMISETA', 'camiseta', '60.00', 0,
    'published', 'variant',
  ])
  kitA = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-KIT', 'kit', '80.00', 0,
    'published', 'bundle',
  ])
  productB = await id(insertProduct, [
    TENANT_B.organizationId, TENANT_B.companyId, storeB, 'B-LAMPARA', 'lampara', '55.00', 4,
    'published', 'simple',
  ])

  const insertVariant = `
    insert into public.product_variants
      (organization_id, company_id, store_id, product_id, sku, name, price, stock, is_default)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`

  shirtRed = await id(insertVariant, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA, 'A-CAMISETA-R-M', 'Rojo · M',
    null, 7, true,
  ])
  shirtBlue = await id(insertVariant, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA, 'A-CAMISETA-A-M', 'Azul · M',
    '69.90', 0, false,
  ])

  await svc(
    `insert into public.variant_attribute_values
       (organization_id, company_id, store_id, variant_id, attribute_id, value_id)
     values ($1, $2, $3, $4, $5, $6), ($1, $2, $3, $4, $7, $8),
            ($1, $2, $3, $9, $5, $10), ($1, $2, $3, $9, $7, $8)`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA,
      shirtRed, colorAttr, colorRed, sizeAttr, sizeM,
      shirtBlue, colorBlue,
    ],
  )

  await svc(
    `insert into public.product_uoms
       (organization_id, company_id, store_id, product_id, uom_id, factor, is_base)
     values ($1, $2, $3, $4, $5, 1, true), ($1, $2, $3, $4, $6, 12, false)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, uomUnit, uomBox],
  )

  await svc(
    `insert into public.bundle_items
       (organization_id, company_id, store_id, bundle_product_id,
        component_product_id, component_kind, component_variant_id, quantity)
     values ($1, $2, $3, $4, $5, 'simple', null, 2),
            ($1, $2, $3, $4, $6, 'variant', $7, 1)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, kitA, simpleA, shirtA, shirtRed],
  )
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('aislamiento entre tenants', () => {
  const tablas = [
    'brands',
    'product_families',
    'attributes',
    'attribute_values',
    'units_of_measure',
    'product_variants',
    'variant_attribute_values',
    'product_uoms',
    'bundle_items',
    'product_relations',
  ]

  it('el tenant B no ve una sola fila del PIM del tenant A', async () => {
    const vistas: string[] = []
    await asRole(db, 'authenticated', claimsFor(TENANT_B), async () => {
      for (const tabla of tablas) {
        const rows = await sql(
          `select count(*)::int as n from public.${tabla} where organization_id = $1`,
          [TENANT_A.organizationId],
        )
        if (Number(rows[0]?.n) !== 0) vistas.push(`${tabla}: ${rows[0]?.n}`)
      }
    })
    expect(vistas).toEqual([])
  })

  it('el tenant A sí ve lo suyo (el test de arriba no pasa por estar todo vacío)', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      for (const tabla of tablas.filter((t) => t !== 'product_relations')) {
        const rows = await sql(`select count(*)::int as n from public.${tabla}`)
        expect(Number(rows[0]?.n), tabla).toBeGreaterThan(0)
      }
    })
  })

  it('el tenant B no puede escribir una variante en un producto del tenant A', async () => {
    const message = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      expectFailure(() =>
        sql(
          `insert into public.product_variants
             (organization_id, company_id, store_id, product_id, sku, name, stock)
           values ($1, $2, $3, $4, 'INTRUSO', 'Intruso', 5)`,
          [TENANT_B.organizationId, TENANT_B.companyId, storeA, shirtA],
        ),
      ),
    )
    expect(message).toMatch(/violates|policy|foreign key/i)
  })

  it('el tenant B no puede borrar ni actualizar el vocabulario del tenant A', async () => {
    await asRole(db, 'authenticated', claimsFor(TENANT_B), async () => {
      const updated = await sql(
        `update public.brands set name = 'Secuestrada' where id = $1 returning id`,
        [brandA],
      )
      expect(updated).toEqual([])
      const deleted = await sql(`delete from public.attributes where id = $1 returning id`, [
        colorAttr,
      ])
      expect(deleted).toEqual([])
    })
    const [brand] = await svc(`select name from public.brands where id = $1`, [brandA])
    expect(brand?.name).toBe('Aurora')
  })

  it('una marca de otra sociedad no se puede asignar a un producto: lo impide la FK compuesta', async () => {
    const message = await expectFailure(() =>
      svc(`update public.products set brand_id = $1 where id = $2`, [brandB, simpleA]),
    )
    expect(message).toMatch(/products_brand_fk|foreign key/i)
  })

  it('la familia sí se asigna dentro de la misma sociedad, y no fuera', async () => {
    await svc(`update public.products set family_id = $1 where id = $2`, [familyA, simpleA])
    const [row] = await svc(`select family_id from public.products where id = $1`, [simpleA])
    expect(row?.family_id).toBe(familyA)

    const familyB = await id(
      `insert into public.product_families (organization_id, company_id, code, name)
       values ($1, $2, 'ajena', 'Ajena') returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId],
    )
    const message = await expectFailure(() =>
      svc(`update public.products set family_id = $1 where id = $2`, [familyB, simpleA]),
    )
    expect(message).toMatch(/products_family_fk|foreign key/i)
  })

  it('una variante no puede declarar una tienda distinta a la de su producto', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.product_variants
           (organization_id, company_id, store_id, product_id, sku, name, stock)
         values ($1, $2, $3, $4, 'A-CRUZADA', 'Cruzada', 1)`,
        [TENANT_B.organizationId, TENANT_B.companyId, storeB, shirtA],
      ),
    )
    expect(message).toMatch(/foreign key/i)
  })
})

describe('roles: leer no es escribir', () => {
  it('un `viewer` del tenant A lee las variantes pero no las toca', async () => {
    await asRole(db, 'authenticated', viewerClaims(), async () => {
      const rows = await sql(`select count(*)::int as n from public.product_variants`)
      expect(Number(rows[0]?.n)).toBe(2)

      const updated = await sql(
        `update public.product_variants set stock = 999 where id = $1 returning id`,
        [shirtRed],
      )
      expect(updated).toEqual([])

      const message = await expectFailure(() =>
        sql(
          `insert into public.units_of_measure (organization_id, company_id, code, name)
           values ($1, $2, 'SACO', 'Saco')`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        ),
      )
      expect(message).toMatch(/policy/i)
    })
  })
})

describe('un solo espacio de nombres de SKU por tienda', () => {
  it('una variante no puede llevar el SKU de un producto de la misma tienda', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.product_variants
           (organization_id, company_id, store_id, product_id, sku, name, stock)
         values ($1, $2, $3, $4, 'a-jabon', 'Choque', 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA],
      ),
    )
    expect(message).toMatch(/SKU_DUPLICADO/)
  })

  it('un producto no puede llevar el SKU de una variante de la misma tienda', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.products
           (organization_id, company_id, store_id, sku, slug, name, price, currency, stock)
         values ($1, $2, $3, 'A-CAMISETA-R-M', 'choque', 'Choque', '1.00', 'PEN', 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(message).toMatch(/SKU_DUPLICADO/)
  })

  it('el mismo SKU en OTRA tienda es legítimo: el alcance es la tienda', async () => {
    const variantParentB = await id(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, kind)
       values ($1, $2, $3, 'B-MADRE', 'madre', 'Madre', '1.00', 'PEN', 0, 'variant')
       returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId, storeB],
    )
    const created = await svc(
      `insert into public.product_variants
         (organization_id, company_id, store_id, product_id, sku, name, stock)
       values ($1, $2, $3, $4, 'A-JABON', 'Mismo SKU, otra tienda', 1)
       returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId, storeB, variantParentB],
    )
    expect(created).toHaveLength(1)
    await svc(`delete from public.products where id = $1`, [variantParentB])
  })
})

describe('el tipo de producto no admite estados a medias', () => {
  it('una variante no puede colgar de un producto simple', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.product_variants
           (organization_id, company_id, store_id, product_id, sku, name, stock)
         values ($1, $2, $3, $4, 'A-IMPOSIBLE', 'Imposible', 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA],
      ),
    )
    expect(message).toMatch(/product_variants_kind_fk|foreign key/i)
  })

  it('un producto con variantes no se puede degradar a simple', async () => {
    const message = await expectFailure(() =>
      svc(`update public.products set kind = 'simple' where id = $1`, [shirtA]),
    )
    expect(message).toMatch(/product_variants_kind|check|violates/i)

    const [row] = await svc(`select kind from public.products where id = $1`, [shirtA])
    expect(row?.kind).toBe('variant')
  })

  it('una sola variante por defecto', async () => {
    const message = await expectFailure(() =>
      svc(`update public.product_variants set is_default = true where id = $1`, [shirtBlue]),
    )
    expect(message).toMatch(/product_variants_one_default|duplicate key/i)
  })

  it('el código de barras de variante es único dentro de la tienda', async () => {
    await svc(`update public.product_variants set barcode = '7501234567890' where id = $1`, [
      shirtRed,
    ])
    const message = await expectFailure(() =>
      svc(`update public.product_variants set barcode = '7501234567890' where id = $1`, [
        shirtBlue,
      ]),
    )
    expect(message).toMatch(/product_variants_barcode_key|duplicate key/i)
    await svc(`update public.product_variants set barcode = null where id = $1`, [shirtRed])
  })
})

describe('atributos: el dominio es cerrado y pertenece a su atributo', () => {
  it('un eje de variante tiene que ser una lista de opciones', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.attributes
           (organization_id, company_id, code, name, data_type, is_variant_axis)
         values ($1, $2, 'peso_libre', 'Peso libre', 'number', true)`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ),
    )
    expect(message).toMatch(/attributes_axis_is_option|check/i)
  })

  it('un atributo que no es lista no puede tener valores', async () => {
    const textAttr = await id(
      `insert into public.attributes (organization_id, company_id, code, name, data_type)
       values ($1, $2, 'notas', 'Notas', 'text') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const message = await expectFailure(() =>
      svc(
        `insert into public.attribute_values
           (organization_id, company_id, attribute_id, code, label)
         values ($1, $2, $3, 'x', 'X')`,
        [TENANT_A.organizationId, TENANT_A.companyId, textAttr],
      ),
    )
    expect(message).toMatch(/attribute_values_type_fk|foreign key/i)
    await svc(`delete from public.attributes where id = $1`, [textAttr])
  })

  it('un atributo con valores en uso no se puede convertir en texto libre', async () => {
    const message = await expectFailure(() =>
      svc(`update public.attributes set data_type = 'text' where id = $1`, [colorAttr]),
    )
    expect(message).toMatch(/attribute_values_only_option|check|violates/i)
  })

  it('una variante no puede tomar el valor de OTRO atributo', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.variant_attribute_values
           (organization_id, company_id, store_id, variant_id, attribute_id, value_id)
         values ($1, $2, $3, $4, $5, $6)`,
        // "Talla M" (valor de `talla`) declarado bajo el atributo `color`.
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtBlue, colorAttr, sizeM],
      ),
    )
    expect(message).toMatch(/variant_attribute_values_value_fk|foreign key|duplicate/i)
  })

  it('un atributo descriptivo no puede definir variantes', async () => {
    const wool = await id(
      `insert into public.attribute_values (organization_id, company_id, attribute_id, code, label)
       values ($1, $2, $3, 'lana', 'Lana') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, materialAttr],
    )
    const message = await expectFailure(() =>
      svc(
        `insert into public.variant_attribute_values
           (organization_id, company_id, store_id, variant_id, attribute_id, value_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtRed, materialAttr, wool],
      ),
    )
    expect(message).toMatch(/variant_attribute_values_axis_fk|foreign key/i)
  })

  it('un eje toma un solo valor por variante', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.variant_attribute_values
           (organization_id, company_id, store_id, variant_id, attribute_id, value_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtRed, colorAttr, colorBlue],
      ),
    )
    expect(message).toMatch(/variant_attribute_values_unique|duplicate key/i)
  })

  it('la ficha técnica admite exactamente un valor por atributo, y de un solo tipo', async () => {
    const dos = await expectFailure(() =>
      svc(
        `insert into public.product_attribute_values
           (organization_id, company_id, store_id, product_id, attribute_id, value_text, value_number)
         values ($1, $2, $3, $4, $5, 'algo', 3)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, materialAttr],
      ),
    )
    expect(dos).toMatch(/product_attribute_values_one_value|check/i)

    const ninguno = await expectFailure(() =>
      svc(
        `insert into public.product_attribute_values
           (organization_id, company_id, store_id, product_id, attribute_id)
         values ($1, $2, $3, $4, $5)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, materialAttr],
      ),
    )
    expect(ninguno).toMatch(/product_attribute_values_one_value|check/i)
  })
})

describe('unidades de venta', () => {
  it('la unidad base tiene factor 1 y no hay dos', async () => {
    const factor = await expectFailure(() =>
      svc(
        `insert into public.product_uoms
           (organization_id, company_id, store_id, product_id, uom_id, factor, is_base)
         values ($1, $2, $3, $4, $5, 6, true)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA, uomBox],
      ),
    )
    expect(factor).toMatch(/product_uoms_base_factor|check/i)

    const dobleBase = await expectFailure(() =>
      svc(
        `insert into public.product_uoms
           (organization_id, company_id, store_id, product_id, uom_id, factor, is_base)
         values ($1, $2, $3, $4, $5, 1, true)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, uomBox],
      ),
    )
    expect(dobleBase).toMatch(/product_uoms_one_base|duplicate key/i)
  })

  it('un factor de conversión cero o negativo no existe', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.product_uoms
           (organization_id, company_id, store_id, product_id, uom_id, factor)
         values ($1, $2, $3, $4, $5, 0)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA, uomBox],
      ),
    )
    expect(message).toMatch(/product_uoms_factor_positive|check/i)
  })

  it('el factor conserva los decimales: no se guarda como float', async () => {
    await svc(
      `insert into public.product_uoms
         (organization_id, company_id, store_id, product_id, uom_id, factor)
       values ($1, $2, $3, $4, $5, 0.333333)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA, uomBox],
    )
    const [row] = await svc(
      `select factor::text as factor from public.product_uoms
        where product_id = $1 and uom_id = $2`,
      [shirtA, uomBox],
    )
    expect(row?.factor).toBe('0.333333')
    await svc(`delete from public.product_uoms where product_id = $1`, [shirtA])
  })

  it('una unidad de otra sociedad no se puede usar en un producto', async () => {
    const uomB = await id(
      `insert into public.units_of_measure (organization_id, company_id, code, name)
       values ($1, $2, 'PALLET', 'Pallet') returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId],
    )
    const message = await expectFailure(() =>
      svc(
        `insert into public.product_uoms
           (organization_id, company_id, store_id, product_id, uom_id, factor)
         values ($1, $2, $3, $4, $5, 100)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, shirtA, uomB],
      ),
    )
    expect(message).toMatch(/product_uoms_uom_fk|foreign key/i)
  })

  it('una unidad en uso no se puede borrar', async () => {
    const message = await expectFailure(() =>
      svc(`delete from public.units_of_measure where id = $1`, [uomBox]),
    )
    expect(message).toMatch(/foreign key|still referenced/i)
  })
})

describe('kits', () => {
  it('un kit no puede contener otro kit', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.bundle_items
           (organization_id, company_id, store_id, bundle_product_id,
            component_product_id, component_kind, quantity)
         values ($1, $2, $3, $4, $5, 'bundle', 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, kitA, kitA],
      ),
    )
    expect(message).toMatch(/bundle_items_no_nesting|bundle_items_not_self|check/i)
  })

  it('un componente que se vende por variantes obliga a decir cuál', async () => {
    const sinVariante = await expectFailure(() =>
      svc(
        `insert into public.bundle_items
           (organization_id, company_id, store_id, bundle_product_id,
            component_product_id, component_kind, quantity)
         values ($1, $2, $3, $4, $5, 'variant', 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, kitA, shirtA],
      ),
    )
    expect(sinVariante).toMatch(/bundle_items_variant_matches_kind|check|duplicate/i)
  })

  it('un componente simple no puede traer variante', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.bundle_items
           (organization_id, company_id, store_id, bundle_product_id,
            component_product_id, component_kind, component_variant_id, quantity)
         values ($1, $2, $3, $4, $5, 'simple', $6, 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, kitA, simpleA, shirtRed],
      ),
    )
    expect(message).toMatch(/bundle_items_variant_matches_kind|check|duplicate/i)
  })

  it('el mismo componente no se repite en el kit aunque no tenga variante', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.bundle_items
           (organization_id, company_id, store_id, bundle_product_id,
            component_product_id, component_kind, quantity)
         values ($1, $2, $3, $4, $5, 'simple', 3)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, kitA, simpleA],
      ),
    )
    expect(message).toMatch(/bundle_items_unique|duplicate key/i)
  })

  it('un producto que es componente de un kit no se puede borrar', async () => {
    const message = await expectFailure(() =>
      svc(`delete from public.products where id = $1`, [simpleA]),
    )
    expect(message).toMatch(/foreign key|still referenced/i)
  })

  it('un componente de un kit no puede convertirse en kit', async () => {
    const message = await expectFailure(() =>
      svc(`update public.products set kind = 'bundle' where id = $1`, [simpleA]),
    )
    expect(message).toMatch(/bundle_items_no_nesting|check|violates/i)
  })

  it('el conteo previo al borrado avisa de variantes y de kits que lo usan', async () => {
    const [usage] = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.product_deletion_usage($1) as usage`, [simpleA]),
    )
    const data = usage?.usage as Record<string, number>
    expect(data.bundles).toBe(1)
    expect(data.variants).toBe(0)

    const [shirtUsage] = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.product_deletion_usage($1) as usage`, [shirtA]),
    )
    expect((shirtUsage?.usage as Record<string, number>).variants).toBe(2)
  })
})

describe('relaciones entre productos', () => {
  it('un producto no se relaciona consigo mismo ni dos veces con el mismo tipo', async () => {
    await svc(
      `insert into public.product_relations
         (organization_id, company_id, store_id, product_id, related_product_id, relation_kind)
       values ($1, $2, $3, $4, $5, 'cross_sell')`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, shirtA],
    )

    const consigoMismo = await expectFailure(() =>
      svc(
        `insert into public.product_relations
           (organization_id, company_id, store_id, product_id, related_product_id)
         values ($1, $2, $3, $4, $4)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA],
      ),
    )
    expect(consigoMismo).toMatch(/product_relations_not_self|check/i)

    const repetida = await expectFailure(() =>
      svc(
        `insert into public.product_relations
           (organization_id, company_id, store_id, product_id, related_product_id, relation_kind)
         values ($1, $2, $3, $4, $5, 'cross_sell')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, shirtA],
      ),
    )
    expect(repetida).toMatch(/product_relations_unique|duplicate key/i)
  })

  it('no se puede relacionar con un producto de otra tienda', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.product_relations
           (organization_id, company_id, store_id, product_id, related_product_id)
         values ($1, $2, $3, $4, $5)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, simpleA, productB],
      ),
    )
    expect(message).toMatch(/foreign key/i)
  })
})

describe('modelo de lectura público', () => {
  it('la disponibilidad de un maestro de variantes sale de sus variantes, no de su stock', async () => {
    // El maestro tiene stock 0 y la variante roja tiene 7: la vitrina dice que
    // hay. Con la columna generada de `products` diría que no y esconderia una
    // camiseta que está en el almacén.
    const [row] = await asRole(db, 'anon', null, () =>
      sql(
        `select kind, in_stock, variant_count, price::text as price, price_from::text as price_from
           from public.public_products where product_id = $1`,
        [shirtA],
      ),
    )
    expect(row?.kind).toBe('variant')
    expect(row?.in_stock).toBe(true)
    expect(row?.variant_count).toBe(2)
    // La roja hereda 60.00 del maestro; la azul cuesta 69.90. "Desde" es 60.00.
    expect(row?.price_from).toBe('60.00')
  })

  it('un maestro sin ninguna variante con existencia no está disponible', async () => {
    await svc(`update public.product_variants set stock = 0 where product_id = $1`, [shirtA])
    const [row] = await asRole(db, 'anon', null, () =>
      sql(`select in_stock from public.public_products where product_id = $1`, [shirtA]),
    )
    expect(row?.in_stock).toBe(false)
    await svc(`update public.product_variants set stock = 7 where id = $1`, [shirtRed])
  })

  it('un kit está disponible solo si todos sus componentes alcanzan', async () => {
    const [conStock] = await asRole(db, 'anon', null, () =>
      sql(`select in_stock from public.public_products where product_id = $1`, [kitA]),
    )
    expect(conStock?.in_stock).toBe(true)

    await svc(`update public.product_variants set stock = 0 where id = $1`, [shirtRed])
    const [sinStock] = await asRole(db, 'anon', null, () =>
      sql(`select in_stock from public.public_products where product_id = $1`, [kitA]),
    )
    expect(sinStock?.in_stock).toBe(false)
    await svc(`update public.product_variants set stock = 7 where id = $1`, [shirtRed])
  })

  it('el comprador anónimo ve las variantes publicadas, con precio heredado ya resuelto', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(
        `select name, price::text as price, in_stock
           from public.public_product_variants
          where product_id = $1 order by name`,
        [shirtA],
      ),
    )
    expect(rows.map((r) => `${r.name}=${r.price}`)).toEqual([
      'Azul · M=69.90',
      'Rojo · M=60.00',
    ])
  })

  /**
   * La ficha pinta un selector por eje («Color: Rojo Azul», «Talla: M») y para
   * eso necesita saber QUÉ ES cada variante. Llega en `options`, calculado por
   * una función definer: el anónimo sigue sin permiso sobre las tablas de
   * atributos (lo comprueba «el vocabulario del catálogo... no es público»).
   */
  it('cada variante pública trae su combinación de ejes, en orden', async () => {
    const rows = await asRole(db, 'anon', null, () =>
      sql(
        `select name, options
           from public.public_product_variants
          where product_id = $1 order by name`,
        [shirtA],
      ),
    )
    const combinacion = (row: Row | undefined) =>
      (row?.options as Array<Record<string, unknown>>).map(
        (o) => `${o.name}:${o.code}=${o.label}(${o.value_code})`,
      )
    expect(combinacion(rows[0])).toEqual(['Color:color=Azul(azul)', 'Talla:talla=M(m)'])
    expect(combinacion(rows[1])).toEqual(['Color:color=Rojo(rojo)', 'Talla:talla=M(m)'])
  })

  it('la combinación no sale del tenant: solo código, nombre, etiqueta y orden', async () => {
    const [row] = await asRole(db, 'anon', null, () =>
      sql(`select options from public.public_product_variants where variant_id = $1`, [shirtRed]),
    )
    const claves = Object.keys((row?.options as Array<Record<string, unknown>>)[0] ?? {}).sort()
    expect(claves).toEqual(['code', 'label', 'name', 'position', 'value_code', 'value_position'])
  })

  it('llamada a mano, la función no responde por variantes que la vitrina no enseña', async () => {
    // Es `SECURITY DEFINER` y `anon` puede ejecutarla: la autorización tiene
    // que estar DENTRO, o con un uuid cualquiera se leerían los ejes de un
    // producto en borrador o de una variante retirada.
    const publica = await asRole(db, 'anon', null, () =>
      sql(`select ebim.variant_public_options($1) as o`, [shirtRed]),
    )
    expect(publica[0]?.o).toHaveLength(2)

    await svc(`update public.product_variants set is_active = false where id = $1`, [shirtBlue])
    const retirada = await asRole(db, 'anon', null, () =>
      sql(`select ebim.variant_public_options($1) as o`, [shirtBlue]),
    )
    expect(retirada[0]?.o).toEqual([])
    await svc(`update public.product_variants set is_active = true where id = $1`, [shirtBlue])

    await svc(`update public.products set status = 'draft', published_at = null where id = $1`, [
      shirtA,
    ])
    const borrador = await asRole(db, 'anon', null, () =>
      sql(`select ebim.variant_public_options($1) as o`, [shirtRed]),
    )
    expect(borrador[0]?.o).toEqual([])
    await svc(
      `update public.products set status = 'published', published_at = now() where id = $1`,
      [shirtA],
    )

    const [definicion] = await svc(
      `select p.prosecdef as definer, p.proconfig[1] as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'ebim' and p.proname = 'variant_public_options'`,
    )
    expect(definicion?.definer).toBe(true)
    expect(definicion?.config).toBe('search_path=""')
  })

  it('las variantes de un producto NO publicado no salen a la vitrina', async () => {
    await svc(`update public.products set status = 'draft', published_at = null where id = $1`, [
      shirtA,
    ])
    const rows = await asRole(db, 'anon', null, () =>
      sql(`select variant_id from public.public_product_variants where product_id = $1`, [shirtA]),
    )
    expect(rows).toEqual([])
    await svc(
      `update public.products set status = 'published', published_at = now() where id = $1`,
      [shirtA],
    )
  })

  it('el comprador anónimo no lee el SKU ni la existencia exacta de una variante', async () => {
    const sku = await asRole(db, 'anon', null, () =>
      expectFailure(() => sql(`select sku from public.product_variants`)),
    )
    expect(sku).toMatch(/permission denied/i)

    const stock = await asRole(db, 'anon', null, () =>
      expectFailure(() => sql(`select stock from public.product_variants`)),
    )
    expect(stock).toMatch(/permission denied/i)
  })

  it('el vocabulario del catálogo y la composición del kit no son públicos', async () => {
    await asRole(db, 'anon', null, async () => {
      for (const tabla of ['attributes', 'attribute_values', 'units_of_measure', 'bundle_items']) {
        const message = await expectFailure(() => sql(`select * from public.${tabla}`))
        expect(message, tabla).toMatch(/permission denied|policy/i)
      }
    })
  })

  it('la marca solo se publica si un producto publicado la usa', async () => {
    await svc(`update public.products set brand_id = $1 where id = $2`, [brandA, simpleA])
    const visible = await asRole(db, 'anon', null, () =>
      sql(`select name from public.brands where id = $1`, [brandA]),
    )
    expect(visible).toHaveLength(1)

    await svc(`update public.products set brand_id = null where id = $1`, [simpleA])
    const oculta = await asRole(db, 'anon', null, () =>
      sql(`select name from public.brands where id = $1`, [brandA]),
    )
    expect(oculta).toEqual([])
  })

  it('el producto simple sigue comportándose exactamente igual que antes del PIM', async () => {
    const [row] = await asRole(db, 'anon', null, () =>
      sql(
        `select kind, in_stock, variant_count, price::text as price, price_from::text as price_from
           from public.public_products where product_id = $1`,
        [simpleA],
      ),
    )
    expect(row?.kind).toBe('simple')
    expect(row?.in_stock).toBe(true)
    expect(row?.variant_count).toBe(0)
    expect(row?.price_from).toBe(row?.price)
  })
})
