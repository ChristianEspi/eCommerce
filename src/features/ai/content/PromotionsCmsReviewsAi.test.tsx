import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, USER, createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'
import { parseAiResult } from '@/features/ai/result'
import { CMS_FIELDS as SERVER_CMS_FIELDS, CMS_TONOS, TAREAS_DE_DESTINO } from '../../../../supabase/functions/_shared/aiContent'
import { PROMO_TERMS as SERVER_PROMO_TERMS, PROMO_TONOS, CANDIDATE_REASONS } from '../../../../supabase/functions/_shared/aiPromotions'
import {
  MOTIVOS_REVISION,
  REPLY_TONES as SERVER_REPLY_TONES,
  REVIEW_FLAGS as SERVER_REVIEW_FLAGS,
  SENALES_RESENAS,
  TONOS_RESENAS,
} from '../../../../supabase/functions/_shared/aiReviews'
import { PROMO_CANDIDATE_REASONS, PROMO_TERMS, PROMO_TONES, formatPromoMetric, promoDraftSchema, resolvePromoText } from '@/features/promotions/ai/promotionsAi'
import { CMS_FIELDS, CMS_TASKS_BY_TARGET, CMS_TONES, cmsDraftSchema } from '@/features/content/ai/contentAi'
import {
  ATTENTION_REASONS,
  REPLY_TONES,
  REVIEW_FLAGS,
  REVIEW_SIGNALS,
  REVIEW_TONES,
  reviewReplySchema,
} from '@/features/catalog/reviews/ai/reviewsAi'

