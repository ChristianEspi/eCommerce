import { Box, Button, Popover, Stack, Typography } from '@mui/material'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useMarkNotificationsRead, useNotifications } from './api'
import { NotificationList } from './NotificationList'

/**
 * La campanita del COMPRADOR en la cabecera de la tienda (2026-11-20).
 *
 * Antes los avisos eran una pestaña de «Tu cuenta»: había que entrar a buscarlos.
 * Ahora están donde se ven, con el contador de no leídos, como en el backoffice.
 * Sin sociedad: el comprador no es miembro de ninguna, y la RLS ya le da solo
 * los suyos (de su cuenta de empresa o de pedidos con su correo).
 *
 * El botón lo pinta la cabecera (`renderTrigger`) para que se vea igual que el
 * resto de sus acciones; aquí vive lo que hace.
 */
export function StoreNotificationBell({
  renderTrigger,
}: {
  renderTrigger: (trigger: {
    onClick: (event: MouseEvent<HTMLElement>) => void
    unread: number
    label: string
  }) => ReactNode
}) {
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const notifications = useNotifications('storefront', null)
  const markRead = useMarkNotificationsRead('storefront', null)

  const items = notifications.data ?? []
  const unread = items.filter((item) => item.read_at === null).length

  return (
    <>
      {renderTrigger({
        onClick: (event) => setAnchor(event.currentTarget),
        unread,
        label:
          unread > 0 ? t('notifications.openUnread').replace('{n}', String(unread)) : t('notifications.open'),
      })}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 'min(380px, calc(100vw - 32px))', maxHeight: 480 } } }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1.25,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Typography sx={{ fontWeight: 700 }}>{t('notifications.title')}</Typography>
          {unread > 0 && (
            <Button size="small" onClick={() => markRead.mutate(undefined)} disabled={markRead.isPending}>
              {t('notifications.markAll')}
            </Button>
          )}
        </Stack>
        {items.length === 0 ? (
          <Box sx={{ px: 2, py: 3 }}>
            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
              {notifications.isError ? t('notifications.error') : t('notifications.empty')}
            </Typography>
          </Box>
        ) : (
          <NotificationList
            items={items}
            onOpen={(item) => {
              if (item.read_at === null) markRead.mutate([item.id])
              setAnchor(null)
            }}
          />
        )}
        <Box sx={{ px: 2, py: 1, borderTop: '1px solid var(--border)' }}>
          <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
            {t('notifications.storeHint')}
          </Typography>
        </Box>
      </Popover>
    </>
  )
}
