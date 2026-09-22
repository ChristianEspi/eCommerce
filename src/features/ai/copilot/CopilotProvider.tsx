import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { plainAnalystText } from '@/features/admin/dashboard/aiAnalyst'
import { aiEntitlementKey } from '@/features/ai/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { Locale } from '@/shared/i18n/messages'
import {
  COPILOT_MAX_QUESTION,
  askCopilot,
  markerContextOf,
  screenFromPath,
  type CopilotEntity,
  type CopilotTurn,
} from './copilot'
import { CopilotCtx, type CopilotContextValue, type CopilotMessage } from './copilot-context'

/** Mensajes que se conservan en pantalla (el historial que viaja es menor). */
const MAX_MESSAGES = 20

function turnsOf(messages: readonly CopilotMessage[], locale: Locale, days: string): CopilotTurn[] {
  const turns: CopilotTurn[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ role: 'user', text: m.text })
      continue
    }
    const data = m.result?.data
    if (!data || data.kind === 'no_data') continue
    // Lo que la persona LEYÓ, con las cifras ya pintadas: el servidor las
    // enmascara antes de pasarlo al modelo (el historial no es fuente).
    turns.push({ role: 'assistant', text: plainAnalystText(data.answer, markerContextOf(data), locale, { days }) })
  }
  return turns
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n()
  const { activeStore } = useTenant()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState<CopilotEntity | null>(null)
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [pending, setPending] = useState(false)
  const seq = useRef(0)
  const busy = useRef(false)

  const storeId = activeStore?.id ?? null
  const screen = screenFromPath(location.pathname)
  const days = t('copilot.days')

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim()
      if (!question || question.length > COPILOT_MAX_QUESTION || busy.current) return
      busy.current = true
      const history = turnsOf(messages, locale, days)
      seq.current += 1
      const userMessage: CopilotMessage = { id: seq.current, role: 'user', text: question }
      setMessages((m) => [...m, userMessage].slice(-MAX_MESSAGES))
      setPending(true)
      const append = (message: Omit<Extract<CopilotMessage, { role: 'assistant' }>, 'id'>) => {
        seq.current += 1
        const id = seq.current
        setMessages((m) => [...m, { ...message, id }].slice(-MAX_MESSAGES))
      }
      askCopilot({ question, locale, storeId, screen, entity, history })
        .then((result) => append({ role: 'assistant', question, result, failed: false }))
        .catch(() => append({ role: 'assistant', question, result: null, failed: true }))
        .finally(() => {
          busy.current = false
          setPending(false)
          // El saldo lo gasta el servidor: se vuelve a leer tras cada pregunta.
          void queryClient.invalidateQueries({ queryKey: aiEntitlementKey() })
        })
    },
    [messages, locale, days, storeId, screen, entity, queryClient],
  )

  const reset = useCallback(() => {
    if (busy.current) return
    setMessages([])
  }, [])

  const value = useMemo<CopilotContextValue>(
    () => ({ open, setOpen, entity, setEntity, messages, pending, send, reset }),
    [open, entity, messages, pending, send, reset],
  )

  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>
}
