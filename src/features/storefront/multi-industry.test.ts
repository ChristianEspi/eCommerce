import { describe, expect, it } from 'vitest'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import { en } from '@/shared/i18n/messages.en'
import { es } from '@/shared/i18n/messages.es'
import { iconoDe } from '@/shared/ui/categoryIcon'
import { PLATFORM_VALUE_PROPS, VALUE_PROP_COPY, VALUE_PROP_ICON_KEYS } from './valueProps'
import { THEME_PRESETS } from './theme/presets'
import { THEME_PRESET_IDS } from './theme/types'

/**
 * La vitrina no sabe a qué se dedica el comercio (Storefront V2 · P14).
 *
 * ## Qué protege este archivo, y por qué existe
 *
 * Este rediseño empezó por un fallo concreto: una tienda de calzado enseñaba
 * «Atención farmacéutica» y «Retiro en tienda» en su franja de servicios, con
 * las categorías de una botica como únicas con icono. Nadie había escrito una
 * condición por rubro —no existía un `if (esFarmacia)`— y el efecto era el
 * mismo: **los valores por defecto de la plataforma eran los de un rubro**.
 *
 * Esa clase de fallo vuelve sola. Vuelve cada vez que alguien redacta un texto
 * por defecto pensando en el cliente que tiene delante, y no se ve en ninguna
 * prueba de unidad porque todo funciona — simplemente habla de otro negocio.
 *
 * Así que esto no prueba un componente: prueba una **propiedad del producto**.
 * Lo que la plataforma dice de oficio no puede mencionar un rubro, y lo que
 * ofrece tiene que servir igual a una zapatería, una botica, una ferretería y
 * una tienda de muebles.
 */

/**
 * Palabras de rubro, que se buscan por PRINCIPIO de palabra.
 *
 * Y sobre el texto sin acentos, que es lo que costó acertar: en una expresión
 * regular de JavaScript, «ó» no es un carácter de palabra, así que `\bmoda`
 * encuentra «cómoda» —el nombre de una variante de tarjeta de producto—. Al
 * quitar los acentos primero, «comoda» deja de tener una frontera ahí dentro y
 * la comparación dice lo que quiere decir.
 */
const RUBROS = [
  'farmac',
  'botica',
  'medicament',
  'receta',
  'droguer',
  'calzado',
  'zapat',
  'moda',
  'ferreter',
  'restaurante',
  'veterinar',
  'pharmac',
  'drugstore',
  'footwear',
  'apparel',
]

/** Sin acentos y en minúsculas, para que la frontera de palabra funcione. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** ¿Este texto nombra un rubro? */
function nombraRubro(texto: string): boolean {
  const limpio = plano(texto)
  return RUBROS.some((rubro) => new RegExp(`\\b${rubro}`).test(limpio))
}

/** Las claves que ve un comprador en la vitrina. */
const CLAVES_DE_VITRINA = (diccionario: Record<string, string>) =>
  Object.entries(diccionario).filter(([clave]) => clave.startsWith('store.'))

describe('lo que la plataforma dice de oficio', () => {
  it('ninguna propuesta de valor por defecto menciona un rubro', () => {
    // Son las que se pintan cuando el comercio no configuró las suyas: envío,
    // pago seguro y atención. Las tres las hace el código, así que la
    // plataforma puede afirmarlas de cualquier tienda — y ninguna puede hablar
    // del negocio de nadie.
    const diccionario = es as Record<string, string>
    const culpables: string[] = []

    for (const propuesta of PLATFORM_VALUE_PROPS) {
      const copia = VALUE_PROP_COPY[propuesta.iconKey]
      for (const clave of [copia.title, copia.body]) {
        const texto = diccionario[clave] ?? ''
        if (nombraRubro(texto)) culpables.push(`${clave}: ${texto}`)
      }
    }

    expect(culpables).toEqual([])
    // Y son tres, no una lista que haya ido creciendo con el tiempo.
    expect(PLATFORM_VALUE_PROPS.map((p) => p.iconKey)).toEqual(['delivery', 'payment', 'support'])
  })

  it('ni un texto de la vitrina en español nombra un rubro', () => {
    const culpables = CLAVES_DE_VITRINA(es as Record<string, string>)
      .filter(([, texto]) => nombraRubro(texto))
      .map(([clave, texto]) => `${clave}: ${texto}`)

    expect(culpables).toEqual([])
  })

  it('ni en inglés', () => {
    const culpables = CLAVES_DE_VITRINA(en as Record<string, string>)
      .filter(([, texto]) => nombraRubro(texto))
      .map(([clave, texto]) => `${clave}: ${texto}`)

    expect(culpables).toEqual([])
  })

  it('tampoco los textos de la pantalla de diseño atan un tema a un rubro', () => {
    // Un tema que dijera «para moda» haría que el comercio de muebles que lo
    // quería dejara de mirarlo.
    const culpables = Object.entries(es as Record<string, string>)
      .filter(([clave]) => clave.startsWith('settings.design.'))
      .filter(([, texto]) => nombraRubro(texto))
      .map(([clave, texto]) => `${clave}: ${texto}`)

    expect(culpables).toEqual([])
  })
})

