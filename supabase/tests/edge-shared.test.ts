// @vitest-environment node
/**
 * Capa compartida de las Edge Functions.
 *
 * Lo que se prueba aquí es la frontera: que el tenant no se pueda declarar
 * desde el cliente, que un precio en el carrito se rechace, y que la máquina de
 * estados de TypeScript no se desincronice de la que tiene la base.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  assertNoTenantInPayload,
  assertNotSuiteOperator,
  bearerToken,
  decodeClaims,
  requireProvisioningKey,
  tenantContext,
  timingSafeEqual,
} from '../functions/_shared/auth.ts'
import { corsHeaders, parseAllowedOrigins, resolveAllowedOrigin } from '../functions/_shared/cors.ts'
import { AppError, fromDatabaseError, toAppError } from '../functions/_shared/errors.ts'
import {
  FULFILLMENT_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  canTransition,
  nextForAxis,
  normalizeOrderItems,
  normalizeBillingAddress,
  normalizeShippingAddress,
} from '../functions/_shared/orders.ts'
import { ROLE_PERMISSIONS, can } from '../functions/_shared/roles.ts'
import { rejectUnknownFields, requireUuid } from '../functions/_shared/validation.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ORG = '11111111-1111-4111-8111-111111111111'
const COMPANY = '22222222-2222-4222-8222-222222222222'
const OTHER_COMPANY = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'

function makeToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.firma-no-verificada-aqui`
}

/** `toThrowError` compara el MENSAJE; lo que estabiliza el contrato de la API
 *  es el `code`, asi que se comprueba ese. */
function expectCode(run: () => unknown, code: string, status?: number): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    if (status !== undefined) expect((error as AppError).status).toBe(status)
    return
  }
  throw new Error(`Se esperaba AppError ${code} y no se lanzo nada`)
}

const validClaims = {
  sub: USER,
  email: 'ana@cliente.com',
  org_id: ORG,
  companies: [{ id: COMPANY, role: 'admin' }],
  active_company: COMPANY,
  apps: ['ecommerce'],
}

describe('el tenant sale del token, no del cuerpo', () => {
  it.each([
    'organization_id',
    'company_id',
    'tenant_id',
    'org_id',
    'active_company',
    'companyId',
  ])('rechaza `%s` en el payload con 400', (field) => {
    expectCode(() => assertNoTenantInPayload({ [field]: ORG }), 'TENANT_NO_ADMITIDO', 400)
  })

  it('rechaza, no ignora en silencio: el mensaje nombra el campo', () => {
    try {
      assertNoTenantInPayload({ organization_id: ORG, company_id: COMPANY })
      throw new Error('deberia haber fallado')
    } catch (error) {
      expect((error as AppError).status).toBe(400)
      expect((error as AppError).message).toContain('organization_id')
      expect((error as AppError).message).toContain('company_id')
    }
  })

  it('un payload limpio pasa', () => {
    expect(() => assertNoTenantInPayload({ store_id: COMPANY, name: 'Silla' })).not.toThrow()
  })

  it('deriva el contexto del claim `active_company`', () => {
    const context = tenantContext(decodeClaims(makeToken(validClaims)))
    expect(context).toEqual({
      userId: USER,
      email: 'ana@cliente.com',
      organizationId: ORG,
      companyId: COMPANY,
      companies: [COMPANY],
    })
  })

  it('una sociedad activa que no esta en companies[] es 403', () => {
    const token = makeToken({ ...validClaims, active_company: OTHER_COMPANY })
    expect(() => tenantContext(decodeClaims(token))).toThrowError(/sociedad activa/i)
  })

  it('un token sin org_id es 403', () => {
    const token = makeToken({ sub: USER, companies: [] })
    expect(() => tenantContext(decodeClaims(token))).toThrowError()
  })

  it('un token expirado es 401', () => {
    const token = makeToken({ ...validClaims, exp: 1000 })
    expect(() => decodeClaims(token)).toThrowError(/expirado/i)
  })

  it('un token que no es un JWT es 401', () => {
    expect(() => decodeClaims('no-es-un-token')).toThrowError(/no es un JWT/i)
  })

  it('exige la cabecera Authorization', () => {
    const request = new Request('https://x.test', { method: 'POST' })
    expect(() => bearerToken(request)).toThrowError(/Authorization/i)
  })
})

