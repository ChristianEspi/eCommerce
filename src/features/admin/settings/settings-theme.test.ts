import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HOME_LAYOUT } from '@/features/storefront/theme/presets'
import { storeFormSchema, storeSettingsSchema, toForm } from './types'

/**
 * Configuración de la tienda y el Theme Engine.
 *
 * Dos cosas se fijan aquí, y las dos son de contrato, no de pantalla:
 *
 *  1. **El tema se guarda siempre.** No es premium: no lo gatea
 *     `content.white_label` y no puede acabar gateado por accidente el día que
 *     alguien mueva una línea dentro del bloque condicional de `saveStoreSettings`.
 *  2. **Lo premium sigue siendo premium.** Abrir el tema no abrió de paso la
 *     marca blanca, la tipografía ni la identidad del correo.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { saveStoreSettings, fetchStoreSettings, themeColumnsReady, resetThemeColumnsProbe } =
  await import('./api')

const TIENDA = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SOCIEDAD = '33333333-3333-4333-8333-333333333333'

/** Cliente de mentira: solo apunta qué tabla recibió qué. */
function espia() {
  const escrituras: Array<{ tabla: string; patch: Record<string, unknown> }> = []
  const client = {
    from: (tabla: string) => ({
      update: (patch: Record<string, unknown>) => {
        escrituras.push({ tabla, patch })
        const eslabon = {
          eq: () => eslabon,
          select: () => eslabon,
          maybeSingle: () => Promise.resolve({ data: { store_id: TIENDA }, error: null }),
        }
        return eslabon
      },
      insert: (patch: Record<string, unknown>) => {
        escrituras.push({ tabla, patch })
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { escrituras, client }
}

async function guardar(canWhiteLabel: boolean, valores: Partial<ReturnType<typeof toForm>> = {}) {
  const falso = espia()
  holder.client = falso.client

  await saveStoreSettings({
    storeId: TIENDA,
    organizationId: ORG,
    companyId: SOCIEDAD,
    currentName: 'Botica',
    values: { ...toForm('Botica', null), ...valores },
    canWhiteLabel,
  })

  return falso.escrituras.find((e) => e.tabla === 'store_settings')?.patch ?? {}
}

beforeEach(() => {
  holder.client = null
  resetThemeColumnsProbe()
})

// ---------------------------------------------------------------------------
// La base puede ir por detrás del código
// ---------------------------------------------------------------------------

/** Cliente que responde según las columnas pedidas, apuntando cada `select`. */
function baseSinColumnasDeTema(fila: Record<string, unknown>) {
  const selects: string[] = []
  const client = {
    from: () => ({
      select: (select: string) => {
        selects.push(select)
        const falta = select.includes('theme_preset')
        const eslabon = {
          eq: () => eslabon,
          maybeSingle: () =>
            Promise.resolve(
              falta
                ? {
                    data: null,
                    error: {
                      code: '42703',
                      message: 'column store_settings.theme_preset does not exist',
                    },
                  }
                : { data: fila, error: null },
            ),
        }
        return eslabon
      },
      update: (patch: Record<string, unknown>) => {
        escriturasDeLaBaseVieja.push(patch)
        const eslabon = {
          eq: () => eslabon,
          select: () => eslabon,
          maybeSingle: () => Promise.resolve({ data: { store_id: TIENDA }, error: null }),
        }
        return eslabon
      },
    }),
  }
  return { selects, client }
}

let escriturasDeLaBaseVieja: Array<Record<string, unknown>> = []

const FILA_SIN_TEMA = {
  store_id: TIENDA,
  organization_id: ORG,
  company_id: SOCIEDAD,
  accent_color: '#5AA97F',
}

describe('cuando la migración del tema todavía no está aplicada', () => {
  /**
   * Es el fallo que se vio en producción: la pantalla de Configuración ENTERA
   * —General, Marca, Usuarios, Impuestos— moría con «Algo salió mal · 42703»
   * porque la lectura pedía tres columnas que esa base no tenía. Una pantalla
   * de ajustes no puede caerse porque una migración vaya por detrás.
   */
  it('la configuración se lee igual, sin las columnas del tema', async () => {
    const falso = baseSinColumnasDeTema(FILA_SIN_TEMA)
    holder.client = falso.client

    const ajustes = await fetchStoreSettings(TIENDA)

    expect(ajustes?.accent_color).toBe('#5AA97F')
    // Primero se pide con las tres; al ver que no están, se relee sin ellas.
    expect(falso.selects).toHaveLength(2)
    expect(falso.selects[0]).toContain('theme_preset')
    expect(falso.selects[1]).not.toContain('theme_preset')
  })

  it('no se vuelve a pagar la consulta fallida', async () => {
    const falso = baseSinColumnasDeTema(FILA_SIN_TEMA)
    holder.client = falso.client

    await fetchStoreSettings(TIENDA)
    await fetchStoreSettings(TIENDA)

    expect(falso.selects.filter((s) => s.includes('theme_preset'))).toHaveLength(1)
  })

  it('la sección de diseño queda apagada en vez de mentir', async () => {
    const falso = baseSinColumnasDeTema(FILA_SIN_TEMA)
    holder.client = falso.client

    expect(themeColumnsReady()).toBe(true)
    await fetchStoreSettings(TIENDA)

    expect(themeColumnsReady()).toBe(false)
  })

  it('y guardar el resto sigue funcionando', async () => {
    // Lo importante: el teléfono que la persona acaba de escribir se guarda.
    // Enviar las tres columnas ausentes habría devuelto 400 y lo habría perdido.
    const falso = baseSinColumnasDeTema(FILA_SIN_TEMA)
    holder.client = falso.client
    escriturasDeLaBaseVieja = []
    await fetchStoreSettings(TIENDA)

    await saveStoreSettings({
      storeId: TIENDA,
      organizationId: ORG,
      companyId: SOCIEDAD,
      currentName: 'Botica',
      values: { ...toForm('Botica', null), contact_phone: '+51 999 111 222' },
      canWhiteLabel: false,
    })

    const patch = escriturasDeLaBaseVieja.at(-1) ?? {}
    expect(patch.contact_phone).toBe('+51 999 111 222')
    for (const campo of ['theme_preset', 'storefront_style', 'home_layout']) {
      expect(patch).not.toHaveProperty(campo)
    }
  })
})

describe('cuando la base sí tiene las columnas', () => {
  it('se piden una sola vez y el diseño queda disponible', async () => {
    const selects: string[] = []
    holder.client = {
      from: () => ({
        select: (select: string) => {
          selects.push(select)
          const eslabon = {
            eq: () => eslabon,
            maybeSingle: () =>
              Promise.resolve({ data: { ...FILA_SIN_TEMA, theme_preset: 'retail' }, error: null }),
          }
          return eslabon
        },
      }),
    }

    const ajustes = await fetchStoreSettings(TIENDA)

    expect(selects).toHaveLength(1)
    expect(ajustes?.theme_preset).toBe('retail')
    expect(themeColumnsReady()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toForm
// ---------------------------------------------------------------------------

describe('toForm parte de valores seguros', () => {
  it('una tienda sin fila de ajustes empieza en universal y sin nada pisado', () => {
    const valores = toForm('Botica', null)

    expect(valores.theme_preset).toBe('universal')
    expect(valores.storefront_style).toEqual({})
    // Vacío significa «uso el orden heredado». Rellenarlo con las trece
    // secciones de hoy congelaría esta tienda en el orden de hoy.
    expect(valores.home_layout).toEqual({ version: 1, sections: [] })
  })

  it('una fila anterior al Theme Engine tampoco rompe la pantalla', () => {
    const fila = storeSettingsSchema.parse({
      store_id: TIENDA,
      organization_id: ORG,
      company_id: SOCIEDAD,
      accent_color: '#5AA97F',
    })

    expect(toForm('Botica', fila).theme_preset).toBe('universal')
  })

  it('una fila con basura se lee sin lanzar', () => {
    const fila = storeSettingsSchema.parse({
      store_id: TIENDA,
      organization_id: ORG,
      company_id: SOCIEDAD,
      accent_color: '#5AA97F',
      theme_preset: 'pharmacy',
      storefront_style: { css: 'x', contentWidth: 'xl' },
      home_layout: { version: 9, sections: 'no' },
    })

    const valores = toForm('Botica', fila)

    expect(valores.theme_preset).toBe('universal')
    expect(valores.storefront_style).toEqual({ contentWidth: 'xl' })
    expect(valores.home_layout).toEqual({ version: 1, sections: [] })
  })

  it('conserva lo que la tienda sí había elegido', () => {
    const fila = storeSettingsSchema.parse({
      store_id: TIENDA,
      organization_id: ORG,
      company_id: SOCIEDAD,
      accent_color: '#5AA97F',
      theme_preset: 'premium',
      storefront_style: { imageRatio: 'portrait' },
      home_layout: { version: 1, sections: [{ id: 'trust', enabled: true }] },
    })

    const valores = toForm('Botica', fila)

    expect(valores.theme_preset).toBe('premium')
    expect(valores.storefront_style).toEqual({ imageRatio: 'portrait' })
    expect(valores.home_layout.sections).toHaveLength(1)
  })

  it('lo que produce toForm siempre pasa la validación del formulario', () => {
    expect(storeFormSchema.safeParse(toForm('Botica', null)).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// El formulario rechaza lo que la base rechazaría
// ---------------------------------------------------------------------------

describe('el formulario replica los CHECK de la base', () => {
  const base = toForm('Botica', null)

  it.each([
    ['un tema inventado', { theme_preset: 'pharmacy' }],
    ['una clave de estilo que no existe', { storefront_style: { css: '.x{}' } }],
    ['un valor de estilo fuera de la lista', { storefront_style: { contentWidth: 'full' } }],
    ['una sección desconocida', { home_layout: { version: 1, sections: [{ id: 'ads', enabled: true }] } }],
    ['una versión futura', { home_layout: { version: 2, sections: [] } }],
    [
      'un tope desbordado',
      { home_layout: { version: 1, sections: [{ id: 'offers', enabled: true, maxItems: 99 }] } },
    ],
  ])('rechaza %s', (_caso, parche) => {
    expect(storeFormSchema.safeParse({ ...base, ...parche }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveStoreSettings
// ---------------------------------------------------------------------------

describe('guardar la configuración', () => {
  it('envía los tres campos del tema', async () => {
    const patch = await guardar(true, {
      theme_preset: 'catalog',
      storefront_style: { contentWidth: 'xl' },
      home_layout: DEFAULT_HOME_LAYOUT,
    })

    expect(patch.theme_preset).toBe('catalog')
    expect(patch.storefront_style).toEqual({ contentWidth: 'xl' })
    expect(patch.home_layout).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('los envía IGUAL sin el addon de marca blanca', async () => {
    const patch = await guardar(false, {
      theme_preset: 'retail',
      storefront_style: { sectionSpacing: 'compact' },
    })

    expect(patch.theme_preset).toBe('retail')
    expect(patch.storefront_style).toEqual({ sectionSpacing: 'compact' })
    expect(patch).toHaveProperty('home_layout')
  })

  it('sin el addon sigue sin escribir lo premium', async () => {
    const patch = await guardar(false, {
      white_label: true,
      font_family: 'grotesk',
      email_from_name: 'Botica',
      email_reply_to: 'hola@botica.com',
    })

    for (const campo of ['white_label', 'font_family', 'email_from_name', 'email_reply_to']) {
      expect(patch).not.toHaveProperty(campo)
    }
  })

  it('con el addon sí escribe lo premium, y el tema sigue estando', async () => {
    const patch = await guardar(true, { white_label: true, font_family: 'grotesk' })

    expect(patch.white_label).toBe(true)
    expect(patch.font_family).toBe('grotesk')
    expect(patch.theme_preset).toBe('universal')
  })

  it('no toca la identidad ni las reglas de compra al guardar el tema', async () => {
    // Lo que esta fase NO puede cambiar. Si mañana alguien mete el tema dentro
    // del bloque premium, o le quita al comercio su regla de cuenta, aquí salta.
    const patch = await guardar(true, { theme_preset: 'premium' })

    expect(patch.checkout_requires_account).toBe(false)
    expect(patch.require_payment_before_dispatch).toBe(false)
    expect(patch.accent_color).toBe('#5aa97f')
  })
})
