import { z } from 'zod'
import { AppError } from '@/domain/errors'
import { metricSchema } from '@/features/admin/dashboard/aiAnalyst'
import { invokeAi } from '@/features/customers/ai/customersAi'
import { parseAiResult, type AiResult } from '@/features/ai/result'
import type { Locale } from '@/shared/i18n/messages'
import {
  QUOTES_ASSISTANT_FUNCTION,
  QUOTE_CREATE_FROM_DRAFT_RPC,
  QUOTE_DRAFT_PREVIEW_RPC,
} from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { tradeErrorFromDb, TradeError } from '../errors'

export { QUOTES_ASSISTANT_FUNCTION }

/**
 * IA de cotizaciones y surtidos en el CLIENTE (fase 07).
 *
 * El recorrido es PROPONER → CONFIRMAR → VALIDAR → EJECUTAR, y cada paso tiene
 * dueño:
 *
 *  1. `quotes-assistant` (`mode: draft`): la IA lee la instrucción y el SISTEMA
 *     la resuelve contra clientes y productos reales (`system`). Con duda
 *     devuelve candidatos; la pantalla los enseña y elige una persona.
 *  2. `quote_draft_preview` (RPC): el motor de precios dice cuánto cuesta cada
 *     línea, su impuesto, si está en el surtido del cliente y si hay
 *     existencia. El navegador NO calcula ni manda importes.
 *  3. La persona revisa y confirma.
 *  4. `quote_create_from_draft` (RPC): vuelve a preciar en el servidor y crea
 *     la cotización en `draft`. Nada se guarda antes de este clic.
 *
 * Surtido: `mode: signals` trae los candidatos del sistema (sin cuota) y
 * `mode: suggest` la priorización con IA. Añadir una sugerencia al borrador es
 * una decisión de la persona; tampoco guarda nada.
 */

// Listas cerradas — espejo de `supabase/functions/_shared/aiQuotes.ts`
// (`QuotesAi.test.tsx` compara las dos copias).
export const SUGGESTION_KINDS = ['replenish', 'cross_sell', 'complement'] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]
export const SUGGESTION_PRIORITIES = ['high', 'medium', 'low'] as const
export type SuggestionPriority = (typeof SUGGESTION_PRIORITIES)[number]
export const CUSTOMER_RESOLUTION = ['resolved', 'ambiguous', 'not_found', 'missing'] as const
export const LINE_RESOLUTION = ['resolved', 'ambiguous', 'not_found', 'out_of_assortment'] as const
export type LineResolution = (typeof LINE_RESOLUTION)[number]

/** Bloqueos que devuelve `quote_draft_preview`: la línea no se puede guardar. */
export const DRAFT_LINE_BLOCKS = [
  'PRODUCTO_NO_DISPONIBLE',
  'VARIANTE_REQUERIDA',
  'VARIANTE_NO_APLICA',
  'VARIANTE_NO_DISPONIBLE',
  'FUERA_DE_SURTIDO',
] as const
export type DraftLineBlock = (typeof DRAFT_LINE_BLOCKS)[number]

export const MAX_INSTRUCTION = 600
export const MAX_ASSORTMENT_QUESTION = 300
export const MAX_DRAFT_LINES = 20
export const MAX_QUANTITY = 100_000
export const DEFAULT_VALIDITY_DAYS = 15

const uuid = z.string().uuid()
const money = z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/)

// ---------------------------------------------------------------------------
// Borrador: interpretación IA + resolución del sistema
// ---------------------------------------------------------------------------

export const productCandidateSchema = z.object({
  product_id: uuid,
  sku: z.string().max(64),
  name: z.string().min(1).max(120),
  kind: z.enum(['simple', 'variant', 'bundle']),
  match: z.enum(['sku', 'name', 'partial']),
  matched_variant_id: uuid.nullable(),
  in_assortment: z.boolean().nullable(),
  variants: z.array(z.object({ variant_id: uuid, sku: z.string().max(64), name: z.string().min(1).max(80) })).max(10),
})
export type ProductCandidate = z.infer<typeof productCandidateSchema>

export const customerCandidateSchema = z.object({
  customer_id: uuid,
  code: z.string().max(40).nullable(),
  name: z.string().min(1).max(80),
  kind: z.string().max(20).nullable(),
  segment: z.string().max(60).nullable(),
  match: z.enum(['code', 'name', 'partial', 'selected']),
})
export type CustomerCandidate = z.infer<typeof customerCandidateSchema>

