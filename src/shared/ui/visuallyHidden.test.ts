// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Texto oculto para lectores de pantalla (2026-11-24).
 *
 * En el `sx` de MUI un número entre 0 y 1 es un PORCENTAJE: `width: 1` es
 * `100%`, no 1 px. Tres «visually hidden» escritos a mano con `position:
 * absolute; width: 1; height: 1` medían el ancho de la página y la
 * desbordaban: en «Complementos IA» salía una barra horizontal. Lo correcto es
 * `visuallyHidden` de `@mui/utils`.
 */
describe('ocultar a la vista sin desbordar la página', () => {
  it('nadie escribe `width: 1, height: 1` a mano', () => {
    const archivos: string[] = []
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const ruta = join(dir, e)
        if (statSync(ruta).isDirectory()) recorrer(ruta)
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) archivos.push(ruta)
      }
    }
    recorrer(join(process.cwd(), 'src'))
    const culpables = archivos.filter((f) => /width:\s*1\s*,\s*height:\s*1\b/.test(readFileSync(f, 'utf8')))
    expect(culpables).toEqual([])
  })
})
