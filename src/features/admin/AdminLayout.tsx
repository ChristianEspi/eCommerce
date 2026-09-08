import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import DensityMediumRoundedIcon from '@mui/icons-material/DensityMediumRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import {
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useSessionContext } from '@/features/auth/session-context'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { RequireTenant } from '@/features/tenant/RequireTenant'
import { useTenant } from '@/features/tenant/tenant-context'
import { R, T } from '@/theme/tokens'
import { GlobalSearch } from '@/features/search/GlobalSearch'
import { AppIcon } from '@/shared/ui/AppIcon'
import { useI18n } from '@/shared/i18n/i18n-context'
import { AppBreadcrumbs } from '@/shared/ui/AppBreadcrumbs'
import { BrandLockup } from '@/shared/ui/BrandLockup'
import { useAppearance } from '@/theme/appearance-context'
import { NAV_ITEMS, crumbsForPath, groupNavItems, visibleNavItems } from './navigation'
import { CompanySwitcher, StoreSwitcher } from './StoreSwitcher'

const SIDEBAR_WIDTH = 244

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  const { tenant, can } = useTenant()
  const { has, status } = useCapabilities()
  // Se calcula aqui y no en el modulo: el menu depende del rol Y de lo que la
  // sociedad tenga contratado, y las dos cosas cambian con el selector.
  const items = visibleNavItems(NAV_ITEMS, {
    can,
    has,
    capabilitiesReady: status === 'ready',
  })
  // Y solo despues se reparte en bloques: agrupar es presentacion, no permiso.
  const sections = groupNavItems(items)

  return (
    <Box
      component="nav"
      aria-label="Backoffice"
      sx={{
        height: '100%',
        background: 'var(--sidebar)',
        color: '#fff',
        px: 2,
        py: 2.5,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* La marca no se mueve: es el ancla de la que cuelga todo lo demas. */}
      <Box sx={{ px: 0.5, mb: 3, flexShrink: 0 }}>
        <BrandLockup variant="white" size={30} />
      </Box>

      {/*
        La LISTA es la que hace scroll, no el panel entero.

        `minHeight: 0` no es decoracion: un hijo de un contenedor flex se niega
        por defecto a encogerse por debajo del alto de su contenido, asi que sin
        el, `overflowY` no llega a activarse nunca y la lista simplemente se sale
        por abajo. Es lo que pasaba al llegar a veintidos modulos: «Configuracion»
        quedaba cortada contra el borde y no habia forma de alcanzarla.

        `overscrollBehavior: contain` evita que al llegar al final del menu el
        gesto siga y arrastre la pagina de detras.
      */}
      <Stack
        spacing={0.5}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          // El anillo de foco y el borde del activo no se recortan contra el
          // area de scroll.
          mx: -0.5,
          px: 0.5,
          py: 0.25,
          // Barra discreta sobre el verde: visible cuando hace falta, sin
          // meter un carril gris del navegador en medio de la marca.
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,.28) transparent',
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,.24)',
            borderRadius: 3,
          },
          '&:hover::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,.36)' },
        }}
      >
        {sections.map((section, indice) => (
          <Box
            key={section.id ?? 'root'}
            // `group` + `aria-labelledby` es lo que convierte la cabecera en
            // ESTRUCTURA: sin eso un lector de pantalla recita veintidos
            // enlaces seguidos y el texto del separador queda suelto en medio,
            // sin decir de que es titulo (WCAG AA).
            {...(section.label
              ? { role: 'group', 'aria-labelledby': `nav-group-${section.id}` }
              : {})}
          >
            {section.label && (
              <Typography
                id={`nav-group-${section.id}`}
                // El primer bloque con cabecera ya viene despues del hueco de
                // Inicio; los siguientes necesitan aire para que la cabecera se
                // lea pegada a LO SUYO y no al bloque anterior.
                sx={{
                  mt: indice === 0 ? 0 : 2,
                  mb: 0.5,
                  px: 1.5,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(237,247,241,.55)',
                }}
              >
                {t(section.label)}
              </Typography>
            )}

            <Stack spacing={0.5}>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className="eb-nav-h"
                  style={({ isActive }) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: 'none',
                    minHeight: 40,
                    color: isActive ? '#fff' : 'rgba(237,247,241,.9)',
                    background: isActive ? 'rgba(255,255,255,.16)' : 'transparent',
                    boxShadow: isActive ? 'inset 0 0 0 1px rgba(255,255,255,.14)' : 'none',
                    borderLeft: isActive ? '3px solid #D6F5C9' : '3px solid transparent',
                  })}
                >
                  {item.icon}
                  {t(item.label)}
                </NavLink>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>

      {/* El nombre del espacio, siempre visible: con un usuario que administra
          más de una cuenta, saber en cuál estás no es un adorno (gmao-038). */}
      {tenant && (
        // Ya no necesita `mt: auto`: la lista se queda con el hueco libre y esto
        // se apoya en el borde de abajo. Y `flexShrink: 0` para que no lo
        // aplaste una lista larga, que es justo lo que hacia antes.
        <Box sx={{ pt: 2.5, px: 0.5, flexShrink: 0 }}>
          <Typography
            sx={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(237,247,241,.6)',
            }}
          >
            {t('admin.tenant.label')}
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{tenant.name}</Typography>
        </Box>
      )}
    </Box>
  )
}

