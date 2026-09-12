import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded'
import { Badge, Box, Button, IconButton, Popover, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useMarkNotificationsRead, useNotifications } from './api'
import { NotificationList } from './NotificationList'

/**
 * La campanita del backoffice.
 *
 * Enseña los avisos de la SOCIEDAD ACTIVA. Quien trabaja en dos sociedades ve
 * en cada una lo suyo, igual que los pedidos: mezclarlos haría que un aviso de
 * la otra sociedad llevara a un pedido que desde aquí no se puede abrir.
 *
 * El número se corta en «9+». Pasado ese punto lo que importa es que hay
 * bastante, no cuánto exactamente.
 */
export function NotificationBell() {
  const { t } = useI18n()
  const { activeCompanyId } = useTenant()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const notifications = useNotifications('backoffice', activeCompanyId, Boolean(activeCompanyId))
  const markRead = useMarkNotificationsRead('backoffice', activeCompanyId)

  const items = notifications.data ?? []
  const unread = items.filter((item) => item.read_at === null).length

  return (
    <>
      <IconButton
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-label={
          unread > 0
            ? t('notifications.openUnread').replace('{n}', String(unread))
            : t('notifications.open')
        }
      >
        <Badge color="error" badgeContent={unread > 9 ? '9+' : unread} invisible={unread === 0}>
          <NotificationsNoneRoundedIcon fontSize="small" />
        </Badge>
      </IconButton>

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
          sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: '1px solid var(--border)' }}
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
      </Popover>
    </>
  )
}