/** Bloque `system` del borrador: lo que el SISTEMA encontró. */
export const draftResolutionSchema = z.object({
  generated_at: z.string().nullable(),
  customer: z.object({
    status: z.enum(CUSTOMER_RESOLUTION),
    query: z.string().max(80).nullable(),
    selected_customer_id: uuid.nullable(),
    candidates: z.array(customerCandidateSchema).max(5),
  }),
  assortment: z
    .object({ configured: z.boolean(), name: z.string().max(120).nullable(), is_allow_list: z.boolean().nullable() })
    .nullable(),
  lines: z
    .array(
      z.object({
        index: z.number().int().min(1),
        query: z.string().max(80),
        quantity: z.number().int().min(1).max(MAX_QUANTITY).nullable(),
        status: z.enum(LINE_RESOLUTION),
        selected_product_id: uuid.nullable(),
        candidates: z.array(productCandidateSchema).max(5),
      }),
    )
    .max(MAX_DRAFT_LINES),
})
export type DraftResolution = z.infer<typeof draftResolutionSchema>

/** `data` del borrador: la INTERPRETACIÓN IA, ya revisada por el servidor. */
export const draftInterpretationSchema = z.object({
  customer_query: z.string().max(80).nullable(),
  lines: z
    .array(z.object({ query: z.string().min(1).max(80), quantity: z.number().int().min(1).max(MAX_QUANTITY).nullable() }))
    .max(MAX_DRAFT_LINES),
  validity_days: z.number().int().min(1).max(365).nullable(),
  notes: z.string().max(300),
  summary: z.string().max(300),
  unresolved: z.array(z.string().min(1).max(160)).max(5),
  price_requested: z.boolean(),
  discarded: z.number().int().min(0).max(100),
  // Un borrador que no se declara borrador no se pinta.
  draft: z.literal(true),
})
export type DraftInterpretation = z.infer<typeof draftInterpretationSchema>

export interface QuoteDraftResponse {
  readonly result: AiResult<DraftInterpretation>
  readonly system: DraftResolution | null
}

function resolutionOf(env: Record<string, unknown> | null): DraftResolution | null {
  const parsed = draftResolutionSchema.safeParse(env?.system)
  return parsed.success ? parsed.data : null
}

/** Interpretar la instrucción. Gasta una consulta. No precia ni guarda. */
export async function requestQuoteDraft(input: {
  storeId: string
  instruction: string
  customerId?: string | null
  locale: Locale
}): Promise<QuoteDraftResponse> {
  const env = await invokeAi(QUOTES_ASSISTANT_FUNCTION, {
    mode: 'draft',
    store_id: input.storeId,
    instruction: input.instruction.trim().slice(0, MAX_INSTRUCTION),
    locale: input.locale,
    ...(input.customerId ? { customer_id: input.customerId } : {}),
  })
  return { result: parseAiResult(draftInterpretationSchema, env), system: resolutionOf(env) }
}

// ---------------------------------------------------------------------------
// Precio del sistema y guardado
// ---------------------------------------------------------------------------

export interface DraftLineInput {
  readonly product_id: string
  readonly variant_id: string | null
  readonly quantity: number
}

export const draftPreviewSchema = z.object({
  generated_at: z.string().nullable(),
  customer: z.object({ customer_id: uuid, code: z.string().max(40).nullable(), name: z.string().max(80) }).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  tax_inclusive: z.boolean(),
  lines: z
    .array(
      z.object({
        index: z.number().int().min(1),
        product_id: uuid,
        variant_id: uuid.nullable(),
        quantity: z.number().int().min(1),
        sku: z.string().max(64).nullable(),
        name: z.string().max(120).nullable(),
        variant_name: z.string().max(160).nullable(),
        in_assortment: z.boolean().nullable(),
        blocked: z.enum(DRAFT_LINE_BLOCKS).nullable(),
        unit_price: money.nullable(),
        compare_at_price: money.nullable(),
        tax_rate: money.nullable(),
        tax_amount: money.nullable(),
        line_total: money.nullable(),
        price_source: z.string().max(40).nullable(),
        price_list_code: z.string().max(60).nullable(),
        availability: z
          .object({
            available: z.union([z.number(), z.string()]).nullable(),
            unknown: z.boolean(),
            backorder: z.boolean(),
            in_stock: z.boolean(),
          })
          .nullable(),
      }),
    )
    .max(50),
  blocked: z.number().int().min(0),
  pricing_error: z.string().max(40).nullable(),
  subtotal: money.nullable(),
  tax_total: money.nullable(),
  grand_total: money.nullable(),
  ready: z.boolean(),
})
export type DraftPreview = z.infer<typeof draftPreviewSchema>
export type DraftPreviewLine = DraftPreview['lines'][number]

function client() {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new TradeError('auth.notConfigured', 'CONFIG_INCOMPLETA')
  return supabase
}

function linesPayload(lines: readonly DraftLineInput[]) {
  return lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity }))
}

