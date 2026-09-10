import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { TENANT_MEMBERS_TABLE } from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * Quién entra a este backoffice, y con qué permiso.
 *
 * ## Membresía sí, identidad no
 *
 * Esta pantalla administra la MEMBRESÍA —qué rol tiene una persona en esta
 * sociedad— y no la IDENTIDAD, que es el correo y la contraseña. La identidad
 * es de la plataforma (contrato §0.1: «separa DATOS, unifica IDENTIDAD») y por
 * eso aquí no se crea a nadie: se le da acceso a alguien que ya existe.
 *
 * La consecuencia práctica es que `user_id` es obligatorio y no se puede
 * inventar. Para dar de alta a quien todavía no tiene cuenta hacen falta dos
 * pasos, y el primero no es de esta app.
 *
 * ## Los tres candados los pone la base, no esta pantalla
 *
 * Las policies de `tenant_members` ya dicen quién puede qué, y esta pantalla
 * solo refleja lo que la base va a permitir:
 *
 *  · `owner` **no se otorga ni se revoca desde la app**. Nace con el tenant
 *    (contrato §3.2) y cambiarlo es una operación de servidor.
 *  · Solo `owner` y `admin` administran miembros.
 *  · Nadie puede borrarse a sí mismo — es lo que evita quedarse fuera de la
 *    propia tienda con un clic.
 *
 * Si la interfaz se equivocara y ofreciera algo de eso, la base lo rechazaría.
 * Se ocultan igualmente porque un control que va a fallar es un control que
 * miente.
 */

export const MEMBER_ROLES = ['admin', 'catalog', 'orders', 'viewer'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

const memberSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'catalog', 'orders', 'viewer']),
  status: z.enum(['active', 'invited', 'revoked']),
  created_at: z.string(),
})

export type TenantMember = z.infer<typeof memberSchema>

export const membersKey = (organizationId: string | null, companyId: string | null) =>
  ['tenant-members', organizationId, companyId] as const

export function useMembers(organizationId: string | null, companyId: string | null) {
  return useQuery<TenantMember[]>({
    queryKey: membersKey(organizationId, companyId),
    enabled: Boolean(organizationId && companyId),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from(TENANT_MEMBERS_TABLE)
        .select('id, user_id, email, role, status, created_at')
        .eq('organization_id', organizationId as string)
        .eq('company_id', companyId as string)
        .order('email')

      if (error) throw error
      return memberSchema.array().parse(data ?? [])
    },
  })
}

function useInvalidateMembers() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['tenant-members'] })
}

/**
 * Da acceso a alguien que YA tiene cuenta.
 *
 * Se pide el `user_id` y no solo el correo porque la fila lo exige: es el `sub`
 * del token, y sin él la membresía no puede coserse a ninguna sesión. Escribir
 * solo el correo dejaría una fila que parece dar acceso y no lo da, que es peor
 * que no poder crearla.
 */
export function useAddMember() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (input: {
      organizationId: string
      companyId: string
      userId: string
      email: string
      role: MemberRole
    }) => {
      const { error } = await getSupabaseClient()
        .from(TENANT_MEMBERS_TABLE)
        .insert({
          organization_id: input.organizationId,
          company_id: input.companyId,
          user_id: input.userId,
          email: input.email.trim().toLowerCase(),
          role: input.role,
          status: 'active',
        })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useChangeMemberRole() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (input: { id: string; role: MemberRole }) => {
      const { error } = await getSupabaseClient()
        .from(TENANT_MEMBERS_TABLE)
        .update({ role: input.role })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/**
 * Quitar el acceso REVOCA, no borra.
 *
 * La fila se queda con `status = 'revoked'`: quién tuvo acceso a la tienda y
 * hasta cuándo es justo lo que hace falta el día que se audita algo, y una fila
 * borrada no responde eso. `ebim.can_access` solo mira las activas, así que el
 * efecto es inmediato igual.
 */
export function useRevokeMember() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabaseClient()
        .from(TENANT_MEMBERS_TABLE)
        .update({ status: 'revoked' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useRestoreMember() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabaseClient()
        .from(TENANT_MEMBERS_TABLE)
        .update({ status: 'active' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
