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
 * `VITE_CULQI_PUBLIC_KEY` es el interruptor, y es una clave PÚBLICA por diseño
 * —Culqi la publica en el navegador, igual que la clave publicable de Supabase—,
 * así que vivir en el bundle es su sitio y no una filtración.
 *
 *   sin clave  → se fabrica un token local. NO se cobra nada.
 *   con clave  → `Culqi.js` tokeniza de verdad contra Culqi.
 *
 * El resto del camino —el checkout, el pipeline, el conector, la máquina de
 * estados— es exactamente el mismo en los dos casos. Por eso el día que llegue
 * la clave no hay nada que reescribir: se rellenan dos variables.
 *
 *   VITE_CULQI_PUBLIC_KEY            en el front
 *   EBIM_PAYMENT_SECRET_CULQI        en los secretos de la Edge Function
 *
 * ## El simulacro NO se parece a un cobro
 *
 * El token de mentira lleva `sim` en el nombre y termina con el último dígito de
 * la tarjeta tecleada, porque el conector decide por ese dígito: acabada en 0 se
 * rechaza, cualquier otra se aprueba. Es lo que permite enseñar los dos finales
 * en una demo sin depender del azar.
 */

/** La clave pública de Culqi, si el despliegue la tiene. */
export function clavePublicaCulqi(): string | null {
  const clave = import.meta.env.VITE_CULQI_PUBLIC_KEY
  return typeof clave === 'string' && clave.trim() !== '' ? clave.trim() : null
}

/** Sin clave pública no hay pasarela: la pantalla trabaja en simulacro. */
export function esSimulacroDePago(): boolean {
  return clavePublicaCulqi() === null
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
 * Carga `Culqi.js` una sola vez.
 *
 * Se hace bajo demanda y no en el arranque de la tienda: quien mira el catálogo
 * no debería pagar la descarga de una pasarela que quizá no use. Y va aquí y no
 * en el `index.html` para que sin clave no se cargue en absoluto.
 */
let cargando: Promise<void> | null = null

function cargarCulqi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new TokenizacionError('SIN_NAVEGADOR'))
  const global = window as unknown as { Culqi?: unknown }
  if (global.Culqi) return Promise.resolve()
  if (cargando) return cargando

  cargando = new Promise<void>((resolver, rechazar) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.culqi.com/js/v4'
    script.async = true
    script.onload = () => resolver()
    script.onerror = () => rechazar(new TokenizacionError('CULQI_NO_CARGA'))
    document.head.appendChild(script)
  })
  return cargando
}

/**
 * Cambia la tarjeta por un token.
 *
 * En modo real, los datos van directos a Culqi desde el navegador. Ni este
 * archivo ni ningún servidor de EBIM los guarda, los registra ni los reenvía.
 */
export async function tokenizarTarjeta(datos: DatosTarjeta): Promise<string> {
  const clave = clavePublicaCulqi()
  if (!clave) return tokenSimulado(datos.numero)

  await cargarCulqi()
  const culqi = (window as unknown as { Culqi?: Record<string, unknown> }).Culqi
  if (!culqi) throw new TokenizacionError('CULQI_NO_CARGA')

  culqi.publicKey = clave
  const crear = culqi.createToken as ((datos: unknown) => Promise<unknown>) | undefined
  if (typeof crear !== 'function') throw new TokenizacionError('CULQI_SIN_API')

  const respuesta = (await crear.call(culqi, {
    card_number: soloDigitos(datos.numero),
    cvv: soloDigitos(datos.cvv),
    expiration_month: soloDigitos(datos.mes),
    expiration_year: soloDigitos(datos.anio),
    email: datos.email,
  })) as { id?: unknown }

  if (typeof respuesta?.id !== 'string') throw new TokenizacionError('TOKEN_NO_EMITIDO')
  return respuesta.id
}
