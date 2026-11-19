import { render, screen, waitFor } from '@testing-library/react'
import { Component, Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lazyPage } from './lazyPage'

/**
 * Una pantalla que sobrevive a un despliegue.
 *
 * El caso real: el backoffice abierto, se despliega una versión nueva, y al
 * pulsar «Promociones» sale «Failed to fetch dynamically imported module». La
 * pestaña pide un trozo de la versión anterior y ese fichero ya no existe.
 *
 * Lo que se fija aquí es el orden de la respuesta —reintento, UNA recarga, y
 * después el error— y sobre todo el límite: una recarga que vuelve a fallar no
 * puede recargar otra vez. Un bucle de recargas es peor que el error.
 */

const RELOAD_KEY = 'ecommerce-chunk-reload'

let recargas: number

beforeEach(() => {
  recargas = 0
  window.sessionStorage.clear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: () => (recargas += 1) },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Pantalla() {
  return <p>Promociones</p>
}

/**
 * El boundary que en la app pone el router.
 *
 * Aquí hace falta de verdad: sin él, el error de carga sale del árbol como
 * «unhandled» y ensucia la corrida entera, y además deja sin comprobar lo único
 * que importa de ese caso: que el error LLEGA a quien tiene que pintarlo.
 */
class Boundary extends Component<{ children: ReactNode }, { roto: boolean }> {
  state = { roto: false }

  static getDerivedStateFromError() {
    return { roto: true }
  }

  render() {
    return this.state.roto ? <p>Algo salio mal</p> : this.props.children
  }
}

describe('una pantalla que se carga aparte y sobrevive a un despliegue', () => {
  it('un fallo suelto se reintenta y la pantalla acaba pintándose', async () => {
    let intentos = 0
    const Lazy = lazyPage(async () => {
      intentos += 1
      if (intentos === 1) throw new TypeError('Failed to fetch dynamically imported module')
      return { default: Pantalla }
    })

    render(
      <Suspense fallback={<p>Cargando</p>}>
        <Lazy />
      </Suspense>,
    )

    expect(await screen.findByText('Promociones')).toBeInTheDocument()
    expect(intentos).toBe(2)
    // Y sin recargar: perder el estado de la página por un corte de un segundo
    // sería cobrar demasiado por el arreglo.
    expect(recargas).toBe(0)
  })

  it('si los dos intentos fallan, recarga una vez para leer la versión nueva', async () => {
    const Lazy = lazyPage(async () => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })

    render(
      <Suspense fallback={<p>Cargando</p>}>
        <Lazy />
      </Suspense>,
    )

    await waitFor(() => expect(recargas).toBe(1))
    // La marca es lo que impide el bucle en la vuelta siguiente.
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBeTruthy()
    // Mientras la página se va, no se pinta el error: sería una alarma falsa.
    expect(screen.getByText('Cargando')).toBeInTheDocument()
  })

  it('con una recarga reciente NO recarga otra vez: propaga el error', async () => {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    const fallo = new TypeError('Failed to fetch dynamically imported module')
    const Lazy = lazyPage(async () => {
      throw fallo
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Boundary>
        <Suspense fallback={<p>Cargando</p>}>
          <Lazy />
        </Suspense>
      </Boundary>,
    )

    // El error llega a la pantalla de error, que es la que ofrece recargar a
    // mano. Y no se recargó sola: ese es el bucle que se está evitando.
    expect(await screen.findByText('Algo salio mal')).toBeInTheDocument()
    expect(recargas).toBe(0)
  })

  it('sin sessionStorage tampoco recarga: sin marca no hay forma de parar', async () => {
    const roto = () => {
      throw new Error('storage bloqueado')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(roto)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(roto)

    const Lazy = lazyPage(async () => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Boundary>
        <Suspense fallback={<p>Cargando</p>}>
          <Lazy />
        </Suspense>
      </Boundary>,
    )

    expect(await screen.findByText('Algo salio mal')).toBeInTheDocument()
    expect(recargas).toBe(0)
  })
})

describe('todo trozo que se carga aparte sobrevive a un despliegue', () => {
  /**
   * 2026-11-19 · En QAS, el asistente de la vitrina se cargaba con `lazy` a
   * secas y, con la pestaña abierta durante un despliegue, salía «Failed to
   * fetch dynamically imported module …/AssistantDrawer-….js». `lazyPage`
   * existía, pero solo lo usaban las rutas. Cualquier `lazy(` suelto vuelve a
   * abrir ese agujero.
   */
  it('ningún archivo de src usa `lazy(` de React directamente', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const archivos: string[] = []
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const ruta = join(dir, e)
        if (statSync(ruta).isDirectory()) recorrer(ruta)
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) archivos.push(ruta)
      }
    }
    recorrer(join(process.cwd(), 'src'))
    const culpables = archivos.filter(
      (f) => !f.endsWith('lazyPage.ts') && /(?<![A-Za-z.])lazy\(/.test(readFileSync(f, 'utf8')),
    )
    expect(culpables).toEqual([])
  })
})
