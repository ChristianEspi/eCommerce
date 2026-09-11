import { describe, expect, it } from 'vitest'
import {
  BUSINESS_ROLES,
  accountFormSchema,
  accountToForm,
  accountUserFormSchema,
  addressFormSchema,
  addressToForm,
  approvalRuleFormSchema,
  businessCan,
  contactFormSchema,
  customerFormSchema,
  customerToForm,
  externalIdFormSchema,
  formatAddress,
  preferredAddress,
  toCustomerCode,
  type CustomerAddress,
} from './types'

/**
 * Reglas del dominio de clientes que viven en el cliente (P05-SaaS).
 *
 * Lo que NO está aquí es tan importante como lo que está: no hay una sola
 * prueba de «este importe necesita aprobación» ni de «este cliente paga X»,
 * porque ninguna de esas decisiones se toma en el navegador. Las prueba
 * `supabase/tests/customers.test.ts` contra Postgres, que es donde se deciden.
 *
 * Lo que sí se comprueba: las reglas de FORMULARIO —las mismas que impone la
 * base, adelantadas para que nadie descubra un CHECK por un error de Postgres—
 * y las de PRESENTACIÓN, que no mueven ni dinero ni permisos.
 */

function address(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    customer_id: '22222222-2222-4222-8222-222222222222',
    label: 'Almacén',
    recipient: null,
    phone: null,
    line1: 'Av. Siempre Viva 742',
    line2: null,
    city: 'Lima',
    region: null,
    postal_code: null,
    country: 'PE',
    is_shipping: true,
    is_billing: false,
    is_default_shipping: false,
    is_default_billing: false,
    verification: 'unverified',
    verified_at: null,
    verification_source: null,
    external_ref: null,
    is_active: true,
    ...overrides,
  }
}

describe('roles de una cuenta B2B', () => {
  it('son cuatro y su orden es el de capacidad', () => {
    expect([...BUSINESS_ROLES]).toEqual(['admin', 'approver', 'buyer', 'viewer'])
  })

  /**
   * La separación de funciones es el motivo entero de que existan las reglas de
   * aprobación: un comprador que además aprueba lo suyo las vuelve decorativas.
   */
  it('el comprador NO aprueba y el aprobador NO compra', () => {
    expect(businessCan('buyer', 'purchase')).toBe(true)
    expect(businessCan('buyer', 'approve')).toBe(false)
    expect(businessCan('approver', 'approve')).toBe(true)
    expect(businessCan('approver', 'purchase')).toBe(false)
  })

  it('el administrador de la cuenta puede todo lo suyo, el observador solo mira', () => {
    for (const permission of ['account.manage', 'purchase', 'approve', 'read'] as const) {
      expect(`admin ${permission}: ${businessCan('admin', permission)}`).toBe(
        `admin ${permission}: true`,
      )
    }
    expect(businessCan('viewer', 'read')).toBe(true)
    expect(businessCan('viewer', 'purchase')).toBe(false)
    expect(businessCan('viewer', 'account.manage')).toBe(false)
  })

  it('sin rol no hay permiso: la ausencia de vínculo nunca se lee como permiso', () => {
    expect(businessCan(null, 'read')).toBe(false)
    expect(businessCan(undefined, 'purchase')).toBe(false)
  })
})