/**
 * Menu de cuenta.
 *
 * Lleva identidad (avatar, correo, sociedad), preferencias e salir. Las
 * preferencias que ofrece son EXACTAMENTE las que el contrato permite al
 * usuario: idioma, modo claro/oscuro y densidad.
 *
 * **No hay selector de paleta, y es deliberado.** El contrato §4.4 dice que el
 * acento es 100 % del tenant (`accent_color` de Branding) y que el usuario
 * elige solo modo y densidad. Un selector de color aqui dejaria que cualquier
 * operario repintara la marca de su empresa desde un menu.
 */
function AccountMenu() {
  const { t, locale, setLocale } = useI18n()
  const { email, role, tenant } = useTenant()
  const { appearance, toggleMode, setDensity } = useAppearance()
  const { signOut } = useSessionContext()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const initial = (email || '?').trim().charAt(0).toUpperCase()

  return (
    <>
      <IconButton onClick={(event) => setAnchor(event.currentTarget)} aria-label={t('admin.account')}>
        <Avatar sx={{ width: 30, height: 30, fontSize: 13, fontWeight: 800, bgcolor: 'var(--accent)', color: '#fff' }}>
          {initial}
        </Avatar>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { width: 300, borderRadius: `${R.lg}px`, mt: 1 } } }}
      >
        {/* Cabecera con la identidad, sobre el degradado de suite. */}
        <Box sx={{ px: 2, py: 2, background: 'var(--sidebar)', color: '#fff' }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ width: 40, height: 40, fontWeight: 800, bgcolor: 'rgba(255,255,255,0.18)', color: '#fff' }}>
              {initial}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, wordBreak: 'break-all' }}>
                {email || '—'}
              </Typography>
              {tenant?.name && (
                <Typography sx={{ fontSize: 11.5, opacity: 0.85 }}>{tenant.name}</Typography>
              )}
            </Box>
          </Stack>
          {role && (
            <Chip
              size="small"
              label={role}
              sx={{ mt: 1.25, fontWeight: 700, bgcolor: 'rgba(255,255,255,0.18)', color: '#fff' }}
            />
          )}
        </Box>

        <Typography
          sx={{
            px: 2, pt: 1.75, pb: 0.75, fontSize: T.micro, fontWeight: 800,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)',
          }}
        >
          {t('admin.account.preferences')}
        </Typography>

        <Stack sx={{ px: 2, pb: 1.5, gap: 1.5 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <AppIcon tone="neutral" size="sm"><LanguageRoundedIcon /></AppIcon>
            <Typography sx={{ fontSize: T.body, fontWeight: 600, flex: 1 }}>
              {t('admin.account.language')}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={locale}
              onChange={(_, next) => next && setLocale(next as typeof locale)}
              aria-label={t('admin.account.language')}
            >
              <ToggleButton value="es" sx={{ px: 1.25, textTransform: 'none' }}>ES</ToggleButton>
              <ToggleButton value="en" sx={{ px: 1.25, textTransform: 'none' }}>EN</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <AppIcon tone="neutral" size="sm">
              {appearance.mode === 'dark' ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
            </AppIcon>
            <Typography sx={{ fontSize: T.body, fontWeight: 600, flex: 1 }}>
              {t('admin.account.mode')}
            </Typography>
            <Switch checked={appearance.mode === 'dark'} onChange={toggleMode} />
          </Stack>

          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <AppIcon tone="neutral" size="sm"><DensityMediumRoundedIcon /></AppIcon>
            <Typography sx={{ fontSize: T.body, fontWeight: 600, flex: 1 }}>
              {t('admin.account.density')}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={appearance.density}
              onChange={(_, next) => next && setDensity(next as typeof appearance.density)}
              aria-label={t('admin.account.density')}
            >
              <ToggleButton value="comoda" sx={{ px: 1, textTransform: 'none' }}>
                {t('appearance.density.comoda')}
              </ToggleButton>
              <ToggleButton value="equilibrada" sx={{ px: 1, textTransform: 'none' }}>
                {t('appearance.density.equilibrada')}
              </ToggleButton>
              <ToggleButton value="compacta" sx={{ px: 1, textTransform: 'none' }}>
                {t('appearance.density.compacta')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null)
            void signOut()
          }}
          sx={{ py: 1.25, gap: 1.25 }}
          // El nombre accesible es la ACCION. Sin esto, el lector anuncia
          // «Cerrar sesionSalir de tu cuenta»: la linea de ayuda es apoyo
          // visual, no parte del nombre del control.
          aria-label={t('nav.signOut')}
        >
          <AppIcon tone="danger" size="sm"><LogoutRoundedIcon /></AppIcon>
          <Box>
            <Typography sx={{ fontSize: T.body, fontWeight: 700, color: 'var(--red)' }}>
              {t('nav.signOut')}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {t('admin.account.signOutHint')}
            </Typography>
          </Box>
        </MenuItem>
      </Menu>
    </>
  )
}