/**
 * Promociones, CMS y reseñas con IA en el CLIENTE (fase 09).
 *
 *  · Plegado por defecto: abrir un cajón o la cola NO pide nada.
 *  · Al desplegar: solo el CÁLCULO DEL SISTEMA (sin cuota); el borrador o el
 *    análisis van aparte, con un botón.
 *  · «Aplicar» escribe en el formulario (nunca guarda); lo demás se copia.
 *  · Ningún botón publica, modera, responde, oculta ni borra.
 *  · Rol sin la funcionalidad ⇒ nada se pinta ni se pide; no contratado ⇒ sin
 *    botón que gaste.
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
const { CapabilitiesProvider } = await import('@/features/capabilities/CapabilitiesProvider')
const { PromotionAiAssistant } = await import('@/features/promotions/ai/PromotionAiAssistant')
const { ContentAiAssistant } = await import('@/features/content/ai/ContentAiAssistant')
const { ReviewsAiPanel } = await import('@/features/catalog/reviews/ai/ReviewsAiPanel')
const { ReviewReplyDialog } = await import('@/features/catalog/reviews/ai/ReviewReplyDialog')

const PROMO = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const G1 = '33333333-3333-4333-8333-333333333333'
const R1 = '44444444-4444-4444-8444-444444444444'
const BLOCK = '55555555-5555-4555-8555-555555555555'
const INTERACTION = '88888888-8888-4888-8888-888888888888'

const PROMO_SYSTEM = {
  promotion_id: PROMO,
  kind: 'percentage',
  status: 'draft',
  generated_at: '2026-09-22T10:00:00Z',
  terms: ['requires_coupon', 'min_subtotal'],
  metrics: {
    discount_percent: { kind: 'percent', value: '15' },
    min_subtotal: { kind: 'money', value: '100.00', currency: 'PEN' },
    P1_units_90d: { kind: 'quantity', value: '30' },
  },
  entities: {
    S1: { kind: 'scope', label: 'Protectores solares' },
    P1: { kind: 'product', label: 'Bloqueador SPF' },
    G1: { kind: 'segment', label: 'Mayoristas' },
  },
  candidates: [
    { ref: 'P1', id: P1, kind: 'product', reason: 'top_seller', label: 'Bloqueador SPF', metrics: ['P1_units_90d'] },
    { ref: 'G1', id: G1, kind: 'segment', reason: 'segment', label: 'Mayoristas', metrics: [] },
  ],
}

const PROMO_DRAFT = {
  texts: {
    name: 'Verano {{discount_percent}}',
    description: 'Descuento de {{discount_percent}} en {{S1}} con cupón.',
    copy: 'Ahorra {{discount_percent}} desde {{min_subtotal}}.',
  },
  candidates: [{ ref: 'P1', id: P1, kind: 'product', reason: 'top_seller', label: 'Bloqueador SPF', text: 'Encaja con la temporada.' }],
  discarded: 1,
  draft: true,
  metrics: PROMO_SYSTEM.metrics,
  entities: PROMO_SYSTEM.entities,
}

const REVIEWS_SYSTEM = {
  scope: 'store',
  generated_at: '2026-09-22T10:00:00Z',
  system_tone: 'mixed',
  metrics: {
    total: { kind: 'count', value: 10 },
    negative: { kind: 'count', value: 4 },
    average: { kind: 'quantity', value: '3.10' },
  },
  entities: { P1: { kind: 'product', label: 'Jabón' }, R1: { kind: 'review', label: 'Jabón · ★' } },
  signals: [{ code: 'negative_share', severity: 'high', ref: null }],
  sample: [{ ref: 'R1', id: R1, rating: 1, status: 'pending', flags: ['low_rating'] }],
}

function entitlement(over: Record<string, unknown> = {}) {
  return {
    enabled: true, status: 'active', plan: 'active', period: '202609', used: 10, quota: 500, remaining: 490,
    features: { promotions: true, content: true, reviews: true },
    ...over,
  }
}

type Handler = (body: Record<string, unknown>) => unknown

function backend(options: {
  role?: string
  entitlement?: Record<string, unknown>
  promotions?: Handler
  content?: Handler
  reviews?: Handler
}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: { ai_entitlement: () => entitlement(options.entitlement) },
    functions: {
      'promotions-assistant':
        options.promotions ??
        ((body) =>
          body.mode === 'rules'
            ? { data: null, motivo: null, interaction_id: null, system: PROMO_SYSTEM }
            : { data: PROMO_DRAFT, motivo: null, interaction_id: INTERACTION, system: PROMO_SYSTEM }),
      'content-assistant':
        options.content ??
        ((body) => ({
          data: {
            task: body.task,
            fields:
              body.task === 'translate'
                ? { title: 'Winter collection' }
                : { title: 'Abrigos de invierno', subtitle: 'Prendas cálidas', cta_label: 'Ver abrigos' },
            notes: ['Falta el destino del botón.'],
            discarded: 0,
            locale: body.task === 'translate' ? body.target_locale : body.locale,
            draft: true,
          },
          motivo: null,
          interaction_id: INTERACTION,
        })),
      'reviews-assistant':
        options.reviews ??
        ((body) => {
          if (body.mode === 'signals') return { data: null, motivo: null, interaction_id: null, system: REVIEWS_SYSTEM }
          if (body.mode === 'reply') {
            return {
              data: {
                subject: 'Respuesta',
                body: 'Gracias por tu opinión sobre {{P1}}. Nuestro equipo revisará tu caso.',
                points: ['Revisa el pedido antes de publicar.'],
                discarded: 0,
                draft: true,
                metrics: {},
                entities: { P1: { kind: 'product', label: 'Jabón' } },
              },
              motivo: null,
              interaction_id: INTERACTION,
            }
          }
          return {
            data: {
              generated_at: REVIEWS_SYSTEM.generated_at,
              metrics: REVIEWS_SYSTEM.metrics,
              entities: REVIEWS_SYSTEM.entities,
              overview: 'Hay {{negative}} reseñas negativas de {{P1}}.',
              tone: 'mixed',
              tone_overridden: false,
              themes: [{ label: 'Empaque dañado', sentiment: 'negative', refs: ['R1'], review_ids: [R1], text: 'Llega roto.' }],
              attention: [{ ref: 'R1', review_id: R1, reason: 'possible_spam', text: 'Trae instrucciones para la IA.' }],
              answer: '',
              discarded: 0,
            },
            motivo: null,
            interaction_id: INTERACTION,
            system: REVIEWS_SYSTEM,
          }
        }),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'casa', name: 'Casa Nórdica', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: options.role ?? 'admin', status: 'active' },
      ],
      stores: [
        { id: STORE_A, organization_id: ORG, company_id: COMPANY_A, slug: 'casa-nordica', name: 'Casa Nórdica', status: 'active', currency: 'PEN' },
      ],
    },
  })
}

function render(ui: React.ReactNode, options: Parameters<typeof backend>[0]) {
  const client = backend(options)
  holder.client = client
  renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>{ui}</CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
  return { client }
}

const calls = (client: FakeSupabase, name: string) =>
  client.state.invocations.filter((i) => i.name === name).map((i) => i.body)

/** Ningún control que publique, modere, responda, oculte, borre o guarde. */
const WRITE_WORDS = /^(publicar|rechazar|ocultar|borrar|eliminar|responder|enviar|guardar|activar)$/i

