import { describe, expect, it } from 'vitest'
import { CAPABILITIES, boundaryForPath } from '@/domain'
import {
  ALERT_SEVERITY,
  MANUAL_MOVEMENT_KINDS,
  MOVEMENT_KINDS,
  compareAlerts,
  formatQuantity,
  movementFormSchema,
  policyFormSchema,
  quantityText,
  requiredSign,
  signMatches,
  staleInterval,
  warehouseFormSchema,
  type InventoryAlert,
} from './types'
import { inventoryErrorFromDb, mapInventoryCode } from './errors'

/**
 * Reglas PURAS del inventario en el cliente.
 *
 * Ninguna de estas decide una existencia: eso vive en el servidor y se prueba
 * contra Postgres real (`supabase/tests/inventory.test.ts`). Lo que se prueba
 * aquí es lo que solo existe en el navegador —la validación que evita el viaje,
 * el orden en que se presentan los avisos y la traducción de un código de error
 * a algo que el operador pueda hacer— y que, si se rompiera, no fallaría en
 * ningún test de base.
 */

describe('cantidades', () => {
  it('un `numeric` de Postgres llega como texto y se convierte una sola vez', () => {
    expect(quantityText.parse('12.500000')).toBe(12.5)
    expect(quantityText.parse(7)).toBe(7)
  })

  it('se presenta sin decimales cuando no los tiene', () => {
    expect(formatQuantity(12)).toBe('12')
    expect(formatQuantity(12.5)).toBe('12.5')
    // Seis decimales es la precisión de la columna; más sería ruido.
    expect(formatQuantity(1 / 3)).toBe('0.333333')
  })
})

describe('el signo tiene que decir lo mismo que el motivo', () => {
  it('una entrada es positiva y una salida por traslado es negativa', () => {
    expect(requiredSign('receipt')).toBe('positive')
    expect(requiredSign('return')).toBe('positive')
    expect(requiredSign('transfer_in')).toBe('positive')
    expect(requiredSign('transfer_out')).toBe('negative')
    // Un ajuste puede ir en los dos sentidos: para eso es un ajuste.
    expect(requiredSign('adjustment')).toBe('any')
  })

  it('cero nunca vale: un movimiento de cero no es un movimiento', () => {
    for (const kind of MANUAL_MOVEMENT_KINDS) {
      expect(signMatches(kind, 0)).toBe(false)
    }
  })

  it('el formulario rechaza la entrada negativa antes de que viaje', () => {
    const values = {
      warehouse_id: '11111111-1111-4111-8111-111111111111',
      product_id: '22222222-2222-4222-8222-222222222222',
      variant_id: null,
      kind: 'receipt' as const,
      quantity: -5,
      reason: '',
    }
    const result = movementFormSchema.safeParse(values)
    expect(result.success).toBe(false)
    expect(result.success === false && result.error.issues[0]?.message).toBe('inventory.error.sign')

    expect(movementFormSchema.safeParse({ ...values, quantity: 5 }).success).toBe(true)
  })

  it('la salida por venta no está entre lo que se escribe a mano', () => {
    expect(MOVEMENT_KINDS).toContain('issue')
    expect(MANUAL_MOVEMENT_KINDS as readonly string[]).not.toContain('issue')
    // El recuento tampoco: es el saldo absoluto que manda el sistema externo.
    expect(MANUAL_MOVEMENT_KINDS as readonly string[]).not.toContain('count')
  })
})

describe('el almacén local no caduca', () => {
  const base = {
    code: 'LIMA',
    name: 'CD Lima',
    kind: 'warehouse' as const,
    stale_policy: 'unknown' as const,
    allows_backorder: false,
    priority: 100,
    is_active: true,
    is_default: false,
    city: '',
    country: '',
  }

  it('poner una caducidad a un almacén local es un error del formulario', () => {
    const result = warehouseFormSchema.safeParse({
      ...base,
      source: 'local' as const,
      stale_minutes: 90,
    })
    expect(result.success).toBe(false)
    expect(result.success === false && result.error.issues[0]?.message).toBe(
      'inventory.error.staleLocal',
    )
  })

  it('en uno del ERP sí se admite, y sin caducidad también', () => {
    expect(
      warehouseFormSchema.safeParse({ ...base, source: 'erp' as const, stale_minutes: 90 }).success,
    ).toBe(true)
    expect(
      warehouseFormSchema.safeParse({ ...base, source: 'erp' as const, stale_minutes: null }).success,
    ).toBe(true)
  })

  it('un código con espacios o acentos no pasa', () => {
    for (const code of ['CD LIMA', 'almacén', '']) {
      const result = warehouseFormSchema.safeParse({
        ...base,
        code,
        source: 'local' as const,
        stale_minutes: null,
      })
      expect(`${code}: ${result.success}`).toBe(`${code}: false`)
    }
  })

  it('los minutos se traducen al intervalo que Postgres entiende', () => {
    expect(staleInterval(90)).toBe('90 minutes')
    expect(staleInterval(null)).toBeNull()
    expect(staleInterval(0)).toBeNull()
    expect(staleInterval(Number.NaN)).toBeNull()
  })
})