/**
 * Lo que el SISTEMA dice del borrador: precio del motor, impuesto por línea,
 * disponibilidad y surtido. Solo lectura; no gasta IA.
 */
export async function previewQuoteDraft(input: {
  storeId: string
  customerId: string
  lines: readonly DraftLineInput[]
}): Promise<DraftPreview | null> {
  const { data, error } = await client().rpc(QUOTE_DRAFT_PREVIEW_RPC, {
    p_store_id: input.storeId,
    p_customer_id: input.customerId,
    p_lines: linesPayload(input.lines),
  })
  if (error) throw tradeErrorFromDb(error)
  if (data === null || data === undefined) return null
  const parsed = draftPreviewSchema.safeParse(data)
  if (!parsed.success) throw new AppError({ boundary: 'trade', code: 'RESPUESTA_INVALIDA' })
  return parsed.data
}

export const createdQuoteSchema = z.object({
  quote_id: uuid,
  quote_number: z.string().min(1).max(60),
  status: z.string(),
  currency: z.string().nullable(),
  grand_total: money.nullable(),
  already_created: z.boolean(),
})
export type CreatedQuote = z.infer<typeof createdQuoteSchema>

/**
 * EJECUTAR tras la confirmación humana. El servidor re-precia: aquí no viaja
 * ni un importe. `requestKey` hace idempotente el doble clic.
 */
export async function createQuoteFromDraft(input: {
  storeId: string
  customerId: string
  quoteNumber: string
  validUntil: string
  notes: string
  lines: readonly DraftLineInput[]
  requestKey: string
}): Promise<CreatedQuote> {
  const { data, error } = await client().rpc(QUOTE_CREATE_FROM_DRAFT_RPC, {
    p_store_id: input.storeId,
    p_customer_id: input.customerId,
    p_quote_number: input.quoteNumber.trim(),
    p_valid_until: input.validUntil,
    p_notes: input.notes.trim() || null,
    p_lines: linesPayload(input.lines),
    p_request_key: input.requestKey,
  })
  if (error) throw tradeErrorFromDb(error)
  const parsed = createdQuoteSchema.safeParse(data)
  if (!parsed.success) throw new AppError({ boundary: 'trade', code: 'RESPUESTA_INVALIDA' })
  return parsed.data
}

// ---------------------------------------------------------------------------
// Surtido: cálculo del sistema + priorización IA
// ---------------------------------------------------------------------------

const entitySchema = z.object({ kind: z.enum(['customer', 'product']), label: z.string().min(1).max(160) })

export const assortmentContextSchema = z.object({
  generated_at: z.string().nullable(),
  metrics: z.record(z.string().max(60), metricSchema),
  entities: z.record(z.string().max(8), entitySchema),
})
export type AssortmentContext = z.infer<typeof assortmentContextSchema>

export const assortmentSystemSchema = assortmentContextSchema.extend({
  customer: z.object({ customer_id: uuid, code: z.string().max(40).nullable(), name: z.string().min(1).max(80) }),
  assortment: z.object({
    configured: z.boolean(),
    name: z.string().max(120).nullable(),
    is_allow_list: z.boolean().nullable(),
  }),
  history: z
    .array(
      z.object({
        ref: z.string().max(8),
        product_id: uuid,
        name: z.string().min(1).max(80),
        orders_365d: z.number().int().min(0),
        days_since_last: z.number().int().nullable(),
        avg_interval_days: z.number().int().nullable(),
      }),
    )
    .max(10),
  candidates: z
    .array(
      z.object({
        ref: z.string().max(8),
        kind: z.enum(SUGGESTION_KINDS),
        product_id: uuid,
        name: z.string().min(1).max(80),
        sku: z.string().max(64).nullable(),
        availability: z.enum(['in_stock', 'unknown']),
        product_kind: z.enum(['simple', 'variant', 'bundle']),
        anchor_ref: z.string().max(8).nullable(),
        category: z.string().max(60).nullable(),
      }),
    )
    .max(15),
  excluded: z.object({ out_of_assortment: z.number().int().min(0), unavailable: z.number().int().min(0) }),
})
export type AssortmentSystem = z.infer<typeof assortmentSystemSchema>
export type AssortmentCandidate = AssortmentSystem['candidates'][number]

export const assortmentSuggestionsSchema = assortmentContextSchema.extend({
  overview: z.string().max(500),
  suggestions: z
    .array(
      z.object({
        ref: z.string().max(8),
        product_id: uuid,
        kind: z.enum(SUGGESTION_KINDS),
        priority: z.enum(SUGGESTION_PRIORITIES),
        reason: z.string().min(1).max(300),
      }),
    )
    .max(8),
  answer: z.string().max(700),
  discarded: z.number().int().min(0).max(100),
})
export type AssortmentSuggestions = z.infer<typeof assortmentSuggestionsSchema>