function AdminChrome() {
  const { t } = useI18n()
  const { appearance, toggleMode } = useAppearance()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'var(--bg)' }}>
      {isDesktop ? (
        <Box sx={{ width: SIDEBAR_WIDTH, flexShrink: 0 }}>
          <Box sx={{ position: 'fixed', width: SIDEBAR_WIDTH, height: '100dvh' }}>
            <SidebarContent />
          </Box>
        </Box>
      ) : (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          PaperProps={{ sx: { width: SIDEBAR_WIDTH, border: 0 } }}
        >
          <SidebarContent onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Topbar neutro (tratamiento A del contrato §4.4): la marca vive en el sidebar. */}
        <Toolbar
          sx={{
            bgcolor: 'var(--card)',
            borderBottom: '1px solid var(--border)',
            gap: 1,
            minHeight: { xs: 56, md: 64 },
            py: { xs: 1, md: 0.5 },
          }}
        >
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setDrawerOpen(true)} aria-label={t('admin.openMenu')}>
              <MenuRoundedIcon />
            </IconButton>
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <AppBreadcrumbs
              items={crumbsForPath(location.pathname, t)}
              ariaLabel={t('admin.breadcrumb')}
            />
          </Box>

          <Box sx={{ mr: 1 }}>
            <GlobalSearch />
          </Box>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <CompanySwitcher />
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <StoreSwitcher />
            </Box>
            <IconButton
              onClick={toggleMode}
              aria-label={appearance.mode === 'dark' ? t('common.theme.light') : t('common.theme.dark')}
            >
              {appearance.mode === 'dark' ? (
                <LightModeRoundedIcon fontSize="small" />
              ) : (
                <DarkModeRoundedIcon fontSize="small" />
              )}
            </IconButton>
            <AccountMenu />
          </Stack>
        </Toolbar>

        {/* En móvil los selectores bajan a su propia fila: apretarlos en la
            barra los dejaría ilegibles justo donde menos espacio hay. */}
        <Stack
          direction="row"
          spacing={1}
          sx={{
            display: { xs: 'flex', sm: 'none' },
            px: 2,
            py: 1.5,
            bgcolor: 'var(--card)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <CompanySwitcher />
          <StoreSwitcher />
        </Stack>

        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 4 } }}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Layout del backoffice del tenant. Área separada del storefront: rutas, layout
 * y guards propios, design system compartido.
 *
 * El guard de tenant envuelve al layout completo y no solo al contenido: sin
 * espacio resuelto no hay ni sidebar ni selectores que mostrar, y pintar el
 * chrome vacío mientras se decide es peor que no pintarlo.
 */
export function AdminLayout() {
  return (
    <RequireTenant>
      <AdminChrome />
    </RequireTenant>
  )
}
