import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenizacionError, estiloCulqi, pagarConCulqiCheckout, textoSobre, tokenizarTarjeta } from './cardToken'

/**
 * La tarjeta se cambia por un token contra la API de Culqi (2026-11-15), con
 * la llave PÚBLICA de la tienda. Sin llave, simulacro local.
 */
const TARJETA = { numero: '4111 1111 1111 1111', mes: '9', anio: '28', cvv: '123', email: 'ana@correo.test' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tokenizar la tarjeta con Culqi', () => {
  it('con llave pública, pide el token a Culqi y devuelve su id', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ object: 'token', id: 'tkn_test_abc123' }), { status: 201 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(tokenizarTarjeta(TARJETA, 'pk_test_ifgncgnlZF7oxgGv')).resolves.toBe('tkn_test_abc123')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://secure.culqi.com/v2/tokens')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pk_test_ifgncgnlZF7oxgGv')
    // Solo dígitos, mes con dos cifras y año con cuatro.
    expect(JSON.parse(String(init?.body))).toEqual({
      card_number: '4111111111111111',
      cvv: '123',
      expiration_month: '09',
      expiration_year: '2028',
      email: 'ana@correo.test',
    })
  })

  it('si Culqi rechaza la tarjeta, no hay token y se dice por qué', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ object: 'error', type: 'card_error' }), { status: 400 })),
    )
    const error = await tokenizarTarjeta(TARJETA, 'pk_test_x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TokenizacionError)
    expect((error as Error).message).toBe('TARJETA_RECHAZADA')
  })

  it('si Culqi no responde, no se inventa un token', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(tokenizarTarjeta(TARJETA, 'pk_test_x')).rejects.toThrow('CULQI_NO_RESPONDE')
  })

  it('sin llave pública, simulacro: token local y ninguna llamada', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(tokenizarTarjeta(TARJETA, null)).resolves.toMatch(/^sim_.*1$/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * 2026-11-18 · La ventana de Culqi con la marca de la tienda: su logo y su
 * acento, y un texto de botón que se lea sobre ese acento.
 */
describe('la ventana de Culqi con la marca de la tienda', () => {
  it('el texto del botón contrasta con el acento', () => {
    expect(textoSobre('#8f2d37')).toBe('#FFFFFF')
    expect(textoSobre('#f5d547')).toBe('#111111')
  })

  it('logo https y acento van al estilo; lo que no es válido no se manda', () => {
    expect(estiloCulqi('https://cdn.test/logo.png', '#8f2d37')).toMatchObject({
      logo: 'https://cdn.test/logo.png',
      bannerColor: '#8f2d37',
      buttonBackground: '#8f2d37',
      buttonTextColor: '#FFFFFF',
    })
    expect(estiloCulqi('http://inseguro/logo.png', 'rojo')).toEqual({})
    expect(estiloCulqi(null, null)).toEqual({})
  })

  it('abre Culqi con la marca de la tienda en `options.style`', async () => {
    const options = vi.fn()
    const culqi = {
      settings: vi.fn(),
      options,
      open: vi.fn(),
      close: vi.fn(),
      isOpen: true,
      token: null as { id: string } | null,
      error: null,
    }
    const ventana = window as unknown as { Culqi?: unknown; culqi?: () => void }
    ventana.Culqi = culqi
    try {
      const promesa = pagarConCulqiCheckout({
        llavePublica: 'pk_test_x',
        montoCentimos: 1000,
        moneda: 'PEN',
        titulo: 'Química Suiza',
        logoUrl: 'https://cdn.test/logo.png',
        colorAcento: '#8f2d37',
      })
      await vi.waitFor(() => expect(culqi.open).toHaveBeenCalled())
      expect(options.mock.calls[0]?.[0]).toMatchObject({
        style: { logo: 'https://cdn.test/logo.png', bannerColor: '#8f2d37' },
      })
      culqi.token = { id: 'tkn_test_1' }
      ventana.culqi?.()
      await expect(promesa).resolves.toBe('tkn_test_1')
    } finally {
      delete ventana.Culqi
    }
  })
})