function assortmentSystemOf(env: Record<string, unknown> | null): AssortmentSystem | null {
  const parsed = assortmentSystemSchema.safeParse(env?.system)
  return parsed.success ? parsed.data : null
}

/** CÁLCULO DEL SISTEMA de las sugerencias. Sin IA y sin cuota. */
export async function fetchAssortmentSignals(input: {
  storeId: string
  customerId: string
  locale: Locale
}): Promise<AssortmentSystem | null> {
  return assortmentSystemOf(
    await invokeAi(QUOTES_ASSISTANT_FUNCTION, {
      mode: 'signals',
      store_id: input.storeId,
      customer_id: input.customerId,
      locale: input.locale,
    }),
  )
}

export interface AssortmentAiResponse {
  readonly result: AiResult<AssortmentSuggestions>
  readonly system: AssortmentSystem | null
}

/** Priorizar con IA. Gasta una consulta (salvo sin candidatos: `vacia`). */
export async function requestAssortmentSuggestions(input: {
  storeId: string
  customerId: string
  locale: Locale
  question?: string | null
}): Promise<AssortmentAiResponse> {
  const question = input.question?.trim().slice(0, MAX_ASSORTMENT_QUESTION) ?? ''
  const env = await invokeAi(QUOTES_ASSISTANT_FUNCTION, {
    mode: 'suggest',
    store_id: input.storeId,
    customer_id: input.customerId,
    locale: input.locale,
    ...(question ? { question } : {}),
  })
  return { result: parseAiResult(assortmentSuggestionsSchema, env), system: assortmentSystemOf(env) }
}

// ---------------------------------------------------------------------------
// Estado del borrador en pantalla (puro, probado sin DOM)
// ---------------------------------------------------------------------------

export interface DraftLineState {
  /** Clave estable de la fila en pantalla. */
  readonly key: string
  /** Lo que escribió la persona (o «sugerencia»). */
  readonly query: string
  readonly status: LineResolution | 'suggested'
  readonly candidates: readonly ProductCandidate[]
  readonly productId: string | null
  readonly variantId: string | null
  /** Texto del campo; se valida al pedir precio. */
  readonly quantity: string
}

/** De la resolución del sistema a filas editables. Nunca elige por la persona. */
export function linesFromResolution(resolution: DraftResolution): DraftLineState[] {
  return resolution.lines.map((l) => {
    const elegido = l.candidates.find((c) => c.product_id === l.selected_product_id) ?? null
    return {
      key: `r${l.index}`,
      query: l.query,
      status: l.status,
      candidates: l.candidates,
      productId: elegido?.product_id ?? null,
      variantId:
        elegido?.kind === 'variant'
          ? (elegido.matched_variant_id ?? (elegido.variants.length === 1 ? elegido.variants[0]!.variant_id : null))
          : null,
      quantity: l.quantity === null ? '' : String(l.quantity),
    }
  })
}

export function parseQuantity(value: string): number | null {
  const t = value.trim()
  if (!/^\d{1,6}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= MAX_QUANTITY ? n : null
}

/**
 * Las filas que se pueden mandar a preciar: producto elegido, variante si la
 * pide y cantidad válida. Las demás esperan a la persona (no se adivinan).
 */
export function readyLines(lines: readonly DraftLineState[]): DraftLineInput[] {
  const salida: DraftLineInput[] = []
  const vistos = new Set<string>()
  for (const l of lines) {
    if (!l.productId) continue
    const cand = l.candidates.find((c) => c.product_id === l.productId)
    if (cand?.kind === 'variant' && !l.variantId) continue
    const quantity = parseQuantity(l.quantity)
    if (quantity === null) continue
    const clave = `${l.productId}:${l.variantId ?? ''}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push({ product_id: l.productId, variant_id: l.variantId, quantity })
  }
  return salida
}

/** Filas que aún necesitan una decisión humana (candidato, variante o cantidad). */
export function pendingLines(lines: readonly DraftLineState[]): number {
  const listas = new Set(readyLines(lines).map((l) => `${l.product_id}:${l.variant_id ?? ''}`))
  return lines.filter((l) => !l.productId || !listas.has(`${l.productId}:${l.variantId ?? ''}`)).length
}

/** Fecha ISO (`YYYY-MM-DD`) a `days` días de `today`. */
export function validUntilFrom(days: number | null, today = new Date()): string {
  const d = new Date(today)
  d.setDate(d.getDate() + (days ?? DEFAULT_VALIDITY_DAYS))
  return d.toISOString().slice(0, 10)
}

/** Clave de idempotencia para el guardado (una por borrador en pantalla). */
export function newRequestKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `ai-quote:${random}`
}
