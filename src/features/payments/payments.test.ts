import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PAYMENT_METHOD_SET_SECRET_RPC,
  RECONCILIATION_IMPORT_RPC,
  REFUND_REQUEST_RPC,
} from '@/shared/lib/db-schema'
import { capability } from '@/domain/capabilities'
import { boundary } from '@/domain/boundaries'
import { mapPaymentsCode } from './errors'
import {
  INTENT_STATUSES,
  newIdempotencyKey,
  paymentIntentSchema,
  paymentMethodSchema,
  reconciliationSummarySchema,
} from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
const apiSource = readFileSync(join(HERE, 'api.ts'), 'utf8')

describe('el backoffice no mueve dinero por PostgREST', () => {
  /**
   * La garantía real está en la base —seis de las siete tablas no tienen GRANT
   * de escritura para `authenticated`— pero este test la sostiene desde el otro
   * lado: si alguien añadiera un `update` sobre `payments`, fallaría aquí y no
   * seis meses después con un 42501 en producción.
   */
  it('solo escribe la tabla de CONFIGURACION, nunca las de dinero', () => {
    const escrituras = [...apiSource.matchAll(/\.from\(([A-Z_]+)\)\s*\n?\s*\.(insert|update|delete)/g)]
    const tablas = new Set(escrituras.map((m) => m[1]))
    expect([...tablas]).toEqual(['PAYMENT_METHODS_TABLE'])
  })

  it('devolver y conciliar son comandos, no escrituras de tabla', () => {
    expect(apiSource).toMatch(/rpc\(REFUND_REQUEST_RPC/)
    expect(apiSource).toMatch(/rpc\(RECONCILIATION_IMPORT_RPC/)
    // Y los nombres salen del vocabulario de persistencia, no de un literal.
    expect(REFUND_REQUEST_RPC).toBe('payment_refund_request')
    expect(RECONCILIATION_IMPORT_RPC).toBe('payment_reconciliation_import')
  })

  it('la llave secreta de la pasarela va a Vault por comando, nunca a la tabla', () => {
    expect(apiSource).toMatch(/rpc\(PAYMENT_METHOD_SET_SECRET_RPC/)
    expect(PAYMENT_METHOD_SET_SECRET_RPC).toBe('payment_method_set_secret')
    // Ninguna columna de la tabla lleva la secreta: solo la pública y la pista.
    expect(apiSource).not.toMatch(/secret_key\s*:/)
    expect(apiSource).not.toMatch(/checkout_secret/)
  })

  it('ninguna consulta declara el tenant: la RLS decide', () => {
    // `organization_id` y `company_id` aparecen UNA vez, en el `insert` del
    // medio de pago, porque las columnas son NOT NULL. Nunca en un filtro.
    expect(apiSource).not.toMatch(/\.eq\(\s*'organization_id'/)
    expect(apiSource).not.toMatch(/\.eq\(\s*'company_id'/)
  })

  it('no pide ni proyecta un secreto ni el sobre crudo del proveedor', () => {
    // Se miran las COLUMNAS que se piden, no el texto del archivo: un
    // comentario que explique por qué `payload` no se proyecta no es una fuga.
    const columnas = [...apiSource.matchAll(/\.select\(\s*([\s\S]*?)\)\s*\n/g)]
      .map((m) => m[1] ?? '')
      .join(' ')
    for (const prohibido of ['secret_ref', 'provider_token_ref', 'api_key', 'payload', 'raw']) {
      expect(columnas, `se proyecta ${prohibido}`).not.toContain(prohibido)
    }
    expect(columnas).toContain('provider_reference')
  })
})

describe('la clave de idempotencia de una devolucion', () => {
  it('cumple el formato que exige la base y no se repite', () => {
    const a = newIdempotencyKey('refund')
    const b = newIdempotencyKey('refund')
    expect(a.length).toBeGreaterThanOrEqual(8)
    expect(a.length).toBeLessThanOrEqual(200)
    expect(a).not.toBe(b)
  })
})

describe('los esquemas de lectura', () => {
  it('el importe llega como TEXTO aunque Postgres lo mande como numero', () => {
    // `numeric` puede llegar como string o como number según el driver. Lo que
    // no puede pasar nunca es que un importe acabe siendo un `number` en la
    // ruta del dinero, así que el esquema lo normaliza a texto.
    const parsed = reconciliationSummarySchema.parse({
      imported: '2',
      duplicated: 0,
      matched: '1',
      discrepancy: 0,
      unmatched: 1,
    })
    expect(parsed.imported).toBe(2)
    expect(parsed.matched).toBe(1)
  })

  it('un medio de pago sin pasarela se lee como offline', () => {
    const method = paymentMethodSchema.parse({
      id: 'a',
      store_id: 'b',
      code: 'transferencia',
      kind: 'bank_transfer',
      display_name: 'Transferencia',
      provider_code: null,
      capture_mode: 'manual',
      is_active: true,
      position: 10,
      instructions: 'Transfiere a la cuenta...',
    })
    expect(method.provider_code).toBeNull()
    expect(method.capture_mode).toBe('manual')
  })

  it('un estado de cobro que la base no tiene se rechaza al leer', () => {
    const base = {
      intent_id: 'a',
      order_id: null,
      order_number: null,
      customer_email: null,
      order_payment_status: null,
      method_code: 'tarjeta',
      method_name: 'Tarjeta',
      method_kind: 'card',
      provider_code: 'sandbox',
      status: 'captured',
      capture_mode: 'automatic',
      currency: 'PEN',
      amount: '100.00',
      amount_captured: '100.00',
      amount_refunded: '0.00',
      provider_reference: 'sbx-1',
      last_error_code: null,
      created_at: '2026-08-28T00:00:00Z',
      attempt_count: 1,
      failed_attempt_count: 0,
      refund_count: 0,
    }
    expect(paymentIntentSchema.parse(base).status).toBe('captured')
    expect(() => paymentIntentSchema.parse({ ...base, status: 'inventado' })).toThrow()
  })

  it('la lista de estados es la misma que la del enum de la base', () => {
    // El enum vive en la migración 120000; aquí se escribe a mano porque de él
    // cuelgan los colores y el filtro. `supabase/tests/payments.test.ts` es
    // quien comprueba el otro lado contra Postgres.
    expect([...INTENT_STATUSES]).toEqual([
      'open',
      'processing',
      'requires_action',
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'expired',
    ])
  })
})

describe('traduccion de errores', () => {
  it('el codigo de negocio decide el mensaje, nunca el texto de Postgres', () => {
    expect(mapPaymentsCode('DEVOLUCION_EXCEDE_COBRO')).toBe('payments.error.refundTooLarge')
    expect(mapPaymentsCode('OPERADOR_NO_ES_ACTOR')).toBe('payments.error.forbidden')
    expect(mapPaymentsCode('DEVOLUCION_CON_PASARELA')).toBe('payments.error.forbidden')
    expect(mapPaymentsCode('COBRO_DE_OTRO_TENANT')).toBe('payments.error.crossTenant')
    expect(mapPaymentsCode('FIRMA_NO_VERIFICADA')).toBe('payments.error.untrusted')
    expect(mapPaymentsCode('RETORNO_NO_DECIDE')).toBe('payments.error.untrusted')
  })

  it('lo desconocido cae en el mensaje generico y no filtra el interno', () => {
    expect(mapPaymentsCode('42P01')).toBe('payments.error.generic')
    expect(mapPaymentsCode('ERROR_INTERNO')).toBe('payments.error.generic')
  })
})

describe('el mapa de dominios dice la verdad sobre pagos', () => {
  it('la frontera y la capacidad estan implementadas y apuntan a la feature', () => {
    const frontera = boundary('payments')
    expect(frontera.state).toBe('implemented')
    expect(frontera.paths).toContain('features/payments')
    expect(frontera.port).toBe('PaymentProvider')
    expect(capability('payments').state).toBe('implemented')
  })

  it('sigue siendo vendible: no se coló como baseline', () => {
    expect(capability('payments').entitlement).toBe('ecommerce.payments')
  })
})
