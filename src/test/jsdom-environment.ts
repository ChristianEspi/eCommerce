import type { Environment } from 'vitest/environments'
import { builtinEnvironments } from 'vitest/environments'

/**
 * jsdom, con UNA corrección de frontera entre jsdom y Node (N08).
 *
 * ## El fallo
 *
 * En Node ≥ 22 el `Request` global es el de undici, que exige que
 * `init.signal` sea un `AbortSignal` DE NODE. El entorno jsdom de Vitest
 * sustituye `AbortController`/`AbortSignal` por los de jsdom, pero deja el
 * `Request` de Node. React Router (`createMemoryRouter`) crea un `Request` con
 * la señal de un `AbortController` —el de jsdom— en cada navegación, y undici lo
 * rechaza: `RequestInit: Expected signal ("AbortSignal {}") to be an instance of
 * AbortSignal`. Con Node 20 pasaba porque su undici no lo comprobaba.
 *
 * ## La corrección, solo del entorno de pruebas
 *
 * Antes de montar jsdom se guardan el `AbortController` y el `AbortSignal` de
 * Node. Después, `Request` se envuelve: si la señal que llega no es de Node, se
 * crea una de Node que se aborta cuando la de jsdom se aborta (con el mismo
 * motivo). La cancelación sigue funcionando igual y jsdom conserva sus propias
 * clases para todo lo demás (`addEventListener(..., { signal })` incluido).
 *
 * No toca el código de producción: en el navegador `Request` y `AbortSignal`
 * son del mismo mundo y este problema no existe.
 */
const jsdom = builtinEnvironments.jsdom

type NodeGlobals = { AbortController: typeof AbortController; AbortSignal: typeof AbortSignal; Request: typeof Request }

export default <Environment>{
  name: 'jsdom-node-request',
  transformMode: 'web',
  async setup(global: Record<string, unknown>, options: Record<string, unknown>) {
    const node = global as unknown as NodeGlobals
    const NodeAbortController = node.AbortController
    const NodeAbortSignal = node.AbortSignal
    const NodeRequest = node.Request

    const env = await jsdom.setup(global, options)

    class BridgedRequest extends NodeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        // La de jsdom tiene la MISMA forma que la de Node, pero otra clase: por eso
        // el tipo es el estructural y la comprobación, la de identidad.
        const signal = init?.signal as AbortSignal | null | undefined
        const foreign = signal != null && !((signal as object) instanceof NodeAbortSignal)
        if (signal && foreign) {
          const bridge = new NodeAbortController()
          if (signal.aborted) bridge.abort(signal.reason)
          else signal.addEventListener('abort', () => bridge.abort(signal.reason), { once: true })
          super(input, { ...init, signal: bridge.signal })
          return
        }
        super(input, init)
      }
    }
    global.Request = BridgedRequest

    return {
      async teardown(g: Record<string, unknown>) {
        g.Request = NodeRequest
        await env.teardown(g)
      },
    }
  },
}
