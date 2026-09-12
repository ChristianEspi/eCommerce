/**
 * create-user — crea la cuenta de acceso de una persona que todavía no la tiene.
 *
 * Toda la decisión vive en `_shared/userProvisioning.ts`, que es lo que los
 * tests ejecutan. Aquí solo está el orden, y el orden es lo único que evita que
 * esto sea un agujero:
 *
 *  1. **Se verifica la FIRMA del token** contra el servidor de auth del
 *     proyecto (`verifyHubToken`). `decodeClaims` por sí solo no verifica nada:
 *     es suficiente cuando la consulta viaja después con el mismo token y la
 *     RLS vuelve a decidir, y NO lo es aquí, donde el siguiente paso usa
 *     `service_role` y salta la RLS. Mismo razonamiento que en el alta de
 *     tenant.
 *  2. **Se pregunta a la base, con el token de quien llama**, si es `owner` o
 *     `admin` de su sociedad. La RLS solo le deja ver su propia membresía, así
 *     que la respuesta no se puede inflar desde el cuerpo.
 *  3. **Solo entonces** entra la clave de servicio, y solo para crear el
 *     usuario de Auth. No escribe ninguna tabla de negocio.
 *
 * Crear la cuenta NO da acceso a nada: son dos decisiones y siguen siendo dos
 * pasos. Repartir el acceso lo siguen haciendo `add_tenant_member` y
 * `add_business_account_user`, que comprueban lo suyo.
 */
import { assertNotSuiteOperator, tenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { AppError, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import {
  assertPuedeDarDeAlta,
  contrasenaParaAlta,
  emailParaAlta,
  esCuentaExistente,
} from '../_shared/userProvisioning.ts'
import { serviceClient, userClient } from '../_runtime/clients.ts'
import { verifyHubToken } from '../_runtime/verify.ts'

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'create-user',
  },
  async ({ request, body, trace, logger }) => {
    const context = tenantContext(await verifyHubToken(request))
    assertNotSuiteOperator(context.email)

    const email = emailParaAlta(body)

    // Con SU token: si estuviera mal firmado no habría llegado al paso 1, y la
    // RLS solo le devuelve su propia fila.
    const { data: miembro, error } = await userClient(request, trace)
      .from('tenant_members')
      .select('role')
      .eq('user_id', context.userId)
      .eq('company_id', context.companyId)
      .eq('status', 'active')
      .maybeSingle()

    if (error) throw fromDatabaseError(error)
    assertPuedeDarDeAlta(miembro?.role as string | null)

    // Aleatoria, salvo que el entorno imponga una fija para demostrar el
    // producto. Sin la variable, el comportamiento es el seguro; ponerla es una
    // decisión consciente de ese entorno y no debe hacerse en producción.
    const password = contrasenaParaAlta(Deno.env.get('EBIM_DEMO_PASSWORD'))
    const { data: creado, error: fallo } = await serviceClient(trace).auth.admin.createUser({
      email,
      password,
      // Confirmada al crearla. La alternativa es un correo de confirmación que
      // este sistema todavía no envía, y con él una cuenta que nadie puede usar.
      email_confirm: true,
    })

    if (fallo) {
      if (esCuentaExistente(fallo)) {
        throw new AppError('CUENTA_YA_EXISTE', 'Ese correo ya tiene una cuenta', 409)
      }
      // El detalle del proveedor se registra, no se devuelve.
      logger.error('create-user.alta_fallida', { code: fallo.status ?? 'sin_codigo' })
      throw new AppError('ALTA_FALLIDA', 'No se pudo crear la cuenta', 502)
    }

    return {
      status: 201,
      body: {
        data: {
          email,
          user_id: creado.user?.id ?? null,
          // Se devuelve UNA vez. No se guarda en ninguna tabla ni en el log.
          temporary_password: password,
        },
      },
    }
  },
)

Deno.serve(handler)
