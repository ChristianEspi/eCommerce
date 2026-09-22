import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '@/test/render'
import {
  AI_ERROR_KINDS as SERVER_ERROR_KINDS,
  AI_FEATURES as SERVER_FEATURES,
} from '../../../supabase/functions/_shared/aiCore'
import { AI_FEATURE_IDS, AI_FEATURE_ROLES, aiFeatureAvailability } from './features'
import { AI_ERROR_KINDS, esReintentable, parseAiResult } from './result'
import { aiEntitlementSchema, type AiEntitlement } from './types'

/**
 * El núcleo de IA del CLIENTE (fase 01).
 *
 *  · Las copias del registro no se separan: front ↔ `aiCore.ts` (y de ahí
 *    ↔ SQL, en `supabase/tests/ai-core-db.test.ts`).
 *  · Nada que venga de una Edge Function se usa sin pasar por zod.
 *  · El estado que se enseña sale de capacidad + módulo + cuota + rol.
 *  · El pulgar en contexto solo existe si hubo traza.
 */

const holder = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('./hooks', () => ({ useAiFeedback: () => ({ mutate: holder.mutate }) }))
const { AiFeedbackButtons } = await import('./AiFeedbackButtons')

const ID = '11111111-1111-4111-8111-111111111111'

describe('las copias del registro', () => {
  it('las funcionalidades y sus roles son los del servidor', () => {
    expect([...AI_FEATURE_IDS].sort()).toEqual(Object.keys(SERVER_FEATURES).sort())
    for (const feature of AI_FEATURE_IDS) {
      expect([...AI_FEATURE_ROLES[feature]].sort(), feature).toEqual(
        [...SERVER_FEATURES[feature].roles].sort(),
      )
    }
  })

  it('los motivos tipados son los del servidor', () => {
    expect([...AI_ERROR_KINDS]).toEqual([...SERVER_ERROR_KINDS])
  })
})

describe('la respuesta de IA se valida antes de usarse', () => {
  const dataSchema = z.object({ resumen: z.string().max(200) })

  it('acepta la forma correcta y conserva el id de interacción', () => {
    const r = parseAiResult(dataSchema, {
      data: { resumen: 'ok' },
      motivo: null,
      interaction_id: ID,
    })
    expect(r).toEqual({ data: { resumen: 'ok' }, motivo: null, interactionId: ID })
  })

  it('un motivo del servidor se respeta y no hay datos', () => {
    const r = parseAiResult(dataSchema, { data: { resumen: 'x' }, motivo: 'sin_cuota' })
    expect(r).toEqual({ data: null, motivo: 'sin_cuota', interactionId: null })
  })

  it('datos con forma inválida no se pintan: motivo esquema', () => {
    expect(
      parseAiResult(dataSchema, { data: { resumen: 42, precio: '9.99' }, motivo: null }).motivo,
    ).toBe('esquema')
    expect(parseAiResult(dataSchema, { data: null, motivo: null }).motivo).toBe('esquema')
  })

  it('un sobre ilegible o un motivo inventado no lanzan', () => {
    expect(parseAiResult(dataSchema, 'texto libre del modelo').motivo).toBe('esquema')
    expect(parseAiResult(dataSchema, { data: {}, motivo: 'hackeado' }).motivo).toBe('esquema')
    expect(
      parseAiResult(dataSchema, { data: { resumen: 'a' }, motivo: null, interaction_id: 'x' })
        .motivo,
    ).toBe('esquema')
  })

  it('solo lo transitorio ofrece reintentar', () => {
    expect(esReintentable('timeout')).toBe(true)
    expect(esReintentable('sin_cuota')).toBe(false)
    expect(esReintentable(null)).toBe(false)
  })
})

describe('qué se puede ofrecer', () => {
  const base: AiEntitlement = {
    enabled: true,
    status: 'active',
    plan: 'active',
    quota: 500,
    used: 10,
    remaining: 490,
    features: { orders: true, credit: false },
  }

  it('el saldo ahora conserva `features`', () => {
    const parsed = aiEntitlementSchema.parse({ ...base, features: { orders: true } })
    expect(parsed.features).toEqual({ orders: true })
  })

  it('disponible solo con capacidad, módulo, cuota y rol', () => {
    expect(aiFeatureAvailability(base, 'orders', 'viewer')).toBe('available')
    expect(aiFeatureAvailability(base, 'credit', 'admin')).toBe('not_entitled')
    expect(aiFeatureAvailability(base, 'credit', 'viewer')).toBe('forbidden')
    expect(aiFeatureAvailability(base, 'orders', null)).toBe('forbidden')
    expect(aiFeatureAvailability({ ...base, status: 'quota_exceeded' }, 'orders', 'admin')).toBe(
      'quota_exhausted',
    )
    expect(aiFeatureAvailability(undefined, 'orders', 'admin')).toBe('loading')
  })

  it('sin `features` (servidor antiguo) no se asume abierta', () => {
    const { features: _omit, ...viejo } = base
    void _omit
    expect(aiFeatureAvailability(viejo, 'orders', 'admin')).toBe('not_entitled')
  })
})

describe('el pulgar en contexto', () => {
  it('sin traza no aparece', () => {
    renderWithProviders(<AiFeedbackButtons interactionId={null} />)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('opina una sola vez sobre SU interacción', async () => {
    holder.mutate.mockClear()
    renderWithProviders(<AiFeedbackButtons interactionId={ID} />)
    await userEvent.click(screen.getByRole('button', { name: 'Me sirvió' }))
    expect(holder.mutate).toHaveBeenCalledWith({ id: ID, value: 1 }, expect.anything())
    // Fase 12: el agradecimiento se anuncia (role=status) y los botones quedan
    // `aria-disabled` —sin soltar el foco de teclado— y no vuelven a enviar.
    expect(screen.getByRole('status')).toHaveTextContent('Gracias, queda registrado.')
    const otro = screen.getByRole('button', { name: 'No me sirvió' })
    expect(otro).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(otro)
    expect(holder.mutate).toHaveBeenCalledTimes(1)
  })
})
