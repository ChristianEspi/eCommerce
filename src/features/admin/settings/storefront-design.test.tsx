import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { renderWithProviders } from '@/test/render'
import { DEFAULT_HOME_LAYOUT } from '@/features/storefront/theme/presets'
import { HOME_SECTION_IDS } from '@/features/storefront/theme/types'
import { StorefrontDesignSection } from './StorefrontDesignSection'
import { storeFormSchema, toForm, type StoreFormValues } from './types'

/**
 * «Diseño de tienda»: elegir tema, ajustarlo y ordenar la portada.
 *
 * ## Lo que se comprueba, en una frase
 *
 * Que un comercio puede cambiar la cara de su tienda **con el teclado**, sin
 * escribir JSON y sin que nada de esto dependa de un addon.
 *
 * Las dos que más valen:
 *
 *  · **el orden se mueve sin arrastrar.** Arrastrar no se puede hacer con el
 *    teclado, y una parte de quien administra una tienda no usa ratón;
 *  · **el tema no es premium.** Si algún día alguien mete estos campos en el
 *    bloque que exige `content.white_label`, esta pantalla dejaría de servirle
 *    a quien no lo tiene contratado — que son casi todos.
 */

/** Un formulario real, con el mismo esquema y los mismos valores que la pantalla. */
function Anfitrion({ inicial }: { inicial?: Partial<StoreFormValues> }) {
  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: { ...toForm('Botica', null), ...inicial },
    mode: 'onBlur',
  })

  return (
    <>
      <StorefrontDesignSection form={form} />
      {/* Espejo del estado: lo que se guardaría si alguien pulsara Guardar. */}
      <pre data-testid="valores">{JSON.stringify(form.watch())}</pre>
      <span data-testid="sucio">{String(form.formState.isDirty)}</span>
    </>
  )
}

function pintar(inicial?: Partial<StoreFormValues>) {
  renderWithProviders(<Anfitrion inicial={inicial} />, { route: '/app/settings' })
}

function valores(): StoreFormValues {
  return JSON.parse(screen.getByTestId('valores').textContent ?? '{}') as StoreFormValues
}

const tema = (nombre: string) => screen.getByRole('radio', { name: new RegExp(nombre, 'i') })

// ---------------------------------------------------------------------------
// Elegir tema
// ---------------------------------------------------------------------------

describe('elegir el tema', () => {
  it('los cuatro se ofrecen como opciones excluyentes', () => {
    pintar()

    const grupo = screen.getByRole('radiogroup')
    expect(within(grupo).getAllByRole('radio')).toHaveLength(4)
  })

  it('la tienda empieza en universal y se ve cuál está elegido', () => {
    pintar()

    expect(tema('universal')).toHaveAttribute('aria-checked', 'true')
    expect(tema('retail')).toHaveAttribute('aria-checked', 'false')
  })

  it.each(['Retail', 'Premium', 'Catálogo'])('se puede elegir %s', async (nombre) => {
    const user = userEvent.setup()
    pintar()

    await user.click(tema(nombre))

    expect(tema(nombre)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('sucio')).toHaveTextContent('true')
  })

  it('se puede elegir con el teclado, no solo con el ratón', async () => {
    const user = userEvent.setup()
    pintar()

    tema('premium').focus()
    await user.keyboard('{Enter}')

    expect(valores().theme_preset).toBe('premium')
  })

  it('elegir uno descarta el anterior', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(tema('retail'))
    await user.click(tema('catálogo'))

    expect(valores().theme_preset).toBe('catalog')
    expect(tema('retail')).toHaveAttribute('aria-checked', 'false')
  })

  it('ningún tema se anuncia como exclusivo de un rubro', () => {
    pintar()

    const grupo = screen.getByRole('radiogroup')
    const texto = grupo.textContent ?? ''
    // Los ejemplos ayudan a elegir; las restricciones estorban. En cuanto un
    // tema dice «solo moda», el comercio de muebles deja de mirarlo.
    for (const restriccion of ['solo ', 'únicamente', 'exclusivo para']) {
      expect(texto.toLowerCase()).not.toContain(restriccion)
    }
  })
})

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

