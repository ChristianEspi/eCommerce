import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FULFILLMENT_STATUSES as EDGE_FULFILLMENT_STATUSES,
  FULFILLMENT_TRANSITIONS as EDGE_FULFILLMENT,
  ORDER_AXES as EDGE_AXES,
  ORDER_STATUSES as EDGE_STATUSES,
  ORDER_TRANSITIONS as EDGE_TRANSITIONS,
  PAYMENT_STATUSES as EDGE_PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS as EDGE_PAYMENT,
  canTransition as edgeCanTransition,
  nextForAxis as edgeNextForAxis,
} from '../../../supabase/functions/_shared/orders'
import { ORDER_TRANSITION_RPC } from '@/shared/lib/db-schema'
import { UPDATE_ORDER_STATUS_FUNCTION } from './api'
import { mapOrderCode } from './errors'
import { MESSAGES } from '@/shared/i18n/messages.all'
import type { MessageKey } from '@/shared/i18n/messages'
import { sheetCells } from '@/shared/lib/excel'
import { ordersBook } from './exportExcel'
import { PAYMENT_LABEL } from './status'
import {
  FULFILLMENT_STATUSES,
  FULFILLMENT_TRANSITIONS,
  ORDER_AXES,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  customerSnapshotSchema,
  nextForAxis,
  nextStatuses,
  normalizeTag,
  orderItemSchema,
  orderSchema,
  rangeStart,
  shippingAddressSchema,
  type Order,
} from './types'

const HERE = dirname(fileURLToPath(import.meta.url))

const baseOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  organization_id: '22222222-2222-4222-8222-222222222222',
  company_id: '33333333-3333-4333-8333-333333333333',
  store_id: '44444444-4444-4444-8444-444444444444',
  order_number: 'A-000001',
  customer_name: 'Ana Compradora',
  customer_email: 'ana@compradora.com',
  customer_phone: '+51 999 111 222',
  status: 'pending',
  currency: 'PEN',
  subtotal: '200.00',
  tax_total: '36.00',
  shipping_total: '0.00',
  discount_total: '0.00',
  grand_total: '236.00',
  shipping_address: { address: 'Av. Primavera 120', reference: 'Portón verde' },
  notes: null,
  placed_at: '2026-08-20T15:04:00.000Z',
  updated_at: '2026-08-20T15:04:00.000Z',
}

const order = (patch: Partial<Order> = {}): Order => orderSchema.parse({ ...baseOrder, ...patch })

/**
 * La máquina de estados vive en TRES sitios: el trigger de la base (que es el
 * que manda), el borde en Deno y esta copia del navegador. Copias separadas se
 * separan solas — este test es el que lo impide, igual que `roles.test.ts` con
 * la matriz de capacidades.
 */
describe('maquina de estados del pedido', () => {
  it('los estados del front son los mismos que los del borde', () => {
    expect([...ORDER_STATUSES]).toEqual([...EDGE_STATUSES])
  })

  it('cada transicion permitida es la misma en las dos copias', () => {
    for (const status of ORDER_STATUSES) {
      expect([...ORDER_TRANSITIONS[status]]).toEqual([...EDGE_TRANSITIONS[status]])
    }
  })

  it('`nextStatuses` responde igual que `canTransition` del borde', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (from === to) continue
        expect(nextStatuses(from).includes(to)).toBe(edgeCanTransition(from, to))
      }
    }
  })

  it('la copia del front dice lo mismo que el trigger de la migracion 04', () => {
    const sql = readFileSync(
      join(HERE, '..', '..', '..', 'supabase', 'migrations', '20260827090400_orders.sql'),
      'utf8',
    )
    for (const [from, allowed] of Object.entries(ORDER_TRANSITIONS)) {
      if (allowed.length === 0) continue
      const line = new RegExp(
        `when '${from}'\\s*then array\\[${allowed.map((to) => `'${to}'`).join(',')}\\]`,
      )
      expect(sql.replace(/\s+/g, ' ').replace(/,\s+/g, ',')).toMatch(line)
    }
  })

  it('cancelado y reembolsado son finales', () => {
    expect(nextStatuses('cancelled')).toHaveLength(0)
    expect(nextStatuses('refunded')).toHaveLength(0)
  })
})

