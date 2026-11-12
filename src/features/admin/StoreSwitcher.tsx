import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Box,
  Button,
  ListItemIcon,
  Menu,
  MenuItem,
  MenuList,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { AppIcon } from '@/shared/ui/AppIcon'
import { R, T } from '@/theme/tokens'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Selector de tienda.
 *
 * Con UNA sola tienda no es un selector: es una etiqueta. Un desplegable
 * deshabilitado de un solo elemento promete una elección que no existe, y el
 * usuario que trabaja siempre en el mismo cliente lo lee como algo roto. Mismo
 * criterio que `CompanySwitcher`, que ya se ocultaba con una sola sociedad.
 *
 * Con varias es un BOTÓN con menú, no un `TextField select`. El campo de
 * formulario con su etiqueta flotante decía «rellena esto», y esto no se
 * rellena: se elige un contexto, y el contexto cambia lo que muestra media
 * aplicación. El menú además deja poner icono, marca de selección y el slug
 * debajo del nombre, que es lo que distingue dos tiendas con nombres parecidos.
 */
export function StoreSwitcher() {
  const { stores, activeStore, setActiveStore } = useTenant()
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  if (stores.length === 0) {
    return (
      <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {t('admin.store.none')}
      </Typography>
    )
  }

  // Una sola tienda: se muestra cuál es, sin fingir que se puede cambiar.
  if (stores.length === 1) {
    return (
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'var(--muted)' }}>
        <StorefrontRoundedIcon sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {activeStore?.name ?? stores[0]?.name}
        </Typography>
      </Stack>
    )
  }

  return (
    <>
      <Button
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={t('admin.store.label')}
        endIcon={<KeyboardArrowDownRoundedIcon />}
        sx={{
          gap: 0.5,
          pl: 0.75,
          pr: 1,
          py: 0.5,
          borderRadius: `${R.md}px`,
          textTransform: 'none',
          color: 'var(--text)',
          bgcolor: 'var(--neutral-soft)',
          '&:hover': { bgcolor: 'color-mix(in srgb, var(--muted) 18%, var(--card))' },
        }}
      >
        <AppIcon tone="accent" size="sm">
          <StorefrontRoundedIcon />
        </AppIcon>
        <Box sx={{ textAlign: 'left', minWidth: 0, ml: 0.5 }}>
          <Typography sx={{ fontSize: T.micro, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', lineHeight: 1.2 }}>
            {t('admin.store.label')}
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2 }}>
            {activeStore?.name ?? '—'}
          </Typography>
        </Box>
      </Button>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 260, borderRadius: `${R.lg}px`, mt: 0.5 } } }}
      >
        <MenuList sx={{ py: 0.5 }}>
          {stores.map((store) => {
            const active = store.id === activeStore?.id
            return (
              <MenuItem
                key={store.id}
                selected={active}
                onClick={() => {
                  setActiveStore(store.id)
                  setAnchor(null)
                }}
                sx={{ gap: 1, py: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 0 }}>
                  <AppIcon tone={active ? 'accent' : 'neutral'} size="sm">
                    <StorefrontRoundedIcon />
                  </AppIcon>
                </ListItemIcon>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{store.name}</Typography>
                  {/* El slug distingue dos tiendas que se llamen parecido. */}
                  <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{store.slug}</Typography>
                </Box>
                {active && <CheckRoundedIcon sx={{ fontSize: 18, color: 'var(--accent-deep)' }} />}
              </MenuItem>
            )
          })}
        </MenuList>
      </Menu>
    </>
  )
}

/**
 * Selector de sociedad. Solo aparece cuando el usuario tiene rol en más de una
 * sociedad de su cuenta; con una, mostrar un desplegable de un elemento sería
 * un adorno. Las opciones salen de las membresías que devolvió la RLS, así que
 * no se puede "elegir" una sociedad a la que no se pertenece.
 */
export function CompanySwitcher() {
  const { companies, memberships, activeCompanyId, setActiveCompany } = useTenant()
  const { t } = useI18n()

  if (companies.length <= 1) return null

  return (
    <SelectField
      size="small"
      value={activeCompanyId ?? ''}
      onChange={(event) => setActiveCompany(event.target.value)}
      label={t('admin.company.label')}
      sx={{ minWidth: 180, '& .MuiInputBase-root': { fontSize: 13, fontWeight: 700 } }}
    >
      {companies.map((companyId) => {
        const membership = memberships.find((item) => item.company_id === companyId)
        return (
          <MenuItem key={companyId} value={companyId}>
            {companyId.slice(0, 8)} · {membership?.role ?? '—'}
          </MenuItem>
        )
      })}
    </SelectField>
  )
}
