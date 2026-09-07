import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/render'
import {
  createFakeSupabase,
  FunctionsHttpErrorLike,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * Flujo completo del comprador: ficha → carrito → checkout → confirmación.
 *
 * Lo que estos tests defienden es el encargo de P06 y, desde P07, el del
 * pipeline:
 *  - el carrito suma, resta y quita, y su subtotal cuadra;
 *  - vive en `localStorage` por tienda y no mezcla catálogos;
 *  - al confirmar, el cuerpo que sale hacia `checkout` lleva el SLUG de la
 *    tienda, los productos, las cantidades y una clave de idempotencia — y ni
 *    un solo importe;
 *  - los importes de la confirmación son los que devolvió el servidor;
 *  - un doble clic no crea dos pedidos, un reintento reusa la MISMA clave, y un
 *    fallo se explica —con su etapa y con el foco puesto— sin perder el carrito.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StorefrontLayout } = await import('./StorefrontLayout')
const { StoreHomePage } = await import('./StoreHomePage')
const { StoreProductPage } = await import('./StoreProductPage')
const { StoreCartPage } = await import('./StoreCartPage')
const { StoreCheckoutPage } = await import('./StoreCheckoutPage')
const { StoreOrderPage } = await import('./StoreOrderPage')
const { CHECKOUT_FUNCTION, attemptStorageKey } = await import('./checkout')
const { cartTokenStorageKey } = await import('./cart/serverCart')

const STORE = 'aaaa1111-1111-4111-8111-111111111111'
const OTRA_STORE = 'aaaa2222-1111-4111-8111-111111111111'
const P_SILLA = 'cccc1111-1111-4111-8111-111111111111'
const P_MESA = 'cccc3333-1111-4111-8111-111111111111'
const CART_TOKEN = 'a'.repeat(64)

function store(overrides: Record<string, unknown> = {}) {
  return {
    store_id: STORE,
    slug: 'casa-nordica',
    name: 'Casa Nórdica',
    currency: 'PEN',
    accent_color: '#056769',
    logo_url: null,
    white_label: false,
    default_locale: 'es',
    support_email: 'hola@casanordica.demo',
    banner_url: null,
    hero_title: null,
    hero_subtitle: null,
    contact_phone: null,
    contact_address: null,
    ...overrides,
  }
}

function producto(overrides: Record<string, unknown> = {}) {
  return {
    product_id: P_SILLA,
    store_id: STORE,
    category_id: null,
    slug: 'silla-roble',
    name: 'Silla de roble',
    description: 'Roble macizo.',
    price: '100.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-08-20T00:00:00.000Z',
    in_stock: true,
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
    ...overrides,
  }
}

/** Respuesta de `checkout`: el dinero llega como texto, ya recalculado. */
function respuestaPedido(body: Record<string, unknown>) {
  return {
    order_id: 'eeee1111-1111-4111-8111-111111111111',
    order_number: 'EC-20260827-00001',
    status: 'pending',
    currency: 'PEN',
    subtotal: '200.00',
    tax_total: '36.00',
    grand_total: '236.00',
    items: (body.items as Array<{ product_id: string; quantity: number }>).map((item) => ({
      product_id: item.product_id,
      sku: 'SKU-1',
      name: 'Silla de roble',
      unit_price: '100.00',
      quantity: item.quantity,
    })),
    replay: false,
  }
}

/** El carrito de servidor devuelve su secreto y nada más que haga falta aquí. */
function carritoServidor(lines: Array<Record<string, unknown>> = []) {
  return {
    cart_id: 'dddd1111-1111-4111-8111-111111111111',
    token: CART_TOKEN,
    status: 'active',
    channel: 'b2c',
    currency: 'PEN',
    owned: false,
    expires_at: null,
    order_id: null,
    lines,
    quote: null,
    quote_error: null,
  }
}

function backend(
  options: {
    onCheckout?: (body: Record<string, unknown>) => unknown
    store?: Record<string, unknown>
    session?: ReturnType<typeof makeSession> | null
  } = {},
) {
  return createFakeSupabase({
    session: options.session ?? null,
    tables: {
      public_stores: [store(options.store)],
      public_categories: [],
      public_products: [
        producto(),
        producto({ product_id: P_MESA, slug: 'mesa', name: 'Mesa', price: '50.00' }),
      ],
      public_product_images: [],
    },
    rpc: {
      cart_open: () => carritoServidor(),
      cart_replace_lines: () => ({ ...carritoServidor(), token: null }),
      cart_abandon: () => ({ ...carritoServidor(), token: null, status: 'abandoned' }),
    },
    functions: {
      [CHECKOUT_FUNCTION]: options.onCheckout ?? respuestaPedido,
    },
  })
}