describe('gobernanza (contrato §13)', () => {
  it('una cuenta @ebim.pe no opera datos de negocio de un tenant', () => {
    expect(() => assertNotSuiteOperator('dcalagua@ebim.pe')).toThrowError(/@ebim\.pe/)
    expect(() => assertNotSuiteOperator('OPERADOR@EBIM.PE')).toThrowError()
  })

  it('un usuario de cliente si opera', () => {
    expect(() => assertNotSuiteOperator('ana@cliente.com')).not.toThrow()
  })
})

describe('clave de aprovisionamiento (contrato §2.6)', () => {
  const key = 'k'.repeat(48)

  it('acepta la clave correcta en cabecera', () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      headers: { 'x-ebim-provisioning-key': key },
    })
    expect(() => requireProvisioningKey(request, key)).not.toThrow()
  })

  it('rechaza una clave incorrecta', () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      headers: { 'x-ebim-provisioning-key': 'x'.repeat(48) },
    })
    expect(() => requireProvisioningKey(request, key)).toThrowError(/invalida/i)
  })

  it('falla ruidosamente si la funcion no tiene clave configurada', () => {
    const request = new Request('https://x.test', { method: 'POST' })
    expectCode(() => requireProvisioningKey(request, undefined), 'PROVISIONING_NO_CONFIGURADO', 500)
  })

  it('la comparacion no filtra el prefijo correcto', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('carrito: el precio lo decide el servidor', () => {
  it.each(['price', 'unit_price', 'line_total', 'currency', 'store_id'])(
    'rechaza `%s` dentro de una linea',
    (field) => {
      expectCode(
        () => normalizeOrderItems([{ product_id: ORG, quantity: 1, [field]: '0.01' }]),
        'CAMPO_NO_PERMITIDO',
        400,
      )
    },
  )

  it('agrupa lineas repetidas del mismo producto', () => {
    expect(
      normalizeOrderItems([
        { product_id: ORG, quantity: 2 },
        { product_id: ORG, quantity: 3 },
        { product_id: COMPANY, quantity: 1 },
      ]),
    ).toEqual([
      { product_id: ORG, quantity: 5 },
      { product_id: COMPANY, quantity: 1 },
    ])
  })

  it.each([0, -1, 1.5, '2', null])('rechaza la cantidad %p', (quantity) => {
    expect(() => normalizeOrderItems([{ product_id: ORG, quantity }])).toThrowError()
  })

  it('rechaza un carrito vacio y uno desmesurado', () => {
    expectCode(() => normalizeOrderItems([]), 'ITEMS_REQUERIDOS')
    const huge = Array.from({ length: 101 }, () => ({ product_id: ORG, quantity: 1 }))
    expectCode(() => normalizeOrderItems(huge), 'ITEMS_EXCESIVOS')
  })
})

/**
 * P03-SaaS. La linea del carrito gana dos campos y NO gana ninguno mas: el
 * factor de conversion —lo que traduce "2 cajas" a existencia descontada— sigue
 * siendo del servidor, igual que el precio.
 */
describe('carrito con variantes y unidades', () => {
  it.each(['uom_id', 'uom_factor', 'factor', 'base_quantity', 'sku', 'variant_sku'])(
    'rechaza `%s` dentro de una linea',
    (field) => {
      expectCode(
        () => normalizeOrderItems([{ product_id: ORG, quantity: 1, [field]: '12' }]),
        'CAMPO_NO_PERMITIDO',
        400,
      )
    },
  )

  /**
   * P04-SaaS. Las tres llaves del motor de precios y el canal. Un comprador que
   * pudiera declarar `segment_id` o `customer_id` se estaria asignando el
   * acuerdo comercial de otro; con `price_list_id` se saltaria la precedencia
   * entera, y con `channel_id`, el canal interno y sus precios preferenciales.
   */
  it.each(['channel_id', 'segment_id', 'customer_id', 'price_list_id', 'price_source'])(
    'rechaza `%s`: el acuerdo comercial no lo elige quien compra',
    (field) => {
      expectCode(
        () => normalizeOrderItems([{ product_id: ORG, quantity: 1, [field]: ORG }]),
        'CAMPO_NO_PERMITIDO',
        400,
      )
    },
  )

  it('la linea de un producto simple viaja EXACTAMENTE igual que antes del PIM', () => {
    // Las claves opcionales solo aparecen si tienen valor. Mandar
    // `variant_id: null` habria cambiado el cuerpo de todas las peticiones del
    // catalogo simple sin que nada lo necesitara.
    const [item] = normalizeOrderItems([{ product_id: ORG, quantity: 1 }])
    expect(Object.keys(item ?? {}).sort()).toEqual(['product_id', 'quantity'])
  })

  it('la variante y la unidad sobreviven, y el codigo de unidad se normaliza', () => {
    expect(
      normalizeOrderItems([
        { product_id: ORG, quantity: 2, variant_id: COMPANY, uom_code: ' caja ' },
      ]),
    ).toEqual([{ product_id: ORG, quantity: 2, variant_id: COMPANY, uom_code: 'CAJA' }])
  })

  it('la clave de agrupacion es producto + variante + unidad', () => {
    const items = normalizeOrderItems([
      { product_id: ORG, quantity: 1, variant_id: COMPANY },
      { product_id: ORG, quantity: 2, variant_id: COMPANY },
      { product_id: ORG, quantity: 1, variant_id: OTHER_COMPANY },
      { product_id: ORG, quantity: 1, uom_code: 'CAJA' },
      { product_id: ORG, quantity: 1 },
    ])
    expect(items).toEqual([
      { product_id: ORG, quantity: 3, variant_id: COMPANY },
      { product_id: ORG, quantity: 1, variant_id: OTHER_COMPANY },
      { product_id: ORG, quantity: 1, uom_code: 'CAJA' },
      { product_id: ORG, quantity: 1 },
    ])
  })

  it('una variante que no es un uuid no pasa', () => {
    expectCode(
      () => normalizeOrderItems([{ product_id: ORG, quantity: 1, variant_id: 'la-roja' }]),
      'ITEM_INVALIDO',
      400,
    )
  })

  it('un codigo de unidad con formato ajeno al de la base no pasa', () => {
    expectCode(
      () => normalizeOrderItems([{ product_id: ORG, quantity: 1, uom_code: 'CAJA GRANDE' }]),
      'ITEM_INVALIDO',
      400,
    )
    expectCode(
      () => normalizeOrderItems([{ product_id: ORG, quantity: 1, uom_code: 'A'.repeat(17) }]),
      'ITEM_INVALIDO',
      400,
    )
  })

  it('una variante vacia o nula se lee como "sin variante", no como error', () => {
    expect(
      normalizeOrderItems([{ product_id: ORG, quantity: 1, variant_id: '', uom_code: null }]),
    ).toEqual([{ product_id: ORG, quantity: 1 }])
  })
})

describe('maquina de estados del pedido', () => {
  it('coincide exactamente con el trigger de la base', () => {
    const sql = readFileSync(
      join(HERE, '..', 'migrations', '20260827090400_orders.sql'),
      'utf8',
    )

    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      if (targets.length === 0) continue
      const clause = new RegExp(
        `when '${from}'\\s+then array\\[([^\\]]+)\\]`,
        'i',
      ).exec(sql)
      expect(clause, `falta la rama '${from}' en el trigger`).toBeTruthy()
      const inSql = (clause?.[1] ?? '')
        .split(',')
        .map((item) => item.trim().replace(/'/g, ''))
        .sort()
      expect(inSql).toEqual([...targets].sort())
    }
  })

  it('cancelado y reembolsado son estados finales', () => {
    expect(canTransition('cancelled', 'paid')).toBe(false)
    expect(canTransition('refunded', 'fulfilled')).toBe(false)
  })

  /**
   * P08-SaaS. Los dos ejes nuevos se comprueban igual que el de P02 y contra el
   * MISMO trigger que manda en produccion. Sin este test, la copia del borde
   * podria ofrecer una transicion que la base rechaza, y el operador veria un
   * 409 sobre un boton que la pantalla le dejo pulsar.
   */
  it('los ejes de pago y entrega coinciden con ebim.assert_order_axes', () => {
    const sql = readFileSync(
      join(HERE, '..', 'migrations', '20260828110000_oms_order_axes.sql'),
      'utf8',
    )

    const machines = { ...PAYMENT_TRANSITIONS, ...FULFILLMENT_TRANSITIONS } as Record<
      string,
      readonly string[]
    >

    for (const [from, targets] of Object.entries(machines)) {
      if (targets.length === 0) continue
      // `String.raw` en vez de doblar cada barra: la expresion se lee igual que
      // el SQL que busca, que es la mitad de por que este test es mantenible.
      const clause = new RegExp(
        String.raw`when '${from}'\s+then array\[([^\]]+)\]`,
        'i',
      ).exec(sql)
      expect(clause, `falta la rama '${from}' en ebim.assert_order_axes`).toBeTruthy()
      const inSql = (clause?.[1] ?? '')
        .split(',')
        .map((item) => item.trim().replace(/'/g, ''))
        .sort()
      expect(inSql, `la rama '${from}' no dice lo mismo`).toEqual([...targets].sort())
    }
  })

  it('nextForAxis no ofrece nunca el estado en el que ya se esta', () => {
    for (const axis of ['order_status', 'payment_status', 'fulfillment_status'] as const) {
      const from = axis === 'fulfillment_status' ? 'unfulfilled' : 'pending'
      expect(nextForAxis(axis, from)).not.toContain(from)
    }
    // Un estado final no ofrece nada, y un valor desconocido tampoco revienta.
    expect(nextForAxis('payment_status', 'refunded')).toEqual([])
    expect(nextForAxis('payment_status', 'inventado')).toEqual([])
  })

  it('un cambio a si mismo es idempotente, no un error', () => {
    expect(canTransition('paid', 'paid')).toBe(true)
  })
})

describe('matriz de roles', () => {
  it('coincide con los roles que exigen las policies del catalogo', () => {
    const sql = readFileSync(
      join(HERE, '..', 'migrations', '20260827090300_catalog.sql'),
      'utf8',
    )
    const rolesEnPolicy = [
      ...new Set(
        [...sql.matchAll(/array\[([^\]]+)\]::public\.app_role\[\]/g)].map((match) =>
          (match[1] ?? '').replace(/['\s]/g, ''),
        ),
      ),
    ]
    expect(rolesEnPolicy).toEqual(['owner,admin,catalog'])
    expect(ROLE_PERMISSIONS['catalog.write']).toEqual(['owner', 'admin', 'catalog'])
  })

  it('viewer no escribe nada', () => {
    for (const permission of Object.keys(ROLE_PERMISSIONS) as Array<
      keyof typeof ROLE_PERMISSIONS
    >) {
      expect(can('viewer', permission)).toBe(false)
    }
  })

  it('owner puede todo', () => {
    for (const permission of Object.keys(ROLE_PERMISSIONS) as Array<
      keyof typeof ROLE_PERMISSIONS
    >) {
      expect(can('owner', permission)).toBe(true)
    }
  })
})

describe('CORS', () => {
  it('el storefront publico permite cualquier origen', () => {
    expect(resolveAllowedOrigin('https://tienda.cliente.com', [])).toBe('*')
  })

  it('el backoffice solo permite origenes de la lista blanca', () => {
    const allowed = ['https://ecommerce.ebim.pe']
    expect(resolveAllowedOrigin('https://ecommerce.ebim.pe', allowed)).toBe(
      'https://ecommerce.ebim.pe',
    )
    expect(resolveAllowedOrigin('https://atacante.com', allowed)).toBeNull()
  })

  it('sin origen permitido no se emite Allow-Origin', () => {
    const headers = corsHeaders('https://atacante.com', {
      allowedOrigins: ['https://ecommerce.ebim.pe'],
    })
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
    expect(headers.Vary).toBe('Origin')
  })

  it('parsea la lista blanca del entorno', () => {
    expect(parseAllowedOrigins(' https://a.com , https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
    expect(parseAllowedOrigins(undefined)).toEqual([])
  })
})

describe('errores', () => {
  it('traduce los codigos de negocio de la base a HTTP', () => {
    expect(fromDatabaseError({ message: 'ADMIN_EMAIL_REQUERIDO: falta el correo' }).status).toBe(400)
    expect(fromDatabaseError({ message: 'TENANT_YA_EXISTE: ya existe' }).status).toBe(409)
    expect(fromDatabaseError({ message: 'STOCK_INSUFICIENTE: sin stock' }).status).toBe(409)
    expect(fromDatabaseError({ message: 'TIENDA_NO_DISPONIBLE: nope' }).status).toBe(404)
    // 2026-11-20 · PDF del comprobante: antes salían como 500 genérico.
    expect(fromDatabaseError({ message: 'COMPROBANTE_NO_ENCONTRADO: no existe', code: '22023' }).status).toBe(404)
    expect(fromDatabaseError({ message: 'PDF_NO_DISPONIBLE: aún no', code: '22023' }).status).toBe(404)
    expect(fromDatabaseError({ message: 'NO_AUTENTICADO: hace falta sesion', code: '42501' }).status).toBe(401)
  })

  it('una violacion de RLS es 403, no un 500 con detalle interno', () => {
    const error = fromDatabaseError({
      code: '42501',
      message: 'new row violates row-level security policy for table "products"',
    })
    expect(error.status).toBe(403)
    expect(error.message).not.toContain('row-level security')
  })

  it('un error desconocido no filtra el interno de Postgres', () => {
    const error = fromDatabaseError({
      code: 'XX000',
      message: 'relation "secreto_interno" does not exist at character 42',
    })
    expect(error.status).toBe(500)
    expect(error.message).toBe('Error interno')
  })

  it('toAppError respeta un AppError ya construido', () => {
    const original = new AppError('MIO', 'mensaje', 409)
    expect(toAppError(original)).toBe(original)
  })
})

describe('validacion de payload', () => {
  it('exige uuid donde toca', () => {
    expect(requireUuid({ store_id: ORG }, 'store_id')).toBe(ORG)
    expect(() => requireUuid({ store_id: 'abc' }, 'store_id')).toThrowError(/uuid/)
  })

  it('rechaza campos desconocidos en vez de descartarlos', () => {
    expectCode(() => rejectUnknownFields({ a: 1, sorpresa: 2 }, ['a']), 'CAMPO_NO_PERMITIDO')
    expect(() => rejectUnknownFields({ a: 1, sorpresa: 2 }, ['a'])).toThrowError(/sorpresa/)
  })
})

describe('direccion de entrega del checkout (P06)', () => {
  it('acepta la direccion sola y la referencia opcional', () => {
    expect(normalizeShippingAddress({ address: '  Av. Primavera 120  ' })).toEqual({
      address: 'Av. Primavera 120',
    })
    expect(
      normalizeShippingAddress({ address: 'Jr. Lima 45', reference: ' Frente al parque ' }),
    ).toEqual({ address: 'Jr. Lima 45', reference: 'Frente al parque' })
  })

  it('una referencia vacia no ensucia el pedido con una clave hueca', () => {
    expect(normalizeShippingAddress({ address: 'Jr. Lima 45', reference: '   ' })).toEqual({
      address: 'Jr. Lima 45',
    })
  })

  it('sin direccion no hay entrega', () => {
    expectCode(() => normalizeShippingAddress({}), 'CAMPO_INVALIDO')
    expectCode(() => normalizeShippingAddress({ address: 'ab' }), 'CAMPO_INVALIDO')
    expectCode(() => normalizeShippingAddress(null), 'CAMPO_INVALIDO')
    expectCode(() => normalizeShippingAddress('Av. Primavera 120'), 'CAMPO_INVALIDO')
  })

  it('no es un vertedero: los campos que no son de direccion se rechazan', () => {
    expectCode(
      () => normalizeShippingAddress({ address: 'Jr. Lima 45', total: '0.01' }),
      'CAMPO_NO_PERMITIDO',
    )
    expectCode(
      () => normalizeShippingAddress({ address: 'Jr. Lima 45', organization_id: ORG }),
      'CAMPO_NO_PERMITIDO',
    )
  })

  it('el punto del mapa: las dos coordenadas, en rango, a 6 decimales', () => {
    expect(
      normalizeShippingAddress({ address: 'Av. Larco 1200', latitude: -12.12551234, longitude: '-77.0300019' }),
    ).toEqual({ address: 'Av. Larco 1200', latitude: -12.125512, longitude: -77.030002 })
    expectCode(() => normalizeShippingAddress({ address: 'Av. Larco 1200', latitude: -12.1 }), 'CAMPO_INVALIDO')
    expectCode(
      () => normalizeShippingAddress({ address: 'Av. Larco 1200', latitude: 95, longitude: -77 }),
      'CAMPO_INVALIDO',
    )
    expectCode(
      () => normalizeShippingAddress({ address: 'Av. Larco 1200', latitude: 'norte', longitude: -77 }),
      'CAMPO_INVALIDO',
    )
  })

  it('corta los textos desmesurados en vez de guardarlos', () => {
    expectCode(() => normalizeShippingAddress({ address: 'x'.repeat(301) }), 'CAMPO_INVALIDO')
    expectCode(
      () => normalizeShippingAddress({ address: 'Jr. Lima 45', reference: 'x'.repeat(201) }),
      'CAMPO_INVALIDO',
    )
  })
})

describe('normalizeBillingAddress · datos del comprobante', () => {
  it('acepta la dirección más el comprobante, y deja el RUC en mayúsculas', () => {
    expect(
      normalizeBillingAddress({
        address: 'Av. Javier Prado 1234',
        country: 'pe',
        document_type: 'invoice',
        tax_id: ' 20131312955 ',
        legal_name: ' Policlínico Andino S.A.C. ',
        cost_center: 'CC-0412',
      }),
    ).toEqual({
      address: 'Av. Javier Prado 1234',
      country: 'PE',
      document_type: 'invoice',
      tax_id: '20131312955',
      legal_name: 'Policlínico Andino S.A.C.',
      cost_center: 'CC-0412',
      id_type: 'ruc',
    })
  })

  it('una factura sin RUC o sin razón social no se acepta', () => {
    expectCode(
      () => normalizeBillingAddress({ address: 'Jr. Lima 45', document_type: 'invoice', legal_name: 'ACME SAC' }),
      'CAMPO_INVALIDO',
    )
    expectCode(
      () => normalizeBillingAddress({ address: 'Jr. Lima 45', document_type: 'invoice', tax_id: '20131312955' }),
      'CAMPO_INVALIDO',
    )
  })

  it('factura: el RUC tiene que pasar su dígito verificador y ser RUC (2026-11-15)', () => {
    expectCode(
      () =>
        normalizeBillingAddress({
          address: 'Jr. Lima 45',
          document_type: 'invoice',
          tax_id: '20601234567',
          legal_name: 'ACME SAC',
        }),
      'CAMPO_INVALIDO',
    )
    expectCode(
      () =>
        normalizeBillingAddress({
          address: 'Jr. Lima 45',
          document_type: 'invoice',
          id_type: 'dni',
          tax_id: '45781236',
          legal_name: 'Ana Pérez',
        }),
      'CAMPO_INVALIDO',
    )
  })

  it('boleta: tipo y número de documento, con su forma', () => {
    expect(
      normalizeBillingAddress({
        address: 'Jr. Lima 45',
        document_type: 'receipt',
        id_type: 'dni',
        tax_id: '45781236',
        legal_name: 'Ana Pérez',
      }),
    ).toEqual({
      address: 'Jr. Lima 45',
      document_type: 'receipt',
      id_type: 'dni',
      tax_id: '45781236',
      legal_name: 'Ana Pérez',
    })
    expectCode(
      () =>
        normalizeBillingAddress({ address: 'Jr. Lima 45', document_type: 'receipt', id_type: 'dni', tax_id: '4578123' }),
      'CAMPO_INVALIDO',
    )
    expectCode(
      () => normalizeBillingAddress({ address: 'Jr. Lima 45', document_type: 'receipt', id_type: 'cedula', tax_id: '1' }),
      'CAMPO_INVALIDO',
    )
  })

  it('la boleta no pide RUC', () => {
    expect(normalizeBillingAddress({ address: 'Jr. Lima 45', document_type: 'receipt' })).toEqual({
      address: 'Jr. Lima 45',
      document_type: 'receipt',
    })
  })

  it('sigue sin ser un vertedero: tipo desconocido, RUC raro o claves ajenas se rechazan', () => {
    expectCode(() => normalizeBillingAddress({ address: 'Jr. Lima 45', document_type: 'ticket' }), 'CAMPO_INVALIDO')
    expectCode(() => normalizeBillingAddress({ address: 'Jr. Lima 45', tax_id: '2060 1234' }), 'CAMPO_INVALIDO')
    expectCode(() => normalizeBillingAddress({ address: 'Jr. Lima 45', total: '0.01' }), 'CAMPO_NO_PERMITIDO')
    expectCode(
      () => normalizeBillingAddress({ address: 'Jr. Lima 45', cost_center: 'x'.repeat(61) }),
      'CAMPO_INVALIDO',
    )
  })
})
