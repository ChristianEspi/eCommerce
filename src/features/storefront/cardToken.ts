/**
 * De la tarjeta al TOKEN, que es lo único que sale de esta pantalla.
 *
 * ## Por qué un token y no el número
 *
 * Culqi entrega un `source_id` de un solo uso a cambio de los datos de la
 * tarjeta. Ese intercambio ocurre contra sus servidores, no contra los nuestros,
 * y es lo que mantiene todo el proyecto fuera del alcance de PCI: por el
 * servidor de EBIM no pasa jamás un número de tarjeta, ni siquiera de paso.
 *
 * ## Los dos modos, y cómo se pasa de uno al otro
 *
 * La llave PÚBLICA de Culqi es de cada tienda: el comercio la pega en
 * Backoffice → Pagos → Medios de pago y llega con el medio elegido
 * (`public_payment_methods.checkout_public_key`). Es pública por diseño
 * —Culqi la publica en el navegador—, así que viajar a la vitrina no es una
 * filtración. La SECRETA nunca sale del servidor (Vault).
 *
 *   sin llave  → se fabrica un token local. NO se cobra nada.
 *   con llave  → `Culqi.js` tokeniza de verdad contra la cuenta de ESA tienda.
 *
 * El resto del camino —el checkout, el pipeline, el conector, la máquina de
 * estados— es exactamente el mismo en los dos casos.
 *
 * ## El simulacro NO se parece a un cobro
 *
 * El token de mentira lleva `sim` en el nombre y termina con el último dígito de
 * la tarjeta tecleada, porque el conector decide por ese dígito: acabada en 0 se
 * rechaza, cualquier otra se aprueba. Es lo que permite enseñar los dos finales
 * en una demo sin depender del azar.
 */

/** La llave pública de Culqi del medio elegido, si la tienda la configuró. */
export function clavePublicaCulqi(llave: string | null | undefined): string | null {
  return typeof llave === 'string' && llave.trim() !== '' ? llave.trim() : null
}

/** Sin llave pública no hay pasarela: la pantalla trabaja en simulacro. */
export function esSimulacroDePago(llave: string | null | undefined): boolean {
  return clavePublicaCulqi(llave) === null
}

export interface DatosTarjeta {
  numero: string
  mes: string
  anio: string
  cvv: string
  email: string
}

export class TokenizacionError extends Error {}

/** Solo dígitos. Se teclea con espacios porque así se lee un plástico. */
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

/**
 * Luhn, en el navegador y solo para avisar antes de tiempo.
 *
 * No es una validación de seguridad —quien decide si una tarjeta existe es el
 * emisor— sino un favor: evita gastar una llamada a la pasarela, y un viaje de
 * ida y vuelta, por un dígito mal tecleado.
 */
export function pareceTarjeta(numero: string): boolean {
  const digitos = soloDigitos(numero)
  if (digitos.length < 13 || digitos.length > 19) return false

  let suma = 0
  let doblar = false
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = Number(digitos[i])
    if (doblar) {
      n *= 2
      if (n > 9) n -= 9
    }
    suma += n
    doblar = !doblar
  }
  return suma % 10 === 0
}

/** El token de mentira. Lleva `sim` en el nombre para que nadie lo confunda. */
function tokenSimulado(numero: string): string {
  const digitos = soloDigitos(numero)
  const ultimo = digitos.slice(-1) || '1'
  return `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${ultimo}`
}

/**
 * La API de tokens de Culqi (2026-11-15).
 *
 * Antes se cargaba `Culqi.js v4` y se esperaba que `Culqi.createToken(datos)`
 * devolviera una promesa; esa librería no funciona así (lee un formulario y
 * responde a una función global), y el token nunca llegaba. La API documentada
 * es un POST con la llave PÚBLICA: no hace falta ningún script de terceros en
 * la página, y lo que se manda es exactamente lo mismo.
 */
const CULQI_TOKENS = 'https://secure.culqi.com/v2/tokens'

