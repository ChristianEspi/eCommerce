// @vitest-environment node
/**
 * El gate de tipos del borde (cierre, item 14), por el lado que no se ve en
 * verde: que mira lo que dice mirar y que no se convierte en un no-op.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DENO_VERSION, checkArgs, listEdgeFiles, resolveDeno } from './check-edge.mjs'

describe('qué archivos comprueba', () => {
  it('todos los .ts del borde, incluidos los compartidos, y ningún test', () => {
    const files = listEdgeFiles()
    expect(files).toContain('supabase/functions/checkout/index.ts')
    expect(files).toContain('supabase/functions/_runtime/clients.ts')
    expect(files.some((f) => f.startsWith('supabase/functions/_shared/'))).toBe(true)
    expect(files.filter((f) => f.endsWith('.test.ts'))).toEqual([])
  })

  it('cada Edge Function desplegable tiene su index.ts dentro', () => {
    const files = listEdgeFiles()
    for (const name of ['api', 'checkout', 'payments-webhook', 'fulfillment-webhook', 'integration-worker']) {
      expect(files).toContain(`supabase/functions/${name}/index.ts`)
    }
  })

  it('un repositorio sin funciones da CERO archivos (y el gate falla en vez de pasar)', () => {
    const vacio = mkdtempSync(join(tmpdir(), 'check-edge-'))
    expect(listEdgeFiles(vacio)).toEqual([])
    mkdirSync(join(vacio, 'supabase', 'functions', 'x'), { recursive: true })
    writeFileSync(join(vacio, 'supabase', 'functions', 'x', 'index.test.ts'), '')
    expect(listEdgeFiles(vacio)).toEqual([])
  })
})

describe('cómo invoca a Deno', () => {
  it('comprueba de verdad: sin --no-check y con la configuración propia', () => {
    const args = checkArgs(['a.ts'])
    expect(args[0]).toBe('check')
    expect(args).not.toContain('--no-check')
    expect(args.join(' ')).toContain('--config scripts/deno.check.json')
    expect(args.at(-1)).toBe('a.ts')
  })

  it('DENO_BIN manda sobre todo lo demás', () => {
    expect(resolveDeno({ DENO_BIN: '/opt/deno' }, () => true)).toMatchObject({ command: '/opt/deno', source: 'DENO_BIN' })
  })

  it('después, el deno del PATH', () => {
    expect(resolveDeno({}, () => true)).toMatchObject({ command: 'deno', source: 'PATH' })
  })

  it('sin Deno instalado, el paquete oficial en versión fijada, sin shell', () => {
    const deno = resolveDeno({}, () => false)
    // En esta máquina npx existe; si no existiera, `null` y el gate falla.
    if (deno) {
      expect(deno.command).toBe(process.execPath)
      expect(deno.prefix).toContain(`deno@${DENO_VERSION}`)
      expect(DENO_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})
