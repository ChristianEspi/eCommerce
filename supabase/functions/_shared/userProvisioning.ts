/**
 * Dar de alta una CUENTA para alguien que todavía no la tiene.
 *
 * ## El callejón sin salida que cierra
 *
 * Dos pantallas reparten acceso —usuarios del backoffice y compradores de una
 * cuenta B2B— y las dos exigen que la persona ya exista. No existía ningún
 * sitio donde pasara a existir: la aplicación no tiene pantalla de registro, y
 * el alta directa de Supabase deja la cuenta sin sesión esperando un correo de
 * confirmación que este sistema todavía no envía. El resultado era «esa persona
 * no tiene cuenta» sin respuesta posible.
 *
 * Aquí la crea el comercio, ya confirmada, y se entrega una contraseña temporal
 * una sola vez.
 *
 * ## Por qué la lógica vive en `_shared` y no en el `index.ts`
 *
 * `_shared` es TypeScript puro que compila el `tsc` del repo y ejecutan los
 * tests; el `index.ts` importa el SDK con especificador `npm:` y `Deno.env`, y
 * por eso no se puede probar desde Vitest. Todo lo que decide algo —quién
 * puede, qué correo vale, cómo se genera la contraseña, cuándo el fallo es «ya
 * existe»— está de este lado.
 */
import { AppError, forbidden } from './errors.ts'
import { requireEmail, rejectUnknownFields } from './validation.ts'

/** Lo único que se acepta del cuerpo. El tenant sale del token (contrato §2.2). */
export const CREATE_USER_FIELDS = ['email'] as const

/**
 * Quién puede dar de alta a alguien: los mismos dos roles que ya administran
 * miembros. No se amplía la lista «porque es solo crear una cuenta» — crear
 * cuentas en un proyecto de autenticación es exactamente lo que usaría alguien
 * para fabricarse una identidad.
 */
export const ROLES_QUE_DAN_DE_ALTA = ['owner', 'admin'] as const

/**
 * Alfabeto SIN los caracteres que se confunden al dictar: `I`, `l`, `1`, `O`,
 * `0`. Porque dictarla es exactamente lo que va a pasar con ella —por teléfono,
 * por chat, copiada a mano— y una contraseña que se teclea mal tres veces
 * acaba en una llamada de soporte, no en un acceso.
 */
export const ALFABETO_SIN_CONFUSOS =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Longitud de la contraseña temporal: 16 sobre 57 símbolos son ~93 bits. */
export const LARGO_CONTRASENA = 16

/**
 * Contraseña temporal.
 *
 * `crypto.getRandomValues` y nunca `Math.random`: una contraseña predecible es
 * peor que ninguna, porque parece que protege. La fuente se puede inyectar solo
 * para poder probar el mapeo al alfabeto sin depender del azar.
 */
export function contrasenaTemporal(
  // `Uint8Array<ArrayBuffer>`: `getRandomValues` no acepta un búfer compartido,
  // y el runtime de Deno (TS 6) lo exige en la firma.
  aleatorio: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = aleatorio(new Uint8Array(LARGO_CONTRASENA))
  return Array.from(bytes, (b) => ALFABETO_SIN_CONFUSOS[b % ALFABETO_SIN_CONFUSOS.length]).join('')
}

/** Mínimo de la contraseña fija. Por debajo, Auth la rechaza y el alta muere. */
export const MINIMO_CONTRASENA_FIJA = 8

/**
 * La contraseña con la que nace la cuenta.
 *
 * ## Por qué existe la variante fija
 *
 * En una demostración, una contraseña distinta por cada cuenta es un obstáculo
 * sin ninguna ventaja: quien enseña el producto crea tres usuarios en directo y
 * tiene que ir copiando tres cadenas de dieciséis caracteres mientras habla.
 * Con `EBIM_DEMO_PASSWORD` puesta, todas las cuentas nacen con esa.
 *
 * ## Y por qué es una variable de entorno y no una constante
 *
 * Escrita en el código viajaría al repositorio y, peor, a producción: cualquiera
 * que leyera este archivo podría entrar como cualquier cuenta creada desde la
 * pantalla. Como variable, el entorno que no la define sigue generando una
 * contraseña aleatoria, que es el comportamiento seguro, y el que la define
 * asume lo que asume. **No debe definirse en producción.**
 *
 * Si está puesta pero es demasiado corta, esto falla en voz alta en vez de
 * volver a la aleatoria por lo bajo: el alta funcionaría y nadie entendería por
 * qué la contraseña no es la esperada.
 */
export function contrasenaParaAlta(fija?: string | null): string {
  const elegida = (fija ?? '').trim()
  if (elegida.length === 0) return contrasenaTemporal()

  if (elegida.length < MINIMO_CONTRASENA_FIJA) {
    throw new AppError(
      'CONFIG_INCOMPLETA',
      `EBIM_DEMO_PASSWORD tiene menos de ${MINIMO_CONTRASENA_FIJA} caracteres`,
      500,
    )
  }
  return elegida
}

/**
 * El correo del alta: normalizado, válido, y nunca de la suite.
 *
 * Un `@ebim.pe` no es actor de negocio de un tenant (contrato §13), así que
 * tampoco se le fabrica una cuenta desde la pantalla de un tenant. La misma
 * regla que ya aplican `add_tenant_member` y `add_business_account_user`, aquí
 * un paso antes.
 */
export function emailParaAlta(body: Record<string, unknown>): string {
  rejectUnknownFields(body, CREATE_USER_FIELDS)
  const email = requireEmail(body, 'email')
  if (email.endsWith('@ebim.pe')) {
    // Código propio y no el genérico `SIN_PERMISO`: la pantalla tiene algo
    // distinto que decir —«ese correo es de la suite»— y con un solo código
    // para los dos casos diría «no tienes permiso» a quien sí lo tiene.
    throw new AppError(
      'CORREO_DE_SUITE',
      'Una cuenta @ebim.pe no se da de alta desde un tenant',
      403,
    )
  }
  return email
}

/**
 * El rol de quien llama, ya leído de la base CON SU TOKEN.
 *
 * Recibe lo que devolvió la consulta, no los claims: los claims se pueden
 * escribir a mano y aquí el siguiente paso salta la RLS. Un `null` —sin fila,
 * o revocado— es «no», igual que un rol insuficiente.
 */
export function assertPuedeDarDeAlta(rol: string | null | undefined): void {
  if (!rol || !ROLES_QUE_DAN_DE_ALTA.includes(rol as (typeof ROLES_QUE_DAN_DE_ALTA)[number])) {
    throw forbidden('Hace falta rol owner o admin para crear una cuenta')
  }
}

/**
 * ¿El fallo del alta es «ese correo ya tiene cuenta»?
 *
 * Importa distinguirlo porque la respuesta es distinta en lo esencial: si ya
 * existe, esta función NO la toca. Cambiarle la contraseña a alguien porque
 * otra persona escribió su correo en un formulario sería un secuestro de cuenta
 * con pantalla propia. Se dice que ya existe y se acaba ahí; vincularla es el
 * paso siguiente y lo siguen decidiendo `add_tenant_member` y
 * `add_business_account_user`.
 */
export function esCuentaExistente(error: { status?: number; message?: string } | null): boolean {
  if (!error) return false
  if (error.status === 422) return true
  return /already|registered|exists|duplicate/i.test(error.message ?? '')
}
