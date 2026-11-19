import { z } from 'zod'
import { codeFromDbError } from '@/shared/lib/appError'
import {
  AI_ACTION_DECIDE_RPC,
  AI_ACTION_PROPOSALS_TABLE,
  AI_ACTION_PROPOSE_RPC,
} from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Acciones propuestas por la IA, del lado del navegador (2026-11-19).
 *
 * El navegador NO escribe en la tabla: propone y decide por comandos, y la base
 * valida los datos contra la sociedad (tienda, productos, reseña), el rol de
 * quien propone y de quien aprueba, y ejecuta el comando de siempre al aprobar.
 */

export const AI_ACTION_KINDS = ['promotion.create_draft', 'review.moderate'] as const
export type AiActionKind = (typeof AI_ACTION_KINDS)[number]

export const AI_ACTION_STATUSES = ['pending', 'executed', 'rejected', 'failed', 'expired'] as const
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number]

export const proposalSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid().nullable(),
  kind: z.enum(AI_ACTION_KINDS),
  title: z.string(),
  rationale: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  source_feature: z.string().nullable(),
  status: z.enum(AI_ACTION_STATUSES),
  proposed_by: z.string().uuid(),
  decided_by: z.string().uuid().nullable(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error_code: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
})
export type AiActionProposal = z.infer<typeof proposalSchema>

export class AiActionError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AiActionError'
    this.code = code
  }
}

function client() {
  const c = tryGetSupabaseClient()
  if (!c) throw new AiActionError('CONFIG_INCOMPLETA')
  return c
}

const COLUMNS =
  'id, store_id, kind, title, rationale, payload, source_feature, status, proposed_by, decided_by, decided_at, decision_note, result, error_code, expires_at, created_at'

/** Las propuestas que la RLS deja ver a esta persona (su sociedad y su rol). */
export async function listProposals(): Promise<AiActionProposal[]> {
  const { data, error } = await client()
    .from(AI_ACTION_PROPOSALS_TABLE)
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new AiActionError(codeFromDbError(error))
  return z.array(proposalSchema).parse(data ?? [])
}

export interface ProposeInput {
  readonly kind: AiActionKind
  readonly storeId: string | null
  readonly title: string
  readonly rationale: string | null
  readonly payload: Record<string, unknown>
  readonly sourceFeature: string | null
  readonly interactionId?: string | null
}

export async function proposeAction(input: ProposeInput): Promise<{ id: string }> {
  const { data, error } = await client().rpc(AI_ACTION_PROPOSE_RPC, {
    p_kind: input.kind,
    p_store_id: input.storeId,
    p_title: input.title,
    p_rationale: input.rationale,
    p_payload: input.payload,
    p_source_feature: input.sourceFeature,
    p_interaction_id: input.interactionId ?? null,
  })
  if (error) throw new AiActionError(codeFromDbError(error))
  return z.object({ id: z.string().uuid() }).parse(data)
}

export const decisionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(AI_ACTION_STATUSES),
  error_code: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
})
export type AiActionDecision = z.infer<typeof decisionSchema>

export async function decideAction(input: {
  id: string
  decision: 'approve' | 'reject'
  note?: string | null
}): Promise<AiActionDecision> {
  const { data, error } = await client().rpc(AI_ACTION_DECIDE_RPC, {
    p_id: input.id,
    p_decision: input.decision,
    p_note: input.note ?? null,
  })
  if (error) throw new AiActionError(codeFromDbError(error))
  return decisionSchema.parse(data)
}

/** Búsqueda general de la bandeja: título, motivo y tipo. */
export function matchesProposal(p: AiActionProposal, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [p.title, p.rationale ?? '', p.kind].some((v) => v.toLowerCase().includes(q))
}