function renderStorefront(
  fake: FakeSupabase,
  route: string,
  session: ReturnType<typeof makeSession> | null = null,
) {
  holder.client = fake
  return renderWithProviders(
    <Routes>
      <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
        <Route index element={<StoreHomePage />} />
        <Route path="product/:productSlug" element={<StoreProductPage />} />
        <Route path="cart" element={<StoreCartPage />} />
        <Route path="checkout" element={<StoreCheckoutPage />} />
        <Route path="order/:orderNumber" element={<StoreOrderPage />} />
      </Route>
    </Routes>,
    { route, session },
  )
}

/** Deja el carrito de la tienda listo, sin repetir la navegación en cada test. */
function sembrarCarrito(lines: Array<Record<string, unknown>>, storeId = STORE) {
  localStorage.setItem(
    `ebim.ecommerce.cart.v1:${storeId}`,
    JSON.stringify({ store_id: storeId, lines }),
  )
}

const LINEA_SILLA = {
  product_id: P_SILLA,
  slug: 'silla-roble',
  name: 'Silla de roble',
  unit_price: '100.00',
  currency: 'PEN',
  image_path: null,
  quantity: 2,
}

/**
 * Claves que jamás pueden aparecer en el cuerpo de la compra, a cualquier
 * profundidad.
 *
 * Antes esto se comprobaba buscando subcadenas en el JSON serializado, y dejó
 * de servir en cuanto el cuerpo ganó un campo llamado `accept_price_changes`:
 * la palabra «price» aparece dentro del NOMBRE de una bandera booleana. Mirar
 * las claves de verdad es más estricto, no menos — un `{"nota": "el price
 * es..."}` ya no daría un falso positivo, y un `{"unit_price": 1}` anidado tres
 * niveles sí lo detecta, cosa que la subcadena hacía por accidente.
 */
const CLAVES_PROHIBIDAS = [
  'price',
  'unit_price',
  'line_total',
  'subtotal',
  'total',
  'currency',
  'discount',
  'store_id',
  'organization_id',
  'company_id',
  'tenant_id',
  'channel_id',
  'user_id',
  'segment_id',
  'customer_id',
  'price_list_id',
  'warehouse_id',
]

function todasLasClaves(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) todasLasClaves(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out.push(key)
      todasLasClaves(item, out)
    }
  }
  return out
}

beforeEach(() => {
  holder.client = null
  localStorage.clear()
  // El intento pendiente vive en `sessionStorage` y sobrevive entre tests si no
  // se limpia: sin esto, el aviso de «tenías una compra a medias» aparecería en
  // pantallas que nunca enviaron nada.
  sessionStorage.clear()
})

/**
 * P16-SaaS · La visita anónima no deja fila en la base.
 *
 * `cart_open` no solo lee: al invitado que llega sin token le CREA el carrito.
 * Y `CartProvider` envuelve el layout entero, así que se llamaba al montar
 * CUALQUIER página de la vitrina — una fila de `carts` por visita, y por cada
 * paso de un rastreador siguiendo el sitemap de P15. Las filas no se recogían
 * nunca (`expire_due_carts` solo cambia el estado), así que era crecimiento
 * permanente contra la factura del comercio.
 *
 * Esto contradecía lo que la cabecera de la migración de P07 y `serverCart.ts`
 * dicen los dos que se hace: «nadie crea una fila por visita; la fila nace al
 * iniciar sesión o al empezar a comprar». Estos tres tests son esa frase,
 * ejecutable.
 *
 * La otra mitad —que la fila que sí se cree se recoja— vive en la base, porque
 * `cart_open` es pública: `supabase/tests/guest-cart-retention.test.ts`.
 */
describe('cuándo se abre el carrito de servidor', () => {
  /** Cuenta las llamadas a `cart_open` sin cambiar lo que devuelve. */
  function backendContando(): { fake: FakeSupabase; llamadas: () => number } {
    const fake = backend()
    let n = 0
    fake.state.rpc.cart_open = () => {
      n += 1
      return carritoServidor()
    }
    return { fake, llamadas: () => n }
  }

  it('el visitante anónimo sin nada que reconciliar NO abre carrito de servidor', async () => {
    const { fake, llamadas } = backendContando()
    renderStorefront(fake, '/s/casa-nordica/product/silla-roble')

    // Se ancla en la ficha ya pintada: eso prueba que el provider montó y que
    // sus efectos corrieron. Sin la espera, el test pasaría por llegar antes de
    // la llamada en vez de por que no la haya.
    expect(await screen.findByRole('button', { name: 'Agregar al carrito' })).toBeInTheDocument()

    expect(llamadas()).toBe(0)
  })

  it('la primera línea SÍ lo abre: es cuando hace falta el ancla', async () => {
    const user = userEvent.setup()
    const { fake, llamadas } = backendContando()
    renderStorefront(fake, '/s/casa-nordica/product/silla-roble')

    await user.click(await screen.findByRole('button', { name: 'Agregar al carrito' }))

    await waitFor(() => expect(llamadas()).toBe(1))
  })

  it('con token guardado lo abre aunque el carrito local esté vacío: hay algo suyo que traer', async () => {
    const { fake, llamadas } = backendContando()
    localStorage.setItem(cartTokenStorageKey(STORE), CART_TOKEN)
    renderStorefront(fake, '/s/casa-nordica/product/silla-roble')

    await waitFor(() => expect(llamadas()).toBe(1))
  })
})

