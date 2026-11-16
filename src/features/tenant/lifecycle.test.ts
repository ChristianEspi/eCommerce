import { describe, expect, it } from 'vitest'
import { classifyErrorCode } from '@/domain/errors'
import { UiError, codeFromDbError } from '@/shared/lib/appError'
import { suspensionMessageKey } from './lifecycle'

/**
 * lifecycle.v1 en la UI: el aviso dice la causa y cualquier pantalla traduce
 * `TENANT_SUSPENDED` a un mensaje claro sin conocer el código.
 */
describe('cuenta suspendida (lifecycle.v1)', () => {
  it('con impago, el aviso pide regularizar el pago con el proveedor', () => {
    expect(suspensionMessageKey('NON_PAYMENT')).toBe('tenantLifecycle.suspended.nonPayment')
    expect(suspensionMessageKey('MANUAL')).toBe('tenantLifecycle.suspended.manual')
    expect(suspensionMessageKey('TERMINATED')).toBe('tenantLifecycle.suspended.terminated')
    expect(suspensionMessageKey(null)).toBe('tenantLifecycle.suspended.manual')
  })

  it('el error de la base se lee como TENANT_SUSPENDED, por mensaje o por SQLSTATE PT423', () => {
    expect(codeFromDbError({ code: 'PT423', message: 'TENANT_SUSPENDED: la cuenta esta suspendida' })).toBe('TENANT_SUSPENDED')
    expect(codeFromDbError({ code: 'PT423', message: 'sin prefijo' })).toBe('TENANT_SUSPENDED')
    expect(classifyErrorCode('TENANT_SUSPENDED')).toBe('forbidden')
  })

  it('cualquier UiError con TENANT_SUSPENDED muestra el aviso transversal; la vitrina conserva el suyo', () => {
    const admin = new UiError({ boundary: 'catalog', key: 'common.error.body', code: 'TENANT_SUSPENDED' })
    expect(admin.key).toBe('tenantLifecycle.error')
    expect(admin.retryable).toBe(false)
    const store = new UiError({ boundary: 'checkout', key: 'tenantLifecycle.error.store', code: 'TENANT_SUSPENDED' })
    expect(store.key).toBe('tenantLifecycle.error.store')
    const other = new UiError({ boundary: 'catalog', key: 'common.error.body', code: 'DUPLICADO' })
    expect(other.key).toBe('common.error.body')
  })
})