/**
 * P08-SaaS. Los dos ejes nuevos viven en los mismos TRES sitios y se comprueban
 * igual: la base manda (`ebim.assert_order_axes`, verificado en
 * `supabase/tests/edge-shared.test.ts`) y aquí se comparan las copias del borde
 * y del navegador entre sí.
 */
describe('los ejes de pago y entrega', () => {
  it('los vocabularios del front y del borde son el mismo', () => {
    expect([...PAYMENT_STATUSES]).toEqual([...EDGE_PAYMENT_STATUSES])
    expect([...FULFILLMENT_STATUSES]).toEqual([...EDGE_FULFILLMENT_STATUSES])
    expect([...ORDER_AXES]).toEqual([...EDGE_AXES])
  })

  it('cada transicion permitida es la misma en las dos copias', () => {
    for (const status of PAYMENT_STATUSES) {
      expect([...PAYMENT_TRANSITIONS[status]], status).toEqual([...EDGE_PAYMENT[status]])
    }
    for (const status of FULFILLMENT_STATUSES) {
      expect([...FULFILLMENT_TRANSITIONS[status]], status).toEqual([...EDGE_FULFILLMENT[status]])
    }
  })

  it('`nextForAxis` responde igual que la del borde para los tres ejes', () => {
    const values: Record<(typeof ORDER_AXES)[number], readonly string[]> = {
      order_status: ORDER_STATUSES,
      payment_status: PAYMENT_STATUSES,
      fulfillment_status: FULFILLMENT_STATUSES,
    }
    for (const axis of ORDER_AXES) {
      for (const from of values[axis]) {
        expect([...nextForAxis(axis, from)], `${axis}:${from}`).toEqual([
          ...edgeNextForAxis(axis, from),
        ])
      }
    }
  })

  it('un valor que este bundle no conoce no revienta la pantalla', () => {
    expect(nextForAxis('payment_status', 'estado_del_futuro')).toEqual([])
  })

  it('cobrado solo puede ir hacia una devolucion', () => {
    expect([...PAYMENT_TRANSITIONS.paid]).toEqual(['partially_refunded', 'refunded'])
  })

  it('despachado solo puede volver como devolucion', () => {
    expect([...FULFILLMENT_TRANSITIONS.fulfilled]).toEqual(['returned'])
  })
})

describe('snapshot de la linea y del cliente', () => {
  it('el impuesto sin registrar es NULL y no cero: no son lo mismo', () => {
    const line = orderItemSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      order_id: '22222222-2222-4222-8222-222222222222',
      sku: 'SKU-1',
      name: 'Algo',
      unit_price: '10.00',
      quantity: 1,
      line_total: '10.00',
    })
    expect(line.tax_rate).toBeNull()
    expect(line.tax_amount).toBeNull()
    // El descuento SÍ es cero por defecto: antes de P10 no existían.
    expect(line.discount_amount).toBe('0.00')
  })

  it('un snapshot de cliente con otra forma se lee vacio, no revienta', () => {
    expect(customerSnapshotSchema.parse('texto suelto')).toEqual({})
    expect(customerSnapshotSchema.parse({ account_name: 'Acme' })).toMatchObject({
      account_name: 'Acme',
    })
  })
})

describe('etiquetas', () => {
  it('normaliza acentos, mayusculas y espacios al formato de la base', () => {
    expect(normalizeTag('  Revisar Dirección ')).toBe('revisar-direccion')
    expect(normalizeTag('URGENTE')).toBe('urgente')
  })

  it('lo que no deja nada utilizable queda vacio y la api lo rechaza', () => {
    expect(normalizeTag('  ///  ')).toBe('')
  })

  it('nunca pasa de 40 caracteres, que es el limite del CHECK', () => {
    expect(normalizeTag('a'.repeat(80))).toHaveLength(40)
  })
})

describe('dinero del pedido', () => {
  it('un numeric que llega como texto se conserva tal cual', () => {
    expect(order().grand_total).toBe('236.00')
  })

  it('un numero se normaliza a texto con dos decimales — nunca se queda como float', () => {
    const parsed = order({ grand_total: 236.1 as unknown as string })
    expect(parsed.grand_total).toBe('236.10')
    expect(typeof parsed.grand_total).toBe('string')
  })
})

