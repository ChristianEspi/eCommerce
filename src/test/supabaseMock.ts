import type { Session } from '@supabase/supabase-js'
import { resolveCapabilities } from '@/domain'

/**
 * Cliente Supabase falso para los tests del frontend.
 *
 * No imita PostgREST entero: imita lo justo para que los componentes reales
 * corran contra él (encadenado `select().eq().order()`, `rpc`, `functions.invoke`
 * y el ciclo de vida de la sesión). Lo que NO simula, a propósito, es la RLS:
 * el aislamiento se prueba contra Postgres de verdad en `supabase/tests`, y
 * fingirlo aquí daría una falsa sensación de cobertura.
 */

export const ORG = '11111111-1111-4111-8111-111111111111'
export const COMPANY_A = '22222222-2222-4222-8222-222222222222'
export const COMPANY_B = '33333333-3333-4333-8333-333333333333'
export const USER = '44444444-4444-4444-8444-444444444444'
export const STORE_A = '55555555-5555-4555-8555-555555555555'

/** Construye un JWT real (sin firma válida) para probar la lectura de claims. */
export function makeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.firma-no-verificada`
}

export interface FakeSessionOptions {
  email?: string
  userId?: string
  claims?: Record<string, unknown>
  /** Cuando es false, la sesión no trae la jerarquía del hub. */
  withTenantClaims?: boolean
}

export function makeSession(options: FakeSessionOptions = {}): Session {
  const {
    email = 'duenio@negocio.com',
    userId = USER,
    withTenantClaims = true,
    claims = {},
  } = options

  const tenantClaims = withTenantClaims
    ? {
        org_id: ORG,
        active_company: COMPANY_A,
        companies: [{ id: COMPANY_A, role: 'admin' }],
        apps: ['ecommerce'],
      }
    : {}

  const payload = { sub: userId, email, ...tenantClaims, ...claims }

  return {
    access_token: makeJwt(payload),
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh',
    user: {
      id: userId,
      email,
      aud: 'authenticated',
      app_metadata: { ...tenantClaims, ...claims },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  } as unknown as Session
}

type Row = Record<string, unknown>

interface RpcOutcome {
  data: unknown
  error: unknown
}

/**
 * El resultado de un `rpc` es «esperable» Y encadenable con `abortSignal`.
 *
 * El SDK real devuelve un constructor de peticiones al que se le puede colgar
 * la señal de cancelación antes de esperarlo, y desde P11-SaaS hay dos módulos
 * que lo hacen —la búsqueda del catálogo y el autocompletado— porque una
 * respuesta de hace tres letras no puede pisar a la de ahora. Con un `Promise`
 * pelado, ese código no se podría probar aquí: fallaría por la forma del doble,
 * no por lo que hace.
 *
 * `abortSignal` se acepta y se ignora: cancelar de verdad exigiría un doble con
 * concurrencia real, y lo que estos tests comprueban es que el módulo de datos
 * SEPA cancelar, no que la red lo obedezca.
 */
function rpcResult(outcome: RpcOutcome) {
  const promise = Promise.resolve(outcome)
  const builder = {
    abortSignal: (_signal?: AbortSignal) => builder,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return builder
}

export interface FakeState {
  session: Session | null
  tables: Record<string, Row[]>
  rpc: Record<string, (args: Record<string, unknown>) => unknown>
  functions: Record<string, (body: Record<string, unknown>) => unknown>
  /** Todo lo que se envió a `functions.invoke`, para poder afirmar sobre ello. */
  invocations: Array<{ name: string; body: Record<string, unknown> }>
  /**
   * Ídem para `rpc`. Existe desde P08-SaaS: los comandos del pedido son
   * funciones de la base y no Edge Functions, así que sin este registro no
   * había forma de afirmar que el navegador NO manda tenant, estado anterior
   * ni importes en el payload.
   */
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  /** Objetos "subidos" por bucket, para afirmar sobre rutas de Storage. */
  storage: Record<string, Record<string, { size: number; contentType: string }>>
}

type QueryResult = { data: Row[] | null; error: { message: string } | null; count?: number | null }

type Mutation =
  | { kind: 'select' }
  | { kind: 'insert'; payload: Row | Row[] }
  | { kind: 'upsert'; payload: Row; onConflict: string[] }
  | { kind: 'update'; patch: Row }
  | { kind: 'delete' }

function compareCells(a: unknown, b: unknown): number {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Number(Boolean(a)) - Number(Boolean(b))
  }
  const numA = typeof a === 'number' ? a : Number(a)
  const numB = typeof b === 'number' ? b : Number(b)
  if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB
  return String(a ?? '').localeCompare(String(b ?? ''))
}

let idCounter = 0
function fakeId(): string {
  idCounter += 1
  return `99999999-9999-4999-8999-${String(idCounter).padStart(12, '0')}`
}

/**
 * Constructor encadenable mínimo: filtra en memoria y se resuelve como promesa.
 * Soporta también insert/update/delete porque el catálogo (P04) escribe en
 * tablas bajo RLS, no solo por Edge Function. Lo que NO simula, a propósito,
 * es la RLS: eso se prueba contra Postgres real en `supabase/tests`.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private rows: Row[]
  private mutation: Mutation = { kind: 'select' }
  /** `select(..., { count: 'exact' })`: hay que devolver el total, no la página. */
  private wantsCount = false
  /** Rango de `range(from, to)`, aplicado DESPUÉS de contar. */
  private range_: { from: number; to: number } | null = null

  constructor(
    private readonly state: FakeState,
    private readonly table: string,
  ) {
    this.rows = [...(state.tables[table] ?? [])]
  }

  select(_columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated' }): this {
    if (options?.count) this.wantsCount = true
    return this
  }

  /**
   * `insert` de una fila o de un LOTE. El lote no es un lujo: la aplicación de
   * un cobro inserta todas sus imputaciones de una vez, y tratar el array como
   * una sola fila daba por buena una escritura que en Postgres son varias.
   */
  insert(payload: Row | Row[]): this {
    this.mutation = { kind: 'insert', payload }
    return this
  }

  /**
   * `upsert` con `onConflict`, como lo usa la escritura de flags técnicos
   * (P02-SaaS). La clave de conflicto se respeta de verdad en vez de insertar
   * siempre: un test que afirmara «se guardó» sobre una tabla que acumula
   * duplicados no probaría nada.
   */
  upsert(payload: Row, options?: { onConflict?: string }): this {
    const onConflict = (options?.onConflict ?? 'id').split(',').map((column) => column.trim())
    this.mutation = { kind: 'upsert', payload, onConflict }
    return this
  }

  update(patch: Row): this {
    this.mutation = { kind: 'update', patch }
    return this
  }

  delete(): this {
    this.mutation = { kind: 'delete' }
    return this
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value)
    return this
  }

  /**
   * `neq`: lo usa el buscador de referencias del inventario para dejar fuera
   * los kits, que no llevan existencia propia. Sin implementarlo de verdad, el
   * test daria por bueno un desplegable que ofrece un movimiento imposible.
   */
  neq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] !== value)
    return this
  }

  /**
   * `is('col', null)` y su negación. Los usa la pestaña de incidentes de P13
   * para separar lo abierto de lo atendido, que en la base es exactamente eso:
   * `resolved_at is null`.
   *
   * Se implementan de verdad —y no como un no-op— por la misma razón que `or`:
   * un filtro que no filtra daría por buena una pestaña «Abiertos» que enseña
   * también los cerrados, que es justo el fallo que haría inservible el
   * tablero.
   */
  is(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => (row[column] ?? null) === value)
    return this
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== 'is') {
      throw new Error(`FakeQuery.not solo implementa 'is'; llegó '${operator}'`)
    }
    this.rows = this.rows.filter((row) => (row[column] ?? null) !== value)
    return this
  }

  /**
   * `gte` sobre texto ISO: es como filtra el listado de pedidos por fecha, y
   * comparar dos ISO como cadenas ordena igual que compararlos como instantes.
   */
  gte(column: string, value: string): this {
    this.rows = this.rows.filter((row) => String(row[column] ?? '') >= value)
    return this
  }

  /**
   * `gt`: lo usa cobranza para quedarse con lo que de verdad falta por cobrar
   * (`balance > 0`). Compara NUMERICAMENTE cuando el umbral es un numero,
   * porque el importe viaja como texto y `'1000.00' > 0` en cadenas no
   * significa nada; un filtro que no filtra daria por buena una pestaña «solo
   * pendiente» que enseña tambien lo ya pagado.
   */
  gt(column: string, value: string | number): this {
    this.rows =
      typeof value === 'number'
        ? this.rows.filter((row) => Number(row[column] ?? 0) > value)
        : this.rows.filter((row) => String(row[column] ?? '') > value)
    return this
  }

  /** `lt`/`lte`: el reverso de `gt`, con la misma regla numerica. Los usa el
   *  buscador de productos para `stock:<10`, que es como se pregunta «que se
   *  esta acabando» sin salir de la caja de busqueda. */
  lt(column: string, value: string | number): this {
    this.rows =
      typeof value === 'number'
        ? this.rows.filter((row) => Number(row[column] ?? 0) < value)
        : this.rows.filter((row) => String(row[column] ?? '') < value)
    return this
  }

  lte(column: string, value: string | number): this {
    this.rows =
      typeof value === 'number'
        ? this.rows.filter((row) => Number(row[column] ?? 0) <= value)
        : this.rows.filter((row) => String(row[column] ?? '') <= value)
    return this
  }

  /**
   * `ilike` suelto, que no es lo mismo que el de dentro de un `or=`.
   *
   * El `or=` es «alguna de estas columnas»; este es una condicion mas que se
   * suma con Y a las demas. Los prefijos del buscador de productos —`cat:`,
   * `marca:`, `sku:`— son exactamente eso: acotan, no amplian.
   *
   * Una celda nula NO coincide con nada, ni siquiera con el patron vacio: un
   * producto sin marca no es «todas las marcas».
   */
  ilike(column: string, pattern: string): this {
    const needle = pattern.replace(/^%|%$/g, '').toLowerCase()
    this.rows = this.rows.filter((row) => {
      const cell = row[column]
      if (cell === null || cell === undefined) return false
      return String(cell).toLowerCase().includes(needle)
    })
    return this
  }

  /**
   * `or=` de PostgREST, en la forma que usa la app: `col.ilike.%texto%`
   * separado por comas. Se implementa de verdad (y no como un no-op) porque el
   * buscador de la vitrina es una de las cosas que estos tests comprueban; un
   * filtro que no filtra daría por bueno cualquier consulta.
   */
  or(filters: string): this {
    const clauses = filters.split(',').map((clause) => clause.trim()).filter(Boolean)
    if (clauses.length === 0) return this

    this.rows = this.rows.filter((row) =>
      clauses.some((clause) => {
        const [column, operator, ...rest] = clause.split('.')
        if (!column || !operator) return false
        const value = rest.join('.')
        const cell = row[column]
        if (cell === null || cell === undefined) return false
        if (operator === 'ilike') {
          const needle = value.replace(/^%|%$/g, '').toLowerCase()
          return String(cell).toLowerCase().includes(needle)
        }
        return String(cell) === value
      }),
    )
    return this
  }

  /** `in('col', [...])`: lo usan las lecturas de hijos por lote del PIM. */
  in(column: string, values: unknown[]): this {
    const wanted = new Set(values)
    this.rows = this.rows.filter((row) => wanted.has(row[column]))
    return this
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count)
    return this
  }

  /**
   * Paginación de PostgREST: `range` es inclusivo en los dos extremos y se
   * aplica al final, después de filtrar y ordenar. Se guarda en vez de recortar
   * aquí porque `count: 'exact'` tiene que devolver el TOTAL del filtro, no el
   * tamaño de la página — un doble que recortara antes de contar daría por
   * bueno un paginador que siempre dice "1 página".
   */
  range(from: number, to: number): this {
    this.range_ = { from, to }
    return this
  }

  /**
   * Ordena por tipo: los booleanos y los números no se comparan como texto.
   *
   * `nullsFirst` se implementa de verdad porque cambia QUÉ sale en la primera
   * página: al ordenar por categoría, los productos sin categoría son nulos, y
   * si se van arriba la primera pantalla se llena de celdas vacías. Postgres
   * pone los nulos al final en ascendente y al principio en descendente salvo
   * que se le diga otra cosa; el doble hace lo mismo.
   */
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const ascending = options?.ascending ?? true
    const nullsFirst = options?.nullsFirst ?? !ascending

    const vacia = (value: unknown) => value === null || value === undefined
    const ordenadas = [...this.rows].sort((a, b) => compareCells(a[column], b[column]))
    if (!ascending) ordenadas.reverse()

    const nulas = ordenadas.filter((row) => vacia(row[column]))
    const llenas = ordenadas.filter((row) => !vacia(row[column]))
    this.rows = nullsFirst ? [...nulas, ...llenas] : [...llenas, ...nulas]
    return this
  }

  /** Aplica la mutación una sola vez y devuelve las filas afectadas. */
  private apply(): Row[] {
    const table = this.state.tables[this.table] ?? (this.state.tables[this.table] = [])

    if (this.mutation.kind === 'insert') {
      const payloads = Array.isArray(this.mutation.payload)
        ? this.mutation.payload
        : [this.mutation.payload]
      const nuevas = payloads.map((payload) => ({ id: fakeId(), ...payload }))
      table.push(...nuevas)
      this.rows = nuevas
    } else if (this.mutation.kind === 'upsert') {
      const { payload, onConflict } = this.mutation
      const existing = table.find((row) =>
        onConflict.every((column) => row[column] === payload[column]),
      )
      if (existing) {
        Object.assign(existing, payload)
        this.rows = [existing]
      } else {
        const row = { id: fakeId(), ...payload }
        table.push(row)
        this.rows = [row]
      }
    } else if (this.mutation.kind === 'update') {
      const patch = this.mutation.patch
      this.rows = this.rows.map((row) => Object.assign(row, patch))
    } else if (this.mutation.kind === 'delete') {
      const doomed = new Set(this.rows)
      this.state.tables[this.table] = table.filter((row) => !doomed.has(row))
    }
    this.mutation = { kind: 'select' }
    return this.rows
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.apply()[0] ?? null, error: null })
  }

  single(): Promise<{ data: Row | null; error: { message: string; code: string } | null }> {
    const rows = this.apply()
    if (!rows[0]) {
      return Promise.resolve({
        data: null,
        error: { message: 'No rows found', code: 'PGRST116' },
      })
    }
    return Promise.resolve({ data: rows[0], error: null })
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.apply()
    const total = rows.length
    const page = this.range_ ? rows.slice(this.range_.from, this.range_.to + 1) : rows
    return Promise.resolve({
      data: page,
      error: null,
      count: this.wantsCount ? total : null,
    }).then(onfulfilled, onrejected)
  }
}

/**
 * Contexto de plataforma por defecto: la cuenta tiene eCommerce activo y NADA
 * contratado más allá de lo baseline.
 *
 * Es el default correcto para los tests que no hablan de entitlements: refleja
 * al tenant que existe hoy —catálogo, vitrina, carrito y pedidos— y hace que
 * las rutas gateadas por capacidad se comporten como antes de P02. Un test que
 * quiera hablar de módulos vendibles pasa su propio `rpc`.
 *
 * `capabilities` la calcula la BASE en producción; aquí se calcula con la misma
 * función pura del dominio para que el doble no pueda contradecir la regla.
 */
export function makePlatformContext(
  overrides: {
    entitlements?: string[]
    flags?: Record<string, boolean>
    appActive?: boolean
    source?: 'hub' | 'provisioning' | 'sin-contexto'
    organizationId?: string
    companyId?: string
    plan?: string | null
  } = {},
): Record<string, unknown> {
  const {
    entitlements = [],
    flags = {},
    appActive = true,
    source = 'sin-contexto',
    organizationId = ORG,
    companyId = COMPANY_A,
    plan = null,
  } = overrides

  const { capabilities } = resolveCapabilities({ appActive, entitlements, flags })

  return {
    organization_id: organizationId,
    company_id: companyId,
    source,
    app_active: appActive,
    plan,
    synced_at: source === 'sin-contexto' ? null : '2026-08-27T12:00:00.000Z',
    entitlements,
    flags,
    capabilities,
  }
}

export class FunctionsHttpErrorLike extends Error {
  readonly context: Response

  /**
   * `extra` lleva lo que una funcion concreta añade al sobre del error. El
   * pipeline de checkout (P07-SaaS) manda `stage` y `retryable` junto al
   * codigo, y sin poder simularlo no se podria comprobar que la pantalla dice
   * en que etapa fallo la compra.
   */
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super('Edge Function returned a non-2xx status code')
    this.name = 'FunctionsHttpError'
    this.context = new Response(
      JSON.stringify({ error: { code, message: code, ...extra } }),
      { status },
    )
  }
}

export function createFakeSupabase(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    session: initial.session ?? null,
    tables: initial.tables ?? {},
    // El contexto de plataforma se sirve por defecto para que montar cualquier
    // pantalla del backoffice no exija declararlo. Un test lo pisa pasando el
    // suyo en `rpc`.
    rpc: { effective_capabilities: () => makePlatformContext(), ...(initial.rpc ?? {}) },
    functions: initial.functions ?? {},
    invocations: [],
    rpcCalls: [],
    storage: initial.storage ?? {},
  }

  type Listener = (event: string, session: Session | null) => void
  const listeners = new Set<Listener>()
  const emit = (event: string) => {
    for (const listener of listeners) listener(event, state.session)
  }

  const client = {
    state,
    emit,
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.session }, error: null }),
      onAuthStateChange: (listener: Listener) => {
        listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
      },
      signInWithPassword: ({ email, password }: { email: string; password: string }) => {
        if (password === 'mal') {
          return Promise.resolve({
            data: { session: null, user: null },
            error: { message: 'Invalid login credentials', status: 400 },
          })
        }
        state.session = makeSession({ email })
        emit('SIGNED_IN')
        return Promise.resolve({ data: { session: state.session }, error: null })
      },
      signOut: () => {
        state.session = null
        emit('SIGNED_OUT')
        return Promise.resolve({ error: null })
      },
      resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
      updateUser: () => Promise.resolve({ data: { user: state.session?.user ?? null }, error: null }),
    },
    from: (table: string) => new FakeQuery(state, table),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      const handler = state.rpc[name]
      if (!handler) {
        return rpcResult({ data: null, error: { message: `rpc ${name} no simulada` } })
      }
      try {
        return rpcResult({ data: handler(args), error: null })
      } catch (error) {
        // Un handler que LANZA simula el fallo de PostgREST: es como se prueba
        // un 42501 de RLS o una funcion de la base que levanta
        // `CODIGO: mensaje`. Sin esto, el unico error simulable era «rpc no
        // simulada», que no distingue un fallo de autorizacion de un olvido.
        return rpcResult({ data: null, error: error as { message?: string; code?: string } })
      }
    },
    storage: {
      from: (bucket: string) => {
        const objects = state.storage[bucket] ?? (state.storage[bucket] = {})
        return {
          upload: (path: string, file: File, options?: { contentType?: string }) => {
            objects[path] = { size: file.size, contentType: options?.contentType ?? file.type }
            return Promise.resolve({ data: { path }, error: null })
          },
          remove: (paths: string[]) => {
            for (const path of paths) delete objects[path]
            return Promise.resolve({ data: [], error: null })
          },
          createSignedUrls: (paths: string[]) =>
            Promise.resolve({
              data: paths.map((path) => ({
                path,
                signedUrl: `https://firmado.test/${path}`,
                error: null,
              })),
              error: null,
            }),
        }
      },
    },
    functions: {
      /**
       * `async` a propósito: un handler que devuelve una promesa se espera
       * aquí, y así un test puede dejar una llamada EN VUELO para comprobar,
       * por ejemplo, que un segundo envío no crea un segundo pedido.
       */
      invoke: async (name: string, options: { body: Record<string, unknown> }) => {
        state.invocations.push({ name, body: options.body })
        const handler = state.functions[name]
        if (!handler) {
          return { data: null, error: new FunctionsHttpErrorLike(500, 'ERROR_INTERNO') }
        }
        try {
          return { data: { data: await handler(options.body) }, error: null }
        } catch (error) {
          return { data: null, error }
        }
      },
    },
  }

  return client
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>
