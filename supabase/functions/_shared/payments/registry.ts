/**
 * El registro de adaptadores: `provider_code` → adaptador.
 *
 * Es el único sitio de todo el repositorio donde el código de una pasarela
 * aparece escrito. El dominio de pagos, el de pedidos y el checkout hablan
 * siempre de `provider_code` como de un dato que viene de la fila; aquí se
 * resuelve a la implementación.
 *
 * **Añadir una pasarela real es escribir un archivo y una línea en este mapa.**
 * Ni una migración sobre `orders`, ni un cambio en el pipeline, ni un `if` en
 * el checkout. Esa es, literalmente, la Definition of Done de P09, y este
 * archivo es donde se comprueba.
 *
 * Un `provider_code` que la base conoce y este mapa no es un error del
 * DESPLIEGUE —fila dada de alta sin desplegar el adaptador—, y por eso sale con
 * su propio código y no como «no soportado».
 */
import { CULQI_PROVIDER_CODE, createCulqiProvider } from './culqi.ts'
import type { PaymentProvider } from './provider.ts'
import { SANDBOX_PROVIDER_CODE, createSandboxProvider, type SandboxOptions } from './sandbox.ts'

export interface ProviderResolveOptions extends SandboxOptions {
  /**
   * La credencial de la pasarela, si la hay.
   *
   * Entra por aqui y no se lee dentro del adaptador porque los adaptadores
   * de esta carpeta son PUROS: ninguno toca `Deno.env`, y por eso la suite
   * los ejecuta en Node junto al resto. Quien lee el entorno es el borde.
   *
   * Sin ella, un adaptador con simulacro debe simular y uno sin simulacro
   * debe rechazar; lo que nunca debe hacer es fingir un cobro.
   */
  readonly secret?: string | null
  /** Configuración PÚBLICA del medio (`payment_methods.public_config`). Sin secretos. */
  readonly publicConfig?: Record<string, unknown>
}

export type PaymentProviderFactory = (options: ProviderResolveOptions) => PaymentProvider

const FACTORIES = new Map<string, PaymentProviderFactory>([
  [SANDBOX_PROVIDER_CODE, (options) => createSandboxProvider(options)],
  [CULQI_PROVIDER_CODE, (options) => createCulqiProvider(options)],
])

export class UnknownPaymentProviderError extends Error {
  readonly code = 'CONECTOR_NO_DESPLEGADO'
  readonly providerCode: string

  constructor(providerCode: string) {
    super(`No hay adaptador desplegado para el conector "${providerCode}"`)
    this.name = 'UnknownPaymentProviderError'
    this.providerCode = providerCode
  }
}

/** Registra un adaptador. Lo usan los tests y, el día que exista, un adaptador real. */
export function registerPaymentProvider(code: string, factory: PaymentProviderFactory): void {
  FACTORIES.set(code, factory)
}

export function hasPaymentProvider(code: string): boolean {
  return FACTORIES.has(code)
}

export function resolvePaymentProvider(
  code: string,
  options: ProviderResolveOptions = {},
): PaymentProvider {
  const factory = FACTORIES.get(code)
  if (!factory) throw new UnknownPaymentProviderError(code)
  return factory(options)
}

/** Los códigos con adaptador desplegado. Para diagnóstico, no para decidir. */
export function deployedPaymentProviders(): readonly string[] {
  return [...FACTORIES.keys()].sort()
}