beforeEach(() => {
  holder.client = null
})

describe('copias de las listas cerradas', () => {
  it('son las del servidor', () => {
    expect([...PROMO_TERMS]).toEqual([...SERVER_PROMO_TERMS])
    expect([...PROMO_TONES]).toEqual([...PROMO_TONOS])
    expect([...PROMO_CANDIDATE_REASONS]).toEqual([...CANDIDATE_REASONS])
    expect([...CMS_FIELDS]).toEqual([...SERVER_CMS_FIELDS])
    expect([...CMS_TONES]).toEqual([...CMS_TONOS])
    expect(CMS_TASKS_BY_TARGET).toEqual(TAREAS_DE_DESTINO)
    expect([...REVIEW_SIGNALS]).toEqual([...SENALES_RESENAS])
    expect([...REVIEW_FLAGS]).toEqual([...SERVER_REVIEW_FLAGS])
    expect([...REVIEW_TONES]).toEqual([...TONOS_RESENAS])
    expect([...ATTENTION_REASONS]).toEqual([...MOTIVOS_REVISION])
    expect([...REPLY_TONES]).toEqual([...SERVER_REPLY_TONES])
  })
})

describe('contrato: lo que no es borrador no se pinta', () => {
  it('draft !== true ⇒ esquema', () => {
    for (const [schema, data] of [
      [promoDraftSchema, PROMO_DRAFT],
      [cmsDraftSchema, { task: 'seo', fields: { seo_title: 'x' }, notes: [], discarded: 0, locale: 'es', draft: true }],
      [reviewReplySchema, { subject: 'a', body: 'b', points: [], discarded: 0, draft: true, metrics: {}, entities: {} }],
    ] as const) {
      expect(parseAiResult(schema, { data, motivo: null }).data).not.toBeNull()
      expect(parseAiResult(schema, { data: { ...data, draft: false }, motivo: null })).toMatchObject({ data: null, motivo: 'esquema' })
    }
  })

  it('marcadores → valor de la base; el porcentaje sin signo; desconocido ⇒ «—»', () => {
    expect(formatPromoMetric({ kind: 'percent', value: '15' }, 'es', '{n} días')).toBe('15 %')
    expect(formatPromoMetric({ kind: 'percent', value: '15' }, 'en', '{n} days')).toBe('15%')
    expect(resolvePromoText('Ahorra {{discount_percent}} en {{S1}} {{X9}}', promoDraftSchema.parse(PROMO_DRAFT), 'es', '{n} días')).toBe(
      'Ahorra 15 % en Protectores solares —',
    )
  })
})