describe('ajustar el tema', () => {
  it('todo empieza heredando, sin nada pisado', () => {
    pintar()

    expect(valores().storefront_style).toEqual({})
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(7)
  })

  it('pisar un ajuste guarda ese y solo ese', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByLabelText('Ancho del contenido'))
    await user.click(screen.getByRole('option', { name: 'Extra ancho' }))

    expect(valores().storefront_style).toEqual({ contentWidth: 'xl' })
  })

  it('volver a heredar borra el valor en vez de guardar uno vacío', async () => {
    const user = userEvent.setup()
    pintar({ storefront_style: { contentWidth: 'xl' } })

    await user.click(screen.getByLabelText('Ancho del contenido'))
    await user.click(screen.getByRole('option', { name: 'Heredar del tema' }))

    expect(valores().storefront_style).toEqual({})
  })

  it('restablecer devuelve todo al tema', async () => {
    const user = userEvent.setup()
    pintar({ storefront_style: { contentWidth: 'xl', imageRatio: 'portrait' } })

    await user.click(screen.getByRole('button', { name: 'Restablecer estilo del tema' }))

    expect(valores().storefront_style).toEqual({})
  })

  it('restablecer está apagado cuando no hay nada que restablecer', () => {
    pintar()

    expect(screen.getByRole('button', { name: 'Restablecer estilo del tema' })).toBeDisabled()
  })

  it('no hay ni un campo libre donde escribir estilos', () => {
    pintar()

    // Todo lo del tema son listas cerradas. Una caja de texto aquí sería la
    // puerta por la que entra el CSS del tenant.
    const textos = screen.queryAllByRole('textbox')
    expect(textos).toHaveLength(0)
    expect(screen.getByTestId('valores').textContent).not.toContain('css')
  })
})

// ---------------------------------------------------------------------------
// Orden de la portada
// ---------------------------------------------------------------------------

