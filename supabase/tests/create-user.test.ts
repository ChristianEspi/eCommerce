// @vitest-environment node
/**
 * Crear la cuenta de acceso de alguien que todavía no la tiene.
 *
 * ## Qué desbloquea, dicho como se vivía
 *
 * Las pantallas de usuarios del backoffice y de compradores B2B respondían
 * `SIN_CUENTA` a un correo que no tuviera cuenta, y no había ningún sitio donde
 * dársela: no hay pantalla de registro, y el alta directa de Supabase deja la
 * cuenta esperando un correo de confirmación que este sistema no envía. Se
 * podía repartir acceso solo a quien ya lo tenía.
 *
 * ## Lo que se prueba aquí
 *
 * Las decisiones, no el cableado: quién puede, qué correo vale, cómo es la
 * contraseña y cuándo un fallo del proveedor significa «ya existe». El
 * `index.ts` que las encadena importa el SDK con `npm:` y `Deno.env`, así que
 * no se ejecuta desde aquí; lo que sí se comprueba de él es el ORDEN, leyendo
 * el archivo, porque ese orden es lo único que impide que `service_role` se use
 * antes de saber quién llama.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AppError } from '../functions/_shared/errors.ts'
import {
  ALFABETO_SIN_CONFUSOS,
  CREATE_USER_FIELDS,
  LARGO_CONTRASENA,
  MINIMO_CONTRASENA_FIJA,
  ROLES_QUE_DAN_DE_ALTA,
  assertPuedeDarDeAlta,
  contrasenaParaAlta,
  contrasenaTemporal,
  emailParaAlta,
  esCuentaExistente,
} from '../functions/_shared/userProvisioning.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX = join(HERE, '..', 'functions', 'create-user', 'index.ts')

/**
 * El código sin sus comentarios.
 *
 * Las comprobaciones estructurales de más abajo dicen «esto no aparece», y sin
 * esto dirían además «ni se puede explicar por qué no aparece»: el comentario
 * que documenta la decisión menciona por fuerza lo que se descarta. Se borran
 * primero los bloques y después las líneas, en ese orden, porque un `//` dentro
 * de un bloque no abre nada.
 */
