import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { renderWithProviders } from '@/test/render'
import { VALUE_PROPS_LIMITS } from '@/features/storefront/valueProps'
import { ValuePropsSection } from './ValuePropsSection'
import { storeFormSchema, toForm, type StoreFormValues } from './types'

/**
 * El editor de propuestas de valor.
 *
 * ## Qué se comprueba, en una frase
 *
 * Que un comercio puede escribir sus propias promesas **con el teclado**, que
 * lo que escribe es lo que se guardaría, y que no puede guardar nada que la
 * base vaya a rechazar.
 *
 * Las dos que más valen:
 *
 *  · **sin nada configurado se explica qué se está viendo.** Un bloque vacío
 *    sin explicación hace pensar que la franja no existe, y el comercio se
 *    queda creyendo que su tienda no dice nada bajo la portada;
 *  · **el orden se mueve sin arrastrar.** Arrastrar no se puede hacer con el
 *    teclado, y una parte de quien administra una tienda no usa ratón.
 */

function Anfitrion({ inicial }: { inicial?: Partial<StoreFormValues> }) {
  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: { ...toForm('Tienda', null), ...inicial },
    mode: 'onBlur',
  })

  return (
    <>
      <ValuePropsSection form={form} />
      <pre data-testid="valores">{JSON.stringify(form.watch())}</pre>
      <span data-testid="sucio">{String(form.formState.isDirty)}</span>
    </>
  )
}

function pintar(inicial?: Partial<StoreFormValues>) {
  renderWithProviders(<Anfitrion inicial={inicial} />, { route: '/app/settings' })
}

function propuestas() {
  const valores = JSON.parse(screen.getByTestId('valores').textContent ?? '{}') as StoreFormValues
  return valores.value_props
}

describe('una tienda que no ha configurado nada', () => {
  it('lo dice, en vez de dejar un hueco', () => {
    pintar()

    expect(screen.getByText(/lo que la plataforma puede afirmar/i)).toBeInTheDocument()
    expect(propuestas()).toEqual([])
  })

  it('el formulario no nace sucio: enseñar no es cambiar', () => {
    pintar()

    expect(screen.getByTestId('sucio')).toHaveTextContent('false')
  })
})