describe('ordenar la portada', () => {
  it('se listan todas las secciones conocidas', () => {
    pintar()

    expect(screen.getAllByRole('listitem')).toHaveLength(HOME_SECTION_IDS.length)
  })

  it('cada botón dice a qué sección pertenece', () => {
    pintar()

    // «Subir» a secas, veintiséis veces, no se distingue de ninguna manera.
    expect(screen.getByRole('button', { name: 'Subir: Ofertas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bajar: Ofertas' })).toBeInTheDocument()
  })

  it('la primera no puede subir y la última no puede bajar', () => {
    pintar()

    const primera = DEFAULT_HOME_LAYOUT.sections[0]?.id
    expect(primera).toBe('hero')
    expect(screen.getByRole('button', { name: 'Subir: Portada' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar: Boletín' })).toBeDisabled()
  })

  it('bajar una sección la mueve una posición, con el teclado', async () => {
    const user = userEvent.setup()
    pintar()

    screen.getByRole('button', { name: 'Bajar: Portada' }).focus()
    await user.keyboard('{Enter}')

    const ids = valores().home_layout.sections.map((s) => s.id)
    expect(ids[0]).toBe('services')
    expect(ids[1]).toBe('hero')
  })

  it('apagar una sección se guarda', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar: Marcas' }))

    const marcas = valores().home_layout.sections.find((s) => s.id === 'brands')
    expect(marcas?.enabled).toBe(false)
  })

  it('una sección sin componente todavía no se puede encender', () => {
    pintar()

    expect(screen.getByRole('checkbox', { name: 'Mostrar: Boletín' })).toBeDisabled()
    // Y se dice por qué, en vez de esconderla: quien la busca y no la
    // encuentra no sabe si no existe o si no la ha visto.
    expect(screen.getAllByText('Todavía no disponible').length).toBeGreaterThan(0)
  })

  it('el tope solo aparece donde significa algo', () => {
    pintar()

    expect(screen.getByLabelText('Máximo: Ofertas')).toBeInTheDocument()
    // El hero enseña una cosa y los servicios cuatro fijas: un tope ahí es
    // ruido que alguien tendría que interpretar.
    expect(screen.queryByLabelText('Máximo: Portada')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Máximo: Servicios')).not.toBeInTheDocument()
  })

  it('un tope fuera de rango se acota en vez de guardarse mal', async () => {
    const user = userEvent.setup()
    pintar()

    const campo = screen.getByLabelText('Máximo: Ofertas')
    await user.clear(campo)
    await user.type(campo, '99')

    const ofertas = valores().home_layout.sections.find((s) => s.id === 'offers')
    expect(ofertas?.maxItems).toBe(24)
  })

  it('volver al orden recomendado deshace el desorden', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('button', { name: 'Bajar: Portada' }))
    await user.click(screen.getByRole('button', { name: 'Volver al orden recomendado' }))

    expect(valores().home_layout.sections.map((s) => s.id)).toEqual(
      DEFAULT_HOME_LAYOUT.sections.map((s) => s.id),
    )
  })
})

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

describe('la vista previa', () => {
  const marco = () => screen.getByTestId('preview-frame')

  it('arranca en escritorio y con el tema puesto', () => {
    pintar()

    expect(marco()).toHaveAttribute('data-viewport', 'desktop')
    expect(marco()).toHaveAttribute('data-store-theme', 'universal')
  })

  it('cambiar de tema la cambia al momento, sin guardar', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(tema('catálogo'))

    expect(marco()).toHaveAttribute('data-store-theme', 'catalog')
    expect(marco()).toHaveAttribute('data-store-header', 'compact')
  })

  it('refleja un ajuste sin guardar', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByLabelText('Aire entre secciones'))
    await user.click(screen.getByRole('option', { name: 'Amplio' }))

    expect(marco()).toHaveAttribute('data-store-spacing', 'spacious')
  })

  it('refleja el orden de la portada sin guardar', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar: Marcas' }))

    // La sección apagada desaparece de la vista previa igual que desaparecería
    // de la tienda.
    expect(within(marco()).queryByText('Marcas')).not.toBeInTheDocument()
  })

  it('se cambia de tamaño con el teclado', async () => {
    const user = userEvent.setup()
    pintar()

    screen.getByRole('button', { name: 'Móvil' }).focus()
    await user.keyboard('{Enter}')

    expect(marco()).toHaveAttribute('data-viewport', 'mobile')
  })

  it('mirar la vista previa no guarda nada', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('button', { name: 'Tableta' }))

    // El tamaño de la vista previa es de quien mira, no de la tienda: no
    // ensucia el formulario ni acaba en la base.
    expect(screen.getByTestId('sucio')).toHaveTextContent('false')
    expect(screen.getByTestId('valores').textContent).not.toContain('viewport')
  })
})

// ---------------------------------------------------------------------------
// Lo que se guarda
// ---------------------------------------------------------------------------

describe('lo que sale de esta pantalla es válido', () => {
  it('cualquier combinación pasa la validación del formulario', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(tema('premium'))
    await user.click(screen.getByLabelText('Proporción de las fotos'))
    await user.click(screen.getByRole('option', { name: 'Vertical' }))
    await user.click(screen.getByRole('button', { name: 'Bajar: Portada' }))

    expect(storeFormSchema.safeParse(valores()).success).toBe(true)
  })

  it('tocar el diseño no toca la identidad ni el contacto de la tienda', async () => {
    const user = userEvent.setup()
    pintar({ name: 'Botica del Centro', support_email: 'hola@botica.pe' })

    await user.click(tema('catálogo'))

    expect(valores().name).toBe('Botica del Centro')
    expect(valores().support_email).toBe('hola@botica.pe')
  })
})