describe('direccion de entrega', () => {
  it('acepta la forma del checkout minimo', () => {
    expect(shippingAddressSchema.parse({ address: 'Calle 1', reference: 'Rojo' })).toEqual({
      address: 'Calle 1',
      reference: 'Rojo',
    })
  })

  it('un jsonb con otra forma no revienta la pantalla: se lee vacio', () => {
    expect(shippingAddressSchema.parse('texto suelto')).toEqual({})
    expect(shippingAddressSchema.parse(null)).toEqual({})
  })
})

describe('filtro de fecha', () => {
  const now = new Date('2026-08-27T18:30:00.000Z')

  it('«todas las fechas» no acota nada', () => {
    expect(rangeStart('all', now)).toBeNull()
  })

  it('«hoy» arranca a medianoche, no hace 24 horas', () => {
    const start = new Date(rangeStart('today', now) as string)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getDate()).toBe(now.getDate())
  })

  it('los rangos incluyen el dia de hoy: 7 dias son hoy y los 6 anteriores', () => {
    const week = new Date(rangeStart('week', now) as string)
    const today = new Date(rangeStart('today', now) as string)
    const days = Math.round((today.getTime() - week.getTime()) / 86_400_000)
    expect(days).toBe(6)
  })
})

describe('exportacion a Excel', () => {
  const t = (key: MessageKey) => MESSAGES.es[key] ?? key
  const sheetOf = (orders: Order[]) => ordersBook(orders, t, 'pedidos').sheets[0]!
  const valueAt = (orders: Order[], header: string) => {
    const sheet = sheetOf(orders)
    return sheet.rows[0]?.[sheet.columns.findIndex((column) => column.header === header)]
  }

  it('lleva los importes como NUMERO, sin simbolo de moneda en la celda', () => {
    expect(valueAt([order()], 'Total')).toBe(236)
    const sheet = sheetOf([order()])
    expect(sheet.rows[0]?.some((cell) => typeof cell === 'string' && cell.includes('S/'))).toBe(false)
  })

  it('cabeceras claras y estados traducidos, no las claves internas', () => {
    const headers = sheetOf([order()]).columns.map((column) => column.header)
    expect(headers).toContain('N.º de pedido')
    expect(headers).toContain('Pago')
    expect(headers).not.toContain('payment_status')
    expect(valueAt([order()], 'Pago')).toBe(t(PAYMENT_LABEL[order().payment_status]))
  })

  it('un nombre con forma de formula se escribe como texto, nunca como formula', () => {
    const sheet = sheetOf([order({ customer_name: '=1+1' })])
    const at = sheet.columns.findIndex((column) => column.header === 'Cliente')
    expect(sheetCells(sheet)[1]?.[at]).toMatchObject({ value: '=1+1', type: String })
  })

  it('junta direccion y referencia en una sola celda', () => {
    expect(valueAt([order()], 'Dirección de envío')).toBe('Av. Primavera 120 — Portón verde')
  })

  it('la fecha es fecha de Excel, no el texto ISO', () => {
    expect(valueAt([order()], 'Fecha')).toBeInstanceOf(Date)
  })
})

describe('traduccion de errores', () => {
  it('una transicion imposible se explica, no cae en el generico', () => {
    expect(mapOrderCode('ORDER_TRANSICION_INVALIDA')).toBe('orders.error.transition')
  })

  it('los importes inmutables tienen su propio mensaje', () => {
    expect(mapOrderCode('ORDER_IMPORTES_INMUTABLES')).toBe('orders.error.amounts')
  })

  it('un codigo desconocido no se enseña crudo', () => {
    expect(mapOrderCode('42P01')).toBe('orders.error.generic')
  })
})

/**
 * El encargo P07 es explícito: los cambios de estado pasan SOLO por
 * `update-order-status`. Una regla que solo vive en un comentario se rompe en la
 * siguiente pantalla, así que se comprueba sobre el código del propio módulo.
 */
