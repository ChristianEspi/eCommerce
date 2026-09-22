import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { AiResult } from '@/features/ai/result'
import type { CopilotAnswer, CopilotEntity, CopilotEntityType } from './copilot'

/**
 * Estado del Copilot en el backoffice: si el panel está abierto, qué entidad
 * tiene la persona abierta en pantalla (pedido, producto, cliente) y la
 * conversación. Vive por encima del contenido para que un cajón de detalle
 * pueda declarar su entidad y para que la conversación sobreviva a cerrar el
 * panel. Se reinicia al cambiar de sociedad (el proveedor lleva `key`).
 */
export type CopilotMessage =
  | { readonly id: number; readonly role: 'user'; readonly text: string }
  | {
      readonly id: number
      readonly role: 'assistant'
      readonly question: string
      readonly result: AiResult<CopilotAnswer> | null
      /** Falló la llamada (red, sesión): se ofrece reintentar. */
      readonly failed: boolean
    }

export interface CopilotContextValue {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly entity: CopilotEntity | null
  readonly setEntity: Dispatch<SetStateAction<CopilotEntity | null>>
  readonly messages: readonly CopilotMessage[]
  readonly pending: boolean
  readonly send: (question: string) => void
  readonly reset: () => void
}

export const CopilotCtx = createContext<CopilotContextValue | null>(null)

/** `null` fuera del backoffice (tests de un cajón suelto, vitrina). */
export function useCopilot(): CopilotContextValue | null {
  return useContext(CopilotCtx)
}

/**
 * Declara la entidad que la pantalla tiene abierta mientras `id` no sea
 * `null`. El Copilot la manda como contexto (tipo + id); el servidor la vuelve
 * a filtrar con la RLS de la herramienta que la use, así que declarar un id
 * ajeno no abre nada.
 */
export function useCopilotEntity(type: CopilotEntityType, id: string | null | undefined): void {
  const setEntity = useContext(CopilotCtx)?.setEntity
  useEffect(() => {
    if (!setEntity || !id) return
    setEntity({ type, id })
    return () => setEntity((actual) => (actual && actual.type === type && actual.id === id ? null : actual))
  }, [setEntity, type, id])
}