/** «28» → «2028»: Culqi pide el año con cuatro cifras. */
function anioCompleto(anio: string): string {
  const digitos = soloDigitos(anio)
  return digitos.length === 2 ? `20${digitos}` : digitos
}

/**
 * Cambia la tarjeta por un token.
 *
 * En modo real, los datos van directos a Culqi desde el navegador. Ni este
 * archivo ni ningún servidor de EBIM los guarda, los registra ni los reenvía.
 * Si Culqi rechaza la tarjeta al tokenizar (número o fecha inválidos), se
 * lanza `TokenizacionError('TARJETA_RECHAZADA')` y no se llega a crear pedido.
 */
export async function tokenizarTarjeta(
  datos: DatosTarjeta,
  llavePublica: string | null | undefined,
): Promise<string> {
  const clave = clavePublicaCulqi(llavePublica)
  if (!clave) return tokenSimulado(datos.numero)

  let respuesta: Response
  try {
    respuesta = await fetch(CULQI_TOKENS, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_number: soloDigitos(datos.numero),
        cvv: soloDigitos(datos.cvv),
        expiration_month: soloDigitos(datos.mes).padStart(2, '0'),
        expiration_year: anioCompleto(datos.anio),
        email: datos.email,
      }),
    })
  } catch {
    throw new TokenizacionError('CULQI_NO_RESPONDE')
  }
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { id?: unknown; object?: unknown }
  if (!respuesta.ok) throw new TokenizacionError('TARJETA_RECHAZADA')
  if (typeof cuerpo.id !== 'string') throw new TokenizacionError('TOKEN_NO_EMITIDO')
  return cuerpo.id
}

// ---------------------------------------------------------------------------
// Culqi Checkout: el formulario OFICIAL de Culqi (2026-11-15)
// ---------------------------------------------------------------------------

/**
 * Decisión del operador: la tarjeta se escribe en la ventana de Culqi, no en
 * campos de la tienda. Así el número nunca pasa por el código de esta página
 * (PCI) y Culqi resuelve la verificación del banco (3DS).
 *
 * La librería es `checkout.culqi.com/js/v4`: se fija la llave pública, el
 * monto (solo para mostrarlo: el cobro lo calcula el servidor) y se abre.
 * Culqi avisa llamando a la función global `window.culqi`; aquí se envuelve
 * en una promesa que devuelve el token, o falla con:
 *
 *   CANCELADO          el comprador cerró la ventana sin pagar;
 *   TARJETA_RECHAZADA  Culqi no aceptó la tarjeta;
 *   CULQI_NO_CARGA / CULQI_SIN_API  la librería no está disponible.
 *
 * Se piden SOLO tarjetas: Yape, banca móvil o agentes dentro de Culqi crean
 * una «orden» que se paga después y necesita otro circuito en el servidor.
 */
export interface CulqiCheckoutInput {
  readonly llavePublica: string
  /** Monto en céntimos, para que la ventana lo muestre. */
  readonly montoCentimos: number
  readonly moneda: string
  readonly titulo: string
  /**
   * La marca de la tienda en la ventana de Culqi (2026-11-18): su logo (URL
   * `https`, la firmada de la vitrina) y su color de acento para la banda, el
   * botón y el precio. Sin ellos, la ventana sale con el estilo de Culqi.
   */
  readonly logoUrl?: string | null
  readonly colorAcento?: string | null
}

/** Negro o blanco, el que se lea mejor sobre el acento (contraste WCAG). */
export function textoSobre(hex: string): '#FFFFFF' | '#111111' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#FFFFFF'
  const n = parseInt(m[1]!, 16)
  const canal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255)
  // Contraste contra blanco (1.05 / (l + 0.05)) frente a contra negro ((l + 0.05) / 0.05).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#111111'
}

