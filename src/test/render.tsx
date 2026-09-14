import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { SessionProvider } from '@/features/auth/SessionProvider'
import { I18nProvider } from '@/shared/i18n/I18nProvider'
import type { Locale } from '@/shared/i18n/messages'
import { FeedbackProvider } from '@/shared/ui/FeedbackProvider'
import { AppearanceProvider } from '@/theme/AppearanceProvider'
import { DEFAULT_APPEARANCE } from '@/theme/appearance'

interface Options extends Omit<RenderOptions, 'wrapper'> {
  locale?: Locale
  route?: string
  tenantAccent?: string | null
  /** Sesión ya resuelta: evita que los tests dependan de la red. */
  session?: Session | null
  /**
   * `true` = la sesión NO se fija: el `SessionProvider` la lee del cliente
   * simulado y escucha sus eventos (entrar, registrarse, salir), como en la app.
   */
  liveSession?: boolean
}

/** Render con los providers reales: los tests ejercitan el mismo árbol que la app. */
export function renderWithProviders(ui: ReactElement, options: Options = {}): RenderResult {
  const { locale = 'es', route = '/', tenantAccent = null, session = null, liveSession = false, ...rest } = options
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initial={locale}>
        <AppearanceProvider initial={DEFAULT_APPEARANCE} tenantAccent={tenantAccent}>
          <QueryClientProvider client={queryClient}>
            <FeedbackProvider>
              <SessionProvider {...(liveSession ? {} : { initialSession: session })}>
                <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
              </SessionProvider>
            </FeedbackProvider>
          </QueryClientProvider>
        </AppearanceProvider>
      </I18nProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...rest })
}
