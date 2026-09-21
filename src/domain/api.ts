/**
 * Contrato de la API EMPRESARIAL (P14-SaaS).
 *
 * Este archivo es el vocabulario, no la implementación: qué versión se sirve,
 * qué permisos existen y qué códigos de error puede recibir un socio. Está en
 * `src/domain` porque es una decisión de PRODUCTO —lo que prometemos a un
 * tercero— y no de infraestructura: la misma lista la aplica la base
 * (`ebim.api_scope_catalog`), la sirve el borde (`_shared/api`) y la pinta el
 * backoffice al conceder permisos. Un test de contrato compara las copias
 * contra Postgres real: si alguien añade un scope en SQL sin declararlo aquí
 * —o al revés— la suite se pone roja.
 *
 * ## Las tres superficies, y por qué esta es distinta
 *
 * | Superficie | Quién llama | Autoridad | Contrato |
 * |---|---|---|---|
 * | Navegador | el usuario del backoffice | RLS + JWT del hub | el ESQUEMA |
 * | Vitrina pública | un comprador anónimo | RLS `to anon` | vistas `public_*` |
 * | **Socio / empresarial** | **el sistema de un tercero** | **token + scope** | **`/v1`, estable** |
 *
 * La tercera no puede tener por contrato el esquema. Un socio que integra
 * contra los nombres de nuestras tablas queda atado a ellos, y renombrar una
 * columna pasa de refactor a incidente con un cliente. Por eso hay versión en
 * la ruta, recursos en vez de tablas, importes como cadena decimal y errores
 * con código estable.
 *
 * ## Por qué los scopes se llaman como las operaciones canónicas
 *
 * `order.create` y `stock.read` ya significan algo exacto en este producto:
 * son las operaciones que `integration_providers.capabilities` declara y las
 * que viajan en `integration_outbox.operation`. Un socio que PIDE `stock.read`
 * y un conector que OFRECE `stock.read` hablan del mismo hecho de negocio en
 * dos direcciones. Inventar un segundo vocabulario (`read:inventory`,
 * `inventory.read`, `INVENTORY_READ`) habría creado dos glosarios que divergen
 * en la primera revisión.
 *
 * Nombre del fabricante: ninguno, aquí ni en ningún archivo bajo `src/`
 * (`src/architecture.test.ts` lo verifica). La traducción de `order.create` a
 * la llamada concreta de cada sistema vive dentro de su adaptador.
 */

/** Versión servida hoy. Va en la RUTA, no en una cabecera que se puede omitir. */
export const API_VERSION = 'v1'

/**
 * Permisos de una credencial de socio. Espejo exacto de
 * `ebim.api_scope_catalog()`.
 *
 * Solo están los que tienen recurso detrás. `invoice.get` sería el nombre
 * canónico correcto el día que exista emisión de facturas; declararlo hoy
 * dejaría en el contrato una promesa que nadie cumple, y un socio la
 * integraría.
 */
export const API_SCOPES = [
  'order.read',
  'order.create',
  'product.read',
  'stock.read',
  'customer.read',
  'catalog.write',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

const SCOPE_SET: ReadonlySet<string> = new Set(API_SCOPES)

export function isApiScope(value: string): value is ApiScope {
  return SCOPE_SET.has(value)
}

/**
 * Códigos de error CANÓNICOS de la API de socio.
 *
 * Estables por contrato: un socio ramifica por ellos y no por el texto, que
 * está en español y puede cambiar. Es la misma regla que el repositorio ya
 * aplica de puertas adentro (`shared/lib/appError.ts`), extendida a un tercero
 * que no puede leer nuestro código para saber qué esperar.
 */
export const API_ERROR_CODES = [
  'NO_AUTENTICADO',
  'TOKEN_INVALIDO',
  'TOKEN_EXPIRADO',
  'CREDENCIAL_INVALIDA',
  'SCOPE_INSUFICIENTE',
  'RECURSO_NO_ENCONTRADO',
  'PETICION_INVALIDA',
  'IDEMPOTENCIA_CONFLICTO',
  'IDEMPOTENCIA_EN_CURSO',
  'LIMITE_DE_TASA',
  'VERSION_NO_SOPORTADA',
  'METODO_NO_PERMITIDO',
  'LOTE_DEMASIADO_GRANDE',
  'ERROR_INTERNO',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/**
 * Cabeceras del contrato. Se declaran aquí para que el borde, la documentación
 * generada y los tests usen la misma cadena: una cabecera escrita a mano en
 * tres sitios se convierte en tres cabeceras el día que una cambia de guion.
 */
export const API_HEADERS = {
  /** El hilo del incidente. Viaja en la petición y VUELVE en toda respuesta. */
  correlation: 'x-correlation-id',
  /** Una llamada concreta dentro del hilo. */
  request: 'x-request-id',
  /** Clave de idempotencia de las escrituras. */
  idempotency: 'idempotency-key',
  rateLimit: 'x-ratelimit-limit',
  rateRemaining: 'x-ratelimit-remaining',
} as const

/**
 * Lo que el producto ASUME del transporte, escrito donde se pueda leer.
 *
 * La terminación TLS la hace la plataforma, no este código: una Edge Function
 * no escucha en texto claro y no hay forma de desplegarla en `http`. Por eso no
 * existe una comprobación de esquema en el borde —sería teatro: la petición ya
 * llegó cifrada o no llegó—. Lo que sí depende de nosotros y sí está
 * implementado: los secretos se guardan en sha256 y nunca en claro, el token se
 * devuelve una sola vez, y toda URL a la que NOSOTROS llamamos está obligada a
 * `https` por un CHECK en la base.
 */
export const API_TRANSPORT = {
  scheme: 'https',
  minimumTlsVersion: '1.2',
  terminatedBy: 'plataforma',
} as const
