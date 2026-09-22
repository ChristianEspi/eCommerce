/**
 * Los puertos de medición del pipeline de IA (`_shared/aiPipeline.ts`).
 *
 * Dos variantes, porque hay dos formas legítimas de saber de qué sociedad es
 * la llamada, y ninguna es el body:
 *
 *  - **Backoffice** (`medidorDeUsuario`): el cliente con el JWT del usuario.
 *    `ai_consume` comprueba pertenencia, rol, capacidad, módulo y cuota, y
 *    emite un ticket; `ai_record` solo deja traza canjeando ese ticket, así que
 *    nadie puede fabricar trazas ni inflar tokens desde el navegador.
 *  - **Vitrina** (`medidorDeTienda`): `service_role`, con la sociedad resuelta
 *    en SQL desde el slug de una tienda activa. Solo la Edge Function la usa.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.48.0'
import type { AiFeature, ResultadoCuota } from '../_shared/aiCore.ts'
import type { TrazaIA } from '../_shared/aiPipeline.ts'

type Medidor = {
  consumir(feature: AiFeature): Promise<ResultadoCuota | null>
  registrar(traza: TrazaIA): Promise<string | null>
}

function argumentosTraza(traza: TrazaIA) {
  return {
    p_feature: traza.feature,
    p_status: traza.status,
    p_model: traza.model,
    p_prompt: traza.prompt,
    p_reply: traza.reply,
    p_input_tokens: traza.usage.inputTokens,
    p_output_tokens: traza.usage.outputTokens,
    p_cache_read_tokens: traza.usage.cacheReadTokens,
    p_latency_ms: traza.latencyMs,
    p_error_kind: traza.errorKind,
  }
}

export function medidorDeUsuario(client: SupabaseClient): Medidor {
  return {
    async consumir(feature) {
      const { data, error } = await client.rpc('ai_consume', { p_feature: feature, p_units: 1 })
      // Un error de la base NO se lee como permiso: se trata como sin cuota.
      if (error) return null
      return (data ?? null) as ResultadoCuota | null
    },
    async registrar(traza) {
      const { data, error } = await client.rpc('ai_record', argumentosTraza(traza))
      if (error) return null
      return typeof data === 'string' ? data : null
    },
  }
}

export function medidorDeTienda(servicio: SupabaseClient, storeSlug: string): Medidor {
  return {
    async consumir(feature) {
      const { data, error } = await servicio.rpc('ai_consume_for_store', {
        p_store_slug: storeSlug,
        p_feature: feature,
        p_units: 1,
      })
      if (error) return null
      return (data ?? null) as ResultadoCuota | null
    },
    async registrar(traza) {
      const { data, error } = await servicio.rpc('ai_record_for_store', {
        p_store_slug: storeSlug,
        ...argumentosTraza(traza),
      })
      if (error) return null
      return typeof data === 'string' ? data : null
    },
  }
}