describe('el colchón y el umbral no pueden ser negativos', () => {
  const base = {
    warehouse_id: '11111111-1111-4111-8111-111111111111',
    product_id: '22222222-2222-4222-8222-222222222222',
    variant_id: null,
  }

  it('cero sí, menos que cero no', () => {
    expect(policyFormSchema.safeParse({ ...base, safety_stock: 0, reorder_point: 0 }).success).toBe(
      true,
    )
    expect(policyFormSchema.safeParse({ ...base, safety_stock: -1, reorder_point: 0 }).success).toBe(
      false,
    )
  })
})

describe('los avisos se ordenan por lo que de verdad urge', () => {
  function alert(kind: InventoryAlert['kind'], sku: string): InventoryAlert {
    return {
      store_id: '55555555-5555-4555-8555-555555555555',
      warehouse_id: null,
      warehouse_code: null,
      product_id: '66666666-6666-4666-8666-666666666666',
      variant_id: null,
      sku,
      name: sku,
      kind,
      available_qty: null,
      reorder_point: null,
      synced_at: null,
    }
  }

  it('un descuadre pesa más que un umbral de prudencia', () => {
    expect(ALERT_SEVERITY.negative).toBeGreaterThan(ALERT_SEVERITY.below_reorder)
    expect(ALERT_SEVERITY.unmapped).toBeGreaterThan(ALERT_SEVERITY.stale)
  })

  it('el orden es por urgencia y, a igualdad, por SKU', () => {
    const sorted = [
      alert('below_reorder', 'A-3'),
      alert('stale', 'A-2'),
      alert('unmapped', 'A-4'),
      alert('negative', 'A-9'),
      alert('below_reorder', 'A-1'),
    ].sort(compareAlerts)

    expect(sorted.map((a) => `${a.kind}:${a.sku}`)).toEqual([
      'negative:A-9',
      'unmapped:A-4',
      'stale:A-2',
      'below_reorder:A-1',
      'below_reorder:A-3',
    ])
  })
})

describe('los códigos del servidor se traducen a algo accionable', () => {
  it('«no se sabe» NO se cuenta como «no hay»', () => {
    // Es la distinción de la fase: decirle al operador que no hay existencia
    // cuando lo que pasa es que su ERP no contesta le hace buscar el problema
    // donde no está.
    expect(mapInventoryCode('DISPONIBILIDAD_DESCONOCIDA')).toBe('inventory.error.unknown')
    expect(mapInventoryCode('STOCK_INSUFICIENTE')).toBe('inventory.error.insufficient')
    expect(mapInventoryCode('DISPONIBILIDAD_DESCONOCIDA')).not.toBe(
      mapInventoryCode('STOCK_INSUFICIENTE'),
    )
  })

  it('«no contratado» tampoco es «sin permiso»', () => {
    expect(mapInventoryCode('MODULO_NO_CONTRATADO')).toBe('inventory.error.notEntitled')
    expect(mapInventoryCode('SIN_PERMISO')).toBe('inventory.error.forbidden')
  })

  it('un código desconocido cae en el genérico y no revienta', () => {
    expect(mapInventoryCode('ALGO_QUE_NADIE_ESCRIBIO')).toBe('inventory.error.generic')
  })
})

describe('el dominio declara lo que esta fase construyó', () => {
  it('`inventory.multiwarehouse` deja de ser una promesa', () => {
    const capability = CAPABILITIES.find((c) => c.id === 'inventory.multiwarehouse')
    expect(capability?.state).toBe('implemented')
    expect(capability?.entitlement).toBe('ecommerce.inventory.multiwarehouse')
  })

  it('la carpeta pertenece a la frontera de inventario', () => {
    expect(boundaryForPath('features/inventory/api.ts')?.id).toBe('inventory')
  })
})

describe('inventoryErrorFromDb — físico bajo cero', () => {
  it('el CHECK de inventory_levels se explica como existencia insuficiente', () => {
    const error = inventoryErrorFromDb({
      code: '23514',
      message: 'new row for relation "inventory_levels" violates check constraint "inventory_levels_on_hand_qty_check"',
    })
    expect(error.key).toBe('inventory.error.insufficient')
  })

  it('otro 23514 sigue siendo un dato inválido', () => {
    expect(inventoryErrorFromDb({ code: '23514', message: 'violates check constraint "warehouses_code_check"' }).key).toBe(
      'inventory.error.invalid',
    )
  })
})

