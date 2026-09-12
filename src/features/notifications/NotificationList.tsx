import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { formatRelative } from '@/shared/lib/format'
import type { AppNotification } from './api'
import { notificationText } from './text'

/**
 * La lista de avisos, compartida por la campanita y por «Tu cuenta».
 *
 * Pulsar un aviso lo marca leído y lleva a su objeto. El enlace es SIEMPRE una
 * ruta interna —la base lo exige con un CHECK—, así que se navega con el router
 * y nunca con `window.location`: un enlace que saliera de la aplicación no
 * podría llegar aquí aunque alguien lo escribiera en la tabla.
 */
export function NotificationList({
  items,
  onOpen,
}: {
  items: AppNotification[]
  onOpen: (notification: AppNotification) => void
}) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()

  return (
    <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((item) => {
        const unread = item.read_at === null
        return (
          <Box component="li" key={item.id} sx={{ borderBottom: '1px solid var(--border)' }}>
            <ButtonBase
              onClick={() => {
                onOpen(item)
                if (item.link && item.link.startsWith('/') && !item.link.startsWith('//')) {
                  navigate(item.link)
                }
              }}
              sx={{
                width: '100%',
                textAlign: 'left',
                alignItems: 'flex-start',
                gap: 1.25,
                px: 2,
                py: 1.5,
                '&:hover': { bgcolor: 'var(--surface-2, rgba(0,0,0,0.04))' },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  mt: 0.75,
                  width: 8,
                  height: 8,
                  flexShrink: 0,
                  borderRadius: '50%',
                  bgcolor: unread ? 'var(--accent)' : 'transparent',
                }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: unread ? 600 : 400 }}>
                  {notificationText(item, t)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                  {formatRelative(item.created_at, locale)}
                  {unread ? ` · ${t('notifications.unread')}` : ''}
                </Typography>
              </Box>
            </ButtonBase>
          </Box>
        )
      })}
    </Stack>
  )
}
