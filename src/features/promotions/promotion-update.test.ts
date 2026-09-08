import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Qué columnas viaja el `update` de una campaña, que resultó ser todo.
 *
 * ## El fallo que este archivo existe para que no vuelva
 *
 * `promotions` tiene GRANT **por columna** para `authenticated`: la RLS filtra
 * filas y nunca columnas, así que la migración enumera una a una las
 * actualizables. Mandar una que no esté en esa lista no da un aviso —da un
 * 42501 y tumba la consulta entera— aunque el valor enviado sea idéntico al que
 * ya estaba.
 *
 * El formulario mandaba la fila completa, con `kind` e `image_url` dentro.
 * Ninguna de las dos tiene GRANT de UPDATE, así que **editar cualquier campaña
 * existente fallaba** con «Tu rol no puede hacer ese cambio» — con un rol de
 * administrador, que es lo que hacía el mensaje incomprensible.
 *
 * `kind` es inmutable por diseño (los alcances y las escalas cuelgan de él por
 * clave ajena compuesta, y la pantalla ya bloquea el selector), así que no se
 * manda nunca. `image_url` sí es editable, y su GRANT llega en
 * `20260908220000`; hasta entonces solo viaja cuando de verdad cambia, para que
 * editar el resto de la campaña funcione igual.
 */

const captura = vi.hoisted(() => ({ tabla: '', patch: null as Record<string, unknown> | null }))

const cliente = {
  from(tabla: string) {
    captura.tabla = tabla
    return {
      update(patch: Record<string, unknown>) {
        captura.patch = patch
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }
  },
}

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => cliente,
  getSupabaseClient: () => cliente,
  tryGetStorefrontClient: () => cliente,
  tryGetStorefrontRpcClient: () => cliente,
  getStorefrontClient: () => cliente,
}))

const { updatePromotion } = await import('./api')

const SCOPE = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  storeId: '33333333-3333-4333-8333-333333333333',
}

const VALORES = {
  code: 'navidad',
  name: 'Navidad',
  description: '',
  imageUrl: 'tienda/promo.jpg',
  kind: 'percentage' as const,
  status: 'active' as const,
  priority: 10,
  stackGroup: '',
  isExclusive: false,
  requiresCoupon: false,
  valuePercent: '20',
  valueAmount: '',
  maxDiscountAmount: '',
  buyQuantity: '',
  freeQuantity: '',
  minSubtotal: '',
  minQuantity: '',
  validFrom: '2026-09-01T00:00',
  validTo: '',
  usageLimit: '',
  usageLimitPerCustomer: '',
}

beforeEach(() => {
  captura.tabla = ''
  captura.patch = null
})

describe('el update de una campaña manda solo lo que puede actualizar', () => {
  it('nunca manda `kind`: el tipo es inmutable después de crearla', async () => {
    await updatePromotion(SCOPE, 'aaaa1111-1111-4111-8111-111111111111', VALORES, {
      image_url: 'tienda/promo.jpg',
    })

    expect(captura.patch).not.toBeNull()
    expect(captura.patch).not.toHaveProperty('kind')
    // Y lo que sí se edita, va.
    expect(captura.patch).toMatchObject({ code: 'navidad', name: 'Navidad', value_percent: '20' })
  })

  it('no manda la foto si no cambió, que es lo que rompía la edición entera', async () => {
    await updatePromotion(SCOPE, 'aaaa1111-1111-4111-8111-111111111111', VALORES, {
      image_url: 'tienda/promo.jpg',
    })
    expect(captura.patch).not.toHaveProperty('image_url')
  })

  it('la manda cuando SÍ cambió: si no, cambiar la foto no haría nada', async () => {
    await updatePromotion(SCOPE, 'aaaa1111-1111-4111-8111-111111111111', VALORES, {
      image_url: 'tienda/otra.jpg',
    })
    expect(captura.patch?.image_url).toBe('tienda/promo.jpg')
  })

  it('el tenant tampoco viaja: mover una campaña de tenant no es una edición', async () => {
    await updatePromotion(SCOPE, 'aaaa1111-1111-4111-8111-111111111111', VALORES, null)

    expect(captura.patch).not.toHaveProperty('organization_id')
    expect(captura.patch).not.toHaveProperty('company_id')
    expect(captura.patch).not.toHaveProperty('store_id')
  })
})
