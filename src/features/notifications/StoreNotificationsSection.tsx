import { Button, Card, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useMarkNotificationsRead, useNotifications } from './api'
import { NotificationList } from './NotificationList'

/**
 * Los avisos del comprador en «Tu cuenta».
 *
 * Sin sociedad: el comprador no es miembro de ninguna, y sus avisos pueden
 * venir de la cuenta de su empresa o de un pedido que hizo como visitante con
 * el mismo correo. La RLS ya se los da solo a él.
 */
export function StoreNotificationsSection() {
  const { t } = useI18n()
  const notifications = useNotifications('storefront', null)
  const markRead = useMarkNotificationsRead('storefront', null)

  if (notifications.isPending) return <LoadingState />
  if (notifications.isError) {
    return <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
  }

  const items = notifications.data ?? []
  if (items.length === 0) return <EmptyState title={t('notifications.empty')} />

  const unread = items.some((item) => item.read_at === null)

  return (
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
