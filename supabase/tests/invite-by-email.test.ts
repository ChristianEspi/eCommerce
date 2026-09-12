// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Dar de alta a alguien por su CORREO.
 *
 * ## Qué arregla, dicho como se vivía
 *
 * Dos pantallas pedían «Id de usuario», con la ayuda «el identificador que emite
 * el hub». Ese identificador no se enseña en ninguna pantalla de la aplicación
 * y el hub no está conectado, así que las dos pantallas se abrían, se veían bien
 * y no se podían usar.
 *
 * ## La propiedad que se fija aquí
 *
 * **El vínculo lo decide el servidor.** Quien llama manda un correo; el servidor
 * comprueba quién pregunta, traduce el correo a una identidad y crea el vínculo.
 * El identificador no viaja de vuelta, y esa ausencia es deliberada: devolverlo
 * convertiría la función en un oráculo para averiguar qué correos tienen cuenta
 * en el proyecto.
 */

let db: PGlite

const SIN_ROL = '0a000000-0000-4000-8000-0000000000e1'
const NUEVA = '0a000000-0000-4000-8000-0000000000e2'
const COMPRADORA = '0a000000-0000-4000-8000-0000000000e3'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

/**
 * Un comprador de la tienda: tiene sesión pero ningún claim de tenant, porque
 * no es miembro de la sociedad que vende. Por eso el tipo se fuerza aquí.
 */
const comprador = (sub: string, email: string) => ({ sub, email }) as unknown as JwtClaims

async function comoAdmin<T>(tenant: typeof TENANT_A, run: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claimsFor(tenant), run)
}

