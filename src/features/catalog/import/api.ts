import { z } from 'zod'
import type { MessageKey } from '@/shared/i18n/messages'
import { codeFromDbError } from '@/shared/lib/appError'
import {
  IMPORT_CATALOG_CATEGORIES_RPC,
  IMPORT_CATALOG_PRODUCTS_RPC,
  IMPORT_CATALOG_VOCABULARY_RPC,
} from '@/shared/lib/db-schema'
import { catalogClient } from '../api/client'
import { CatalogError } from '../api/errors'
import type { Attribute, AttributeValue } from '../pim/types'
import type { AxisColumn } from './columns'
import type { ImportRow } from './parse'

/**
 * Las tres importaciones del catálogo contra la base.
 *
 * Simular y aplicar son la MISMA llamada con `dryRun` distinto (ver la cabecera
 * de `20260916100000_catalog_import.sql`): la vista previa es la validación de
 * verdad, no una imitación en el navegador.
 */

const rowResultSchema = z.object({
  sheet: z.string(),
  row: z.number().int(),
  key: z.string().nullable().default(null),
  status: z.enum(['created', 'updated', 'error']),
  reason: z.string().optional(),
  field: z.string().nullable().optional(),
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
  inventory_by_warehouse: z.boolean().optional(),
})

export type ImportRowResult = z.infer<typeof rowResultSchema>
export type ImportResult = z.infer<typeof importResultSchema>

/** Motivos por fila que la pantalla sabe explicar. El resto cae en el genérico. */
export const ROW_REASONS = [
  'CAMPO_REQUERIDO',
  'CODIGO_INVALIDO',
  'SLUG_INVALIDO',
  'FORMATO_INVALIDO',
  'NUMERO_INVALIDO',
  'VALOR_INVALIDO',
  'TEXTO_DEMASIADO_LARGO',
  'DUPLICADO',
  'SKU_DUPLICADO',
  'SKU_REPETIDO',
  'DATO_DISTINTO',
  'TIPO_DISTINTO',
  'REFERENCIA_INVALIDA',
  'CATEGORIA_NO_ENCONTRADA',
  'MARCA_NO_ENCONTRADA',
  'FAMILIA_NO_ENCONTRADA',
  'ATRIBUTO_NO_ENCONTRADO',
  'ATRIBUTO_NO_ES_LISTA',
  'EJE_NO_ENCONTRADO',
  'NO_ES_EJE',
  'VALOR_NO_ENCONTRADO',
  'VARIANTE_DE_OTRO_PRODUCTO',
  'PADRE_NO_ENCONTRADO',
  'PADRE_INVALIDO',
  'CATEGORIA_PROFUNDIDAD',
  'CATEGORIA_CICLO',
  'MODULO_NO_CONTRATADO',
] as const

export type RowReason = (typeof ROW_REASONS)[number]

export function rowReasonKey(reason: string | undefined): MessageKey {
  return (ROW_REASONS as readonly string[]).includes(reason ?? '')
    ? (`catalogImport.reason.${reason}` as MessageKey)
    : 'catalogImport.reason.DESCONOCIDO'
}

/** Errores de la carga ENTERA: no hay filas que enseñar, hay una causa. */
export function mapImportCode(code: string): MessageKey {
  switch (code) {
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
    case 'OPERADOR_NO_ES_ACTOR':
    case '42501':
      return 'catalogImport.error.forbidden'
    case 'MODULO_NO_CONTRATADO':
      return 'catalogImport.error.module'
    case 'FILAS_EXCESIVAS':
      return 'catalogImport.error.tooMany'
    case 'CAMPO_NO_PERMITIDO':
    case 'FILAS_INVALIDAS':
      return 'catalogImport.error.shape'
    default:
      return 'catalogImport.error.generic'
  }
}

async function run(rpc: string, args: Record<string, unknown>): Promise<ImportResult> {
  const { data, error } = await catalogClient().rpc(rpc, args)
  if (error) {
    const code = codeFromDbError(error)
    throw new CatalogError(mapImportCode(code), code)
  }
  return importResultSchema.parse(data)
}

export type VocabularySheets = Partial<
  Record<'brands' | 'families' | 'units' | 'attributes' | 'attribute_values', readonly ImportRow[]>
>

export function importVocabulary(sheets: VocabularySheets, dryRun: boolean): Promise<ImportResult> {
  return run(IMPORT_CATALOG_VOCABULARY_RPC, { p_sheets: sheets, p_dry_run: dryRun })
}

export function importCategories(storeId: string, rows: readonly ImportRow[], dryRun: boolean): Promise<ImportResult> {
  return run(IMPORT_CATALOG_CATEGORIES_RPC, { p_store_id: storeId, p_rows: rows, p_dry_run: dryRun })
}

export function importProducts(storeId: string, rows: readonly ImportRow[], dryRun: boolean): Promise<ImportResult> {
  return run(IMPORT_CATALOG_PRODUCTS_RPC, { p_store_id: storeId, p_rows: rows, p_dry_run: dryRun })
}

/**
 * Los ejes de variante activos de la sociedad, como columnas de la hoja de
 * productos: «Talla», «Color»… con sus primeros valores para el ejemplo.
 */
export function axisColumns(
  attributes: readonly Attribute[],
  values: readonly AttributeValue[],
): AxisColumn[] {
  return attributes
    .filter((attribute) => attribute.is_variant_axis && attribute.is_active)
    .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
    .map((attribute) => ({
      code: attribute.code,
      header: attribute.name,
      sampleValues: values
        .filter((value) => value.attribute_id === attribute.id && value.is_active)
        .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
        .slice(0, 3)
        .map((value) => value.label),
    }))
}