describe('Promociones — Redactar con IA', () => {
  it('plegado no pide nada; al abrir solo las reglas; el borrador se aplica al formulario', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    const { client } = render(
      <PromotionAiAssistant promotionId={PROMO} current={{ name: 'Verano', description: '' }} onApply={onApply} />,
      {},
    )
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    expect(await screen.findByText('Requiere cupón')).toBeInTheDocument()
    expect(screen.getByText(/Compra mínima: S\/\s?100\.00/)).toBeInTheDocument()
    expect(calls(client, 'promotions-assistant')).toEqual([{ mode: 'rules', promotion_id: PROMO, locale: 'es' }])

    await user.type(screen.getByLabelText('Indicaciones (opcional)'), 'para familias')
    await user.click(screen.getByRole('button', { name: 'Redactar borrador' }))
    const nombre = await screen.findByDisplayValue('Verano 15 %')
    expect(nombre).toBeInTheDocument()
    expect(calls(client, 'promotions-assistant')[1]).toEqual({
      mode: 'copy', promotion_id: PROMO, locale: 'es', tone: 'neutral', brief: 'para familias',
    })
    // Ningún importe ni regla viaja desde el navegador.
    expect(JSON.stringify(calls(client, 'promotions-assistant'))).not.toMatch(/percent|amount|subtotal/)

    await user.click(screen.getByRole('button', { name: 'Aplicar al formulario · Nombre' }))
    expect(onApply).toHaveBeenCalledWith('name', 'Verano 15 %')
    // El copy no tiene columna: se copia, no se aplica.
    expect(screen.queryByRole('button', { name: 'Aplicar al formulario · Copy promocional' })).toBeNull()
    expect(screen.getByDisplayValue(/^Ahorra 15 % desde S\/\s?100\.00\.$/)).toBeInTheDocument()
    expect(screen.getByText(/Encaja con la temporada/)).toBeInTheDocument()
    expect(screen.getByText(/Se descartaron 1 piezas/)).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b.textContent ?? '').not.toMatch(WRITE_WORDS)
  })

  it('no contratado: sin botón que gaste', async () => {
    const user = userEvent.setup()
    render(<PromotionAiAssistant promotionId={PROMO} current={{ name: '', description: '' }} onApply={vi.fn()} />, {
      entitlement: { features: { promotions: false } },
    })
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    expect(await screen.findByText('Tu empresa no tiene contratado este uso de IA.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Redactar borrador' })).toBeNull()
  })

  it('rol sin la funcionalidad (catalog): nada se pinta ni se pide', async () => {
    const { client } = render(
      <PromotionAiAssistant promotionId={PROMO} current={{ name: '', description: '' }} onApply={vi.fn()} />,
      { role: 'catalog' },
    )
    await waitFor(() => expect(client.state.invocations.length).toBe(0))
    expect(screen.queryByText('Redactar con IA')).toBeNull()
  })

  it('motivo bloqueada: aviso con reintento, sin borrador', async () => {
    const user = userEvent.setup()
    render(<PromotionAiAssistant promotionId={PROMO} current={{ name: '', description: '' }} onApply={vi.fn()} />, {
      promotions: (body) =>
        body.mode === 'rules'
          ? { data: null, motivo: null, interaction_id: null, system: PROMO_SYSTEM }
          : { data: null, motivo: 'bloqueada', interaction_id: INTERACTION, system: PROMO_SYSTEM },
    })
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    await user.click(await screen.findByRole('button', { name: 'Redactar borrador' }))
    expect(await screen.findByText(/no pasó las reglas/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aplicar al formulario/ })).toBeNull()
  })
})

describe('CMS — Borrador con IA', () => {
  it('banner de un bloque: pide con lo escrito y aplica campo a campo; sin «publicar»', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    const { client } = render(
      <ContentAiAssistant
        target="block"
        blockId={BLOCK}
        blockType="hero"
        current={{ title: 'Invierno', subtitle: '', cta_label: '' }}
        applicable={['title', 'subtitle']}
        onApply={onApply}
      />,
      {},
    )
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    expect(calls(client, 'content-assistant')).toEqual([])
    await user.type(screen.getByLabelText('Indicaciones'), 'coleccion de invierno')
    await user.click(screen.getByRole('button', { name: 'Redactar borrador' }))
    expect(await screen.findByDisplayValue('Abrigos de invierno')).toBeInTheDocument()
    expect(calls(client, 'content-assistant')[0]).toEqual({
      task: 'banner', target: 'block', block_id: BLOCK, block_type: 'hero',
      fields: { title: 'Invierno' }, tone: 'neutral', locale: 'es', brief: 'coleccion de invierno',
    })
    await user.click(screen.getByRole('button', { name: 'Aplicar al formulario · Título' }))
    expect(onApply).toHaveBeenCalledWith('title', 'Abrigos de invierno')
    // El botón no es aplicable en este tipo de bloque: solo se copia.
    expect(screen.queryByRole('button', { name: 'Aplicar al formulario · Texto del botón' })).toBeNull()
    expect(screen.getByText('Falta el destino del botón.')).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b.textContent ?? '').not.toMatch(WRITE_WORDS)
  })

  it('traducir una página: sin instrucción, con idioma destino', async () => {
    const user = userEvent.setup()
    const { client } = render(
      <ContentAiAssistant target="page" pageId={BLOCK} current={{ title: 'Colección de invierno' }} applicable={['title', 'seo_title', 'seo_description']} onApply={vi.fn()} />,
      {},
    )
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    await user.click(screen.getByLabelText('Qué redactar'))
    await user.click(await screen.findByRole('option', { name: 'Traducir los textos actuales' }))
    expect(screen.queryByLabelText('Indicaciones')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Redactar borrador' }))
    expect(await screen.findByDisplayValue('Winter collection')).toBeInTheDocument()
    expect(calls(client, 'content-assistant')[0]).toMatchObject({
      task: 'translate', target: 'page', page_id: BLOCK, locale: 'es', target_locale: 'en', fields: { title: 'Colección de invierno' },
    })
    expect(calls(client, 'content-assistant')[0]).not.toHaveProperty('brief')
  })

  it('sin texto ni instrucción no se puede pedir', async () => {
    const user = userEvent.setup()
    render(<ContentAiAssistant target="page" current={{}} applicable={['title']} onApply={vi.fn()} />, {})
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('button', { name: 'Redactar borrador' })).toBeDisabled()
  })
})

