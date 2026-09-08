import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_ITEMS, groupNavItems, visibleNavItems } from './navigation'

/**
 * Los bloques del sidebar.
 *
 * Agrupar es PRESENTACIÓN: no decide quién ve qué —eso es `visibleNavItems`— y
 * por eso todo lo de aquí se prueba sin montar un árbol de React.
 */
describe('bloques del menú', () => {
  const todo = { can: () => true, has: () => true, capabilitiesReady: true }

  it('no pierde ni duplica ninguna entrada al repartirlas', () => {
    // Lo primero que hay que garantizar de un reparto: que es un reparto. Si un
    // día alguien añade un grupo al tipo y se olvida de meterlo en NAV_GROUPS,
    // sus entradas desaparecerían del menú sin error de compilación.
    const items = visibleNavItems(NAV_ITEMS, todo)
    const repartidas = groupNavItems(items).flatMap((seccion) => seccion.items.map((i) => i.to))

    expect(repartidas.sort()).toEqual(items.map((i) => i.to).sort())
  })

  it('Inicio va arriba del todo y sin cabecera', () => {
    // No pertenece a ninguna familia porque las resume todas: ponerlo bajo un
    // título sería mentir sobre lo que hay dentro.
    const [primera] = groupNavItems(visibleNavItems(NAV_ITEMS, todo))

    expect(primera?.label).toBeNull()
    expect(primera?.items.map((i) => i.to)).toEqual(['/app'])
  })

  it('respeta el orden declarado en NAV_GROUPS', () => {
    const secciones = groupNavItems(visibleNavItems(NAV_ITEMS, todo))
    const conCabecera = secciones.filter((s) => s.id !== null).map((s) => s.id)

    expect(conCabecera).toEqual(NAV_GROUPS.map((g) => g.id))
  })

  it('ninguna cabecera se queda sin entradas que presidir', () => {
    // Un grupo declarado y vacío es una cabecera muerta esperando a que alguien
    // la vea. Si se retira el último módulo de una familia, se retira la
    // familia.
    const secciones = groupNavItems(visibleNavItems(NAV_ITEMS, todo))

    for (const seccion of secciones) expect(seccion.items.length).toBeGreaterThan(0)
    expect(secciones.filter((s) => s.id !== null)).toHaveLength(NAV_GROUPS.length)
  })

  it('el grupo desaparece cuando la sociedad no tiene ninguno de sus módulos', () => {
    // Es el caso real de un tenant que no contrata nada comercial: la cabecera
    // «VENTAS» presidiendo el vacío se lee como una pantalla que se rompió al
    // cargar, no como un módulo no contratado.
    const sinVentas = visibleNavItems(NAV_ITEMS, {
      can: () => true,
      has: (capability) =>
        !['orders', 'payments', 'credit.management', 'fulfillment'].includes(capability),
      capabilitiesReady: true,
    })

    expect(groupNavItems(sinVentas).map((s) => s.id)).not.toContain('sales')
  })

  it('sin ni un módulo contratado solo queda SISTEMA', () => {
    // Ajustes, Operación, Integraciones y Diagnóstico no llevan capacidad a
    // propósito: son la salida de un tenant mal configurado. Su cabecera tiene
    // que sobrevivir a que todo lo demás se apague.
    const secciones = groupNavItems(
      visibleNavItems(NAV_ITEMS, { can: () => true, has: () => false, capabilitiesReady: true }),
    )

    expect(secciones.map((s) => s.id)).toEqual(['system'])
  })

  it('cada módulo declara a qué bloque pertenece', () => {
    // Sin grupo, una entrada nueva no falla: se cuela en el bloque de arriba,
    // junto a Inicio, y ahí se queda para siempre porque nadie lo nota. Inicio
    // es la única excepción legítima.
    const huerfanos = NAV_ITEMS.filter((item) => !item.group && item.to !== '/app')

    expect(huerfanos.map((i) => i.to)).toEqual([])
  })
})
