import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'
import { PIM_TASKS as PIM_TASKS_SERVIDOR } from '../../../supabase/functions/_shared/aiPim'
import { PIM_TASKS, aEntradaDeAtributo, interpretarAsistencia } from './api/copy'
import type { ProductPublication } from './types'

/**
 * Asistente de ficha en el CLIENTE (fase 03).
 *
 *  · ACTUAL frente a SUGERENCIA; aplicar, editar o descartar cada una.
 *  · Nada se guarda al pedir: nombre y descripción van al formulario; categoría
 *    y atributos solo al pulsar «Aplicar», por su comando de siempre.
 *  · Respuesta inválida ⇒ sin sugerencias; lo determinista sobrevive.
 *  · Sin rol, oculto; sin contrato o sin cuota, sin botón que gaste.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { ProductAiAssistant } = await import('./ProductAiAssistant')

const PRODUCT = '11111111-1111-4111-8111-111111111111'
const CATEGORY = '22222222-2222-4222-8222-222222222223'
const ATTRIBUTE = '33333333-3333-4333-8333-333333333331'
const OPTION = '44444444-4444-4444-8444-444444444441'
const DUP = '55555555-5555-4555-8555-555555555551'
const INTERACTION = '66666666-6666-4666-8666-666666666666'

const SYSTEM = {
  tasks: [...PIM_TASKS],
  missing_attributes: [{ id: ATTRIBUTE, name: 'Forma' }],
  duplicate_candidates: [{ product_id: DUP, sku: 'AMX-500', name: 'Amoxicilina 500 mg x 21', score: 0.8 }],
}

function suggestions(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Amoxicilina 500 mg · caja de 21 cápsulas',
    short_description: 'Caja con 21 cápsulas de 500 mg.',
    description: 'Presentación en caja con 21 cápsulas de 500 mg.',
    seo_title: 'Amoxicilina 500 mg x 21',
    seo_description: 'Amoxicilina 500 mg en caja de 21 cápsulas.',
    normalized_name: 'Amoxicilina 500 mg x 21 caps',
    category: { id: CATEGORY, path: 'Farmacia > Antibioticos', reason: 'Es un antibiótico.' },
    attributes: [
      {
        attribute_id: ATTRIBUTE,
        name: 'Forma',
        display: 'Cápsula',
        value: { kind: 'option', option_id: OPTION },
        reason: 'El nombre dice CAPS.',
      },
    ],
    duplicates: [{ product_id: DUP, sku: 'AMX-500', name: 'Amoxicilina 500 mg x 21', score: 0.8, reason: 'Mismo producto.' }],
    tags: ['amoxicilina', 'quilab'],
    discarded: 1,
    ...overrides,
  }
}

function ok(overrides: Record<string, unknown> = {}) {
  return { data: suggestions(overrides), motivo: null, interaction_id: INTERACTION, system: SYSTEM }
}

const PUBLICATION: ProductPublication = {
  store_id: STORE_A,
  store_name: 'Casa',
  store_slug: 'casa',
  store_status: 'active',
  store_currency: 'PEN',
  is_origin: true,
  publication_id: '77777777-7777-4777-8777-777777777777',
  category_id: null,
  category_name: null,
  slug: 'amoxicilina',
  status: 'published',
  published_at: null,
  price: '12.50',
  compare_at_price: null,
  currency: 'PEN',
  updated_at: null,
}

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  copy?: (body: Record<string, unknown>) => unknown
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      ai_entitlement: () => ({
        enabled: true,
        status: 'active',
        plan: 'active',
        period: '202609',
        used: 1,
        quota: 100,
        remaining: 99,
        features: { 'catalog.copy': true },
        ...options.entitlement,
      }),
      update_product_publication: () => null,
    },
    functions: options.copy ? { 'catalog-copy': options.copy } : {},
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'catalog', status: 'active' },
      ],
      stores: [
        { id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa', name: 'Casa', status: 'active', currency: 'PEN' },
      ],
      product_attribute_values: [],
    },
  })
}

function render(options: Parameters<typeof backend>[0] & { publication?: ProductPublication | null }) {
  const client = backend(options)
  holder.client = client
  const onApplyText = vi.fn()
  renderWithProviders(
    <TenantProvider>
      <ProductAiAssistant
        productId={PRODUCT}
        storeId={STORE_A}
        canWrite
        current={{ name: 'AMOXICILINA 500MG X 21 CAPS', description: '' }}
        publication={options.publication === undefined ? PUBLICATION : options.publication}
        scope={{ organizationId: ORG, companyId: COMPANY_A, storeId: STORE_A }}
        onApplyText={onApplyText}
      />
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client, onApplyText }
}

beforeEach(() => {
  holder.client = null
})

describe('contrato con el servidor', () => {
  it('las tareas son las del servidor', () => {
    expect([...PIM_TASKS]).toEqual([...PIM_TASKS_SERVIDOR])
  })

  it('respuesta válida', () => {
    const r = interpretarAsistencia(ok())
    expect(r.suggestions?.title).toBe('Amoxicilina 500 mg · caja de 21 cápsulas')
    expect(r.interactionId).toBe(INTERACTION)
    expect(r.system?.missing_attributes).toHaveLength(1)
  })

  it('sugerencia malformada ⇒ esquema; lo determinista se conserva', () => {
    const r = interpretarAsistencia({ ...ok(), data: { ...suggestions(), category: { id: 'no-uuid', path: 'x', reason: '' } } })
    expect(r.suggestions).toBeNull()
    expect(r.motivo).toBe('esquema')
    expect(r.system?.duplicate_candidates).toHaveLength(1)
  })

  it('valor de atributo con forma desconocida ⇒ esquema', () => {
    const r = interpretarAsistencia(
      ok({ attributes: [{ attribute_id: ATTRIBUTE, name: 'X', display: 'x', value: { kind: 'date', date: '2026' }, reason: '' }] }),
    )
    expect(r.motivo).toBe('esquema')
  })

  it('basura ⇒ esquema sin romper', () => {
    expect(interpretarAsistencia('nada')).toEqual({ suggestions: null, motivo: 'esquema', interactionId: null, system: null })
  })

  it('motivo tipado sin datos', () => {
    const r = interpretarAsistencia({ data: null, motivo: 'vacia', interaction_id: null, system: SYSTEM })
    expect(r.motivo).toBe('vacia')
    expect(r.system).not.toBeNull()
  })
  it('valor propuesto → entrada del comando de atributos (lo editado manda)', () => {
    const opcion = '00000000-0000-4000-8000-0000000000aa'
    expect(aEntradaDeAtributo({ kind: 'option', option_id: opcion })).toEqual({ kind: 'option', optionId: opcion })
    expect(aEntradaDeAtributo({ kind: 'text', text: 'Menta' }, '  Eucalipto ')).toEqual({ kind: 'text', text: 'Eucalipto' })
    expect(aEntradaDeAtributo({ kind: 'number', number: '500' }, '0,5')).toEqual({ kind: 'number', number: '0.5' })
    expect(aEntradaDeAtributo({ kind: 'boolean', boolean: false })).toEqual({ kind: 'boolean', boolean: false })
  })
})

describe('panel', () => {
  it('no pide nada al montarse: cada sugerencia gasta cuota', async () => {
    const { client } = render({ copy: () => ok() })
    await screen.findByRole('button', { name: 'Sugerir mejoras' })
    expect(client.state.invocations).toHaveLength(0)
  })

  it('pide en modo assist, con tienda e idioma, sin tenant en el cuerpo', async () => {
    const { client } = render({ copy: () => ok() })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    await screen.findByDisplayValue('Amoxicilina 500 mg · caja de 21 cápsulas')
    const body = client.state.invocations[0]!.body
    expect(body).toEqual({ product_id: PRODUCT, mode: 'assist', locale: 'es', store_id: STORE_A })
  })

  it('ACTUAL frente a SUGERENCIA; aplicar al formulario no guarda', async () => {
    const { client, onApplyText } = render({ copy: () => ok() })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    const grupo = await screen.findByRole('group', { name: 'Título comercial' })
    expect(within(grupo).getByText('AMOXICILINA 500MG X 21 CAPS')).toBeInTheDocument()

    // Editar antes de aplicar.
    const campo = within(grupo).getByRole('textbox')
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Amoxicilina Quilab')
    await userEvent.click(within(grupo).getByRole('button', { name: 'Aplicar al formulario' }))
    expect(onApplyText).toHaveBeenCalledWith('name', 'Amoxicilina Quilab')
    expect(within(grupo).getByRole('status')).toHaveTextContent('Aplicada')
    // Ninguna escritura: ni tablas ni comandos.
    expect(client.state.rpcCalls?.some((c: { name: string }) => c.name === 'update_product_publication') ?? false).toBe(false)
  })

  it('descartar quita la sugerencia', async () => {
    render({ copy: () => ok() })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    const grupo = await screen.findByRole('group', { name: 'Descripción completa' })
    await userEvent.click(within(grupo).getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByRole('group', { name: 'Descripción completa' })).not.toBeInTheDocument()
  })

  it('atributo: se guarda SOLO al pulsar aplicar, con el valor de la lista', async () => {
    const { client } = render({ copy: () => ok() })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    const grupo = await screen.findByRole('group', { name: 'Atributo: Forma' })
    expect(client.state.tables.product_attribute_values).toHaveLength(0)
    await userEvent.click(within(grupo).getByRole('button', { name: 'Aplicar' }))
    await within(grupo).findByRole('status')
    expect(client.state.tables.product_attribute_values).toEqual([
      expect.objectContaining({ product_id: PRODUCT, attribute_id: ATTRIBUTE, value_id: OPTION, value_text: null }),
    ])
  })

  it('categoría: se aplica SOLO al pulsar, por el comando de la publicación y sin tocar precio, slug ni estado', async () => {
    const { client } = render({ copy: () => ok() })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    const grupo = await screen.findByRole('group', { name: 'Categoría sugerida' })
    const llamadas = () => client.state.rpcCalls.filter((c) => c.name === 'update_product_publication')
    expect(llamadas()).toHaveLength(0)
    await userEvent.click(within(grupo).getByRole('button', { name: 'Aplicar' }))
    await within(grupo).findByRole('status')
    expect(llamadas()).toHaveLength(1)
    expect(llamadas()[0]!.args).toEqual({
      p_product_id: PRODUCT,
      p_store_id: STORE_A,
      p_slug: null,
      p_category_id: CATEGORY,
      p_clear_category: false,
      p_status: null,
      p_price: null,
    })
  })

  it('categoría sin publicación en la tienda: no se puede aplicar', async () => {
    render({ copy: () => ok(), publication: null })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    const grupo = await screen.findByRole('group', { name: 'Categoría sugerida' })
    expect(within(grupo).getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  })

  it('duplicados del sistema con la opinión de la IA, y pulgar en contexto', async () => {
    render({ copy: () => ok() })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    expect(await screen.findByText('La IA lo ve como el mismo producto')).toBeInTheDocument()
    expect(screen.getByText(/1 sugerencias se descartaron/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '¿Te sirvió?' })).toBeInTheDocument()
  })

  it('motivo tipado: se explica y lo determinista se ve igual', async () => {
    render({ copy: () => ({ data: null, motivo: 'bloqueada', interaction_id: null, system: SYSTEM }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    expect(await screen.findByText(/no pasaron las reglas/)).toBeInTheDocument()
    expect(screen.getByText('Forma')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '¿Te sirvió?' })).not.toBeInTheDocument()
  })

  it('respuesta inválida: no se pinta nada del modelo', async () => {
    render({ copy: () => ({ data: { title: 5 }, motivo: null, interaction_id: null }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir mejoras' }))
    expect(await screen.findByText(/no tenía el formato esperado/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Título comercial' })).not.toBeInTheDocument()
  })

  it('sin contrato: aviso y botón deshabilitado', async () => {
    render({ copy: () => ok(), entitlement: { features: { 'catalog.copy': false } } })
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sugerir mejoras' })).toBeDisabled()
  })

  it('rol sin permiso: el panel no aparece', async () => {
    render({ copy: () => ok(), role: 'orders' })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Sugerir mejoras' })).not.toBeInTheDocument()
  })
})
