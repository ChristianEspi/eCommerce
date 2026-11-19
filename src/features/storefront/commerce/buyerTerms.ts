import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useSessionContext } from '@/features/auth/session-context'
import { PURCHASE_APPROVAL_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { fetchMyStatement, myStatementKey } from '../portal'
import { useStoreAccounts } from './accounts'
import { useCommerceContext } from './context'

/**
 * Las condiciones del comprador empresa que el carrito y el pago deben DECIR:
 * cuánto crédito le queda y si este pedido va a pasar por aprobación.
 *
 * No deciden nada. El crédito lo bloquea el servidor al registrar el pedido
 * (`CREDITO_BLOQUEADO`) y la aprobación la fija `create_order`; aquí solo se
 * adelanta lo que va a pasar, para que no sea una sorpresa al final. Por eso
 * ninguna de las dos consultas corre si el contexto comercial no dice que hay
 * algo que contar: el consumidor no paga ni una llamada.
 */

export interface BuyerCredit {
  /** Lo que queda de la línea, como número para comparar con el total. */
  available: number
  limit: number | null
  currency: string | null
  termsDays: number
}

/**
 * El crédito de la cuenta con la que se compra en ESTA tienda.
 *
 * `my_account_statement` devuelve todas las cuentas del usuario; la de esta
 * tienda es la que el contexto comercial nombra. Sin límite (`credit_available`
 * nulo) no hay nada que enseñar: esa cuenta compra sin tope.
 */
export function useBuyerCredit(storeSlug: string): BuyerCredit | null {
  const { status } = useSessionContext()
  const { context } = useCommerceContext(storeSlug, status === 'authenticated')
  const enabled = Boolean(context?.has_credit_terms)
  const statement = useQuery({
    queryKey: myStatementKey(storeSlug),
    queryFn: () => fetchMyStatement(storeSlug),
    enabled,
    retry: false,
    staleTime: 60_000,
  })
  if (!enabled || !context || !statement.data) return null
  const cuenta =
    statement.data.find((row) => context.account_code && row.account_code === context.account_code) ??
    statement.data.find((row) => row.account_name === context.account_name) ??
    null
  if (!cuenta || cuenta.credit_available === null) return null
  return {
    available: Number(cuenta.credit_available),
    limit: cuenta.credit_limit === null ? null : Number(cuenta.credit_limit),
    currency: cuenta.currency,
    termsDays: cuenta.payment_terms_days,
  }
}

const approvalPreviewSchema = z.object({
  required: z.boolean(),
  reason: z.enum(['user_limit', 'rule', 'account_threshold']).nullable().default(null),
  rule_min_amount: z.string().nullable().default(null),
  user_limit: z.string().nullable().default(null),
  approver_role: z.string().nullable().default(null),
})

export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>

/**
 * ¿Este importe va a pasar por aprobación?
 *
 * Usa `purchase_approval`, la misma función que consulta el checkout en el
 * servidor antes de registrar el pedido, con la cuenta EFECTIVA del comprador
 * en esta tienda. Solo pregunta si la cuenta tiene control de aprobación o el
 * usuario tiene límite de gasto. El importe entra redondeado a la unidad en la
 * clave: sumar un producto de S/ 0.50 no debe disparar otra consulta.
 */
export function useApprovalPreview(storeSlug: string, amount: string | null): ApprovalPreview | null {
  const { status } = useSessionContext()
  const { context } = useCommerceContext(storeSlug, status === 'authenticated')
  const controlada = Boolean(context && (context.requires_approval || context.has_spending_limit))
  const cuentas = useStoreAccounts(storeSlug, controlada)
  const cuenta = cuentas.data?.find((row) => row.is_effective) ?? null
  const importe = amount !== null && Number(amount) > 0 ? Math.ceil(Number(amount)) : null
  const query = useQuery({
    queryKey: ['storefront', 'approval-preview', storeSlug, cuenta?.account_id ?? null, importe] as const,
    queryFn: async () => {
      const supabase = tryGetSupabaseClient()
      if (!supabase || !cuenta || importe === null) return null
      const { data, error } = await supabase.rpc(PURCHASE_APPROVAL_RPC, {
        p_business_account_id: cuenta.account_id,
        p_amount: String(importe),
      })
      if (error) throw error
      return approvalPreviewSchema.parse(data)
    },
    enabled: controlada && cuenta !== null && importe !== null,
    retry: false,
    staleTime: 60_000,
  })
  return controlada ? (query.data ?? null) : null
}
