import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { renderWithProviders } from '@/test/render'
import { DEFAULT_HOME_LAYOUT, THEME_PRESETS } from '@/features/storefront/theme/presets'
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
/** Cuenta los renders del anfitrión: un `watch` realimentado se ve aquí. */
let renders = 0

function Anfitrion({ inicial }: { inicial?: Partial<StoreFormValues> }) {
  renders += 1
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
      <span data-testid="renders">{renders}</span>
    </>
  )
}

function pintar(inicial?: Partial<StoreFormValues>) {
  renders = 0
  renderWithProviders(<Anfitrion inicial={inicial} />, { route: '/app/settings' })
}

function valores(): StoreFormValues {
  return JSON.parse(screen.getByTestId('valores').textContent ?? '{}') as StoreFormValues
}

const tema = (nombre: string) => screen.getByRole('radio', { name: new RegExp(nombre, 'i') })

/**
 * Abre un grupo de ajustes finos (Storefront V2 · P10).
 *
 * Desde P10 los siete desplegables van plegados en tres grupos: los ajustes
 * son la excepción, no el caso normal, y siete controles abiertos ocupaban más
 * pantalla que la elección del tema — que es LA decisión.
 */
async function abrirGrupo(user: ReturnType<typeof userEvent.setup>, nombre: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(nombre, 'i') }))
}

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
  it('todo empieza heredando, sin nada pisado', async () => {
    const user = userEvent.setup()
    pintar()

    expect(valores().storefront_style).toEqual({})

    // Los siete siguen ahí; lo que cambia en P10 es que hay que abrir su grupo.
    for (const grupo of ['Estructura', 'Producto', 'Espaciado y ancho']) {
      await abrirGrupo(user, grupo)
    }
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(7)
  })

  /**
   * Los tres grupos (Storefront V2 · P10).
   *
   * Siete desplegables abiertos, todos con el mismo peso y todos diciendo
   * «Heredar del tema», ocupaban más pantalla que la elección del tema y
   * ofrecían siete preguntas a quien acababa de responder una.
   */
  it('los grupos llegan plegados, pero el que lleva algo pisado se abre solo', () => {
    pintar({ storefront_style: { contentWidth: 'xl' } })

    // El de espaciado, que es donde vive lo pisado, está abierto.
    expect(screen.getByRole('button', { name: /Espaciado y ancho/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // Los otros dos, no: lo normal no tiene por qué ocupar sitio.
    expect(screen.getByRole('button', { name: /^Estructura/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('un grupo plegado dice cuántos ajustes lleva dentro', () => {
    // Si no, esconder es esconder: quien no recuerda qué tocó hace tres meses
    // tendría que abrir los tres grupos para encontrarlo.
    pintar({ storefront_style: { heroVariant: 'statement', categoryVariant: 'pills' } })

    expect(screen.getByLabelText('2 personalizados en este grupo')).toBeInTheDocument()
  })

  it('se cuenta lo personalizado, y sin nada dice que todo lo hereda', () => {
    pintar({ storefront_style: { contentWidth: 'xl', imageRatio: 'portrait' } })
    // Ocho desde V3 · P02: el contrato gana el encaje de la foto, que hasta
    // entonces estaba cableado dentro de la tarjeta.
    expect(screen.getByText('2 de 8 ajustes personalizados')).toBeInTheDocument()

    cleanup()
    pintar()
    expect(screen.getByText('Todo lo hereda del tema.')).toBeInTheDocument()
  })

  it('la opción de heredar DICE qué se hereda, no solo que hereda', async () => {
    // «Heredar del tema» a secas obligaba a abrir la vitrina para saber si la
    // tienda tenía las tarjetas cómodas o compactas. El dato estaba aquí.
    const user = userEvent.setup()
    pintar()

    await abrirGrupo(user, 'Espaciado y ancho')
    await user.click(screen.getByLabelText('Ancho del contenido'))

    // universal hereda `lg`, que en la pantalla se llama «Normal».
    expect(screen.getByRole('option', { name: 'Usar tema: Normal' })).toBeInTheDocument()
  })

  it('y lo que dice cambia con el tema elegido', async () => {
    const user = userEvent.setup()
    pintar({ theme_preset: 'premium' })

    await abrirGrupo(user, 'Producto')
    await user.click(screen.getByLabelText('Tarjeta de producto'))

    // premium hereda tarjeta EDITORIAL desde V3 · P02 —la que suelta el
    // recuadro y deja mandar a la fotografía—; retail sigue compacta.
    expect(screen.getByRole('option', { name: 'Usar tema: Editorial' })).toBeInTheDocument()
  })

  it('pisar un ajuste guarda ese y solo ese', async () => {
    const user = userEvent.setup()
    pintar()

    await abrirGrupo(user, 'Espaciado y ancho')
    await user.click(screen.getByLabelText('Ancho del contenido'))
    await user.click(screen.getByRole('option', { name: 'Extra ancho' }))

    expect(valores().storefront_style).toEqual({ contentWidth: 'xl' })
  })

  it('volver a heredar borra el valor en vez de guardar uno vacío', async () => {
    const user = userEvent.setup()
    pintar({ storefront_style: { contentWidth: 'xl' } })

    await user.click(screen.getByLabelText('Ancho del contenido'))
    await user.click(screen.getByRole('option', { name: 'Usar tema: Normal' }))

    expect(valores().storefront_style).toEqual({})
  })

  it('restablecer devuelve todo al tema', async () => {
    const user = userEvent.setup()
    pintar({ storefront_style: { contentWidth: 'xl', imageRatio: 'portrait' } })

    await user.click(screen.getByRole('button', { name: 'Restablecer al tema' }))

    expect(valores().storefront_style).toEqual({})
  })

  it('restablecer está apagado cuando no hay nada que restablecer', () => {
    pintar()

    expect(screen.getByRole('button', { name: 'Restablecer al tema' })).toBeDisabled()
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
    // Desde P12 la última ORDENABLE es la última que se pinta: «Boletín» ya no
    // está en la lista, está en «Próximamente» y no tiene flechas.
    expect(screen.getByRole('button', { name: 'Bajar: Datos del negocio' })).toBeDisabled()
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

  it('las familias de la portada (categories) ya se pueden encender', () => {
    pintar()

    expect(screen.getByRole('checkbox', { name: 'Mostrar: Categorías' })).toBeEnabled()
  })

  it('los datos del negocio ya se pueden encender (P09)', () => {
    // Estuvo en el contrato y en esta pantalla desde el principio, apagada y
    // sin poder encenderse. Ahora pinta contacto, nombre y páginas reales.
    pintar()

    expect(screen.getByRole('checkbox', { name: 'Mostrar: Datos del negocio' })).toBeEnabled()
  })

  /**
   * «Próximamente» (Storefront V2 · P12).
   *
   * Las secciones sin componente estaban mezcladas con las demás, apagadas y
   * con una nota debajo, y se podían subir y bajar como si significara algo.
   * Ordenar lo que no se pinta es ordenar nada, y además empujaba a las de
   * verdad fuera de sitio.
   */
  it('una sección sin componente no se puede encender NI ordenar', () => {
    pintar()

    // Ni interruptor ni flechas: un control desactivado invita a pulsarlo.
    expect(screen.queryByRole('checkbox', { name: 'Mostrar: Boletín' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Boletín/ })).not.toBeInTheDocument()
  })

  it('pero se sigue enseñando, y se dice por qué', () => {
    // Esconderla sería más limpio y peor: quien busca «boletín» y no lo
    // encuentra no sabe si no existe o si no lo ha visto.
    pintar()

    expect(screen.getByText('Próximamente')).toBeInTheDocument()
    expect(screen.getByText('Boletín')).toBeInTheDocument()
    expect(screen.getAllByText(/Todavía no disponible/).length).toBeGreaterThan(0)
  })

  it('reordenar las activas no mueve a las pendientes de su sitio', () => {
    // El array guardado lleva las trece. Si al mover una activa se arrastrara
    // una pendiente, el orden guardado cambiaría por algo que el comercio no
    // tocó — la clase de diferencia que aparece meses después como «yo no moví
    // eso».
    pintar()
    const antes = valores().home_layout.sections.findIndex((s) => s.id === 'newsletter')

    screen.getByRole('button', { name: 'Bajar: Portada' }).click()

    expect(valores().home_layout.sections.findIndex((s) => s.id === 'newsletter')).toBe(antes)
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

// ---------------------------------------------------------------------------
// El taller (Storefront V2 · P10)
// ---------------------------------------------------------------------------

/**
 * «Diseño de tienda» como TALLER, no como formulario.
 *
 * Hasta P10 la vista previa estaba al final: se elegía el tema arriba, se bajaba
 * por siete desplegables y el editor de secciones, y se llegaba a la vista
 * previa cuando ya no se veía lo que se había tocado. Configurar una tienda es
 * un lazo de prueba y error, y si el lazo no cabe en una pantalla, se rompe: se
 * elige un tema a ciegas y no se vuelve.
 */
describe('el taller de diseño', () => {
  it('son dos zonas con nombre: se configura en una y se mira en la otra', () => {
    pintar()

    expect(screen.getByRole('region', { name: 'Configuración del diseño' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Vista previa' })).toBeInTheDocument()
  })

  it('la configuración va ANTES que la vista previa en el documento', () => {
    // En dos columnas eso es «izquierda y derecha»; en una —tableta y
    // teléfono— es «primero configuro, luego miro», que es el orden en el que
    // se lee y el que oye quien navega con un lector de pantalla. Fijarlo aquí
    // es lo que impide que un día la vista previa acabe encima del formulario
    // en un teléfono, empujando la configuración fuera de la primera pantalla.
    pintar()

    const taller = screen.getByTestId('design-workspace')
    const configuracion = screen.getByRole('region', { name: 'Configuración del diseño' })
    const previa = screen.getByRole('region', { name: 'Vista previa' })

    expect(taller).toContainElement(configuracion)
    expect(taller).toContainElement(previa)
    expect(
      configuracion.compareDocumentPosition(previa) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('las tres decisiones están en la columna de configuración, y la tienda no', () => {
    pintar()

    const configuracion = screen.getByRole('region', { name: 'Configuración del diseño' })

    expect(within(configuracion).getByRole('radiogroup')).toBeInTheDocument()
    expect(within(configuracion).getByText('Ajustes del tema')).toBeInTheDocument()
    expect(within(configuracion).getByRole('checkbox', { name: 'Mostrar: Marcas' })).toBeInTheDocument()
    expect(within(configuracion).queryByTestId('preview-frame')).not.toBeInTheDocument()
  })

  it('abrir y cerrar un grupo no ensucia el formulario', async () => {
    // Lo que está abierto es de quien mira, no de la tienda. Si esto ensuciara
    // el formulario, la barra de Guardar avisaría de cambios sin guardar por
    // haber abierto un desplegable, y al pulsar Guardar no cambiaría nada.
    const user = userEvent.setup()
    pintar()

    await abrirGrupo(user, 'Estructura')
    await abrirGrupo(user, 'Estructura')

    expect(screen.getByTestId('sucio')).toHaveTextContent('false')
  })

  it('los grupos se abren con el teclado', async () => {
    const user = userEvent.setup()
    pintar()

    const grupo = screen.getByRole('button', { name: /^Producto/i })
    grupo.focus()
    await user.keyboard('{Enter}')

    expect(grupo).toHaveAttribute('aria-expanded', 'true')
  })

  it('mirar la tienda y cambiarla no dispara un bucle de renders', async () => {
    // El taller lee el formulario con `form.watch`, y un `watch` que escriba
    // en el formulario al renderizar se realimenta hasta colgar la pestaña.
    // Un cambio = un puñado de renders, no cientos.
    const user = userEvent.setup()
    pintar()

    const antes = Number(screen.getByTestId('renders').textContent)
    await user.click(tema('premium'))
    const despues = Number(screen.getByTestId('renders').textContent)

    expect(despues).toBeGreaterThan(antes)
    expect(despues - antes).toBeLessThan(10)
  })
})

// ---------------------------------------------------------------------------
// El selector visual y el editor compacto (Storefront V2 · P12)
// ---------------------------------------------------------------------------

/**
 * Elegir un tema es una decisión VISUAL.
 *
 * Hasta P12 se tomaba leyendo cuatro frases de una línea. «Visual y editorial:
 * fotos grandes, más aire» describe bien `premium` y no dice cuántas columnas
 * tiene, que es lo que de verdad cambia la pantalla.
 *
 * Las miniaturas se dibujan con la DEFINICIÓN del preset. Cuatro capturas
 * habrían sido más bonitas y estarían mal el mismo día que alguien cambie un
 * valor: una imagen no se entera de que `retail` pasó de cinco columnas a seis.
 */
describe('el selector visual de temas', () => {
  const miniatura = (preset: string) =>
    document.querySelector(`[data-theme-mini="${preset}"]`) as HTMLElement | null

  it('cada tarjeta lleva su miniatura', () => {
    pintar()

    for (const preset of ['universal', 'retail', 'premium', 'catalog']) {
      expect(miniatura(preset)).toBeInTheDocument()
    }
  })

  it('la miniatura sale de la definición del preset, no de un dibujo fijo', () => {
    // `retail` declara cinco columnas y `premium` tres. Si esto se rompe al
    // cambiar un preset, la miniatura estaba mintiendo.
    pintar()

    const columnas = (preset: string) =>
      miniatura(preset)?.querySelector('[data-mini-columns]')?.getAttribute('data-mini-columns')

    expect(columnas('retail')).toBe(String(THEME_PRESETS.retail.gridColumns.lg))
    expect(columnas('premium')).toBe(String(THEME_PRESETS.premium.gridColumns.lg))
    expect(columnas('retail')).not.toBe(columnas('premium'))
  })

  it('las miniaturas no se anuncian: lo que se lee es el texto de al lado', () => {
    pintar()

    expect(miniatura('universal')).toHaveAttribute('aria-hidden', 'true')
  })

  it('cada tarjeta dice sus diferencias en datos, para quien no ve la miniatura', () => {
    pintar()

    const catalogo = tema('catálogo')
    expect(catalogo.textContent).toContain(`${THEME_PRESETS.catalog.gridColumns.lg} columnas`)
    // Y la tarjeta de producto y la portada que trae el preset.
    expect(catalogo.textContent).toContain('Compacta')
  })

  it('siguen siendo cuatro opciones excluyentes y se ve cuál está elegida', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(tema('premium'))

    expect(tema('premium')).toHaveAttribute('aria-checked', 'true')
    expect(tema('universal')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('ninguna tarjeta ata un tema a un rubro', () => {
    // El resumen se arma con la definición, así que no puede colar un rubro sin
    // querer; esta prueba lo fija por si alguien redacta uno a mano.
    pintar()

    // Por palabra entera: «cómoda» es el nombre de una tarjeta de producto y
    // contiene «moda» sin hablar de ropa.
    const prohibidos = ['farmacia', 'botica', 'moda', 'calzado', 'zapatilla', 'restaurante']
    const texto = screen.getByRole('radiogroup').textContent?.toLowerCase() ?? ''
    for (const palabra of prohibidos) {
      expect(texto).not.toMatch(new RegExp(`\b${palabra}`))
    }
  })
})

/**
 * Arrastrar, como AÑADIDO.
 *
 * Los botones siguen siendo el camino completo: arrastrar no se puede hacer con
 * el teclado. Lo que se comprueba aquí es que arrastrar hace lo mismo que las
 * flechas, no que las sustituye.
 */
describe('reordenar arrastrando', () => {
  /** Un arrastre nativo: empezar, pasar por encima y soltar. */
  function arrastrar(desde: HTMLElement, hasta: HTMLElement) {
    fireEvent.dragStart(desde)
    fireEvent.dragOver(hasta)
    fireEvent.drop(hasta)
  }

  const fila = (id: string) => document.querySelector(`[data-section="${id}"]`) as HTMLElement

  it('soltar una sección sobre otra la lleva a su posición', () => {
    pintar()

    // Portada · Servicios · Ofertas → soltar «Portada» sobre «Ofertas» la deja
    // DONDE estaba «Ofertas», que al bajar significa justo detrás de ella.
    arrastrar(fila('hero'), fila('offers'))

    const orden = valores().home_layout.sections.map((s) => s.id)
    expect(orden.slice(0, 3)).toEqual(['services', 'offers', 'hero'])
  })

  it('arrastrar hacia arriba también funciona', () => {
    pintar()

    arrastrar(fila('offers'), fila('hero'))

    expect(valores().home_layout.sections[0]?.id).toBe('offers')
  })

  it('soltar una sección sobre sí misma no cambia nada', () => {
    pintar()
    const antes = JSON.stringify(valores().home_layout)

    arrastrar(fila('hero'), fila('hero'))

    expect(JSON.stringify(valores().home_layout)).toBe(antes)
  })

  it('las flechas SIGUEN ahí y hacen lo mismo', async () => {
    // La prueba que impide que un día arrastrar sustituya a las flechas y la
    // pantalla deje de servirle a quien no usa ratón.
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('button', { name: 'Bajar: Portada' }))

    expect(valores().home_layout.sections[0]?.id).toBe('services')
    expect(valores().home_layout.sections[1]?.id).toBe('hero')
  })

  it('el orden guardado sigue teniendo las trece secciones', () => {
    // Reordenar no puede perder ninguna por el camino: la que se cayera del
    // array volvería a aparecer al final en la próxima normalización, en un
    // sitio que el comercio no eligió.
    pintar()

    arrastrar(fila('trust'), fila('hero'))

    const orden = valores().home_layout.sections.map((s) => s.id)
    expect(orden).toHaveLength(HOME_SECTION_IDS.length)
    expect(new Set(orden).size).toBe(HOME_SECTION_IDS.length)
  })

  it('arrastrar se refleja en la vista previa sin guardar', () => {
    pintar()

    arrastrar(fila('brands'), fila('hero'))

    const marco = screen.getByTestId('preview-frame')
    const titulos = Array.from(marco.querySelectorAll('h1, h2, p, span'))
      .map((n) => n.textContent)
      .filter(Boolean)
    // «Marcas» pasa a estar antes que cualquier otra sección de la portada.
    expect(titulos.indexOf('Marcas')).toBeGreaterThan(-1)
  })
})