describe('lo que la plataforma OFRECE sirve a cualquier rubro', () => {
  it('los iconos de propuesta de valor son genéricos, no de un sector', () => {
    // `expertise` y no «farmacéutico»: una botica anuncia su atención
    // farmacéutica escribiéndola ella, y una ferretería anuncia su asesoría
    // técnica con el mismo icono.
    expect([...VALUE_PROP_ICON_KEYS]).toEqual([
      'delivery',
      'pickup',
      'payment',
      'support',
      'returns',
      'warranty',
      'installments',
      'quality',
      'assortment',
      'expertise',
      'schedule',
      'certification',
    ])
  })

  it('una familia de CUALQUIER rubro encuentra su icono', () => {
    // La tabla tenía catorce entradas y diez eran de farmacia: una botica tenía
    // icono para cada familia y una zapatería no tenía ninguno, así que sus
    // puertas se veían todas iguales. Esto fija la cobertura conseguida.
    const familias = [
      'Zapatillas',
      'Botas de cuero',
      'Ropa de hombre',
      'Bolsos y carteras',
      'Abarrotes',
      'Bebidas',
      'Herramientas',
      'Pinturas',
      'Muebles de sala',
      'Electrodomésticos',
      'Celulares',
      'Deportes',
      'Juguetes',
      'Mascotas',
      'Útiles de oficina',
      'Repuestos automotrices',
      'Perfumería',
      'Cuidado del bebé',
      // Y las de salud siguen ahí: quitarlas sería el mismo error del revés.
      'Medicamentos',
      'Vitaminas',
      'Dermocosmética',
    ]

    const sinIcono = familias.filter((familia) => iconoDe(familia) === CategoryRoundedIcon)
    expect(sinIcono).toEqual([])
  })

  it('ningún rubro concentra la tabla: las familias de salud no son mayoría', () => {
    // La forma de medirlo sin contar la tabla a mano: se pide un icono para una
    // familia de nueve sectores distintos y se comprueba que salen al menos
    // seis iconos DIFERENTES. Con una tabla dominada por un rubro, media lista
    // caería en el genérico y el recuento se hundiría.
    const unoPorSector = [
      'Medicamentos',
      'Zapatillas',
      'Bebidas',
      'Herramientas',
      'Celulares',
      'Juguetes',
      'Mascotas',
      'Muebles',
      'Repuestos',
    ]

    const distintos = new Set(unoPorSector.map((familia) => iconoDe(familia)))
    expect(distintos.size).toBeGreaterThanOrEqual(6)
    expect(distintos.has(CategoryRoundedIcon)).toBe(false)
  })

  it('lo específico gana a lo genérico, que es lo que hace útil la tabla', () => {
    // «Zapatillas de running» es calzado, no «cuidado personal» por llevar
    // «personal» en otra familia. El orden de la tabla es el que lo garantiza.
    expect(iconoDe('Zapatillas de running')).toBe(iconoDe('Calzado'))
    expect(iconoDe('Cuidado personal')).not.toBe(iconoDe('Zapatillas'))
  })

  it('una familia que nadie previó cae en el genérico, no en un hueco', () => {
    // En una barra de ocho entradas, un hueco descuadra la fila entera.
    expect(iconoDe('Artículos litúrgicos')).toBe(CategoryRoundedIcon)
    expect(iconoDe('')).toBe(CategoryRoundedIcon)
  })
})

describe('los cuatro temas sirven a cualquier rubro', () => {
  it('ninguno declara una restricción de sector', () => {
    // La definición de un tema son medidas y composiciones. Si algún día
    // apareciera un campo como `industry`, esto lo cazaría.
    for (const id of THEME_PRESET_IDS) {
      const claves = Object.keys(THEME_PRESETS[id])
      expect(claves).toEqual([
        'id',
        'headerVariant',
        'heroVariant',
        'productCardVariant',
        'categoryVariant',
        'contentWidth',
        'imageRatio',
        'sectionSpacing',
        'gridColumns',
      ])
    }
  })

  it('y se diferencian de verdad entre sí', () => {
    // Cuatro temas que resolvieran lo mismo serían cuatro nombres. Lo que se
    // fija aquí es que la combinación de cada uno es única.
    const huellas = THEME_PRESET_IDS.map((id) => {
      const d = THEME_PRESETS[id]
      return [
        d.headerVariant,
        d.heroVariant,
        d.productCardVariant,
        d.categoryVariant,
        d.contentWidth,
        d.imageRatio,
        d.sectionSpacing,
        d.gridColumns.lg,
      ].join('|')
    })

    expect(new Set(huellas).size).toBe(THEME_PRESET_IDS.length)
  })
})