function soloCodigo(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function catchError(run: () => unknown): AppError {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('Se esperaba un AppError y la operación tuvo éxito')
}

// ---------------------------------------------------------------------------
// Quién puede
// ---------------------------------------------------------------------------

describe('quién puede crear una cuenta', () => {
  it('owner y admin, que son los que ya administran miembros', () => {
    expect(() => assertPuedeDarDeAlta('owner')).not.toThrow()
    expect(() => assertPuedeDarDeAlta('admin')).not.toThrow()
    expect([...ROLES_QUE_DAN_DE_ALTA]).toEqual(['owner', 'admin'])
  })

  it.each(['viewer', 'orders', 'catalog', 'finance'])('%s no', (rol) => {
    expect(catchError(() => assertPuedeDarDeAlta(rol)).status).toBe(403)
  })

  /**
   * Sin fila es «no», y es el caso que importa: la consulta corre con el token
   * de quien llama, así que quien no sea miembro de esa sociedad recibe cero
   * filas en vez de un error. Leer eso como «adelante» convertiría la RLS en lo
   * contrario de lo que es.
   */
  it('sin fila —no es miembro, o está revocado— tampoco', () => {
    expect(catchError(() => assertPuedeDarDeAlta(null)).status).toBe(403)
    expect(catchError(() => assertPuedeDarDeAlta(undefined)).status).toBe(403)
    expect(catchError(() => assertPuedeDarDeAlta('')).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Qué correo
// ---------------------------------------------------------------------------

describe('el correo del alta', () => {
  it('se normaliza: espacios fuera y en minúsculas', () => {
    expect(emailParaAlta({ email: '  Nueva@Tienda.COM  ' })).toBe('nueva@tienda.com')
  })

  it('uno inválido se rechaza con 400', () => {
    expect(catchError(() => emailParaAlta({ email: 'no-es-un-correo' })).status).toBe(400)
    expect(catchError(() => emailParaAlta({ email: '' })).status).toBe(400)
    expect(catchError(() => emailParaAlta({})).status).toBe(400)
  })

  /**
   * Contrato §13: `@ebim.pe` nunca es actor de negocio de un tenant. La regla
   * ya la aplican `add_tenant_member` y `add_business_account_user`; aquí va un
   * paso antes, porque crear la cuenta es lo que haría falta para saltársela.
   */
  it('un correo de la suite no se da de alta desde un tenant', () => {
    const error = catchError(() => emailParaAlta({ email: 'operador@ebim.pe' }))
    expect(error.status).toBe(403)
    // Código propio y no el genérico: la pantalla tiene algo distinto que decir.
    expect(error.code).toBe('CORREO_DE_SUITE')
  })

  it('y tampoco disfrazado de mayúsculas', () => {
    expect(catchError(() => emailParaAlta({ email: 'Operador@EBIM.pe' })).code).toBe(
      'CORREO_DE_SUITE',
    )
  })

  /**
   * El tenant sale del token, nunca del cuerpo (contrato §2.2). Se RECHAZA en
   * vez de ignorarse: ignorarlo deja al que llama creyendo que funcionó.
   */
  it('rechaza un tenant declarado en el cuerpo, no lo ignora', () => {
    const error = catchError(() =>
      emailParaAlta({ email: 'nueva@tienda.com', organization_id: 'otra' }),
    )
    expect(error.status).toBe(400)
    expect(error.code).toBe('CAMPO_NO_PERMITIDO')
  })

  it('el cuerpo admite un solo campo', () => {
    expect([...CREATE_USER_FIELDS]).toEqual(['email'])
  })
})

// ---------------------------------------------------------------------------
// La contraseña
// ---------------------------------------------------------------------------

describe('la contraseña temporal', () => {
  it('mide lo declarado y sale del alfabeto declarado', () => {
    const password = contrasenaTemporal()
    expect(password).toHaveLength(LARGO_CONTRASENA)
    for (const caracter of password) {
      expect(`${caracter}: ${ALFABETO_SIN_CONFUSOS.includes(caracter)}`).toBe(`${caracter}: true`)
    }
  })

  /**
   * Sin `I`, `l`, `1`, `O` ni `0`. Porque dictarla es exactamente lo que va a
   * pasar con ella, y una contraseña que se teclea mal tres veces termina en
   * soporte y no en un acceso.
   */
  it.each(['I', 'l', '1', 'O', '0'])('no contiene %s, que se confunde al dictarla', (caracter) => {
    expect(ALFABETO_SIN_CONFUSOS).not.toContain(caracter)
  })

  it('cada llamada da una distinta', () => {
    const generadas = new Set(Array.from({ length: 200 }, () => contrasenaTemporal()))
    expect(generadas.size).toBe(200)
  })

  /**
   * La fuente es la criptográfica del entorno. Una contraseña predecible es
   * peor que ninguna, porque parece que protege; esto lo fija leyendo el
   * código, que es donde se rompería al «simplificar» a `Math.random`.
   */
  it('usa crypto y no Math.random', () => {
    const codigo = soloCodigo(
      readFileSync(join(HERE, '..', 'functions', '_shared', 'userProvisioning.ts'), 'utf8'),
    )
    expect(codigo).toContain('crypto.getRandomValues')
    expect(codigo).not.toContain('Math.random')
  })

  it('el mapeo al alfabeto no se sale del rango con el byte más alto', () => {
    const password = contrasenaTemporal((bytes) => bytes.fill(255))
    expect(password).toHaveLength(LARGO_CONTRASENA)
    expect(ALFABETO_SIN_CONFUSOS).toContain(password[0])
  })
})

// ---------------------------------------------------------------------------
// La contraseña fija de las demostraciones
// ---------------------------------------------------------------------------

describe('la contraseña fija del entorno', () => {
  /**
   * Sin la variable, el comportamiento es el de siempre. Es la mitad que
   * importa: un entorno que no pide nada no puede acabar con una contraseña
   * conocida por descuido.
   */
  it('sin variable, sigue siendo aleatoria', () => {
    for (const vacio of [undefined, null, '', '   ']) {
      const password = contrasenaParaAlta(vacio)
      expect(password).toHaveLength(LARGO_CONTRASENA)
      expect(password).not.toBe(contrasenaParaAlta(vacio))
    }
  })

  it('con variable, todas las cuentas nacen con esa', () => {
    expect(contrasenaParaAlta('Demo2026!')).toBe('Demo2026!')
    expect(contrasenaParaAlta('  Demo2026!  ')).toBe('Demo2026!')
  })

  /**
   * Falla en voz alta en vez de volver a la aleatoria por lo bajo. Degradar en
   * silencio dejaría el alta funcionando y a nadie entendiendo por qué la
   * contraseña no es la que la demostración esperaba.
   */
  it('una demasiado corta no se ignora: se avisa', () => {
    const error = catchError(() => contrasenaParaAlta('corta'))
    expect(error.status).toBe(500)
    expect(error.code).toBe('CONFIG_INCOMPLETA')
    expect(MINIMO_CONTRASENA_FIJA).toBe(8)
  })

  /**
   * Escrita en el código viajaría al repositorio y a producción, y cualquiera
   * que leyera el archivo podría entrar como cualquier cuenta creada desde la
   * pantalla. Solo puede llegar por el entorno.
   */
  it('no hay ninguna contraseña escrita en el código', () => {
    const compartido = soloCodigo(
      readFileSync(join(HERE, '..', 'functions', '_shared', 'userProvisioning.ts'), 'utf8'),
    )
    const funcion = soloCodigo(readFileSync(INDEX, 'utf8'))

    expect(compartido).not.toMatch(/Demo\d/i)
    expect(funcion).not.toMatch(/Demo\d/i)
    // La única vía es la variable, y se lee en el borde y no aquí dentro.
    expect(funcion).toContain("Deno.env.get('EBIM_DEMO_PASSWORD')")
    expect(compartido).not.toContain('Deno.env')
  })
})

// ---------------------------------------------------------------------------
// La cuenta que ya existe
// ---------------------------------------------------------------------------

describe('un correo que ya tiene cuenta', () => {
  it('se reconoce por el estado y por el mensaje del proveedor', () => {
    expect(esCuentaExistente({ status: 422, message: 'lo que sea' })).toBe(true)
    expect(esCuentaExistente({ message: 'User already registered' })).toBe(true)
    expect(esCuentaExistente({ message: 'duplicate key value' })).toBe(true)
  })

  it('un fallo cualquiera no se confunde con «ya existe»', () => {
    expect(esCuentaExistente({ status: 500, message: 'upstream caido' })).toBe(false)
    expect(esCuentaExistente(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// El orden, que es la defensa
// ---------------------------------------------------------------------------

describe('el orden dentro de la función', () => {
  const codigo = soloCodigo(readFileSync(INDEX, 'utf8'))

  /**
   * `decodeClaims` NO verifica la firma. Es suficiente cuando la consulta viaja
   * después con el mismo token y la RLS vuelve a decidir; no lo es aquí, donde
   * el paso siguiente usa `service_role` y salta la RLS. Con `decodeClaims` a
   * secas, un token escrito a mano crearía cuentas.
   */
  it('verifica la FIRMA del token, no solo lo decodifica', () => {
    expect(codigo).toContain('verifyHubToken')
    expect(codigo).not.toContain('decodeClaims')
  })

  it('comprueba el rol ANTES de tocar la clave de servicio', () => {
    const rol = codigo.indexOf('assertPuedeDarDeAlta')
    const servicio = codigo.indexOf('serviceClient(trace)')
    expect(rol).toBeGreaterThan(-1)
    expect(servicio).toBeGreaterThan(rol)
  })

  it('y lo comprueba contra la BASE con el token del que llama', () => {
    expect(codigo).toContain('userClient(request')
    expect(codigo).toContain("from('tenant_members')")
  })

  /**
   * Crear la cuenta y repartir el acceso son dos decisiones. Esta función hace
   * la primera y ninguna más: si algún día escribiera `tenant_members` o
   * `business_account_users` con `service_role`, el vínculo dejaría de pasar
   * por las funciones que comprueban permisos.
   */
  it('no escribe ninguna tabla de negocio', () => {
    expect(codigo).not.toContain('add_tenant_member(')
    expect(codigo).not.toContain('business_account_users')
    expect(codigo).not.toContain('.insert(')
  })

  /** La contraseña se devuelve una vez; en el registro no aparece nunca. */
  it('no registra la contraseña', () => {
    const registros = codigo.match(/logger\.\w+\([^)]*\)/g) ?? []
    for (const registro of registros) {
      expect(registro).not.toContain('password')
    }
  })

  it('el operador de la suite no opera un tenant ni aquí', () => {
    expect(codigo).toContain('assertNotSuiteOperator')
  })
})