describe('de la ficha al carrito', () => {
  it('agregar abre el panel con lo que se acaba de meter', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    await user.click(await screen.findByRole('button', { name: 'Agregar al carrito' }))

    // El panel se abre solo: el comprador ve lo que metió sin dejar la ficha.
    expect(await screen.findByRole('heading', { name: /Carrito/ })).toBeInTheDocument()
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    expect(screen.getAllByText('Silla de roble').length).toBeGreaterThan(1)
    expect(screen.getByRole('link', { name: 'Ver el carrito' })).toHaveAttribute(
      'href',
      '/s/casa-nordica/cart',
    )
  })

  it('la cantidad elegida en la ficha es la que entra al carrito', async () => {
    const user = userEvent.setup()
    renderStorefront(backend(), '/s/casa-nordica/product/silla-roble')

    // El botón de la FICHA, no el de una tarjeta de «también te puede
    // interesar»: desde que las tarjetas compran, hay varios con el mismo
    // nombre en la página, y el único que respeta la cantidad elegida es este.
    // El bloque de compra es un `group` con nombre, así que se acota ahí.
    const buyBox = await screen.findByRole('group', { name: 'Comprar' })
    await user.click(within(buyBox).getByRole('button', { name: 'Sumar una unidad' }))
    await user.click(within(buyBox).getByRole('button', { name: 'Agregar al carrito' }))

    await waitFor(() => {
      const guardado = localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)
      expect(guardado).toContain('"quantity":2')
    })
  })

  /**
   * P18 · La tienda que solo vende a quien ha entrado.
   *
   * Se para ANTES del formulario. Rellenar doce campos para que al final te
   * digan que hacía falta una cuenta es la forma más cara de enterarse — y el
   * carrito tiene que seguir intacto, porque perderlo es la otra forma de que
   * el comprador no vuelva.
   */
  it('sin sesión, la tienda que exige cuenta manda a iniciar sesión en vez del formulario', async () => {
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(
      backend({ store: { checkout_requires_account: true } }),
      '/s/casa-nordica/checkout',
    )

    expect(await screen.findByText('Inicia sesión para comprar')).toBeInTheDocument()
    // Y el botón vuelve AQUÍ: mandarlo al backoffice tras pedirle la sesión
    // para comprar sería perderlo.
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: /Confirmar pedido/ })).not.toBeInTheDocument()
  })

  it('con sesión, la misma tienda enseña el formulario de siempre', async () => {
    // Con sesión manda el carrito del SERVIDOR, no el del navegador: por eso la
    // línea se siembra ahí y no con `sembrarCarrito`.
    const fake = backend({
      store: { checkout_requires_account: true },
      session: makeSession(),
    })
    fake.state.rpc.cart_open = () =>
      carritoServidor([
        {
          product_id: P_SILLA,
          variant_id: null,
          uom_code: null,
          quantity: 2,
          slug: 'silla-roble',
          name: 'Silla de roble',
          unit_price: '100.00',
          unit_price_snapshot: '100.00',
        },
      ])
    renderStorefront(fake, '/s/casa-nordica/checkout', makeSession())

    expect(await screen.findByRole('button', { name: /Confirmar pedido/ })).toBeInTheDocument()
  })

  it('una tienda abierta sigue vendiendo a quien no ha entrado', async () => {
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(backend(), '/s/casa-nordica/checkout')

    // La regla es del comercio y viene apagada: encenderla por defecto habría
    // cortado la venta de toda tienda ya en producción.
    expect(await screen.findByRole('button', { name: /Confirmar pedido/ })).toBeInTheDocument()
  })

  it('el carrito de otra tienda no se ve en esta', async () => {
    sembrarCarrito([{ ...LINEA_SILLA, quantity: 4 }], OTRA_STORE)
    renderStorefront(backend(), '/s/casa-nordica/cart')

    expect(await screen.findByText('Tu carrito está vacío')).toBeInTheDocument()
  })

  it('el carrito de la tienda sobrevive a la recarga y se puede editar', async () => {
    const user = userEvent.setup()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(backend(), '/s/casa-nordica/cart')

    expect((await screen.findAllByText(/200\.00/)).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Restar una unidad' }))
    await waitFor(() => expect(screen.queryByText(/200\.00/)).not.toBeInTheDocument())
    expect(screen.getAllByText(/100\.00/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Quitar del carrito/ }))
    expect(await screen.findByText('Tu carrito está vacío')).toBeInTheDocument()
    expect(localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)).toBeNull()
  })

  /**
   * El carrito de servidor es una COMODIDAD (P07-SaaS): entrega el secreto con
   * el que se ata la compra a un carrito. Que exista no puede cambiar lo que el
   * comprador ve, y que falle no puede impedirle comprar — eso se prueba abajo.
   */
  it('el token del carrito de servidor se guarda al abrir la vitrina', async () => {
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(backend(), '/s/casa-nordica/cart')

    await waitFor(() =>
      expect(localStorage.getItem(cartTokenStorageKey(STORE))).toBe(CART_TOKEN),
    )
  })
})

