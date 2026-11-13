import { createContext, useContext } from 'react'
import { DEFAULT_APPEARANCE, type Appearance } from './appearance'
import type { ColorMode, Density } from './tokens'

export interface AppearanceContextValue {
  appearance: Appearance
  setMode: (mode: ColorMode) => void
  setDensity: (density: Density) => void
  toggleMode: () => void
  hydrate: (next: Partial<Appearance>) => void
  /**
   * El acento de la marca del tenant, puesto por quien lo conoce (el layout del
   * backoffice con la tienda activa). `null` devuelve el acento de suite. No es
   * una preferencia del usuario: el color es 100 % del tenant (contrato §4.4).
   */
  setTenantAccent: (hex: string | null) => void
}

export const AppearanceContext = createContext<AppearanceContextValue>({
  appearance: DEFAULT_APPEARANCE,
  setMode: () => {},
  setDensity: () => {},
  toggleMode: () => {},
  hydrate: () => {},
  setTenantAccent: () => {},
})

export function useAppearance(): AppearanceContextValue {
  return useContext(AppearanceContext)
}