describe('añadir una propuesta', () => {
  it('llega con la sugerencia del icono ya escrita', async () => {
    const user = userEvent.setup()
    pintar()

    await user.click(screen.getByRole('button', { name: /Añadir propuesta/i }))

    // La sugerencia existe para que la fila nueva no nazca en blanco: lo que
    // hay que inventar desde cero se queda sin escribir.
    expect(propuestas()).toEqual([
      {
        iconKey: 'delivery',
        title: 'Envío a domicilio',
        body: 'Eliges el método al pagar',
        enabled: true,
      },
    ])
    expect(screen.getByTestId('sucio')).toHaveTextContent('true')
  })

  it('cada fila nueva coge un icono LIBRE: no se repiten', async () => {
    const user = userEvent.setup()
    pintar()

    const anadir = screen.getByRole('button', { name: /Añadir propuesta/i })
    await user.click(anadir)
    await user.click(anadir)
    await user.click(anadir)

    const claves = propuestas().map((prop) => prop.iconKey)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('a la cuarta se cierra la puerta y se explica por qué', async () => {
    const user = userEvent.setup()
    pintar()

    const anadir = screen.getByRole('button', { name: /Añadir propuesta/i })
    for (let i = 0; i < VALUE_PROPS_LIMITS.max; i += 1) await user.click(anadir)

    expect(propuestas()).toHaveLength(VALUE_PROPS_LIMITS.max)
    expect(anadir).toBeDisabled()
    expect(screen.getByText(/Cuatro es el máximo/i)).toBeInTheDocument()
  })
})

describe('escribir la promesa', () => {
  const UNA: Partial<StoreFormValues> = {
    value_props: [{ iconKey: 'expertise', title: 'Asesoría', body: 'Pregunta', enabled: true }],
  }

  it('el texto del comercio es lo que se guardaría', async () => {
    const user = userEvent.setup()
    pintar(UNA)

    const titulo = screen.getByRole('textbox', { name: /^Título: Asesoría$/ })
    await user.clear(titulo)
    await user.type(titulo, 'Atención farmacéutica')

    expect(propuestas()[0]?.title).toBe('Atención farmacéutica')
  })

  it('el título no admite más de lo que la base acepta', async () => {
    const user = userEvent.setup()
    pintar(UNA)

    const titulo = screen.getByRole('textbox', { name: /^Título: Asesoría$/ })
    await user.clear(titulo)
    await user.type(titulo, 'a'.repeat(80))

    // El tope lo pone el propio campo: recortar al guardar sería cambiarle el
    // texto a alguien sin decírselo.
    expect(propuestas()[0]?.title).toHaveLength(VALUE_PROPS_LIMITS.titleMax)
  })

  it('vaciar el título se señala en su fila, no en un error genérico al guardar', async () => {
    const user = userEvent.setup()
    pintar(UNA)

    await user.clear(screen.getByRole('textbox', { name: /^Título: Asesoría$/ }))

    expect(screen.getByText(/Escribe un título de 1 a 40 caracteres/i)).toBeInTheDocument()
  })

  it('vaciar el apoyo lo QUITA en vez de guardarlo en blanco', async () => {
    const user = userEvent.setup()
    pintar(UNA)

    await user.clear(screen.getByRole('textbox', { name: /^Apoyo \(opcional\): Asesoría$/ }))

    // El CHECK de la base exige 1..90 si la clave viene. «Sin apoyo» y «apoyo
    // en blanco» son la misma cosa dicha de dos formas, y solo una se guarda.
    expect(propuestas()[0]).not.toHaveProperty('body')
  })

  it('apagar una propuesta la conserva escrita', async () => {
    const user = userEvent.setup()
    pintar(UNA)

    await user.click(screen.getByRole('checkbox', { name: /Visible en la tienda: Asesoría/i }))

    expect(propuestas()[0]?.enabled).toBe(false)
    expect(propuestas()[0]?.title).toBe('Asesoría')
  })
})

describe('ordenar y quitar', () => {
  const DOS: Partial<StoreFormValues> = {
    value_props: [
      { iconKey: 'delivery', title: 'Envíos', enabled: true },
      { iconKey: 'warranty', title: 'Garantía', enabled: true },
    ],
  }

  it('se reordena con los botones, sin arrastrar', async () => {
    const user = userEvent.setup()
    pintar(DOS)

    await user.click(screen.getByRole('button', { name: /Subir propuesta: Garantía/i }))

    expect(propuestas().map((prop) => prop.iconKey)).toEqual(['warranty', 'delivery'])
  })

  it('los botones de los extremos están desactivados, no fingen', async () => {
    pintar(DOS)

    expect(screen.getByRole('button', { name: /Subir propuesta: Envíos/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Bajar propuesta: Garantía/i })).toBeDisabled()
  })

  it('cada control dice a qué propuesta pertenece', () => {
    pintar(DOS)

    // En una lista de cuatro filas con cuatro controles cada una, dieciséis
    // botones llamados «Subir» no se distinguen de ninguna manera.
    expect(screen.getByRole('button', { name: /Quitar propuesta: Envíos/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Quitar propuesta: Garantía/i })).toBeInTheDocument()
  })

  it('quitar deja solo la otra', async () => {
    const user = userEvent.setup()
    pintar(DOS)

    await user.click(screen.getByRole('button', { name: /Quitar propuesta: Envíos/i }))

    expect(propuestas().map((prop) => prop.iconKey)).toEqual(['warranty'])
  })

  it('volver a las de plataforma deja la lista vacía, no una lista de tres', async () => {
    const user = userEvent.setup()
    pintar(DOS)

    await user.click(screen.getByRole('button', { name: /Volver a las de la plataforma/i }))

    // Vacío significa «usa las de plataforma». Copiar su texto a la fila
    // dejaría a esta tienda con la redacción de hoy escrita a su nombre.
    expect(propuestas()).toEqual([])
    expect(screen.getByText(/lo que la plataforma puede afirmar/i)).toBeInTheDocument()
  })
})

describe('el selector de icono no ofrece lo que no se puede guardar', () => {
  it('deja fuera los iconos que otra fila ya usa', async () => {
    const user = userEvent.setup()
    pintar({
      value_props: [
        { iconKey: 'delivery', title: 'Envíos', enabled: true },
        { iconKey: 'warranty', title: 'Garantía', enabled: true },
      ],
    })

    await user.click(screen.getByRole('combobox', { name: /Icono: Envíos/i }))
    const opciones = screen.getAllByRole('option').map((nodo) => nodo.textContent)

    // El propio sigue estando —si no, el selector se quedaría sin valor— pero
    // el de la otra fila no: la base rechaza el icono repetido, y una opción
    // que se elige y luego no guarda es peor que una que no aparece.
    expect(opciones).toContain('Envío a domicilio')
    expect(opciones).not.toContain('Garantía')
  })
})