/** El bloque `style` de Culqi Checkout v4 con la marca de la tienda; vacío si no hay nada que poner. */
export function estiloCulqi(logoUrl?: string | null, colorAcento?: string | null): Record<string, string> {
  const estilo: Record<string, string> = {}
  if (logoUrl && /^https:\/\//i.test(logoUrl)) estilo.logo = logoUrl
  const acento = colorAcento && /^#[0-9a-f]{6}$/i.test(colorAcento.trim()) ? colorAcento.trim() : null
  if (acento) {
    estilo.bannerColor = acento
    estilo.buttonBackground = acento
    estilo.buttonTextColor = textoSobre(acento)
    estilo.menuColor = acento
    estilo.linksColor = acento
    estilo.priceColor = acento
  }
  return estilo
}

let cargandoCheckout: Promise<void> | null = null

function cargarCulqiCheckout(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new TokenizacionError('CULQI_NO_CARGA'))
  if ((window as unknown as { Culqi?: unknown }).Culqi) return Promise.resolve()
  if (cargandoCheckout) return cargandoCheckout
  cargandoCheckout = new Promise<void>((resolver, rechazar) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.culqi.com/js/v4'
    script.async = true
    script.onload = () => resolver()
    script.onerror = () => {
      cargandoCheckout = null
      rechazar(new TokenizacionError('CULQI_NO_CARGA'))
    }
    document.head.appendChild(script)
  })
  return cargandoCheckout
}

interface CulqiGlobal {
  publicKey?: string
  settings?: (opciones: Record<string, unknown>) => void
  options?: (opciones: Record<string, unknown>) => void
  open?: () => void
  close?: () => void
  isOpen?: boolean
  token?: { id?: string } | null
  error?: { user_message?: string } | null
}

export async function pagarConCulqiCheckout(input: CulqiCheckoutInput): Promise<string> {
  await cargarCulqiCheckout()
  const ventana = window as unknown as { Culqi?: CulqiGlobal; culqi?: () => void }
  const culqi = ventana.Culqi
  if (!culqi || typeof culqi.open !== 'function' || typeof culqi.settings !== 'function') {
    throw new TokenizacionError('CULQI_SIN_API')
  }

  culqi.publicKey = input.llavePublica
  culqi.token = null
  culqi.error = null
  culqi.settings({
    title: input.titulo,
    currency: input.moneda,
    amount: Math.max(1, Math.round(input.montoCentimos)),
  })
  const estilo = estiloCulqi(input.logoUrl, input.colorAcento)
  culqi.options?.({
    lang: 'auto',
    installments: false,
    paymentMethods: { tarjeta: true, yape: false, bancaMovil: false, agente: false, billetera: false, cuotealo: false },
    ...(Object.keys(estilo).length > 0 ? { style: estilo } : {}),
  })

  return new Promise<string>((resolve, reject) => {
    const anterior = ventana.culqi
    let terminado = false
    let visto = false
    const terminar = (accion: () => void) => {
      if (terminado) return
      terminado = true
      clearInterval(vigia)
      ventana.culqi = anterior
      accion()
    }

    ventana.culqi = () => {
      const id = culqi.token?.id
      if (typeof id === 'string' && id) {
        culqi.close?.()
        terminar(() => resolve(id))
      } else if (culqi.error) {
        culqi.close?.()
        terminar(() => reject(new TokenizacionError('TARJETA_RECHAZADA')))
      }
    }

    // Cerrar la ventana sin pagar no llama a `culqi()`: se vigila si sigue
    // abierta (`Culqi.isOpen` o, si la versión no lo expone, su iframe).
    const vigia = setInterval(() => {
      const abierta =
        typeof culqi.isOpen === 'boolean'
          ? culqi.isOpen
          : Boolean(document.querySelector('iframe[src*="culqi"], iframe[name*="culqi" i]'))
      if (abierta) visto = true
      else if (visto) terminar(() => reject(new TokenizacionError('CANCELADO')))
    }, 400)

    culqi.open?.()
    // Se mira YA si quedó abierta: si el comprador la cierra antes del primer
    // ciclo de la vigía, sin esto la promesa no terminaría nunca.
    if (culqi.isOpen === true || document.querySelector('iframe[src*="culqi"], iframe[name*="culqi" i]')) {
      visto = true
    }
  })
}
