import { Button, useTheme } from '@mui/material'
import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { AppearanceProvider } from './AppearanceProvider'
import { tenantAccentVars } from './appearance'
import { useAppearance } from './appearance-context'

/**
 * El backoffice toma el color de la marca de la tienda activa (2026-11-13).
 * El layout del panel lo pone con `setTenantAccent`; aquí se prueba el
 * mecanismo, sin el layout.
 */
function PonerAcento({ hex }: { hex: string | null }) {
  const { setTenantAccent } = useAppearance()
  const theme = useTheme()
  useEffect(() => {
    setTenantAccent(hex)
    return () => setTenantAccent(null)
  }, [hex, setTenantAccent])
  return <Button variant="contained" data-primary={theme.palette.primary.main}>Nuevo producto</Button>
}

const accentVar = () => document.documentElement.style.getPropertyValue('--accent')

describe('acento de la marca en el backoffice', () => {
  it('pinta botones y variables con el color de la tienda, y lo retira al salir', () => {
    const { rerender, unmount } = render(
      <AppearanceProvider>
        <PonerAcento hex="#a6192e" />
      </AppearanceProvider>,
    )
    expect(accentVar()).toBe('#a6192e')
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toHaveAttribute('data-primary', '#a6192e')

    // Un valor que no es un color no se aplica: vuelve el de suite.
    act(() => {
      rerender(
        <AppearanceProvider>
          <PonerAcento hex="rojo" />
        </AppearanceProvider>,
      )
    })
    expect(accentVar()).toBe('')

    unmount()
    expect(accentVar()).toBe('')
  })

  it('la barra lateral también sale del color de la marca', () => {
    expect(tenantAccentVars('#a6192e', 'light')['--sidebar']).toContain('#a6192e')
    expect(tenantAccentVars('#a6192e', 'dark')['--sidebar']).toContain('#a6192e')
  })
})
