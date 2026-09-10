// @vitest-environment node
/**
 * Dónde se hace cumplir cada capacidad VENDIBLE, medido sobre el esquema real
 * (P17-SaaS).
 *
 * La migración 160000 lo escribió sin ambigüedad: «`ebim.has_capability` — LA
 * autoridad de gating. La de la UI es cortesía». `src/app/routes.tsx` envuelve
 * cada pantalla en `gated(...)`, pero eso solo decide qué se PINTA: un miembro
 * legítimo del tenant que hable PostgREST con su propio token no pasa por el
 * router. Si la única puerta de un módulo de pago es esa envoltura, el módulo
 * está gateado en el navegador y no en el producto.
 *
 * Esta prueba no opina sobre si conviene cerrar cada hueco —eso depende de que
 * el hub tenga dado de alta el catálogo de addons de `ecommerce` (R1, mitad
 * abierta), porque encender el candado ANTES de que alguien pueda conceder el
 * entitlement apagaría el módulo para todos los tenants—. Lo que hace es
 * convertir el hueco en un dato: la lista de lo que hoy NO se hace cumplir en
 * el servidor está escrita aquí con su motivo, y **no puede crecer sin que la
 * suite se ponga roja**. Una capacidad vendible nueva sin candado de servidor
 * y sin entrada en esta lista rompe el gate.
 *
 * Evidencia: se lee de `pg_policies` y `pg_proc` del esquema construido desde
 * las migraciones, no de un inventario escrito a mano.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { CAPABILITIES } from '../../src/domain/capabilities.ts'
import { asRole, createTestDatabase } from './harness.ts'

let db: PGlite

async function svc<T = Record<string, unknown>>(query: string): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query)).rows)
}

/**
 * Capacidades que aparecen como tercer argumento de `ebim.has_capability` en
 * cualquier policy o cuerpo de función del esquema.
 *
 * Se extraen del texto renderizado por Postgres, donde el literal sale como
 * `'promotions'::text`. Se mira SOLO dentro del paréntesis de la llamada y se
 * toma su ÚLTIMA cadena, que es el tercer argumento: mirar la expresión entera
 * confunde el nombre de un rol con el de una capacidad, porque una policy suele
 * llevar `has_role(..., '{owner,admin,catalog}')` al lado.
 */
/**
 * Las DOS porteras del servidor, no una.
 *
 * `ebim.has_capability` es `can_access AND company_is_entitled`: la pertenencia
 * y el addon. Una función que ya comprobó la pertenencia por su cuenta —o que
 * deliberadamente no la comprueba, como las que sirven a la vitrina pública,
 * donde quien pregunta es un visitante anónimo— llama directamente a
 * `company_is_entitled`, y eso sigue siendo un candado de servidor sobre el
 * addon. Mirar solo `has_capability` daba por «gateada solo en la UI» una
 * capacidad que en realidad tiene su candado en la base.
 */
const PORTERAS = /has_capability|company_is_entitled/
const LLAMADA_A_PORTERA = /(?:has_capability|company_is_entitled)\s*\(([^)]*)\)/g

function capabilitiesMentioned(expressions: readonly string[]): Set<string> {
  const known = new Set(CAPABILITIES.map((c) => c.id as string))
  const found = new Set<string>()

  for (const raw of expressions) {
    if (!raw || !PORTERAS.test(raw)) continue
    for (const call of raw.matchAll(LLAMADA_A_PORTERA)) {
      const literals = [...(call[1] as string).matchAll(/'([^']*)'/g)].map((m) => m[1] as string)
      const code = literals.at(-1)
      if (code !== undefined && known.has(code)) found.add(code)
    }
  }
  return found
}

/**
 * Lo que hoy se gatea SOLO en la UI, con el motivo por el que sigue así.
 *
 * Cada entrada es deuda declarada, no una excepción de diseño: `docs/SAAS_GAPS.md`
 * la recoge como «importante». Vaciar esta lista es cerrar el hueco; añadirle
 * una entrada exige escribir por qué.
 */
