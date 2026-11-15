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