describe('presentación', () => {
  it('el código sugerido sale del nombre y aguanta acentos y símbolos', () => {
    expect(toCustomerCode('Acme Perú S.A.C.')).toBe('ACME-PERU-S-A-C')
    expect(toCustomerCode('  ')).toBe('')
    expect(toCustomerCode('x'.repeat(80)).length).toBeLessThanOrEqual(41)
  })

  it('la dirección se lee sin huecos aunque falten campos', () => {
    expect(formatAddress(address({ city: null, region: null }))).toBe('Av. Siempre Viva 742, PE')
    expect(formatAddress(address())).toBe('Av. Siempre Viva 742, Lima, PE')
  })

  it('la preferida es la marcada por defecto para ESE uso', () => {
    const primera = address({ id: 'a1' } as Partial<CustomerAddress>)
    const marcada = address({ id: 'a2', is_default_shipping: true } as Partial<CustomerAddress>)
    expect(preferredAddress([primera, marcada], 'shipping')?.id).toBe('a2')
  })

  it('sin marcada, la primera que sirva; y las inactivas no sirven', () => {
    const inactiva = address({ id: 'a1', is_active: false } as Partial<CustomerAddress>)
    const activa = address({ id: 'a2' } as Partial<CustomerAddress>)
    expect(preferredAddress([inactiva, activa], 'shipping')?.id).toBe('a2')
  })

  /**
   * Devolver `null` en vez de «la primera que haya» es la diferencia entre no
   * preseleccionar nada y facturarle a un almacén.
   */
  it('si ninguna sirve para ese uso, no se inventa una', () => {
    expect(preferredAddress([address()], 'billing')).toBeNull()
  })
})

describe('formulario de cliente', () => {
  it('acepta una ficha mínima y normaliza los vacíos', () => {
    const parsed = customerFormSchema.safeParse(customerToForm(null))
    expect(parsed.success).toBe(false) // sin nombre ni código no hay ficha
  })

  it('el código admite el formato de un ERP y rechaza espacios', () => {
    const base = { ...customerToForm(null), name: 'Acme' }
    expect(customerFormSchema.safeParse({ ...base, code: 'CLI-0001' }).success).toBe(true)
    expect(customerFormSchema.safeParse({ ...base, code: 'cli.0001' }).success).toBe(true)
    expect(customerFormSchema.safeParse({ ...base, code: 'con espacio' }).success).toBe(false)
  })

  it('el correo es opcional pero, si está, tiene que parecerlo', () => {
    const base = { ...customerToForm(null), name: 'Acme', code: 'ACME' }
    expect(customerFormSchema.safeParse({ ...base, email: '' }).success).toBe(true)
    expect(customerFormSchema.safeParse({ ...base, email: 'no-es-un-correo' }).success).toBe(false)
    expect(customerFormSchema.safeParse({ ...base, email: 'a@b.com' }).success).toBe(true)
  })
})

describe('formulario de dirección: las tres reglas que la base impone', () => {
  const base = { ...addressToForm(null), label: 'Almacén', line1: 'Av. Siempre Viva 742' }

  it('una dirección sin uso no se guarda', () => {
    const parsed = addressFormSchema.safeParse({ ...base, is_shipping: false, is_billing: false })
    expect(parsed.success).toBe(false)
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe('customers.error.addressUse')
  })

  it('no se puede marcar por defecto un uso que la dirección no tiene', () => {
    const parsed = addressFormSchema.safeParse({
      ...base,
      is_billing: false,
      is_default_billing: true,
    })
    expect(parsed.success).toBe(false)
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe('customers.error.defaultUse')
  })

  it('el país es el código ISO de dos letras y se normaliza a mayúsculas', () => {
    const parsed = addressFormSchema.safeParse({ ...base, country: 'pe' })
    expect(parsed.success && parsed.data.country).toBe('PE')
    expect(addressFormSchema.safeParse({ ...base, country: 'Perú' }).success).toBe(false)
  })

  it('los cuatro estados de verificación son los del enum de la base', () => {
    for (const state of ['unverified', 'pending', 'verified', 'rejected'] as const) {
      expect(addressFormSchema.safeParse({ ...base, verification: state }).success).toBe(true)
    }
    expect(addressFormSchema.safeParse({ ...base, verification: 'quizas' }).success).toBe(false)
  })
})

