import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { codeFromDbError } from '@/shared/lib/appError'
import {
  INVOICE_SEQUENCES_TABLE,
  INVOICE_SETTINGS_CONFIGURE_RPC,
  INVOICE_SETTINGS_TABLE,
  INVOICING_NUBEFACT_CONFIGURE_RPC,
  INVOICING_TEST_FUNCTION,
  TENANT_INTEGRATIONS_TABLE,
} from '@/shared/lib/db-schema'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Configuración › Facturación (fase 3, 2026-11-20).
 *
 * Tres cosas, cada una por su camino seguro:
 *  · la configuración fiscal de la tienda (`invoice_settings_configure`);
 *  · el correlativo actual por serie (solo lectura: lo mueve la emisión);
 *  · el emisor Nubefact (`invoicing_nubefact_configure`). La ruta y el token
 *    van a Vault y NO vuelven: aquí solo se leen las pistas (`…5677`).
 * Y «Probar conexión» (`invoicing-test`), que tampoco devuelve credenciales.
 */

export type PdfFormat = 'A4' | 'A5' | 'TICKET'

export const DEFAULT_SETTINGS = {
  receipt_series: 'B001',
  invoice_series: 'F001',
  credit_note_receipt_series: 'BC01',
  credit_note_invoice_series: 'FC01',
  shipping_tax_rate: '0.18',
  zero_rate_affectation: 'exonerado' as 'exonerado' | 'inafecto',
  auto_issue: false,
  pdf_format: null as PdfFormat | null,
}

const settingsSchema = z.object({
  receipt_series: z.string(),
  invoice_series: z.string(),
  credit_note_receipt_series: z.string().catch('BC01'),
  credit_note_invoice_series: z.string().catch('FC01'),
  shipping_tax_rate: z.coerce.string(),
  zero_rate_affectation: z.enum(['exonerado', 'inafecto']).catch('exonerado'),
  auto_issue: z.boolean(),
  pdf_format: z.enum(['A4', 'A5', 'TICKET']).nullable().catch(null).default(null),
})
export type InvoicingSettings = z.infer<typeof settingsSchema>

const sequenceSchema = z.object({ series: z.string(), last_number: z.coerce.number() })

const providerSchema = z.object({
  is_active: z.boolean(),
  config: z
    .object({
      ruta_hint: z.string().optional(),
      token_hint: z.string().optional(),
      configured_at: z.string().optional(),
    })
    .catch({}),
})
export type NubefactStatus = { configured: boolean; active: boolean; rutaHint: string | null; tokenHint: string | null }

export interface InvoicingOverview {
  readonly settings: InvoicingSettings
  readonly sequences: Record<string, number>
  readonly nubefact: NubefactStatus
}

export class InvoicingError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'InvoicingError'
    this.code = code
  }
}

function client() {
  const c = tryGetSupabaseClient()
  if (!c) throw new InvoicingError('CONFIG_INCOMPLETA')
  return c
}

export async function fetchInvoicingOverview(storeId: string): Promise<InvoicingOverview> {
  const c = client()
  const [settings, sequences, provider] = await Promise.all([
    c.from(INVOICE_SETTINGS_TABLE)
      .select('receipt_series, invoice_series, credit_note_receipt_series, credit_note_invoice_series, shipping_tax_rate, zero_rate_affectation, auto_issue, pdf_format')
      .eq('store_id', storeId)
      .maybeSingle(),
    c.from(INVOICE_SEQUENCES_TABLE).select('series, last_number'),
    c.from(TENANT_INTEGRATIONS_TABLE).select('is_active, config').eq('provider_code', 'nubefact').maybeSingle(),
  ])
  for (const r of [settings, sequences, provider]) if (r.error) throw new InvoicingError(codeFromDbError(r.error))

  const p = provider.data ? providerSchema.parse(provider.data) : null
  return {
    settings: settings.data ? settingsSchema.parse(settings.data) : { ...DEFAULT_SETTINGS },
    sequences: Object.fromEntries(z.array(sequenceSchema).parse(sequences.data ?? []).map((s) => [s.series, s.last_number])),
    nubefact: {
      configured: Boolean(p?.config.token_hint),
      active: p?.is_active ?? false,
      rutaHint: p?.config.ruta_hint ?? null,
      tokenHint: p?.config.token_hint ?? null,
    },
  }
}

export interface SettingsInput {
  readonly receipt_series: string
  readonly invoice_series: string
  readonly credit_note_receipt_series: string
  readonly credit_note_invoice_series: string
  readonly shipping_tax_rate: string
  readonly zero_rate_affectation: 'exonerado' | 'inafecto'
  readonly auto_issue: boolean
  readonly pdf_format: PdfFormat | null
  readonly receipt_last_number: number | null
  readonly invoice_last_number: number | null
}

export async function saveInvoicingSettings(storeId: string, input: SettingsInput): Promise<void> {
  const { error } = await client().rpc(INVOICE_SETTINGS_CONFIGURE_RPC, {
    p_store_id: storeId,
    p_receipt_series: input.receipt_series,
    p_invoice_series: input.invoice_series,
    p_shipping_tax_rate: input.shipping_tax_rate,
    p_zero_rate_affectation: input.zero_rate_affectation,
    p_auto_issue: input.auto_issue,
    p_receipt_last_number: input.receipt_last_number,
    p_invoice_last_number: input.invoice_last_number,
    p_credit_note_receipt_series: input.credit_note_receipt_series,
    p_credit_note_invoice_series: input.credit_note_invoice_series,
    p_pdf_format: input.pdf_format ?? '',
  })
  if (error) throw new InvoicingError(codeFromDbError(error))
}

export async function saveNubefact(storeId: string, input: { ruta: string; token: string; active: boolean }): Promise<void> {
  const { error } = await client().rpc(INVOICING_NUBEFACT_CONFIGURE_RPC, {
    p_store_id: storeId,
    p_ruta: input.ruta,
    p_token: input.token,
    p_active: input.active,
  })
  if (error) throw new InvoicingError(codeFromDbError(error))
}

const testSchema = z.object({ ok: z.boolean(), code: z.string().nullable() })
export type ConnectionTest = z.infer<typeof testSchema>

export async function testNubefact(): Promise<ConnectionTest> {
  const { data, error } = await client().functions.invoke<{ data: unknown }>(INVOICING_TEST_FUNCTION, { body: {} })
  if (error) throw new InvoicingError(await codeFromInvokeError(error))
  const parsed = testSchema.safeParse(data?.data)
  if (!parsed.success) throw new InvoicingError('RESPUESTA_INVALIDA')
  return parsed.data
}

const keyOf = (storeId: string | null) => ['invoicing', 'overview', storeId] as const

export function useInvoicingOverview(storeId: string | null) {
  return useQuery({ queryKey: keyOf(storeId), enabled: Boolean(storeId), queryFn: () => fetchInvoicingOverview(storeId as string) })
}

export function useSaveInvoicingSettings(storeId: string | null) {
  const qc = useQueryClient()
  return useMutation<void, InvoicingError, SettingsInput>({
    mutationFn: (input) => saveInvoicingSettings(storeId as string, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keyOf(storeId) }),
  })
}

export function useSaveNubefact(storeId: string | null) {
  const qc = useQueryClient()
  return useMutation<void, InvoicingError, { ruta: string; token: string; active: boolean }>({
    mutationFn: (input) => saveNubefact(storeId as string, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keyOf(storeId) }),
  })
}

export function useTestNubefact() {
  return useMutation<ConnectionTest, InvoicingError>({ mutationFn: testNubefact })
}
