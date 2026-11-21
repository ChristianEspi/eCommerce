/**
 * 2026-11-21 · La guía pública `/api` describe la API que EXISTE.
 *
 * Las rutas salen de `API_ROUTES`; lo único escrito a mano son las respuestas
 * de ejemplo. Estos tests exigen una por ruta —una ruta nueva sin documentar
 * rompe la suite— y que la página enseñe cada ruta, cada permiso y la URL base.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { API_SCOPES } from '../../../../supabase/functions/_shared/api/contract.ts'
import { API_ROUTES } from '../../../../supabase/functions/_shared/api/routes.ts'
import { ApiDocsPage } from './ApiDocsPage'
import { RESPONSE_EXAMPLES, TOKEN_OPERATION_ID } from './apiExamples'

describe('guía pública de la API', () => {
  it('cada ruta publicada tiene su respuesta de ejemplo', () => {
    const sinEjemplo = [TOKEN_OPERATION_ID, ...API_ROUTES.map((route) => route.operationId)].filter(
      (id) => RESPONSE_EXAMPLES[id] === undefined,
    )
    expect(sinEjemplo).toEqual([])
  })

  it('no documenta rutas que ya no existen', () => {
    const vivas = new Set([TOKEN_OPERATION_ID, ...API_ROUTES.map((route) => route.operationId)])
    expect(Object.keys(RESPONSE_EXAMPLES).filter((id) => !vivas.has(id))).toEqual([])
  })

  it('enseña cada ruta con su ficha, cada permiso y la llamada del token', () => {
    const { container } = renderWithProviders(<ApiDocsPage />, { route: '/api' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Conecta tu sistema con la tienda')
    for (const route of API_ROUTES) {
      expect(container.querySelector(`#${route.operationId}`)).not.toBeNull()
    }
    expect(container.querySelector(`#${TOKEN_OPERATION_ID}`)).not.toBeNull()
    for (const scope of API_SCOPES) {
      expect(screen.getAllByText(scope).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText(/\/functions\/v1\/api/).length).toBeGreaterThan(0)
  })

  it('el lote de catálogo avisa de que exige Idempotency-Key', () => {
    const { container } = renderWithProviders(<ApiDocsPage />, { route: '/api' })
    const ficha = container.querySelector('#upsertCatalogProducts')
    expect(ficha?.textContent).toContain('Exige la cabecera Idempotency-Key')
    expect(ficha?.textContent).toContain('/v1/catalog/products:batch')
  })
})
