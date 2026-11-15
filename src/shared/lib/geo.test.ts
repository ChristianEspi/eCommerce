import { afterEach, describe, expect, it, vi } from 'vitest'

// `src/test/setup.ts` sustituye la red de este módulo para el resto de la
// suite. Aquí se prueba el ORIGINAL, con `fetch` simulado.
const geo = await vi.importActual<typeof import('./geo')>('./geo')

afterEach(() => {
  vi.unstubAllGlobals()
})

function respuesta(cuerpo: unknown) {
  return Promise.resolve(new Response(JSON.stringify(cuerpo), { status: 200 }))
}

describe('geo: OpenStreetMap sin costo', () => {
  it('lee la dirección de Nominatim y quita «Provincia de» / «Gobierno Regional de»', async () => {
    const fetchMock = vi.fn(() =>
      respuesta({
        address: {
          road: 'Avenida José Larco',
          house_number: '1200',
          suburb: 'Miraflores',
          county: 'Provincia de Lima',
          state: 'Gobierno Regional de Lima',
          postcode: '15074',
          country_code: 'pe',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const partes = await geo.reverseGeocode({ lat: -12.1255, lng: -77.03 })
    expect(partes).toEqual({
      address: 'Avenida José Larco 1200',
      district: 'Miraflores',
      city: 'Lima',
      region: 'Lima',
      postalCode: '15074',
      country: 'PE',
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('nominatim.openstreetmap.org/reverse')
  })

  it('busca la dirección limitada al país y devuelve el punto', async () => {
    const fetchMock = vi.fn(() => respuesta([{ lat: '-12.0972', lon: '-77.0365' }]))
    vi.stubGlobal('fetch', fetchMock)
    const punto = await geo.geocodeAddress({ address: 'Av. Camino Real 456', city: 'San Isidro', country: 'PE' })
    expect(punto).toEqual({ lat: -12.0972, lng: -77.0365 })
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('countrycodes=pe')
    expect(url).toContain('q=Av.+Camino+Real+456%2C+San+Isidro')
  })

  it('una dirección demasiado corta no consulta, y lo repetido sale de la caché', async () => {
    const fetchMock = vi.fn(() => respuesta([{ lat: '-12.05', lon: '-77.05' }]))
    vi.stubGlobal('fetch', fetchMock)
    expect(await geo.geocodeAddress({ address: 'ab' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    await geo.geocodeAddress({ address: 'Jr. Lampa 55', city: 'Lima' })
    await geo.geocodeAddress({ address: 'Jr. Lampa 55', city: 'Lima' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('el punto guardado en el pedido y el enlace para el repartidor', () => {
    expect(geo.pointOfAddress({ address: 'x', latitude: -12.1, longitude: '-77.03' })).toEqual({ lat: -12.1, lng: -77.03 })
    expect(geo.pointOfAddress({ address: 'x' })).toBeNull()
    expect(geo.pointOfAddress({ latitude: 200, longitude: 0 })).toBeNull()
    expect(geo.mapsLink({ lat: -12.1, lng: -77.03 })).toBe('https://www.google.com/maps/search/?api=1&query=-12.1,-77.03')
  })

  it('la distancia se lee como se dice', () => {
    expect(geo.formatDistance(0.34, 'es')).toBe('350 m')
    expect(geo.formatDistance(1.24, 'es')).toBe('1,2 km')
  })
})
