// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, TENANT_A } from './harness'
import {
  AI_MAX_IMAGE_BYTES,
  bloquesDeContenido,
  bytesDeBase64,
  firmaCoincide,
  resumenAdjuntos,
  validarAdjunto,
} from '../functions/_shared/aiAttachments.ts'
import {
  ESQUEMA_INTAKE,
  consultaDeLinea,
  limpiarTexto,
  proponerLinea,
  revisarIntake,
  type HitCatalogo,
  type LineaLeida,
  type RespuestaModeloIntake,
} from '../functions/_shared/aiIntake.ts'
import { AI_FEATURES, validarEsquema } from '../functions/_shared/aiCore.ts'

/**
 * Pedido desde foto, PDF o texto (2026-11-19).
 *
 * Lo que se prueba es el REPARTO: el archivo se valida antes de gastar, el
 * modelo solo lee, el catálogo decide el producto y la base frena por
 * comprador. Ninguna de esas piezas necesita red.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]).toString('base64')
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj').toString('base64')

describe('adjuntos: se validan antes de gastar cuota', () => {
  it('acepta una imagen o un PDF cuyos bytes son lo que dicen ser', () => {
    expect(validarAdjunto('image/png', PNG).ok).toBe(true)
    expect(validarAdjunto('image/jpeg', JPG).ok).toBe(true)
    expect(validarAdjunto('application/pdf', PDF).ok).toBe(true)
    // Un data: URL también, reducido a base64.
    const r = validarAdjunto('image/png', `data:image/png;base64,${PNG}`)
    expect(r.ok && r.adjunto.data).toBe(PNG)
  })

  it('rechaza un tipo fuera de la lista cerrada (SVG es código, HEIC no se lee)', () => {
    expect(validarAdjunto('image/svg+xml', PNG)).toEqual({ ok: false, motivo: 'TIPO_NO_ADMITIDO' })
    expect(validarAdjunto('image/heic', PNG)).toEqual({ ok: false, motivo: 'TIPO_NO_ADMITIDO' })
    expect(validarAdjunto(undefined, PNG)).toEqual({ ok: false, motivo: 'TIPO_NO_ADMITIDO' })
  })

  it('rechaza un archivo renombrado: el tipo lo declara el navegador, los bytes no mienten', () => {
    expect(validarAdjunto('image/png', PDF)).toEqual({ ok: false, motivo: 'ARCHIVO_ILEGIBLE' })
    expect(validarAdjunto('application/pdf', JPG)).toEqual({ ok: false, motivo: 'ARCHIVO_ILEGIBLE' })
    expect(firmaCoincide('image/jpeg', PNG)).toBe(false)
  })

  it('rechaza vacío, base64 roto y lo que pasa del techo', () => {
    expect(validarAdjunto('image/png', '')).toEqual({ ok: false, motivo: 'ARCHIVO_VACIO' })
    expect(validarAdjunto('image/png', 'no es base64!!')).toEqual({ ok: false, motivo: 'ARCHIVO_ILEGIBLE' })
    const grande = 'A'.repeat(Math.ceil(((AI_MAX_IMAGE_BYTES + 10) * 4) / 3))
    expect(validarAdjunto('image/png', grande)).toEqual({ ok: false, motivo: 'ARCHIVO_DEMASIADO_GRANDE' })
  })

  it('calcula el tamaño sin decodificar', () => {
    expect(bytesDeBase64(Buffer.from('hola mundo').toString('base64'))).toBe(10)
  })

  it('los bloques van antes del texto y la traza solo guarda tipo y tamaño', () => {
    const r = validarAdjunto('application/pdf', PDF)
    if (!r.ok) throw new Error('debería validar')
    const bloques = bloquesDeContenido([r.adjunto], 'lee')
    expect(bloques.map((b) => b.type)).toEqual(['document', 'text'])
    expect(resumenAdjuntos([r.adjunto])).toMatch(/^application\/pdf \d+ KB$/)
    expect(resumenAdjuntos([r.adjunto])).not.toContain(PDF)
  })
})

function respuesta(lineas: Partial<RespuestaModeloIntake['lineas'][number]>[], extra: Partial<RespuestaModeloIntake> = {}): RespuestaModeloIntake {
  return {
    es_pedido: true,
    notas: '',
    ...extra,
    lineas: lineas.map((l) => ({
      texto: 'Donecil 10 mg',
      cantidad: 1,
      cantidad_supuesta: false,
      unidad: '',
      sku: '',
      legible: true,
      ...l,
    })),
  }
}

describe('lo que el modelo leyó, pasado por las reglas de dominio', () => {
  it('el esquema que se manda al proveedor acepta una respuesta típica', () => {
    expect(validarEsquema(ESQUEMA_INTAKE, respuesta([{ cantidad: 3, unidad: 'caja' }])).ok).toBe(true)
  })

  it('no es un pedido, o no queda ninguna línea útil ⇒ vacía', () => {
    expect(revisarIntake(respuesta([{}], { es_pedido: false }))).toEqual({ ok: false, motivo: 'vacia' })
    expect(revisarIntake(respuesta([{ texto: ' ', sku: '' }]))).toEqual({ ok: false, motivo: 'vacia' })
  })

  it('la misma línea repetida se SUMA: en una lista a mano repetir es pedir más', () => {
    const r = revisarIntake(respuesta([{ cantidad: 2 }, { cantidad: 3, texto: 'donecil 10 MG' }]))
    if (!r.ok) throw new Error('debería revisar')
    expect(r.value.lineas).toHaveLength(1)
    expect(r.value.lineas[0]?.cantidad).toBe(5)
  })

  it('quita correos y números largos (teléfono, RUC) del texto', () => {
    expect(limpiarTexto('Donecil ana@correo.pe 987 654 321 caja')).toBe('Donecil caja')
    expect(limpiarTexto('RUC 20123456789 Doxiplus')).toBe('RUC Doxiplus')
  })

  it('un SKU con forma rara se descarta, pero la línea queda', () => {
    const r = revisarIntake(respuesta([{ sku: 'DROP TABLE;' }]))
    if (!r.ok) throw new Error('debería revisar')
    expect(r.value.lineas[0]?.sku).toBeNull()
    expect(r.value.lineas[0]?.texto).toBe('Donecil 10 mg')
  })

  it('las notas no traen cifras: las cantidades las enseña la tabla', () => {
    const r = revisarIntake(respuesta([{}], { notas: 'Revisa las 3 líneas borrosas' }))
    if (!r.ok) throw new Error('debería revisar')
    expect(r.value.notas).toBe('Revisa las líneas borrosas')
  })
})

const hit = (h: Partial<HitCatalogo>): HitCatalogo => ({
  product_id: '11111111-1111-4111-8111-111111111111',
  slug: 'donecil-10',
  name: 'Donecil 10 mg x 30',
  sku: 'DON-10',
  kind: 'simple',
  brand_name: null,
  in_stock: true,
  ...h,
})

const leida = (l: Partial<LineaLeida> = {}): LineaLeida => ({
  texto: 'Donecil 10 mg',
  cantidad: 2,
  cantidadSupuesta: false,
  unidad: null,
  sku: null,
  legible: true,
  ...l,
})

describe('el producto lo decide el catálogo, sin modelo', () => {
  it('coincidencia de texto real y letra legible ⇒ probable, con el SKU del catálogo', () => {
    const p = proponerLinea(0, leida(), { mode: 'fts', items: [hit({})] })
    expect(p.confianza).toBe('probable')
    expect(p.sku_propuesto).toBe('DON-10')
  })

  it('solo parecido, o letra dudosa ⇒ dudosa', () => {
    expect(proponerLinea(0, leida(), { mode: 'fuzzy', items: [hit({})] }).confianza).toBe('dudosa')
    expect(proponerLinea(0, leida({ legible: false }), { mode: 'fts', items: [hit({})] }).confianza).toBe('dudosa')
  })

  it('sin resultados ⇒ ninguna, y no se propone SKU', () => {
    const p = proponerLinea(0, leida(), { mode: 'empty', items: [] })
    expect(p).toMatchObject({ confianza: 'ninguna', sku_propuesto: null, coincidencia: null })
  })

  it('un producto con variantes no se compra por el maestro: hay que elegir', () => {
    const p = proponerLinea(0, leida(), { mode: 'fts', items: [hit({ kind: 'variant' })] })
    expect(p).toMatchObject({ confianza: 'variante', sku_propuesto: null })
  })

  it('un código escrito en el documento manda, aunque el buscador no lo encuentre', () => {
    const conCodigo = proponerLinea(0, leida({ sku: 'don-10' }), { mode: 'fts', items: [hit({})] })
    expect(conCodigo).toMatchObject({ confianza: 'codigo', sku_propuesto: 'DON-10' })
    const sinResultado = proponerLinea(0, leida({ sku: 'XYZ-9' }), { mode: 'empty', items: [] })
    expect(sinResultado).toMatchObject({ confianza: 'codigo', sku_propuesto: 'XYZ-9', coincidencia: null })
  })

  it('las alternativas son del buscador y como mucho tres', () => {
    const items = [1, 2, 3, 4, 5].map((n) => hit({ product_id: `1111111${n}-1111-4111-8111-111111111111`, sku: `S-${n}` }))
    const p = proponerLinea(0, leida(), { mode: 'fts', items })
    expect(p.alternativas).toHaveLength(3)
    expect(p.alternativas.map((a) => a.sku)).toEqual(['S-2', 'S-3', 'S-4'])
  })

  it('la consulta al buscador va sin cantidades sueltas', () => {
    expect(consultaDeLinea(leida({ texto: 'Donecil 10 mg 3 cajas' }))).toBe('Donecil 10 mg')
  })
})

describe('registro', () => {
  it('intake: capacidad de asistente, módulo vitrina, dentro de los techos', () => {
    expect(AI_FEATURES.intake).toMatchObject({ capability: 'ai.assist', module: 'storefront' })
    expect(AI_FEATURES.intake.maxTokens).toBeLessThanOrEqual(4096)
    expect(AI_FEATURES.intake.timeoutMs).toBeLessThanOrEqual(30000)
  })
})

describe('ai_intake_check: sesión y freno por comprador', () => {
  let db: PGlite
  const COMPRADOR = { sub: '0b000000-0000-4000-8000-00000000c001', role: 'authenticated', email: 'compra@cliente.pe' }

  beforeAll(async () => {
    db = await createTestDatabase()
    await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      TENANT_A.organizationId,
      TENANT_A.companyId,
      TENANT_A.slug,
      TENANT_A.slug,
      TENANT_A.adminEmail,
      TENANT_A.ownerId,
      TENANT_A.storeSlug,
    ])
    await db.query(`update public.stores set status = 'active'`)
  })

  afterAll(async () => {
    await db?.close()
  })

  async function revisar(claims: Record<string, unknown> | null, slug = TENANT_A.storeSlug) {
    const rol = claims ? 'authenticated' : 'anon'
    return asRole(db, rol, (claims ?? null) as never, async () => {
      const r = await db.query<{ r: Record<string, unknown> }>(`select public.ai_intake_check($1) as r`, [slug])
      return r.rows[0]?.r
    })
  }

  it('anónimo no puede ni llamarla', async () => {
    await expect(revisar(null)).rejects.toThrow(/permission denied/i)
  })

  it('con sesión y tienda activa, sí', async () => {
    expect(await revisar(COMPRADOR)).toEqual({ allowed: true })
  })

  it('tienda desconocida ⇒ no disponible', async () => {
    expect(await revisar(COMPRADOR, 'no-existe')).toEqual({ allowed: false, reason: 'TIENDA_NO_DISPONIBLE' })
  })

  it('el techo es POR COMPRADOR: a la 31.ª lectura en la hora, frena; a otro no', async () => {
    const otro = { ...COMPRADOR, sub: '0b000000-0000-4000-8000-00000000c002' }
    // Ya hubo una lectura en el caso anterior.
    for (let i = 0; i < 29; i++) expect(await revisar(COMPRADOR)).toEqual({ allowed: true })
    expect(await revisar(COMPRADOR)).toEqual({ allowed: false, reason: 'RATE_LIMITED' })
    expect(await revisar(otro)).toEqual({ allowed: true })
  })
})
