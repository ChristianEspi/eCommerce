import { z } from 'zod'
import { rowReasonKey as catalogReasonKey } from '@/features/catalog/import/api'
import type { MessageKey } from '@/shared/i18n/messages'
import { codeFromDbError } from '@/shared/lib/appError'
import { IMPORT_BUSINESS_ACCOUNT_USERS_RPC, IMPORT_CUSTOMERS_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import type { ImportRow } from '@/features/catalog/import/parse'
import { CustomersError } from '../errors'

/**
 * Las dos importaciones de clientes contra la base.
 *
 * Simular y aplicar son la MISMA llamada con `dryRun` distinto (ver la cabecera
 * de `20261113120000_customers_import.sql`): la vista previa es la validación
 * de verdad, no una imitación en el navegador.
 */

const rowResultSchema = z.object({
  sheet: z.string(),
  row: z.number().int(),
  key: z.string().nullable().default(null),
  status: z.enum(['created', 'updated', 'error']),
  reason: z.string().optional(),
  field: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  constraint: z.string().nullable().optional(),
})

const importResultSchema = z.object({
  dry_run: z.boolean(),
  applied: z.boolean(),
  total: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  errors: z.number().int(),
  rows: z.array(rowResultSchema),
})

export type CustomerImportRow = z.infer<typeof rowResultSchema>
export type CustomerImportResult = z.infer<typeof importResultSchema>

/** Motivos propios de estas importaciones. Los compartidos los explica el catálogo. */
export const CUSTOMER_ROW_REASONS = [
  'CODIGO_CLIENTE_INVALIDO',
  'CODIGO_REPETIDO',
  'SEGMENTO_NO_ENCONTRADO',
  'CORREO_INVALIDO',
  'CORREO_REPETIDO',
  'CODIGO_ERP_EN_USO',
  'SIN_PERMISO_ERP',
  'CUENTA_NO_ENCONTRADA',
  'OTRA_CUENTA',
  'SIN_CUENTA',
  'CORREO_DE_SUITE',
  'SUCURSAL_NO_ENCONTRADA',
  'SIN_PERMISO',
] as const

export function customerRowReasonKey(reason: string | undefined): MessageKey {
  return (CUSTOMER_ROW_REASONS as readonly string[]).includes(reason ?? '')
    ? (`customersImport.reason.${reason}` as MessageKey)
    : catalogReasonKey(reason)
}

/** Errores de la carga ENTERA: no hay filas que enseñar, hay una causa. */
export function mapCustomerImportCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case 'OPERADOR_NO_ES_ACTOR':
    case '42501':
      return 'customersImport.error.forbidden'
    case 'MODULO_NO_CONTRATADO':
      return 'customersImport.error.module'
    case 'CUENTA_NO_ENCONTRADA':
      return 'customers.error.notFound'
    case 'FILAS_EXCESIVAS':
      return 'catalogImport.error.tooMany'
    case 'CAMPO_NO_PERMITIDO':
    case 'FILAS_INVALIDAS':
      return 'catalogImport.error.shape'
    default:
      return 'catalogImport.error.generic'
  }
}

async function run(rpc: string, args: Record<string, unknown>): Promise<CustomerImportResult> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new CustomersError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  const { data, error } = await supabase.rpc(rpc, args)
  if (error) {
    const code = codeFromDbError(error)
    throw new CustomersError(mapCustomerImportCode(code), code)
  }
  return importResultSchema.parse(data)
}

export function importCustomers(rows: readonly ImportRow[], dryRun: boolean): Promise<CustomerImportResult> {
  return run(IMPORT_CUSTOMERS_RPC, { p_rows: rows, p_dry_run: dryRun })
}

/** Con `accountId` todas las filas son de esa cuenta; sin él, cada fila dice la suya. */
export function importAccountUsers(
  accountId: string | null,
  rows: readonly ImportRow[],
  dryRun: boolean,
): Promise<CustomerImportResult> {
  return run(IMPORT_BUSINESS_ACCOUNT_USERS_RPC, { p_account_id: accountId, p_rows: rows, p_dry_run: dryRun })
}

/** Los correos que la revisión rechazó porque todavía no tienen usuario. */
export function emailsWithoutAccount(result: CustomerImportResult | null): string[] {
  if (!result) return []
  const emails = result.rows
    .filter((row) => row.status === 'error' && row.reason === 'SIN_CUENTA' && row.value)
    .map((row) => (row.value as string).toLowerCase())
  return [...new Set(emails)]
}