describe('checkout', () => {
  async function rellenar(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText(/Nombre y apellido/), 'Ana Pérez')
    await user.type(screen.getByLabelText(/Correo/), 'ana@compradora.com')
    await user.type(screen.getByLabelText(/Teléfono/), '+51 999 888 777')
    await user.type(screen.getByLabelText(/Dirección de entrega/), 'Av. Primavera 120')
  }

  it('manda tienda, productos y cantidades — y ningún importe', async () => {
    const user = userEvent.setup()
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.type(screen.getByLabelText(/Referencia/), 'Portón verde')
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const { name, body } = fake.state.invocations[0]!

    expect(name).toBe(CHECKOUT_FUNCTION)
    expect(body.store_slug).toBe('casa-nordica')
    expect(body.customer_name).toBe('Ana Pérez')
    expect(body.customer_email).toBe('ana@compradora.com')
    expect(body.customer_phone).toBe('+51 999 888 777')
    expect(body.shipping_address).toEqual({
      address: 'Av. Primavera 120',
      reference: 'Portón verde',
    })
    expect(body.items).toEqual([{ product_id: P_SILLA, quantity: 2 }])
    expect(body.accept_price_changes).toBe(false)
    // P10: sin cupón tecleado viaja la lista VACÍA, que es «no hay cupón» y no
    // «no se preguntó». Y sigue sin viajar ni un importe de descuento.
    expect(body.coupon_codes).toEqual([])

    // Ni el tenant ni el dinero salen del navegador. Se miran las CLAVES, a
    // cualquier profundidad: es la forma exacta de la regla.
    const claves = todasLasClaves(body)
    for (const prohibida of CLAVES_PROHIBIDAS) {
      expect(claves, `clave prohibida en el cuerpo: ${prohibida}`).not.toContain(prohibida)
    }
  })

  it('la clave de idempotencia viaja en el cuerpo y es de alta entropía', async () => {
    const user = userEvent.setup()
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    // 32 bytes en hexadecimal. Es lo que impide que dos pestañas abiertas en el
    // mismo milisegundo compartan clave — y con ella, pedido.
    expect(fake.state.invocations[0]?.body.idempotency_key).toMatch(/^[a-f0-9]{64}$/)
  })

  it('el cupón viaja como TEXTO y sin un solo importe (P10)', async () => {
    const user = userEvent.setup()
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.type(screen.getByLabelText(/Cupón de descuento/), 'verano-25')
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const { body } = fake.state.invocations[0]!

    // Lo que se tecleó, tal cual: normalizarlo aquí sería una segunda regla que
    // un día deja de coincidir con la columna generada de la base.
    expect(body.coupon_codes).toEqual(['verano-25'])

    // Y NADA más: el cuerpo sigue sin llevar descuento, campaña ni «aplicada».
    const claves = todasLasClaves(body)
    for (const prohibida of [
      'discount',
      'discount_total',
      'discount_amount',
      'promotion_id',
      'promotion_code',
      'coupon_id',
    ]) {
      expect(claves, `clave prohibida en el cuerpo: ${prohibida}`).not.toContain(prohibida)
    }
  })

  it('la referencia es opcional: sin ella, no viaja el campo', async () => {
    const user = userEvent.setup()
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]?.body.shipping_address).toEqual({
      address: 'Av. Primavera 120',
    })
  })

  it('no envía nada con datos incompletos', async () => {
    const user = userEvent.setup()
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await user.type(await screen.findByLabelText(/Nombre y apellido/), 'Ana Pérez')
    await user.type(screen.getByLabelText(/Correo/), 'no-es-un-correo')
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    expect(await screen.findByText('Escribe un correo válido')).toBeInTheDocument()
    expect(fake.state.invocations).toHaveLength(0)
  })

  it('un carrito vacío no llega ni a la pantalla de pago', async () => {
    renderStorefront(backend(), '/s/casa-nordica/checkout')

    expect(await screen.findByText('Tu carrito está vacío')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar pedido' })).not.toBeInTheDocument()
  })

  it('doble clic no crea dos pedidos', async () => {
    const user = userEvent.setup()
    const pendiente: { responder: (() => void) | null } = { responder: null }
    const fake = backend({
      onCheckout: (body) => {
        // La primera llamada se queda en vuelo: es el hueco por el que se
        // colaría el segundo clic si el botón no se bloqueara.
        return new Promise((resolve) => {
          pendiente.responder = () => resolve(respuestaPedido(body))
        })
      },
    })
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    const form = document.querySelector('form') as HTMLFormElement
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    // El botón se bloquea mientras el pedido está en vuelo...
    expect(await screen.findByRole('button', { name: 'Registrando el pedido…' })).toBeDisabled()
    // ...y un submit que se cuele igual (Enter repetido) no dispara nada.
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    pendiente.responder?.()
    expect(await screen.findByText('EC-20260827-00001')).toBeInTheDocument()
    expect(fake.state.invocations).toHaveLength(1)
  })

  /**
   * El bloqueo del botón es cortesía; la garantía es la clave. Este test compra
   * la propiedad que de verdad importa: dos envíos del MISMO intento de compra
   * llevan la MISMA clave, así que el servidor devuelve el mismo pedido en vez
   * de crear el segundo.
   */
  it('reintentar tras un fallo reusa la misma clave de idempotencia', async () => {
    const user = userEvent.setup()
    let intentos = 0
    const fake = backend({
      onCheckout: (body) => {
        intentos += 1
        if (intentos === 1) throw new FunctionsHttpErrorLike(503, 'DISPONIBILIDAD_DESCONOCIDA')
        return respuestaPedido(body)
      },
    })
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))
    await waitFor(() => expect(fake.state.invocations).toHaveLength(2))

    const [primera, segunda] = fake.state.invocations
    expect(primera?.body.idempotency_key).toBe(segunda?.body.idempotency_key)
  })

  it('un error del servidor se explica, dice la etapa, recibe el foco y no vacía el carrito', async () => {
    const user = userEvent.setup()
    const fake = backend({
      onCheckout: () => {
        throw new FunctionsHttpErrorLike(409, 'STOCK_INSUFICIENTE', {
          stage: 'reserve_inventory',
          retryable: false,
        })
      },
    })
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/unidades disponibles/i)
    // La etapa: «al apartar el stock» es lo que convierte «algo salió mal» en
    // algo que el comprador puede entender.
    expect(alerta).toHaveTextContent('al apartar el stock')
    // Y el foco, sin el cual quien usa lector de pantalla no se entera de nada.
    await waitFor(() => expect(alerta).toHaveFocus())

    expect(localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeEnabled()
  })

  /**
   * El carrito de servidor puede desaparecer bajo los pies del comprador: el de
   * un invitado CADUCA por retencion, y un entorno de demostracion se puede
   * vaciar entero. El token vive en `localStorage` y sobrevive a la fila que
   * nombraba, asi que sin recuperacion esa persona no vuelve a comprar hasta
   * que alguien le dice que borre datos del sitio.
   */
  it('si el carrito de servidor ya no existe, se compra igual y el token muerto se tira', async () => {
    const user = userEvent.setup()
    const fake = backend({
      onCheckout: (body) => {
        // El servidor solo se queja cuando le mandan el token muerto.
        if (body.cart_token) {
          throw new FunctionsHttpErrorLike(404, 'CARRITO_NO_ENCONTRADO', {
            stage: 'resolve_prices',
            retryable: false,
          })
        }
        return respuestaPedido(body)
      },
    })
    sembrarCarrito([LINEA_SILLA])
    localStorage.setItem(cartTokenStorageKey(STORE), CART_TOKEN)
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    // El pedido sale: las lineas viajan en el cuerpo, el token solo era el ancla.
    expect(await screen.findByText('EC-20260827-00001')).toBeInTheDocument()
    await waitFor(() => expect(fake.state.invocations).toHaveLength(2))
    expect(fake.state.invocations[0]?.body.cart_token).toBe(CART_TOKEN)
    expect(fake.state.invocations[1]?.body.cart_token).toBeNull()
    // Misma clave en los dos: si el primero hubiese llegado a crear el pedido,
    // el servidor devuelve ese y no un segundo.
    expect(fake.state.invocations[1]?.body.idempotency_key).toBe(
      fake.state.invocations[0]?.body.idempotency_key,
    )
    // Y el token muerto no se queda esperando al siguiente intento.
    await waitFor(() => expect(localStorage.getItem(cartTokenStorageKey(STORE))).toBeNull())
  })

  it('un cambio de precio se puede confirmar, y el segundo envío lo dice', async () => {
    const user = userEvent.setup()
    let intentos = 0
    const fake = backend({
      onCheckout: (body) => {
        intentos += 1
        if (intentos === 1) {
          throw new FunctionsHttpErrorLike(409, 'PRECIO_CAMBIADO', {
            stage: 'resolve_prices',
            retryable: false,
          })
        }
        return respuestaPedido(body)
      },
    })
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/precio de algo de tu carrito/i)
    await user.click(await screen.findByRole('button', { name: 'Confirmar con el precio nuevo' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(2))
    expect(fake.state.invocations[1]?.body.accept_price_changes).toBe(true)
    // Misma compra, misma clave: aceptar el precio nuevo no puede crear un
    // segundo pedido.
    expect(fake.state.invocations[1]?.body.idempotency_key).toBe(
      fake.state.invocations[0]?.body.idempotency_key,
    )
  })

  /**
   * Recarga a mitad de compra. El comprador no sabe si su pedido llegó a
   * existir; lo que la pantalla hace es recuperar la clave del intento y
   * decírselo, para que reenviar sea seguro en vez de una apuesta.
   */
  it('tras recargar, se avisa del intento pendiente y se reusa su clave', async () => {
    const user = userEvent.setup()
    const CLAVE = 'b'.repeat(64)
    sessionStorage.setItem(
      attemptStorageKey('casa-nordica'),
      JSON.stringify({ key: CLAVE, startedAt: Date.now() }),
    )
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    expect(await screen.findByText('Tenías una compra a medias')).toBeInTheDocument()

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]?.body.idempotency_key).toBe(CLAVE)
  })

  /**
   * El carrito de servidor no puede ser un punto único de fallo: si su RPC no
   * responde, el comprador tiene que poder comprar igual — sin `cart_token`,
   * que es lo único que se pierde.
   */
  it('si el carrito de servidor falla, la compra sigue', async () => {
    const user = userEvent.setup()
    const fake = backend()
    fake.state.rpc.cart_open = () => {
      throw new Error('CARRITO_NO_ENCONTRADO: no hay ningun carrito con esos datos')
    }
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenar(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]?.body.cart_token).toBeNull()
    expect(await screen.findByText('EC-20260827-00001')).toBeInTheDocument()
  })
})

