import { Button, Card, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useMarkNotificationsRead, useNotifications } from './api'
import { useCartReminderPreference, useSetCartReminderPreference } from './cartRecovery'
import { NotificationList } from './NotificationList'

/**
 * Los avisos del comprador en «Tu cuenta».
 *
 * Sin sociedad: el comprador no es miembro de ninguna, y sus avisos pueden
 * venir de la cuenta de su empresa o de un pedido que hizo como visitante con
 * el mismo correo. La RLS ya se los da solo a él.
 *
 * Debajo, la preferencia de recordatorios de carrito de ESTA tienda (cierre,
 * ítem 8). Solo aparece si la tienda los tiene encendidos: ofrecer apagar algo
 * que no existe es ruido.
 */
export function StoreNotificationsSection() {
  const { t } = useI18n()
  const { storeSlug } = useParams<{ storeSlug: string }>()
  const notifications = useNotifications('storefront', null)
  const markRead = useMarkNotificationsRead('storefront', null)

  let content: ReactNode
  if (notifications.isPending) {
    content = <LoadingState />
  } else if (notifications.isError) {
    content = <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
  } else if ((notifications.data ?? []).length === 0) {
    content = <EmptyState title={t('notifications.empty')} />
  } else {
    const items = notifications.data ?? []
    const unread = items.some((item) => item.read_at === null)
    content = (
      <Stack spacing={1.5}>
        {unread && (
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => markRead.mutate(undefined)} disabled={markRead.isPending}>
              {t('notifications.markAll')}
            </Button>
          </Stack>
        )}
        <Card variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)' }}>
          <NotificationList
            items={items}
            onOpen={(item) => {
              if (item.read_at === null) markRead.mutate([item.id])
            }}
          />
        </Card>
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          {t('notifications.storeHint')}
        </Typography>
      </Stack>
    )
  }

  return (
    <Stack spacing={2.5}>
      {content}
      <CartReminderPreference storeSlug={storeSlug ?? null} />
    </Stack>
  )
}

/** Recibir o no recordatorios de carrito de esta tienda. La persona sale del JWT. */
function CartReminderPreference({ storeSlug }: { storeSlug: string | null }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const preference = useCartReminderPreference(storeSlug, true)
  const update = useSetCartReminderPreference(storeSlug)

  // Sin tienda en la ruta, sin respuesta o con la función apagada, no se enseña
  // nada: la preferencia no es imprescindible para leer los avisos.
  if (!storeSlug || !preference.data || !preference.data.store_enabled) return null

  return (
    <Card variant="outlined" sx={{ borderRadius: 'var(--sf-radius, 12px)', px: 2, py: 1.5 }}>
      <FormControlLabel
        control={
          <Switch
            checked={preference.data.receive}
            disabled={update.isPending}
            onChange={(_, receive) =>
              update.mutate(receive, { onError: () => notify(t('cartRecovery.preferenceError'), 'error') })
            }
          />
        }
        label={t('cartRecovery.preference')}
      />
      <Typography variant="caption" component="p" sx={{ color: 'var(--muted)' }}>
        {t('cartRecovery.preferenceHelp')}
      </Typography>
    </Card>
  )
}