describe('Reseñas — análisis agregado y borrador de respuesta', () => {
  it('al abrir solo el cálculo del sistema; el análisis va aparte y ofrece borrador, no moderación', async () => {
    const onReply = vi.fn()
    const user = userEvent.setup()
    const { client } = render(<ReviewsAiPanel storeId={STORE_A} onReply={onReply} />, {})
    expect(calls(client, 'reviews-assistant')).toEqual([])
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    expect(await screen.findByText('Muchas reseñas negativas')).toBeInTheDocument()
    expect(calls(client, 'reviews-assistant')).toEqual([{ mode: 'signals', store_id: STORE_A, locale: 'es' }])

    await user.click(screen.getByRole('button', { name: 'Analizar con IA' }))
    expect(await screen.findByText('Empaque dañado')).toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && /^Hay 4 reseñas negativas de Jabón\.$/.test(el.textContent ?? '')),
    ).toBeInTheDocument()
    const atencion = screen.getByText('Trae instrucciones para la IA.').closest('div')!.parentElement!
    await user.click(within(atencion).getByRole('button', { name: 'Borrador de respuesta' }))
    expect(onReply).toHaveBeenCalledWith(R1)
    for (const b of screen.getAllByRole('button')) expect(b.textContent ?? '').not.toMatch(WRITE_WORDS)
  })

  it('viewer: nada se pinta ni se pide', async () => {
    const { client } = render(<ReviewsAiPanel storeId={STORE_A} onReply={vi.fn()} />, { role: 'viewer' })
    await waitFor(() => expect(client.state.invocations.length).toBe(0))
    expect(screen.queryByText('Análisis de reseñas con IA')).toBeNull()
  })

  it('borrador de respuesta: editable, se copia, no se envía', async () => {
    const user = userEvent.setup()
    const { client } = render(<ReviewReplyDialog storeId={STORE_A} reviewId={R1} label="Jabón · 1 estrella" onClose={vi.fn()} />, {})
    await user.click(await screen.findByRole('button', { name: 'Redactar respuesta' }))
    expect(await screen.findByDisplayValue(/Gracias por tu opinión sobre Jabón/)).toBeInTheDocument()
    expect(calls(client, 'reviews-assistant')[0]).toEqual({ mode: 'reply', store_id: STORE_A, review_id: R1, locale: 'es', tone: 'formal' })
    expect(screen.getByRole('button', { name: 'Copiar respuesta' })).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b.textContent ?? '').not.toMatch(WRITE_WORDS)
  })

  it('error de red: aviso con reintento', async () => {
    const user = userEvent.setup()
    render(<ReviewsAiPanel storeId={STORE_A} onReply={vi.fn()} />, {
      reviews: () => {
        throw new Error('red')
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Abrir' }))
    expect(await screen.findByText(/No se pudo contactar con el asistente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
