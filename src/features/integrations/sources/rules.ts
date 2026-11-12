import type { MessageKey } from '@/shared/i18n/messages'
import type { StatusTone } from '@/shared/ui/StatusChip'
import { isPublicHttpsUrl, type FeedDraft, type RunStatus, type SourceDraft } from './types'

/**
 * Reglas puras de los formularios de fuentes. Avisan ANTES de guardar con lo
 * mismo que la base comprueba al guardar (CHECK y RLS siguen mandando).
 */

/** Qué falta para guardar la fuente; `null` si está lista. */
export function sourceDraftProblem(draft: SourceDraft, hasStoredSecret: boolean): MessageKey | null {
  if (draft.name.trim() === '') return 'integrations.sources.validation.name'
  if (!isPublicHttpsUrl(draft.baseUrl)) return 'integrations.sources.validation.url'
  if (draft.authType === 'api_key' && !/^[A-Za-z][A-Za-z0-9-]{1,60}$/.test(draft.authHeader.trim())) {
    return 'integrations.sources.validation.header'
  }
  if ((draft.authType === 'basic' || draft.authType === 'oauth2') && draft.authUsername.trim() === '') {
    return 'integrations.sources.validation.username'
  }
  if (draft.authType === 'oauth2' && !isPublicHttpsUrl(draft.oauthTokenUrl)) {
    return 'integrations.sources.validation.tokenUrl'
  }
  if (draft.authType !== 'none' && !hasStoredSecret && draft.secret.trim() === '') {
    return 'integrations.sources.validation.secret'
  }
  return null
}

/** Qué falta para guardar el flujo; `null` si está listo. */
export function feedDraftProblem(draft: FeedDraft): MessageKey | null {
  if (!/^\/?[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,299}$/.test(draft.path.trim())) {
    return 'integrations.sources.validation.path'
  }
  if (draft.resource === 'prices' && !draft.priceListId) return 'integrations.sources.validation.priceList'
  return null
}

export const RUN_TONE: Record<RunStatus, StatusTone> = {
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'error',
}
