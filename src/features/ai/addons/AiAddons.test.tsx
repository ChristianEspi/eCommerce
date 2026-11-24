import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { en } from '@/shared/i18n/messages.en'
import { esBackoffice } from '@/shared/i18n/messages.es.backoffice'
import { AI_FEATURE_IDS } from '../features'
import type { AiEntitlement } from '../types'
import { AI_ADDON_GROUPS } from './catalog'

/**
 * Complementos IA (2026-11-23).
 *
 *  · Ninguna IA se queda fuera de la pantalla ni sin textos.
 *  · El interruptor existe solo para lo que la empresa PUEDE encender: lo que
 *    no está en el plan o depende de un módulo sin contratar se explica, sin
 *    interruptor.
 *  · Solo propietario o administración cambia; el cambio va a `ai_feature_set`.
 */

const holder = vi.hoisted(() => ({
  role: 'owner' as string | null,
  estado: null as AiEntitlement | null,
  mutate: vi.fn(),
}))

vi.mock('@/features/tenant/tenant-context', () => ({
  useTenant: () => ({ role: holder.role }),
}))
vi.mock('../hooks', () => ({
  useAiEntitlement: () => ({ data: holder.estado, isPending: false }),
}))
vi.mock('./api', () => ({
  useSetAiFeature: () => ({ mutate: holder.mutate, isPending: false }),
  useAiUsageThisMonth: () => ({ data: [], isPending: false, isError: false }),
  useAiAddonHistory: () => ({ data: [], isPending: false, isError: false }),
}))

const { AiAddonsPage } = await import('./AiAddonsPage')

function estado(states: Record<string, 'on' | 'off' | 'no_ai' | 'no_module'>): AiEntitlement {
  const todos = Object.fromEntries(AI_FEATURE_IDS.map((f) => [f, states[f] ?? 'on'])) as Record<
    string,
    'on' | 'off' | 'no_ai' | 'no_module'
  >
  return {
    enabled: true,
    status: 'active',
    plan: 'active',
    used: 180,
    quota: 500,
    remaining: 320,
    features: Object.fromEntries(Object.entries(todos).map(([f, s]) => [f, s === 'on'])),
    states: todos,
  }
}

function tarjeta(feature: string): HTMLElement {
  const card = document.querySelector(`[data-ai-addon="${feature}"]`)
  if (!card) throw new Error(`sin tarjeta ${feature}`)
  return card as HTMLElement
}

beforeEach(() => {
  holder.role = 'owner'
  holder.mutate = vi.fn()
  window.location.hash = ''
})

describe('catálogo de complementos', () => {
  it('cada IA aparece exactamente una vez', () => {
    const enGrupos = AI_ADDON_GROUPS.flatMap((g) => [...g.features])
    expect([...enGrupos].sort()).toEqual([...AI_FEATURE_IDS].sort())
  })

  it('cada IA tiene nombre, descripción y datos en español e inglés', () => {
    const faltan: string[] = []
    for (const f of AI_FEATURE_IDS) {
      for (const campo of ['name', 'desc', 'data']) {
        const key = `aiAddons.f.${f}.${campo}`
        if (!(key in esBackoffice)) faltan.push(`es:${key}`)
        if (!(key in en)) faltan.push(`en:${key}`)
      }
    }
    expect(faltan).toEqual([])
  })
})

describe('pantalla Complementos IA', () => {
  it('enseña cada IA con su estado, y solo las disponibles llevan interruptor', () => {
    holder.estado = estado({ reviews: 'off', credit: 'no_module', 'catalog.copy': 'no_ai' })
    renderWithProviders(<AiAddonsPage />)

    expect(screen.getByRole('tab', { name: `Complementos · ${AI_FEATURE_IDS.length - 3}/${AI_FEATURE_IDS.length}` })).toBeInTheDocument()

    const orders = tarjeta('orders')
    expect(within(orders).getByText('Asistente de pedidos')).toBeInTheDocument()
    expect(within(orders).getByText('Activo')).toBeInTheDocument()
    expect(within(orders).getByRole('checkbox', { name: 'Encender o apagar Asistente de pedidos' })).toBeChecked()

    const reviews = tarjeta('reviews')
    expect(within(reviews).getByText('Apagado')).toBeInTheDocument()
    expect(within(reviews).getByRole('checkbox')).not.toBeChecked()

    // Lo que no depende de la empresa se explica, sin interruptor.
    expect(within(tarjeta('credit')).getByText('Requiere contratar su módulo')).toBeInTheDocument()
    expect(within(tarjeta('credit')).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(tarjeta('catalog.copy')).getByText('No incluido en tu plan')).toBeInTheDocument()
    expect(within(tarjeta('catalog.copy')).queryByRole('checkbox')).not.toBeInTheDocument()

    // Quién la usa: los roles de la funcionalidad.
    expect(within(orders).getByText('Propietario')).toBeInTheDocument()
  })

  it('apagar una IA llama a la base con esa IA', async () => {
    const user = userEvent.setup()
    holder.estado = estado({})
    renderWithProviders(<AiAddonsPage />)

    await user.click(within(tarjeta('reviews')).getByRole('checkbox'))
    expect(holder.mutate).toHaveBeenCalledWith({ feature: 'reviews', enabled: false }, expect.anything())
  })

  it('quien no administra la ve, pero no puede cambiarla', () => {
    holder.role = 'orders'
    holder.estado = estado({})
    renderWithProviders(<AiAddonsPage />)

    expect(screen.getAllByText(/Solo propietario o administración/).length).toBeGreaterThan(0)
    expect(within(tarjeta('orders')).getByRole('checkbox')).toBeDisabled()
  })

  it('el saldo enseña lo que queda del cupo del mes', async () => {
    const user = userEvent.setup()
    holder.estado = estado({})
    renderWithProviders(<AiAddonsPage />)

    await user.click(screen.getByRole('tab', { name: 'Saldo' }))
    expect(await screen.findByText('320')).toBeInTheDocument()
    expect(screen.getByText(/180 de 500 consultas usadas/)).toBeInTheDocument()
  })
})