describe('formulario de contacto y de identificador externo', () => {
  it('un contacto necesita correo o teléfono', () => {
    const base = { name: 'Ana', email: '', phone: '', role_title: '', is_primary: false, is_active: true }
    expect(contactFormSchema.safeParse(base).success).toBe(false)
    expect(contactFormSchema.safeParse({ ...base, phone: '999888777' }).success).toBe(true)
    expect(contactFormSchema.safeParse({ ...base, email: 'ana@acme.com' }).success).toBe(true)
  })

  it('el código de sistema se normaliza a minúsculas', () => {
    const parsed = externalIdFormSchema.safeParse({
      system_code: 'ERP',
      external_id: 'C-0001',
      notes: '',
    })
    expect(parsed.success && parsed.data.system_code).toBe('erp')
  })
})

describe('formulario de cuenta B2B y de sus reglas', () => {
  it('un umbral sin el control encendido no se guarda', () => {
    const base = { ...accountToForm(null, 'Acme'), code: 'ACME' }
    const parsed = accountFormSchema.safeParse({ ...base, approval_threshold: '500.00' })
    expect(parsed.success).toBe(false)
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe(
      'customers.error.thresholdNeedsControl',
    )
    expect(
      accountFormSchema.safeParse({
        ...base,
        requires_approval: true,
        approval_threshold: '500.00',
      }).success,
    ).toBe(true)
  })

  it('el vínculo se pide por CORREO: ya no hay que pegar un identificador', () => {
    /**
     * Este test estaba invertido, y con razón en su momento.
     *
     * Exigía un uuid en `user_id` porque el vínculo se creaba insertando la
     * fila desde el navegador, y para eso hacía falta el identificador. El
     * problema es que ese identificador no se enseña en ninguna pantalla y el
     * hub que iba a emitirlo no está conectado: la ayuda decía «pega el
     * identificador que emite el hub» y no había de dónde sacarlo.
     *
     * Ahora la traducción de correo a identidad la hace el servidor, que además
     * comprueba quién pregunta. El formulario ya no necesita el uuid, y exigirlo
     * dejaría la pantalla inservible otra vez.
     */
    const base = {
      user_id: '',
      email: 'compras@acme.com',
      role: 'buyer' as const,
      spending_limit: '',
      status: 'invited' as const,
      default_location_id: '',
    }
    expect(accountUserFormSchema.safeParse(base).success).toBe(true)

    // Y el correo sigue siendo obligatorio: es lo único que identifica ahora.
    expect(accountUserFormSchema.safeParse({ ...base, email: 'no-es-correo' }).success).toBe(false)
  })

  /** Contrato §13: la suite no compra en nombre de un cliente. */
  it('una cuenta @ebim.pe no se puede vincular', () => {
    const parsed = accountUserFormSchema.safeParse({
      user_id: '33333333-3333-4333-8333-333333333333',
      email: 'operador@ebim.pe',
      role: 'admin' as const,
      spending_limit: '',
      status: 'active' as const,
      default_location_id: '',
    })
    expect(parsed.success).toBe(false)
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe('customers.error.suiteEmail')
  })

  it('un observador no puede ser el aprobador de una regla', () => {
    const base = { name: 'Desde 500', min_amount: '500.00', is_active: true }
    expect(approvalRuleFormSchema.safeParse({ ...base, approver_role: 'approver' }).success).toBe(true)
    expect(approvalRuleFormSchema.safeParse({ ...base, approver_role: 'viewer' }).success).toBe(false)
  })

  it('el importe admite dos decimales y nada más', () => {
    const base = { name: 'Regla', approver_role: 'approver' as const, is_active: true }
    expect(approvalRuleFormSchema.safeParse({ ...base, min_amount: '1000' }).success).toBe(true)
    expect(approvalRuleFormSchema.safeParse({ ...base, min_amount: '1000.5' }).success).toBe(true)
    expect(approvalRuleFormSchema.safeParse({ ...base, min_amount: '1000.555' }).success).toBe(false)
    expect(approvalRuleFormSchema.safeParse({ ...base, min_amount: '-10' }).success).toBe(false)
  })
})
