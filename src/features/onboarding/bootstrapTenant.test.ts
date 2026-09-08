import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPANY_A,
  FunctionsHttpErrorLike,
  ORG,
  STORE_A,
  createFakeSupabase,
  type FakeSupabase,
} from '@/test/supabaseMock'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,

  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

import { STORE_SLUG_RE, bootstrapTenant, mapBootstrapCode, slugify } from './bootstrapTenant'

function fakeWithBootstrap(): FakeSupabase {
  return createFakeSupabase({
    functions: {
      'bootstrap-tenant': () => ({
        organization_id: ORG,
        company_id: COMPANY_A,
        tenant_slug: 'mi-tienda',
        store_id: STORE_A,
        store_slug: 'mi-tienda',
        admin_email: 'duenio@negocio.com',
      }),
    },
  })
}

describe('bootstrapTenant', () => {
  let fake: FakeSupabase

  beforeEach(() => {
    fake = fakeWithBootstrap()
    holder.client = fake
  })

  it('NO envía el tenant en el cuerpo: lo deriva el servidor del token', async () => {
    await bootstrapTenant({ tenant_name: 'Negocio', store_slug: 'mi-tienda', currency: 'PEN' })

    const invocation = fake.state.invocations[0]
    expect(invocation?.name).toBe('bootstrap-tenant')
    expect(Object.keys(invocation?.body ?? {}).sort()).toEqual([
      'currency',
      'store_slug',
      'tenant_name',
    ])
    for (const forbidden of ['organization_id', 'company_id', 'tenant_id', 'org_id', 'owner_user_id']) {
      expect(invocation?.body).not.toHaveProperty(forbidden)
    }
  })

  it('normaliza el slug antes de enviarlo', async () => {
    await bootstrapTenant({ tenant_name: '  Negocio  ', store_slug: ' Mi-Tienda ', currency: 'USD' })
    expect(fake.state.invocations[0]?.body).toMatchObject({
      tenant_name: 'Negocio',
      store_slug: 'mi-tienda',
      currency: 'USD',
    })
  })

  it('devuelve el espacio creado', async () => {
    const result = await bootstrapTenant({
      tenant_name: 'Negocio',
      store_slug: 'mi-tienda',
      currency: 'PEN',
    })
    expect(result.store_id).toBe(STORE_A)
    expect(result.organization_id).toBe(ORG)
  })

  it('traduce el 409 de tenant existente a algo accionable', async () => {
    holder.client = createFakeSupabase({
      functions: {
        'bootstrap-tenant': () => {
          throw new FunctionsHttpErrorLike(409, 'TENANT_YA_EXISTE')
        },
      },
    })
    await expect(
      bootstrapTenant({ tenant_name: 'Negocio', store_slug: 'mi-tienda', currency: 'PEN' }),
    ).rejects.toMatchObject({ key: 'onboarding.error.tenantExists', code: 'TENANT_YA_EXISTE' })
  })

  it('sin backend configurado avisa en vez de reventar', async () => {
    holder.client = null
    await expect(
      bootstrapTenant({ tenant_name: 'Negocio', store_slug: 'mi-tienda', currency: 'PEN' }),
    ).rejects.toMatchObject({ key: 'auth.notConfigured' })
  })
})

describe('mapBootstrapCode', () => {
  it('cubre los códigos que la Edge Function puede devolver', () => {
    expect(mapBootstrapCode('DUPLICADO')).toBe('onboarding.error.slugTaken')
    expect(mapBootstrapCode('ADMIN_EMAIL_INVALIDO')).toBe('onboarding.error.operatorEmail')
    expect(mapBootstrapCode('NO_AUTENTICADO')).toBe('onboarding.error.unauthorized')
    expect(mapBootstrapCode('TENANT_NO_ADMITIDO')).toBe('onboarding.error.invalidData')
    expect(mapBootstrapCode('LO_QUE_SEA')).toBe('onboarding.error.generic')
  })
})

describe('slugify', () => {
  it('produce slugs que la base acepta', () => {
    expect(slugify('Bodega Doña Ana S.A.C.')).toBe('bodega-dona-ana-s-a-c')
    expect(slugify('  Café  del  Centro  ')).toBe('cafe-del-centro')
    expect(STORE_SLUG_RE.test(slugify('Bodega Doña Ana'))).toBe(true)
  })

  it('no deja guiones colgando ni pasa de 62 caracteres', () => {
    const long = slugify('a'.repeat(200))
    expect(long.length).toBeLessThanOrEqual(62)
    expect(long.endsWith('-')).toBe(false)
    expect(slugify('---hola---')).toBe('hola')
  })
})