describe('el backoffice no escribe pedidos por PostgREST', () => {
  // Se quitan los comentarios antes de mirar: este mismo archivo NOMBRA la
  // llamada prohibida para explicar por qué no está, y un escáner que no
  // distingue código de prosa daría un falso positivo con su propia doc.
  const source = readFileSync(join(HERE, 'api.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  /**
   * Desde P08 el módulo SÍ escribe por PostgREST — pero solo en las tres tablas
   * de anotaciones (`order_notes`, `order_tags`, `order_external_refs`), que
   * nacieron con su policy de rol para eso. La regla original —«sobre el pedido
   * no se escribe»— no se afloja: se hace más precisa, porque un
   * `not.toMatch(/\.insert\(/)` sobre el archivo entero dejaría de decir nada
   * sobre `orders` en cuanto el módulo tocara cualquier otra tabla.
   */
  const WRITABLE_TABLES = [
    'ORDER_NOTES_TABLE',
    'ORDER_TAGS_TABLE',
    'ORDER_EXTERNAL_REFS_TABLE',
  ]

  it('ninguna consulta hace `update` — ni sobre el pedido ni sobre nada', () => {
    // El pedido no se edita nunca desde aquí, y las anotaciones tampoco: una
    // nota reescrita deja de ser una nota, y una etiqueta es un booleano con
    // nombre. Lo único editable en la base son las referencias externas, y esa
    // pantalla todavía no existe.
    expect(source).not.toMatch(/\.update\(/)
  })

  it('`insert` y `delete` solo caen sobre las tablas de anotaciones', () => {
    const chains = [...source.matchAll(/\.from\((\w+)\)([\s\S]{0,200})/g)]
    expect(chains.length).toBeGreaterThan(0)
    for (const [, table, tail] of chains) {
      if (!table || !tail) continue
      if (!/\.(insert|update|delete|upsert)\(/.test(tail)) continue
      expect(WRITABLE_TABLES, `${table} no puede escribirse desde el navegador`).toContain(table)
    }
  })

  it('el pedido y sus lineas se leen y nunca se escriben', () => {
    for (const table of ['ORDERS_TABLE', 'ORDER_ITEMS_TABLE', 'ORDER_TIMELINE_TABLE']) {
      const chains = [
        ...source.matchAll(new RegExp(String.raw`\.from\(${table}\)([\s\S]{0,200})`, 'g')),
      ]
      expect(chains.length, table).toBeGreaterThan(0)
      for (const [, tail] of chains) {
        expect(tail, table).not.toMatch(/\.(insert|update|delete|upsert)\(/)
      }
    }
  })

  it('el unico camino de escritura es la Edge Function', () => {
    // Desde P01 el nombre de la funcion vive en `shared/lib/db-schema.ts`, asi
    // que se comprueba el VALOR importado en vez de buscar el literal en este
    // archivo: si alguien apunta la constante a otra funcion, esto falla, y un
    // `toContain` sobre el fuente no lo habria visto.
    expect(UPDATE_ORDER_STATUS_FUNCTION).toBe('update-order-status')
    expect(source).toMatch(/functions\.invoke\(UPDATE_ORDER_STATUS_FUNCTION/)
  })

  it('el cuerpo que sale del navegador no lleva tenant ni importes', () => {
    const body = source.slice(source.indexOf('export async function updateOrderStatus'))
    for (const forbidden of ['organization_id', 'company_id', 'store_id', 'grand_total', 'subtotal']) {
      expect(body).not.toContain(forbidden)
    }
  })

  /**
   * P08. Los tres ejes nuevos no tienen GRANT de escritura en `orders`, así que
   * el comando no es «la forma recomendada»: es la única. Esta prueba fija que
   * la llamada existe y que su payload no declara nada que decida el servidor.
   */
  it('las transiciones pasan por el comando `order_transition`, sin tenant', () => {
    expect(ORDER_TRANSITION_RPC).toBe('order_transition')
    expect(source).toMatch(/rpc\(ORDER_TRANSITION_RPC/)
    const body = source.slice(
      source.indexOf('export async function transitionOrder'),
      source.indexOf('export interface ApprovalInput'),
    )
    for (const forbidden of [
      'organization_id',
      'company_id',
      'store_id',
      'p_from',
      'grand_total',
      'subtotal',
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })
})