describe('confirmación', () => {
  it('muestra los importes del SERVIDOR, no los del carrito, y vacía el carrito', async () => {
    const user = userEvent.setup()
    const fake = backend()
    // El carrito dice 200.00 de subtotal; el servidor manda 236.00 de total.
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await user.type(await screen.findByLabelText(/Nombre y apellido/), 'Ana Pérez')
    await user.type(screen.getByLabelText(/Correo/), 'ana@compradora.com')
    await user.type(screen.getByLabelText(/Teléfono/), '+51 999 888 777')
    await user.type(screen.getByLabelText(/Dirección de entrega/), 'Av. Primavera 120')
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    expect(await screen.findByRole('heading', { name: 'Pedido registrado' })).toBeInTheDocument()
    expect(screen.getByText('EC-20260827-00001')).toBeInTheDocument()
    expect(screen.getByText('Pendiente de pago')).toBeInTheDocument()
    // Impuesto y total del servidor, no el subtotal que calculó el carrito.
    expect(screen.getByText(/^S\/ 36\.00$/)).toBeInTheDocument()
    expect(screen.getByText(/^S\/ 236\.00$/)).toBeInTheDocument()

    await waitFor(() =>
      expect(localStorage.getItem(`ebim.ecommerce.cart.v1:${STORE}`)).toBeNull(),
    )
    // El intento se cierra: si quedara, la próxima compra reusaría su clave y
    // el servidor devolvería el pedido anterior.
    expect(sessionStorage.getItem(attemptStorageKey('casa-nordica'))).toBeNull()
  })

  it('sin estado de navegación sigue mostrando el número de la URL', async () => {
    renderStorefront(backend(), '/s/casa-nordica/order/EC-20260827-00042')

    expect(await screen.findByText('EC-20260827-00042')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pedido registrado' })).toBeInTheDocument()
  })
})

/**
 * P12-SaaS · elegir CÓMO llega el pedido.
 *
 * Las tres propiedades que solo se ven montando el árbol:
 *
 *  1. el envío se ve ANTES de comprar, separado del total y ya calculado por el
 *     servidor;
 *  2. lo que sale hacia el borde es un CÓDIGO y ni un céntimo —la lista de
 *     claves prohibidas de arriba se aplica igual al bloque `delivery`—;
 *  3. y una opción sin cobertura se pinta deshabilitada con su motivo, en vez
 *     de desaparecer: «a tu distrito no llegamos con express, pero sí con
 *     estándar» solo se puede decir si express aparece.
 */
const OPCIONES_ENTREGA = {
  currency: 'PEN',
  zone: { code: 'lima', name: 'Lima metropolitana' },
  options: [
    {
      delivery_method_id: 'ffff1111-1111-4111-8111-111111111111',
      code: 'estandar',
      name: 'Envío estándar',
      description: null,
      instructions: null,
      strategy: 'ship',
      available: true,
      reason: null,
      currency: 'PEN',
      amount: '15.00',
      free: false,
      promised_from: '2026-08-29',
      promised_to: '2026-08-31',
      requires_window: false,
      pickup_points: [],
    },
    {
      delivery_method_id: 'ffff2222-1111-4111-8111-111111111111',
      code: 'express',
      name: 'Envío express',
      description: null,
      instructions: null,
      strategy: 'ship',
      available: false,
      reason: 'FUERA_DE_COBERTURA',
      currency: 'PEN',
      amount: null,
      free: false,
      promised_from: null,
      promised_to: null,
      requires_window: false,
      pickup_points: [],
    },
  ],
}

function backendConEntrega(options: { onCheckout?: (body: Record<string, unknown>) => unknown } = {}) {
  const fake = backend(options)
  fake.state.rpc.delivery_options_for_slug = () => OPCIONES_ENTREGA
  return fake
}

async function rellenarContacto(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Nombre y apellido/), 'Ana Pérez')
  await user.type(screen.getByLabelText(/Correo/), 'ana@compradora.com')
  await user.type(screen.getByLabelText(/Teléfono/), '+51 999 888 777')
  await user.type(screen.getByLabelText(/Dirección de entrega/), 'Av. Primavera 120')
}

