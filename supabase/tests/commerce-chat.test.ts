// @vitest-environment node
/**
 * Asistente de compra conversacional (2026-11-22).
 *
 * Lo que se fija:
 *  · el plan del modelo se valida contra una lista cerrada; lo dudoso es responder;
 *  · repetir un pedido aplica SOLO los cambios dichos y lo demás queda igual;
 *  · un carrito propuesto usa las reglas de la lectura de pedidos (código nuestro
 *    manda, presentaciones a elegir, nombre comercial de segundo intento);
 *  · lo que ve el modelo para redactar no lleva importes;
 *  · el freno por comprador en la base.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, TENANT_A } from './harness'
import {
  aplicarCambios,
  compararPresentaciones,
  contenidoDePresentacion,
  descripcionParaModelo,
  hermanosPorContenido,
  nombreSinContenido,
  ejecutarChat,
  leerReposicion,
  leerSeguimiento,
  nombreCoincide,
  numerosDePedido,
  taparNumeros,
  proponerCarrito,
  validarPlanChat,
  type PuertosChat,
} from '../functions/_shared/commerceChat.ts'
import type { HitCatalogo, ResultadoBusqueda } from '../functions/_shared/aiIntake.ts'

const CONSIV = '11111111-1111-4111-8111-111111111111'
const FANTER = '22222222-2222-4222-8222-222222222222'
const BLOQ = '33333333-3333-4333-8333-333333333333'

const hit = (o: Partial<HitCatalogo>): HitCatalogo => ({
  product_id: BLOQ,
  slug: 'bloqueador',
  name: 'Bloqueador Solar FPS 50',
  sku: 'QS-514574',
  kind: 'simple',
  brand_name: 'Eucerin',
  in_stock: true,
  ...o,
})

function puertos(over: Partial<PuertosChat> = {}): PuertosChat & { busquedas: string[] } {
  const busquedas: string[] = []
  const catalogo: Record<string, ResultadoBusqueda> = {
    bloqueador: { mode: 'fts', items: [hit({})] },
    lejia: {
      mode: 'fts',
      items: [
        hit({ product_id: 'l1', name: 'Lejía Tradicional 1 L', brand_name: 'Clorox' }),
        hit({ product_id: 'l5', name: 'Lejía Tradicional 5 L', brand_name: 'Clorox' }),
        hit({ product_id: 'lg', name: 'Lejía Tradicional Gel 1 L', brand_name: 'Clorox' }),
        hit({ product_id: 'lo', name: 'Lejía Tradicional 5 L', brand_name: 'Otra' }),
      ],
    },
    consiv: { mode: 'fts', items: [hit({ product_id: CONSIV, slug: 'consiv', name: 'Consiv Tableta Recubierta Caja 30 un', sku: null, kind: 'variant' })] },
    metilfenidato: { mode: 'fts', items: [hit({ product_id: CONSIV, slug: 'consiv', name: 'Consiv Tableta Recubierta Caja 30 un', sku: null, kind: 'variant' })] },
  }
  return {
    busquedas,
    async buscar(consulta) {
      busquedas.push(consulta)
      return catalogo[consulta.toLowerCase()] ?? { mode: 'empty', items: [] }
    },
    async pedidos() {
      return [
        { order_id: 'o2', order_number: 'EC-2', status: 'paid', payment_status: 'paid', fulfillment_status: 'in_progress', placed_at: '2026-11-20T10:00:00Z', total: '300.00', currency: 'PEN' },
        { order_id: 'o1', order_number: 'EC-1', status: 'delivered', payment_status: 'paid', fulfillment_status: 'fulfilled', placed_at: '2026-10-20T10:00:00Z', total: '100.00', currency: 'PEN' },
      ]
    },
    async detallePedido(id) {
      return id === 'o2'
        ? [
            { sku: 'QS-282484', nombre: 'Consiv Tableta Recubierta Caja 30 un · 18 mg', cantidad: 2 },
            { sku: 'QS-295212', nombre: 'Fanter 10 mg Comprimidos Recubiertos · Caja x 15', cantidad: 1 },
          ]
        : []
    },
    async reposicion() {
      return [{ sku: 'QS-282484', nombre: 'Consiv Tableta Recubierta Caja 30 un · 18 mg', cantidad: 2, compras: 4, cada_dias: 15, dias_restantes: -1 }]
    },
    async ficha(id) {
      if (id === 'l1') return { product_id: 'l1', nombre: 'Lejía Tradicional 1 L', marca: 'Clorox', descripcion: null, destacados: [], especificaciones: [], presentaciones: [] }
      if (id !== CONSIV) return null
      return {
        product_id: CONSIV,
        nombre: 'Consiv Tableta Recubierta',
        marca: 'Medifarma',
        descripcion: 'Metilfenidato. Tableta de liberación prolongada.',
        destacados: ['Registro sanitario vigente'],
        especificaciones: [{ etiqueta: 'Forma', valor: 'Tableta' }],
        presentaciones: [
          { variant_id: 'v30', nombre: '18 mg · Caja 30 un', en_stock: true, precio: '90.00', moneda: 'PEN' },
          { variant_id: 'v100', nombre: '18 mg · Caja x100', en_stock: true, precio: '250.00', moneda: 'PEN' },
        ],
      }
    },
    async seguimiento(id) {
      return id === 'o1'
        ? [{ metodo: 'Reparto', estado: 'in_transit', prometido_hasta: '2026-11-19', entregado: null, dias_retraso: 3, ultimo_evento: { estado: 'delivery_attempted', fecha: '2026-11-21' }, intentos_fallidos: 1 }]
        : []
    },
    async precios(ids) {
      return new Map(ids.map((id, i) => [id, { precio: i === 0 ? '12.00' : '50.00', moneda: 'PEN' }]))
    },
    async credito() {
      return { cuenta: 'Distribuidora Prueba SAC', limite: '10000.00', disponible: '7500.00', saldo: '2500.00', vencido: '0', moneda: 'PEN', proximo: { order_number: 'EC-2', due_at: '2026-12-20', total: '300.00', days_overdue: 0 } }
    },
    async resolverCodigos(skus) {
      const m = new Map()
      if (skus.includes('QS-282484')) m.set('qs-282484', { product_id: CONSIV, slug: 'consiv', name: 'Consiv Tableta Recubierta Caja 30 un', variant: true })
      if (skus.includes('QS-295212')) m.set('qs-295212', { product_id: FANTER, slug: 'fanter', name: 'Fanter 10 mg Comprimidos Recubiertos', variant: true })
      return m
    },
    async presentaciones(ids) {
      const m = new Map()
      if (ids.includes(CONSIV)) m.set(CONSIV, [{ variant_id: 'a1111111-1111-4111-8111-111111111111', sku: 'QS-282484', name: '18 mg' }])
      if (ids.includes(FANTER)) m.set(FANTER, [{ variant_id: 'a2222222-1111-4111-8111-111111111111', sku: 'QS-295212', name: 'Caja x 15' }])
      return m
    },
    ...over,
  }
}

describe('el plan del modelo', () => {
  it('lista cerrada: lo desconocido o incompleto es responder', () => {
    expect(validarPlanChat({ herramienta: 'borrar_todo' })).toEqual({ herramienta: 'responder' })
    expect(validarPlanChat({ herramienta: 'buscar_productos', consulta: 'x' })).toEqual({ herramienta: 'responder' })
    expect(validarPlanChat({ herramienta: 'armar_pedido', items: [] })).toEqual({ herramienta: 'responder' })
  })

  it('un número de pedido inventado o mal formado se descarta (queda «el más reciente»)', () => {
    expect(validarPlanChat({ herramienta: 'estado_pedido', numero_pedido: "1'; drop" })).toEqual({ herramienta: 'estado_pedido', numero: null })
    expect(validarPlanChat({ herramienta: 'estado_pedido', numero_pedido: 'EC-20261121-00061' })).toEqual({ herramienta: 'estado_pedido', numero: 'EC-20261121-00061' })
  })

  it('cantidades fuera de rango se descartan; 0 solo vale al repetir (quitar)', () => {
    const items = [{ producto: 'Consiv', cantidad: 0 }, { producto: 'Fanter', cantidad: 3 }, { producto: 'X', cantidad: 2 }, { producto: 'Lejía', cantidad: 100000 }]
    expect(validarPlanChat({ herramienta: 'repetir_pedido', items })).toMatchObject({ cambios: [{ producto: 'Consiv', cantidad: 0 }, { producto: 'Fanter', cantidad: 3 }] })
    expect(validarPlanChat({ herramienta: 'armar_pedido', items })).toMatchObject({ items: [{ producto: 'Fanter', cantidad: 3 }] })
  })
})

describe('repetir un pedido con cambios', () => {
  it('coincide por palabras, sin tildes', () => {
    expect(nombreCoincide('Consiv Tableta Recubierta · 18 mg', 'consiv')).toBe(true)
    expect(nombreCoincide('Lejía Tradicional 5 L', 'lejia concentrada')).toBe(false)
    expect(nombreCoincide('Lejía Tradicional 5 L', 'lejia tradicional')).toBe(true)
  })

  it('cambia la cantidad, quita y añade; lo no dicho queda igual', () => {
    const r = aplicarCambios(
      [
        { sku: 'A', nombre: 'Consiv 18 mg', cantidad: 2 },
        { sku: 'B', nombre: 'Fanter 10 mg', cantidad: 1 },
      ],
      [{ producto: 'Consiv', cantidad: 4 }, { producto: 'Fanter', cantidad: 0 }, { producto: 'Bloqueador', cantidad: 1 }, { producto: 'Nabila', cantidad: 0 }],
    )
    expect(r.lineas).toEqual([
      { texto: 'Consiv 18 mg', cantidad: 4, sku: 'A' },
      { texto: 'Bloqueador', cantidad: 1, sku: null },
    ])
    expect(r.avisos).toEqual(['NO_ESTABA:Nabila'])
  })

  it('propone el carrito desde el último pedido, con la presentación ya elegida por su código', async () => {
    const p = puertos()
    const r = await ejecutarChat({ herramienta: 'repetir_pedido', numero: null, cambios: [{ producto: 'Fanter', cantidad: 0 }] }, p)
    expect(r.datos.tipo).toBe('carrito')
    if (r.datos.tipo !== 'carrito') return
    expect(r.datos.origen).toBe('EC-2')
    expect(r.datos.lineas).toHaveLength(1)
    expect(r.datos.lineas[0]).toMatchObject({ confianza: 'codigo', sku_propuesto: 'QS-282484', cantidad: 2 })
    expect(r.datos.lineas[0]!.presentaciones.map((x) => x.sku)).toEqual(['QS-282484'])
    expect(r.paraModelo).not.toMatch(/300|100\.00/)
  })

  it('sin pedidos anteriores lo dice, sin inventar', async () => {
    const r = await ejecutarChat({ herramienta: 'repetir_pedido', numero: 'EC-999', cambios: [] }, puertos())
    expect(r.datos).toEqual({ tipo: 'carrito', origen: null, lineas: [], avisos: ['SIN_PEDIDO'] })
  })
})

describe('armar un pedido dictado', () => {
  it('busca cada producto; si la frase no casa, prueba con el nombre comercial (sin marcar)', async () => {
    const p = puertos()
    const lineas = await proponerCarrito([{ texto: 'Consiv 18 mg tab rec', cantidad: 3, sku: null }, { texto: 'bloqueador', cantidad: 1, sku: null }], p)
    expect(p.busquedas).toEqual(expect.arrayContaining(['Consiv 18 mg tab rec', 'Consiv', 'bloqueador']))
    expect(lineas[0]).toMatchObject({ confianza: 'variante', sku_propuesto: null })
    expect(lineas[0]!.presentaciones).toHaveLength(1)
    expect(lineas[1]).toMatchObject({ confianza: 'probable', sku_propuesto: 'QS-514574' })
  })
})

describe('pedidos y crédito', () => {
  it('estado de un pedido: el pedido es el del comprador; otro número no existe', async () => {
    const r = await ejecutarChat({ herramienta: 'estado_pedido', numero: 'ec-1' }, puertos())
    expect(r.datos).toMatchObject({ tipo: 'pedido', pedido: { order_number: 'EC-1' } })
    const otro = await ejecutarChat({ herramienta: 'estado_pedido', numero: 'EC-404' }, puertos())
    expect(otro.datos).toEqual({ tipo: 'pedido', pedido: null, entregas: [] })
  })

  it('un pedido con retraso: el modelo ve estado, fecha prometida, días y último evento (2026-11-22)', async () => {
    const r = await ejecutarChat({ herramienta: 'estado_pedido', numero: 'EC-1' }, puertos())
    expect(r.datos).toMatchObject({ tipo: 'pedido', entregas: [{ dias_retraso: 3, intentos_fallidos: 1 }] })
    expect(JSON.parse(r.paraModelo)).toMatchObject({
      numero: 'EC-1',
      entregas: [{ estado: 'in_transit', dias_retraso: 3, ultimo_evento_del_operador: { estado: 'delivery_attempted' }, intentos_de_entrega_fallidos: 1 }],
    })
    expect(r.paraModelo).not.toMatch(/100.00/)
  })

  it('leerSeguimiento descarta lo mal formado y no inventa retrasos', () => {
    expect(leerSeguimiento({ entregas: [{ estado: 'pending', dias_retraso: -2, intentos_fallidos: 'x' }, { sin: 'estado' }] })).toEqual([
      { metodo: null, estado: 'pending', prometido_hasta: null, entregado: null, dias_retraso: 0, ultimo_evento: null, intentos_fallidos: 0 },
    ])
    expect(leerSeguimiento(null)).toEqual([])
  })

  it('el crédito se pinta con cifras; el modelo solo ve si hay vencido', async () => {
    const r = await ejecutarChat({ herramienta: 'mi_credito' }, puertos())
    expect(r.datos).toMatchObject({ tipo: 'credito', credito: { disponible: '7500.00' } })
    expect(r.paraModelo).not.toMatch(/7500|2500|10000/)
    expect(JSON.parse(r.paraModelo)).toMatchObject({ tiene_linea: true, tiene_vencido: false })
  })
})

describe('reposición predictiva (2026-11-22)', () => {
  it('el plan la acepta sin campos', () => {
    expect(validarPlanChat({ herramienta: 'reponer', consulta: 'lo de siempre' })).toEqual({ herramienta: 'reponer' })
  })

  it('arma el carrito con el SKU y la cantidad típica; el modelo ve el ritmo, no importes', async () => {
    const r = await ejecutarChat({ herramienta: 'reponer' }, puertos())
    expect(r.datos.tipo).toBe('reposicion')
    if (r.datos.tipo !== 'reposicion') return
    expect(r.datos.items).toHaveLength(1)
    expect(r.datos.lineas[0]).toMatchObject({ cantidad: 2, sku_propuesto: 'QS-282484' })
    expect(JSON.parse(r.paraModelo)).toMatchObject({ reponer: [{ cada_dias: 15, dias_restantes: -1 }] })
    expect(r.productosPermitidos).toEqual([])
  })

  it('sin historial regular: carrito vacío y el modelo lo sabe', async () => {
    const r = await ejecutarChat({ herramienta: 'reponer' }, puertos({ reposicion: async () => [] }))
    expect(r.datos).toEqual({ tipo: 'reposicion', items: [], lineas: [] })
    expect(r.paraModelo).toMatch(/no hay productos/)
  })

  it('leerReposicion descarta filas mal formadas', () => {
    const filas = leerReposicion([
      { sku: 'A', nombre: 'Uno', cantidad: 2, compras: 3, cada_dias: 10, dias_restantes: 1 },
      { sku: '', nombre: 'Sin sku', cantidad: 2, compras: 3, cada_dias: 10, dias_restantes: 1 },
      { sku: 'B', nombre: 'Cantidad rara', cantidad: 1.5, compras: 3, cada_dias: 10, dias_restantes: 1 },
      { sku: 'C', nombre: 'Cada cero', cantidad: 1, compras: 3, cada_dias: 0, dias_restantes: 1 },
    ])
    expect(filas.map((f) => f.sku)).toEqual(['A'])
    expect(leerReposicion(null)).toEqual([])
  })
})

describe('sustitutos por principio activo', () => {
  it('busca por el principio activo y deja fuera el producto pedido', async () => {
    const p = puertos()
    const r = await ejecutarChat({ herramienta: 'sustitutos', producto: 'Concerta', principioActivo: 'metilfenidato' }, p)
    expect(p.busquedas).toEqual(['metilfenidato'])
    expect(r.datos).toMatchObject({ tipo: 'sustitutos', principio_activo: 'metilfenidato', product_ids: [CONSIV] })
    expect(r.productosPermitidos).toEqual([CONSIV])
  })
})

describe('preguntas sobre un producto y comparar presentaciones (2026-11-22)', () => {
  it('el plan pide el producto; sin él es responder', () => {
    expect(validarPlanChat({ herramienta: 'sobre_producto', consulta: 'Consiv' })).toEqual({ herramienta: 'sobre_producto', producto: 'Consiv' })
    expect(validarPlanChat({ herramienta: 'sobre_producto', consulta: '' })).toEqual({ herramienta: 'responder' })
  })

  it('lee el contenido del nombre; los mg son dosis, no contenido', () => {
    expect(contenidoDePresentacion('Eutebrol Duo 14mg / 10 mg Tableta Caja 30 un')).toEqual({ cantidad: 30, unidad: 'un' })
    expect(contenidoDePresentacion('Amoxicilina 500 mg Caja x100')).toEqual({ cantidad: 100, unidad: 'un' })
    expect(contenidoDePresentacion('Fanter 10 mg · Caja x 15')).toEqual({ cantidad: 15, unidad: 'un' })
    expect(contenidoDePresentacion('Pedialyte 500 ml · Uva')).toEqual({ cantidad: 500, unidad: 'ml' })
    expect(contenidoDePresentacion('Lejía 1,5 L')).toEqual({ cantidad: 1500, unidad: 'ml' })
    expect(contenidoDePresentacion('Crema 2 kg')).toEqual({ cantidad: 2000, unidad: 'g' })
    expect(contenidoDePresentacion('Consiv 18 mg')).toBeNull()
    expect(contenidoDePresentacion('Talla M')).toBeNull()
  })

  it('el precio por unidad lo calcula el código; empate o sin datos: no hay mejor', () => {
    const base = { en_stock: true, moneda: 'PEN' }
    const r = compararPresentaciones([
      { ...base, variant_id: 'a', nombre: 'Caja 30 un', precio: '90.00' },
      { ...base, variant_id: 'b', nombre: 'Caja x100', precio: '250.00' },
      { ...base, variant_id: 'c', nombre: 'Frasco 120 ml', precio: '20.00' },
    ])
    expect(r.map((x) => [x.por_unidad, x.mejor])).toEqual([['3.00', false], ['2.50', true], [null, false]])
    const empate = compararPresentaciones([
      { ...base, variant_id: 'a', nombre: '500 ml · Uva', precio: '5.00' },
      { ...base, variant_id: 'b', nombre: '500 ml · Fresa', precio: '5.00' },
    ])
    expect(empate.map((x) => [x.por_unidad, x.mejor])).toEqual([['1.00', false], ['1.00', false]])
    const sinPrecio = compararPresentaciones([
      { ...base, variant_id: 'a', nombre: 'Caja 30 un', precio: null },
      { ...base, variant_id: 'b', nombre: 'Caja x100', precio: '250.00' },
    ])
    expect(sinPrecio.every((x) => x.por_unidad === null && !x.mejor)).toBe(true)
  })

  it('contesta desde la ficha del producto que encontró el buscador; el modelo no ve precios', async () => {
    const r = await ejecutarChat({ herramienta: 'sobre_producto', producto: 'Consiv' }, puertos())
    expect(r.datos).toMatchObject({ tipo: 'ficha', product_id: CONSIV })
    if (r.datos.tipo !== 'ficha') return
    expect(r.datos.comparacion.map((c) => c.mejor)).toEqual([false, true])
    const modelo = JSON.parse(r.paraModelo)
    expect(modelo).toMatchObject({ producto: 'Consiv Tableta Recubierta', comparacion_posible: true, presentaciones: [{ contenido: '30 unidades' }, { mas_conveniente_por_unidad: true }] })
    expect(r.paraModelo).not.toMatch(/90|250|2.50|3.00/)
    expect(r.productosPermitidos).toEqual([CONSIV])
  })

  it('la descripción que ve el modelo va sin afirmaciones de salud ni frases repetidas', () => {
    const d = 'Pedialyte contiene Electrolitos, del laboratorio Abbott. Indicado para: reposición de agua en diarreas. Se presenta en frasco de 500 ml. Lee el prospecto y sigue las indicaciones de tu médico. Pedialyte contiene Electrolitos, del laboratorio Abbott. Disponible en 2 sabores (Cereza y Manzana).'
    expect(descripcionParaModelo(d)).toBe('Pedialyte contiene Electrolitos, del laboratorio Abbott. Se presenta en frasco de 500 ml. Disponible en 2 sabores (Cereza y Manzana).')
    expect(descripcionParaModelo('Indicado para el dolor.')).toBeNull()
    expect(descripcionParaModelo(null)).toBeNull()
  })

  it('tamaños cargados como productos sueltos: se comparan los hermanos, no otra marca ni otra dosis', async () => {
    expect(nombreSinContenido('Lejía Tradicional Caja x 5 L')).toBe(nombreSinContenido('Lejía Tradicional 1 L'))
    expect(nombreSinContenido('Eutebrol Duo 14mg / 10 mg Tableta Caja 30 un')).not.toBe(nombreSinContenido('Eutebrol Tableta Caja 30 un'))
    const base = hit({ product_id: 'a', name: 'Amoxil 500 mg Caja x 30', brand_name: null })
    const otros = [base, hit({ product_id: 'b', name: 'Amoxil 500 mg Caja x 100', brand_name: null }), hit({ product_id: 'c', name: 'Amoxil 250 mg Caja x 100', brand_name: null })]
    expect(hermanosPorContenido(base, otros).map((h) => h.product_id)).toEqual(['a', 'b'])

    const r = await ejecutarChat({ herramienta: 'sobre_producto', producto: 'lejia' }, puertos())
    if (r.datos.tipo !== 'ficha') throw new Error('tipo')
    expect(r.datos.comparacion.map((c) => [c.variant_id, c.por_unidad, c.mejor])).toEqual([
      ['l1', '1.20', false],
      ['l5', '1.00', true],
    ])
  })

  it('producto que no está: ficha vacía y el modelo lo sabe', async () => {
    const r = await ejecutarChat({ herramienta: 'sobre_producto', producto: 'Nabila' }, puertos())
    expect(r.datos).toEqual({ tipo: 'ficha', product_id: null, comparacion: [] })
    expect(r.paraModelo).toMatch(/no se encontró/)
  })
})

describe('candado de contacto y números de pedido (2026-11-22)', () => {
  it('el número de pedido del resultado no cuenta como teléfono; uno inventado sí', () => {
    const datos = { tipo: 'carrito' as const, origen: 'EC-20261119-00056', lineas: [], avisos: [] }
    expect(taparNumeros('Tu pedido EC-20261119-00056 está listo', numerosDePedido(datos))).toBe('Tu pedido pedido está listo')
    expect(taparNumeros('Llama al 999 888 777', numerosDePedido(datos))).toBe('Llama al 999 888 777')
  })
})

describe('ai_chat_check: sesión y freno por comprador', () => {
  let db: PGlite
  const COMPRADOR = { sub: '0b000000-0000-4000-8000-00000000c101', role: 'authenticated', email: 'compra@cliente.pe' }

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
    return asRole(db, claims ? 'authenticated' : 'anon', (claims ?? null) as never, async () => {
      const r = await db.query<{ r: Record<string, unknown> }>(`select public.ai_chat_check($1) as r`, [slug])
      return r.rows[0]?.r
    })
  }

  it('anónimo no puede ni llamarla', async () => {
    await expect(revisar(null)).rejects.toThrow(/permission denied/i)
  })

  it('tienda desconocida ⇒ no disponible', async () => {
    expect(await revisar(COMPRADOR, 'no-existe')).toEqual({ allowed: false, reason: 'TIENDA_NO_DISPONIBLE' })
  })

  it('60 por hora y por comprador; a otro no le afecta', async () => {
    for (let i = 0; i < 60; i++) expect(await revisar(COMPRADOR)).toEqual({ allowed: true })
    expect(await revisar(COMPRADOR)).toEqual({ allowed: false, reason: 'RATE_LIMITED' })
    expect(await revisar({ ...COMPRADOR, sub: '0b000000-0000-4000-8000-00000000c102' })).toEqual({ allowed: true })
  })
})