const SIN_CANDADO_DE_SERVIDOR: ReadonlyArray<{ code: string; motivo: string }> = [
  {
    code: 'catalog.advanced',
    motivo:
      'Las once tablas del PIM (variantes, atributos, unidades, kits) llevan RLS por tenant y por rol, ' +
      'pero ninguna policy consulta la capacidad. P03-SaaS las creó antes de que P04 fijara el patrón.',
  },
  {
    code: 'payments',
    motivo:
      'Las siete tablas del dominio de cobro llevan RLS por tenant y por rol; la capacidad solo se ' +
      'comprueba en `routes.tsx`. La migración de capacidad (120200) registra el estado y la vista, no un candado.',
  },
  {
    code: 'fulfillment',
    motivo:
      'Mismo caso que pagos: la oferta, el despacho y las devoluciones se protegen por tenant y por rol, ' +
      'y la capacidad no entra en ninguna policy (150700 registra estado, conector de pruebas y vista).',
  },
]

beforeAll(async () => {
  db = await createTestDatabase()
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('las capacidades vendibles se hacen cumplir en el servidor', () => {
  let enforced: Set<string>

  beforeAll(async () => {
    const policies = await svc<{ expr: string }>(
      `select coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
         from pg_policies where schemaname in ('public', 'ebim', 'storage')`,
    )
    const routines = await svc<{ expr: string }>(
      `select p.prosrc as expr
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'ebim')`,
    )
    enforced = capabilitiesMentioned([
      ...policies.map((r) => r.expr),
      ...routines.map((r) => r.expr),
    ])
  }, 180_000)

  /** Sin esto, un fallo del extractor pasaría por «no hay nada que gatear». */
  it('hay capacidades hechas cumplir que medir', () => {
    expect(enforced.size).toBeGreaterThan(3)
  })

  /**
   * La lista de vendibles sale de la BASE, no de TypeScript: si alguien siembra
   * una capacidad que el registro no declara, `capabilities.test.ts` ya lo caza,
   * y aquí queremos medir contra lo que de verdad hay en el esquema.
   *
   * `declared` queda fuera a propósito: no hay tabla ni comando que gatear
   * todavía (hoy, `orders.advanced`). Entra en esta prueba el día que se
   * implemente, que es exactamente cuando hay algo que cerrar.
   */
  it('el reparto entre «con candado» y «solo UI» es EXACTAMENTE el declarado', async () => {
    const vendibles = await svc<{ code: string }>(
      `select code from public.app_capabilities
        where not is_baseline and state = 'implemented' order by code`,
    )
    expect(vendibles.length).toBeGreaterThan(5)

    const sinCandado = vendibles.map((r) => r.code).filter((code) => !enforced.has(code))

    expect(sinCandado.sort()).toEqual(
      SIN_CANDADO_DE_SERVIDOR.map((e) => e.code).sort(),
    )
  })

  it('cada hueco declarado dice POR QUÉ sigue abierto', () => {
    for (const entry of SIN_CANDADO_DE_SERVIDOR) {
      expect(entry.motivo.length).toBeGreaterThan(60)
    }
  })

  /**
   * La otra mitad de la propiedad, y la que de verdad protege el ingreso: lo
   * que YA tiene candado no puede perderlo en un refactor de policies.
   */
  it('las capacidades que hoy SÍ tienen candado lo conservan', () => {
    const conCandado = [
      'content.cms',
      'content.white_label',
      'customers.b2b',
      'inventory.multiwarehouse',
      'integrations.enterprise',
      'pricing.lists',
      'promotions',
      'analytics.advanced',
      // La IA es la única con coste marginal por uso: perder su candado no
      // abre un módulo de más, abre una factura.
      'ai.assist',
    ]
    for (const code of conCandado) {
      expect([code, enforced.has(code)]).toEqual([code, true])
    }
  })

  /**
   * Y la propiedad de fondo: ninguna capacidad BASELINE se hace cumplir por
   * entitlement. Un candado sobre lo baseline sería un módulo que se apaga solo
   * cuando el hub no contesta —el tenant se quedaría sin catálogo ni pedidos por
   * una caída de la plataforma, que es peor que el problema que resuelve—.
   */
  it('nada baseline depende de un entitlement para funcionar', async () => {
    const baseline = await svc<{ code: string }>(
      `select code from public.app_capabilities where is_baseline order by code`,
    )
    const gateadas = baseline.map((r) => r.code).filter((code) => enforced.has(code))
    expect(gateadas).toEqual([])
  })
})