describe('entrega en el checkout (P12)', () => {
  it('enseña el envío ya calculado por el servidor, separado del total', async () => {
    const user = userEvent.setup()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(backendConEntrega(), '/s/casa-nordica/checkout')

    await rellenarContacto(user)

    await user.click(await screen.findByRole('radio', { name: /Envío estándar/ }))

    // El importe del envío sale del servidor y se pinta aparte: un total mayor
    // que la suma de las líneas sin una línea que lo explique es un carrito
    // abandonado.
    expect(await screen.findByText('Envío')).toBeInTheDocument()
    expect(screen.getByText(/^S\/ 15\.00$/)).toBeInTheDocument()
  })

  it('una opción sin cobertura se pinta deshabilitada, con su motivo', async () => {
    const user = userEvent.setup()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(backendConEntrega(), '/s/casa-nordica/checkout')

    await rellenarContacto(user)

    const express = await screen.findByRole('radio', { name: /Envío express/ })
    expect(express).toBeDisabled()
    expect(screen.getByText('No disponible para tu dirección')).toBeInTheDocument()
  })

  it('lo que viaja es un CÓDIGO de método y ni un céntimo', async () => {
    const user = userEvent.setup()
    const fake = backendConEntrega()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenarContacto(user)
    await user.click(await screen.findByRole('radio', { name: /Envío estándar/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const body = fake.state.invocations[0]?.body as Record<string, unknown>
    const delivery = body.delivery as Record<string, unknown>

    expect(delivery.method_code).toBe('estandar')
    expect(delivery.pickup_point_id).toBeNull()
    // La misma regla que el resto del cuerpo: ni importes, ni tenant, ni
    // transportista, ni almacén, a ninguna profundidad.
    for (const clave of todasLasClaves(delivery)) {
      expect(CLAVES_PROHIBIDAS).not.toContain(clave)
    }
    expect(todasLasClaves(delivery)).not.toContain('provider_code')
  })

  it('no deja comprar sin elegir cómo lo quiere recibir', async () => {
    const user = userEvent.setup()
    const fake = backendConEntrega()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenarContacto(user)
    await screen.findByRole('radio', { name: /Envío estándar/ })
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    expect(
      await screen.findByText('Elige cómo quieres recibir tu pedido.'),
    ).toBeInTheDocument()
    // No se llegó a llamar al borde: el error se resolvió aquí.
    expect(fake.state.invocations).toHaveLength(0)
  })

  it('sin métodos configurados el checkout funciona EXACTAMENTE como antes de P12', async () => {
    const user = userEvent.setup()
    // `backend()` sin la RPC: la tienda no tiene red de entrega configurada.
    const fake = backend()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await rellenarContacto(user)
    expect(await screen.findByText('Esta tienda todavía no cobra envío.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))
    expect(await screen.findByRole('heading', { name: 'Pedido registrado' })).toBeInTheDocument()

    const body = fake.state.invocations[0]?.body as Record<string, unknown>
    expect(body.delivery).toBeNull()
  })
})

/**
 * Los medios de pago de la tienda, tal y como los devuelve la vista publica:
 * codigo, familia, nombre, orden e instrucciones. Ni proveedor ni configuracion
 * — esas columnas no salen de la base, y el test lo comprueba abajo.
 */
const MEDIOS_PAGO = [
  {
    payment_method_id: 'dddd1111-1111-4111-8111-111111111111',
    store_id: STORE,
    code: 'yape',
    kind: 'wallet',
    display_name: 'Yape',
    position: 10,
    instructions: 'Yapea al 999 888 777 a nombre de Casa Nordica.',
  },
  {
    payment_method_id: 'dddd2222-2222-4222-8222-222222222222',
    store_id: STORE,
    code: 'transferencia',
    kind: 'bank_transfer',
    display_name: 'Transferencia bancaria',
    position: 20,
    instructions: 'Cuenta BCP 191-0000-1-11',
  },
]

function backendConPago(
  options: { onCheckout?: (body: Record<string, unknown>) => unknown } = {},
) {
  const fake = backendConEntrega(options)
  fake.state.tables.public_payment_methods = MEDIOS_PAGO
  return fake
}

/** Contacto + entrega elegida: el punto justo antes de decidir como se paga. */
async function llegarAlPago(user: ReturnType<typeof userEvent.setup>) {
  await rellenarContacto(user)
  await user.click(await screen.findByRole('radio', { name: /Envío estándar/ }))
}

describe('medio de pago en el checkout (P09)', () => {
  it('lo que viaja es el CODIGO del medio, sin proveedor ni configuracion', async () => {
    const user = userEvent.setup()
    const fake = backendConPago()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await llegarAlPago(user)
    await user.click(await screen.findByRole('radio', { name: /Transferencia bancaria/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const body = fake.state.invocations[0]?.body as Record<string, unknown>

    expect(body.payment_method_code).toBe('transferencia')
    // La misma regla que el resto del cuerpo: ni tenant, ni importes, ni nada
    // que huela a credencial de pasarela.
    for (const clave of todasLasClaves(body)) {
      expect(CLAVES_PROHIBIDAS).not.toContain(clave)
    }
    expect(todasLasClaves(body)).not.toContain('provider_code')
    expect(todasLasClaves(body)).not.toContain('capture_mode')
  })

  it('no deja comprar sin elegir como pagar', async () => {
    const user = userEvent.setup()
    const fake = backendConPago()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await llegarAlPago(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    // Con dos medios no hay preseleccion posible: se pide elegir y NO se llama
    // al servidor para que conteste algo que ya se sabia.
    expect(
      await screen.findByText('Elige cómo quieres pagar tu pedido.'),
    ).toBeInTheDocument()
    expect(fake.state.invocations).toHaveLength(0)
  })

  it('las instrucciones salen ANTES de pedir, no solo en la confirmacion', async () => {
    const user = userEvent.setup()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(backendConPago(), '/s/casa-nordica/checkout')

    await llegarAlPago(user)
    await user.click(await screen.findByRole('radio', { name: /Yape/ }))

    // Que hay que hacer para pagar es lo unico accionable de un medio como
    // Yape: decidirlo a ciegas y descubrirlo despues es como se abandona.
    expect(await screen.findByText(/Yapea al 999 888 777/)).toBeInTheDocument()
  })

  it('sin medios configurados el checkout funciona EXACTAMENTE como antes de P09', async () => {
    const user = userEvent.setup()
    // `backendConEntrega()` sin la vista: la tienda no tiene medios de pago.
    const fake = backendConEntrega()
    sembrarCarrito([LINEA_SILLA])
    renderStorefront(fake, '/s/casa-nordica/checkout')

    await llegarAlPago(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    const body = fake.state.invocations[0]?.body as Record<string, unknown>
    // Ni la clave viaja: un `null` seria «no eligio», y aqui no se pregunto.
    expect(Object.keys(body)).not.toContain('payment_method_code')
  })
})
