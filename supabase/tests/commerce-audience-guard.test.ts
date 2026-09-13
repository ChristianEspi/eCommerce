// @vitest-environment node
/**
 * Guarda de H01: declarar una audiencia o una cuenta no cambia nada.
 *
 * La vitrina pinta «cuenta comercial» o «comprando para» a partir de lo que el
 * servidor ya autorizó. Este archivo defiende la otra mitad: que un navegador
 * que intente DECLARAR ese contexto en el checkout sea rechazado en la puerta,
 * no ignorado en silencio. Ignorarlo sería esconder el intento; rechazarlo lo
 * deja escrito en el error.
 *
 * El precio por identidad ya tiene su suite (`pricing-checkout.test.ts`,
 * bloque «el precio del acuerdo llega a quien lo firmo»); aquí no se repite.
 */
import { describe, expect, it } from 'vitest'

import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

const BODY = {
  store_slug: 'tienda-a',
  idempotency_key: 'k'.repeat(32),
  customer_email: 'ana@compradora.test',
  customer_name: 'Ana Perez',
  customer_phone: '+51 999 888 777',
  items: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
  shipping_address: { address: 'Av. Arequipa 100', city: 'Lima', country: 'PE' },
}

describe('el checkout no acepta contexto comercial declarado por el navegador', () => {
  it('el cuerpo mínimo es válido: si no, los rechazos de abajo no prueban nada', async () => {
    await expect(parseCheckoutBody({ ...BODY })).resolves.toMatchObject({ storeSlug: 'tienda-a' })
  })

  it.each([
    ['audience', 'enterprise'],
    ['business_account_id', '44444444-4444-4444-8444-444444444444'],
    ['customer_id', '55555555-5555-4555-8555-555555555555'],
    ['segment_id', '66666666-6666-4666-8666-666666666666'],
    ['price_list_id', '77777777-7777-4777-8777-777777777777'],
  ])('`%s` en el cuerpo se rechaza con CAMPO_NO_PERMITIDO', async (campo, valor) => {
    await expect(parseCheckoutBody({ ...BODY, [campo]: valor })).rejects.toMatchObject({
      code: 'CAMPO_NO_PERMITIDO',
    })
  })

  it('y tampoco dentro de una línea: el precio lo decide el servidor', async () => {
    await expect(
      parseCheckoutBody({
        ...BODY,
        items: [{ ...BODY.items[0], customer_id: '55555555-5555-4555-8555-555555555555' }],
      }),
    ).rejects.toMatchObject({ code: 'CAMPO_NO_PERMITIDO' })
  })
})