/** Crea un usuario de Auth, que es lo que el correo tiene que poder resolver. */
async function crearUsuario(id: string, email: string) {
  await svc(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
}

let cuentaA = ''

beforeAll(async () => {
  db = await createTestDatabase()

  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
      tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
    ])
  }

  await crearUsuario(TENANT_A.ownerId, TENANT_A.adminEmail)
  await crearUsuario(NUEVA, 'nueva@tenant-a.com')
  await crearUsuario(SIN_ROL, 'mirona@tenant-a.com')
  await crearUsuario(COMPRADORA, 'compradora@cliente.com')

  const [cliente] = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name)
     values ($1, $2, 'company', 'CLI-B2B', 'Cliente B2B') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const [cuenta] = await svc<{ id: string }>(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, customer_kind, code, name)
     values ($1, $2, $3, 'company', 'ACC-1', 'Cuenta 1') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, cliente?.id],
  )
  cuentaA = String(cuenta?.id)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.business_account_users`)
  await svc(`delete from public.tenant_members where role <> 'owner'`)
})

// ---------------------------------------------------------------------------
// Backoffice
// ---------------------------------------------------------------------------

describe('quién entra al backoffice', () => {
  /**
   * Sin organización ni sociedad: las toma del token.
   *
   * La regla del proyecto prohíbe que el tenant llegue por parámetro a algo que
   * alcanza el cliente, y `security-baseline.test.ts` lo comprueba recorriendo
   * el catálogo de funciones. Aquí se ve la consecuencia: el alta ocurre en la
   * sociedad ACTIVA de quien llama, no en la que declare.
   */
  const alta = (email: string, rol = 'admin', tenant = TENANT_A) =>
    comoAdmin(tenant, () =>
      svc<{ r: string }>(`select public.add_tenant_member($1, $2::public.app_role) as r`, [
        email,
        rol,
      ]),
    )

  it('basta el correo: el servidor resuelve la identidad', async () => {
    await alta('nueva@tenant-a.com')

    const [fila] = await svc<{ user_id: string; role: string; status: string }>(
      `select user_id, role, status from public.tenant_members where email = 'nueva@tenant-a.com'`,
    )
    expect(fila?.user_id).toBe(NUEVA)
    expect(fila?.role).toBe('admin')
    expect(fila?.status).toBe('active')
  })

  it('no devuelve el identificador, solo su propia fila', async () => {
    // Devolverlo convertiría esto en una forma de averiguar qué correos tienen
    // cuenta en el proyecto, uno a uno.
    const [fila] = await alta('nueva@tenant-a.com')
    const [miembro] = await svc<{ id: string }>(
      `select id from public.tenant_members where email = 'nueva@tenant-a.com'`,
    )

    expect(fila?.r).toBe(miembro?.id)
    expect(fila?.r).not.toBe(NUEVA)
  })

  it('un correo sin cuenta se explica, no falla en críptico', async () => {
    const error = await expectFailure(() => alta('nadie@tenant-a.com'))

    expect(error).toContain('SIN_CUENTA')
  })

  it('el correo se normaliza antes de buscarlo', async () => {
    await alta('  NUEVA@Tenant-A.com  ')

    const filas = await svc(`select 1 from public.tenant_members where email = 'nueva@tenant-a.com'`)
    expect(filas).toHaveLength(1)
  })

  it('volver a añadir a alguien le devuelve el acceso en vez de fallar', async () => {
    await alta('nueva@tenant-a.com', 'viewer')
    await svc(`update public.tenant_members set status = 'revoked' where email = 'nueva@tenant-a.com'`)

    await alta('nueva@tenant-a.com', 'orders')

    const [fila] = await svc<{ role: string; status: string }>(
      `select role, status from public.tenant_members where email = 'nueva@tenant-a.com'`,
    )
    expect(fila).toEqual({ role: 'orders', status: 'active' })
  })

  it('y tampoco se DEGRADA a un propietario', async () => {
    /**
     * La otra mitad de la misma regla, y la que faltaba.
     *
     * La función readmite a quien ya estaba con el rol pedido, que es lo
     * correcto para devolver el acceso a alguien revocado. Con un `owner` eso
     * era un agujero: escribir el correo del dueño y elegir «admin» lo
     * degradaba en el acto. Se vio probando contra el proyecto real —respondió
     * 200 y el propietario pasó a administrador— y se restauró en el momento.
     *
     * Degradar al único propietario deja la cuenta sin nadie que pueda borrar su
     * tienda ni recuperar el rol. Un desplegable no puede hacer eso.
     */
    await alta(TENANT_A.adminEmail, 'viewer')

    const [fila] = await svc<{ role: string }>(
      `select role from public.tenant_members where email = $1`,
      [TENANT_A.adminEmail],
    )
    expect(fila?.role).toBe('owner')
  })

  it('owner NO se otorga desde la aplicación', async () => {
    // Nace con el tenant (contrato §3.2). Un desplegable que lo ofreciera
    // permitiría fabricar un segundo dueño de la cuenta desde una pantalla.
    const error = await expectFailure(() => alta('nueva@tenant-a.com', 'owner'))

    expect(error).toContain('ROL_NO_ASIGNABLE')
  })

  it('un miembro sin rol administrativo no puede dar de alta a nadie', async () => {
    await svc(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'mirona@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, SIN_ROL],
    )

    const error = await expectFailure(() =>
      asRole(
        db,
        'authenticated',
        claimsFor(TENANT_A, {
          sub: SIN_ROL,
          email: 'mirona@tenant-a.com',
          companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
        }),
        () => svc(`select public.add_tenant_member('nueva@tenant-a.com', 'admin')`),
      ),
    )

    expect(error).toContain('SIN_PERMISO')
  })

  it('el alta ocurre en la sociedad del que llama, nunca en otra', async () => {
    // El admin de B da de alta: la fila nace en B, porque la sociedad sale de
    // su token. No hay forma de pedir un alta «en la sociedad de al lado».
    await alta('nueva@tenant-a.com', 'admin', TENANT_B)

    const filas = await svc<{ company_id: string }>(
      `select company_id from public.tenant_members where email = 'nueva@tenant-a.com'`,
    )
    expect(filas).toHaveLength(1)
    expect(filas[0]?.company_id).toBe(TENANT_B.companyId)
  })
})

// ---------------------------------------------------------------------------
// Cuentas B2B
// ---------------------------------------------------------------------------

describe('quién compra a nombre de una cuenta', () => {
  const alta = (
    email: string,
    rol = 'buyer',
    limite: number | null = null,
    estado = 'invited',
  ) =>
    comoAdmin(TENANT_A, () =>
      svc(
        `select public.add_business_account_user(
           $1, $2, $3::public.business_role, $4, null, $5::public.member_status)`,
        [cuentaA, email, rol, limite, estado],
      ),
    )

  it('basta el correo, igual que en el backoffice', async () => {
    await alta('compradora@cliente.com')

    const [fila] = await svc<{ user_id: string; role: string }>(
      `select user_id, role from public.business_account_users
        where email = 'compradora@cliente.com'`,
    )
    expect(fila?.user_id).toBe(COMPRADORA)
    expect(fila?.role).toBe('buyer')
  })

  /**
   * El estado NO es decorativo: el portal del comprador exige `active` para
   * dejar entrar. Una versión anterior de esta función escribía `active`
   * siempre, así que marcar a alguien como «invitado» y darle acceso inmediato
   * a comprar a nombre de la empresa eran la misma acción — con la pantalla
   * diciendo lo contrario.
   */
  it('vincular como INVITADO no da acceso a comprar', async () => {
    await alta('compradora@cliente.com', 'buyer', null, 'invited')

    const [fila] = await svc<{ status: string }>(
      `select status from public.business_account_users where email = 'compradora@cliente.com'`,
    )
    expect(fila?.status).toBe('invited')
  })

  it('y activarlo es una decisión explícita', async () => {
    await alta('compradora@cliente.com', 'buyer', null, 'active')

    const [fila] = await svc<{ status: string }>(
      `select status from public.business_account_users where email = 'compradora@cliente.com'`,
    )
    expect(fila?.status).toBe('active')
  })

  it('el límite de gasto se guarda con el vínculo', async () => {
    await alta('compradora@cliente.com', 'buyer', 500)

    const [fila] = await svc<{ spending_limit: string }>(
      `select spending_limit::text from public.business_account_users
        where email = 'compradora@cliente.com'`,
    )
    expect(fila?.spending_limit).toBe('500.00')
  })

  it('un correo sin cuenta se explica', async () => {
    expect(await expectFailure(() => alta('nadie@cliente.com'))).toContain('SIN_CUENTA')
  })

  it('un correo de la suite no compra a nombre de un cliente', async () => {
    await crearUsuario('0a000000-0000-4000-8000-0000000000e9', 'operador@ebim.pe')

    expect(await expectFailure(() => alta('operador@ebim.pe'))).toContain('CORREO_DE_SUITE')
  })

  /**
   * Lo que ve la propia persona mientras espera la activación.
   *
   * Antes la tienda le decía «no estás vinculado a ninguna empresa», que era
   * falso. Ahora puede saber a cuál sí, y solo eso: el nombre.
   */
  describe('mientras el vínculo está pendiente', () => {
    const comoCompradora = <T,>(run: () => Promise<T>) =>
      asRole(db, 'authenticated', comprador(COMPRADORA, 'compradora@cliente.com'), run)

    it('la invitada ve el nombre de la empresa que la vinculó', async () => {
      await alta('compradora@cliente.com', 'buyer', 500, 'invited')

      const [fila] = await comoCompradora(() =>
        svc<{ r: Array<Record<string, unknown>> }>(
          `select public.my_pending_business_accounts() as r`,
        ),
      )
      expect(fila?.r).toHaveLength(1)
      expect(fila?.r[0]?.name).toBe('Cuenta 1')
      // Y nada más: ni límite, ni ids. Un vínculo pendiente no da acceso.
      expect(Object.keys(fila?.r[0] ?? {}).sort()).toEqual(['invited_at', 'name'])
    })

    it('una vez activa deja de estar pendiente, y pasa a las cuentas con acceso', async () => {
      await alta('compradora@cliente.com', 'buyer', null, 'active')

      const [pendientes] = await comoCompradora(() =>
        svc<{ r: unknown[] }>(`select public.my_pending_business_accounts() as r`),
      )
      const [activas] = await comoCompradora(() =>
        svc<{ r: unknown[] }>(`select public.my_business_accounts() as r`),
      )
      expect(pendientes?.r).toEqual([])
      expect(activas?.r).toHaveLength(1)
    })

    it('nadie ve los vínculos pendientes de otra persona', async () => {
      await alta('compradora@cliente.com', 'buyer', null, 'invited')

      const [fila] = await asRole(
        db,
        'authenticated',
        comprador(NUEVA, 'nueva@tenant-a.com'),
        () => svc<{ r: unknown[] }>(`select public.my_pending_business_accounts() as r`),
      )
      expect(fila?.r).toEqual([])
    })

    it('anon no puede preguntarlo', async () => {
      const error = await expectFailure(() =>
        asRole(db, 'anon', null, () => svc(`select public.my_pending_business_accounts()`)),
      )
      expect(error).toMatch(/permission denied/i)
    })
  })

  it('el admin de otra sociedad no toca esta cuenta', async () => {
    const error = await expectFailure(() =>
      comoAdmin(TENANT_B, () =>
        svc(`select public.add_business_account_user($1, 'compradora@cliente.com', 'buyer', null, null, 'invited')`, [
          cuentaA,
        ]),
      ),
    )

    expect(error).toContain('SIN_PERMISO')
  })
})
