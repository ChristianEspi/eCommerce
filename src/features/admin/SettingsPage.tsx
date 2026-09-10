import ContactMailRoundedIcon from '@mui/icons-material/ContactMailRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import DensityMediumRoundedIcon from '@mui/icons-material/DensityMediumRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Grid,
  MenuItem,
  Link as MuiLink,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { CapabilityFeature } from '@/features/capabilities/CapabilityGate'
import { useCapabilities } from '@/features/capabilities/capabilities-context'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionCard } from '@/shared/ui/SectionCard'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { StatusChip } from '@/shared/ui/StatusChip'
import { GhostButton, PrimaryButton } from '@/shared/ui/buttons'
import GroupRoundedIcon from '@mui/icons-material/GroupRounded'
import { useSessionContext } from '@/features/auth/session-context'
import { MembersSection } from './settings/MembersSection'
import { TaxesSection } from './settings/TaxesSection'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState, LoadingState, UnauthorizedState } from '@/shared/ui/states'
import { useAppearance } from '@/theme/appearance-context'
import {
  BRAND_FONTS,
  BRAND_RADII,
  COLOR_MODES,
  DENSITIES,
  R,
  type ColorMode,
  type Density,
} from '@/theme/tokens'
import { SettingsError } from './settings/api'
import { BrandPreview } from './settings/BrandPreview'
import { StoreAssetField } from './settings/StoreAssetField'
import { storeFormSchema, toForm, type StoreFormValues } from './settings/types'
import {
  useAssetUrls,
  useSaveStoreSettings,
  useStoreSettings,
} from './settings/useStoreSettings'

function errorKeyOf(error: unknown): MessageKey {
  return error instanceof SettingsError ? error.key : 'settings.error.generic'
}

/** El mensaje de zod ES la clave de i18n: nunca se enseña texto en un solo idioma. */
function fieldError(message: string | undefined, t: (key: MessageKey) => string): string | undefined {
  return message ? t(message as MessageKey) : undefined
}

/**
 * La etiqueta flotante va SIEMPRE arriba en este formulario.
 *
 * Los campos se rellenan con `values` de react-hook-form, que escribe en el DOM
 * sin pasar por el `onChange` de React; MUI decide si encoge la etiqueta mirando
 * su propio estado, y con ese camino no se entera de que el campo ya tiene
 * texto. El resultado era la etiqueta a media altura ENCIMA del valor —el
 * «Teléfono» montado sobre el número—. Forzarla arriba lo arregla de raíz y
 * además deja los diez campos con el mismo aspecto estén llenos o vacíos.
 */
const SHRINK = { inputLabel: { shrink: true } }

/** Estados (cargando, sin permiso, error) con la misma caja que el formulario. */
function StateCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * Apariencia por usuario: SOLO modo y densidad.
 * No hay selector de paleta — el color es 100% del tenant (contrato §4.4).
 */
function AppearanceSection() {
  const { t } = useI18n()
  const { appearance, setMode, setDensity } = useAppearance()

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" icon={false}>
        {t('admin.settings.appearance.note')}
      </Alert>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<DarkModeRoundedIcon />}
            title={t('admin.settings.appearance.mode')}
            subtitle={t('admin.settings.appearance.modeHelp')}
            padded
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={appearance.mode}
              onChange={(_, next: ColorMode | null) => next && setMode(next)}
              aria-label={t('admin.settings.appearance.mode')}
            >
              {COLOR_MODES.map((mode) => (
                <ToggleButton key={mode} value={mode}>
                  {mode === 'light' ? t('common.theme.light') : t('common.theme.dark')}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<DensityMediumRoundedIcon />}
            title={t('admin.settings.appearance.density')}
            subtitle={t('admin.settings.appearance.densityHelp')}
            padded
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={appearance.density}
              onChange={(_, next: Density | null) => next && setDensity(next)}
              aria-label={t('admin.settings.appearance.density')}
            >
              {DENSITIES.map((density) => (
                <ToggleButton key={density} value={density} sx={{ textTransform: 'none' }}>
                  {t(`appearance.density.${density}` as MessageKey)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </SectionCard>
        </Grid>
      </Grid>
    </Stack>
  )
}

/**
 * Sección que solo el propietario o un administrador pueden tocar. La UI lo
 * oculta y la RLS lo impide: son dos capas del mismo requisito, no una sola
 * repetida (contrato §13, doble enforcement).
 */
function ManagedSection({ children }: { children: ReactNode }) {
  const { can } = useTenant()
  const { t } = useI18n()
  if (!can('store.manage')) {
    return (
      <StateCard>
        <UnauthorizedState description={t('admin.settings.unauthorized')} />
      </StateCard>
    )
  }
  return <>{children}</>
}

/**
 * Personalización de la tienda.
 *
 * Un solo formulario para las dos pestañas de contenido (General y Marca) y una
 * sola barra de Guardar persistente: la regla de suite es tabs centrados +
 * barra sticky, no un botón por pestaña que deje cambios sin guardar al cambiar
 * de sección.
 *
 * Todo lo que se edita aquí lo lee la vitrina de `public_stores`, así que el
 * cambio se ve en `/s/:slug` en cuanto react-query revalida.
 *
 * ## Por qué el formulario está en tarjetas y en rejilla
 *
 * Era una columna de diez campos a todo lo ancho, uno debajo de otro y sin más
 * separación que el aire: para saber qué tenía delante había que leerse las diez
 * etiquetas, y un campo de teléfono de mil cuatrocientos píxeles no ayuda a
 * escribir nueve dígitos. Ahora cada grupo —identidad, contacto, color,
 * imágenes, estilo, correo— es una tarjeta con su rótulo y su icono, y dentro de
 * cada una los campos ocupan el ancho que pide su contenido. La pantalla se
 * recorre saltando de rótulo en rótulo y el ojo sabe siempre en qué bloque está.
 */
export function SettingsPage() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, activeCompanyId, tenant, status: tenantStatus, can } = useTenant()
  // Para no ofrecerle a nadie quitarse el acceso a sí mismo: la base lo
  // rechazaría igual, pero un botón que va a fallar es un botón que miente.
  const { session } = useSessionContext()
  const canManage = can('store.manage')
  // Dos ejes distintos: `can` es el ROL y `has` es lo que la sociedad CONTRATÓ.
  // Hacen falta los dos, y la base los vuelve a comprobar por separado.
  const { has } = useCapabilities()
  const canWhiteLabel = has('content.white_label')

  const storeId = activeStore?.id ?? null
  const settings = useStoreSettings(canManage ? storeId : null)
  const save = useSaveStoreSettings()

  // `values` reconstruye el formulario cuando llega la fila de la base. Se
  // memoriza para no rearmar el objeto en cada tecla.
  const values = useMemo(
    () => toForm(activeStore?.name ?? '', settings.data ?? null),
    [activeStore?.name, settings.data],
  )

  const form = useForm<StoreFormValues>({ resolver: zodResolver(storeFormSchema), values })

  const logo = form.watch('logo_url')
  const banner = form.watch('banner_url')
  const favicon = form.watch('favicon_url')
  const assetUrls = useAssetUrls([logo, banner, favicon])

  // Lo que pinta la muestra de marca. Se mira con `watch` para que reaccione a
  // cada tecla: una vista previa que solo se entera al guardar no es una vista
  // previa, es una confirmación.
  const previewName = form.watch('name')
  const previewAccent = form.watch('accent_color')
  const previewRadius = form.watch('ui_radius')
  const previewFont = form.watch('font_family')

  async function onSubmit(values: StoreFormValues) {
    if (!storeId || !activeCompanyId || !tenant) return
    try {
      await save.mutateAsync({
        storeId,
        organizationId: tenant.organization_id,
        companyId: activeCompanyId,
        currentName: activeStore?.name ?? '',
        values,
        canWhiteLabel,
      })
      notify(t('settings.toast.saved'))
      form.reset(values)
    } catch (error) {
      notify(t(errorKeyOf(error)), 'error')
    }
  }

  const busy = save.isPending || form.formState.isSubmitting
  const storeUrl = activeStore ? `/s/${activeStore.slug}` : null

  /**
   * Estado previo al formulario, calculado UNA vez.
   *
   * A propósito no es un componente envolvente: un componente definido dentro
   * del render se recrea en cada tecla y React remonta su árbol — el campo
   * perdería el foco a la primera letra.
   */
  const gate: ReactNode | null =
    tenantStatus === 'loading' ? (
      <StateCard>
        <LoadingState />
      </StateCard>
    ) : !storeId ? (
      <StateCard>
        <EmptyState title={t('admin.store.none')} description={t('admin.store.noneBody')} />
      </StateCard>
    ) : settings.isError ? (
      <StateCard>
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </StateCard>
    ) : settings.isPending ? (
      <StateCard>
        <LoadingState />
      </StateCard>
    ) : null

  return (
    <Box component="form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <PageHeader
        icon={<SettingsRoundedIcon />}
        title={t('admin.settings.title')}
        subtitle={activeStore?.name}
        actions={
          storeUrl && (
            <Button
              component={MuiLink}
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              variant="outlined"
              endIcon={<LaunchRoundedIcon fontSize="small" />}
            >
              {t('settings.viewStore')}
            </Button>
          )
        }
      />
      <SectionTabs
        ariaLabel={t('admin.settings.title')}
        items={[
          {
            id: 'general',
            label: t('admin.settings.tab.general'),
            content: (
              <ManagedSection>
                {gate ?? (
                  <Stack spacing={2.5}>
                    <SectionCard
                      icon={<StorefrontRoundedIcon />}
                      title={t('settings.section.identity')}
                      subtitle={t('settings.section.identityHelp')}
                      padded
                    >
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={5}>
                          <TextField
                            fullWidth
                            slotProps={SHRINK}
                            label={t('settings.name')}
                            helperText={
                              fieldError(form.formState.errors.name?.message, t) ??
                              t('settings.nameHelp')
                            }
                            error={Boolean(form.formState.errors.name)}
                            disabled={busy}
                            inputProps={{ maxLength: 200 }}
                            {...form.register('name')}
                          />
                        </Grid>
                        <Grid item xs={12} md={7}>
                          <TextField
                            fullWidth
                            slotProps={SHRINK}
                            label={t('settings.description')}
                            helperText={
                              fieldError(form.formState.errors.hero_subtitle?.message, t) ??
                              t('settings.descriptionHelp')
                            }
                            error={Boolean(form.formState.errors.hero_subtitle)}
                            disabled={busy}
                            multiline
                            minRows={2}
                            inputProps={{ maxLength: 240 }}
                            {...form.register('hero_subtitle')}
                          />
                        </Grid>
                      </Grid>
                    </SectionCard>

                    <SectionCard
                      icon={<ContactMailRoundedIcon />}
                      title={t('settings.contact')}
                      subtitle={t('settings.section.contactHelp')}
                      padded
                    >
                      {/* Tres campos en una fila y con el ancho que pide cada
                          uno: un teléfono no necesita el ancho de una dirección,
                          y darle el mismo hace pensar que cabe algo más. */}
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={4}>
                          <TextField
                            fullWidth
                            slotProps={SHRINK}
                            label={t('settings.contactEmail')}
                            type="email"
                            helperText={fieldError(form.formState.errors.support_email?.message, t)}
                            error={Boolean(form.formState.errors.support_email)}
                            disabled={busy}
                            inputProps={{ maxLength: 320 }}
                            {...form.register('support_email')}
                          />
                        </Grid>
                        <Grid item xs={12} md={3}>
                          <TextField
                            fullWidth
                            slotProps={SHRINK}
                            label={t('settings.contactPhone')}
                            helperText={fieldError(form.formState.errors.contact_phone?.message, t)}
                            error={Boolean(form.formState.errors.contact_phone)}
                            disabled={busy}
                            inputProps={{ maxLength: 40 }}
                            {...form.register('contact_phone')}
                          />
                        </Grid>
                        <Grid item xs={12} md={5}>
                          <TextField
                            fullWidth
                            slotProps={SHRINK}
                            label={t('settings.contactAddress')}
                            helperText={fieldError(form.formState.errors.contact_address?.message, t)}
                            error={Boolean(form.formState.errors.contact_address)}
                            disabled={busy}
                            inputProps={{ maxLength: 240 }}
                            {...form.register('contact_address')}
                          />
                        </Grid>
                      </Grid>
                    </SectionCard>

                    {/* P18 · Quién puede comprar.
                        Va en General y no en Marca porque no es apariencia: es
                        una regla de negocio del comercio, del mismo orden que
                        el impuesto. Y va con su explicación al lado porque
                        encenderla cambia quién puede pagar — no es la clase de
                        interruptor que se descubre por el nombre. */}
                    <SectionCard
                      icon={<LockRoundedIcon />}
                      title={t('settings.section.checkout')}
                      subtitle={t('settings.section.checkoutHelp')}
                      padded
                    >
                      <Controller
                        control={form.control}
                        name="checkout_requires_account"
                        render={({ field }) => (
                          <FormControlLabel
                            control={
                              <Switch
                                checked={field.value}
                                disabled={busy}
                                onChange={(event) => field.onChange(event.target.checked)}
                              />
                            }
                            label={t('settings.checkoutRequiresAccount')}
                          />
                        )}
                      />
                      <Typography sx={{ color: 'var(--muted)', fontSize: 13, mt: 0.5 }}>
                        {t('settings.checkoutRequiresAccountHelp')}
                      </Typography>

                      {/* P19 · La otra regla del mismo orden: no soltar la
                          mercancía sin haber cobrado. Va apagada porque vender a
                          crédito es despachar hoy y cobrar a treinta días, y
                          encenderla para todos habría roto esa operación. */}
                      <Controller
                        control={form.control}
                        name="require_payment_before_dispatch"
                        render={({ field }) => (
                          <FormControlLabel
                            sx={{ mt: 1.5 }}
                            control={
                              <Switch
                                checked={field.value}
                                disabled={busy}
                                onChange={(event) => field.onChange(event.target.checked)}
                              />
                            }
                            label={t('settings.requirePaymentBeforeDispatch')}
                          />
                        )}
                      />
                      <Typography sx={{ color: 'var(--muted)', fontSize: 13, mt: 0.5 }}>
                        {t('settings.requirePaymentBeforeDispatchHelp')}
                      </Typography>
                    </SectionCard>
                  </Stack>
                )}
              </ManagedSection>
            ),
          },
          {
            id: 'branding',
            label: t('admin.settings.tab.branding'),
            content: (
              <ManagedSection>
                {gate ?? (
                  <Stack spacing={2.5}>
                    <SectionCard
                      icon={<PaletteRoundedIcon />}
                      title={t('settings.accent')}
                      subtitle={t('settings.section.colorHelp')}
                      padded
                    >
                      <Grid container spacing={2.5} sx={{ alignItems: 'flex-start' }}>
                        <Grid item xs={12} md={5}>
                          <Controller
                            control={form.control}
                            name="accent_color"
                            render={({ field, fieldState }) => (
                              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                                <Box
                                  component="input"
                                  type="color"
                                  aria-label={t('settings.accent')}
                                  value={field.value}
                                  disabled={busy}
                                  onChange={(event) => field.onChange(event.target.value)}
                                  sx={{
                                    width: 52,
                                    height: 40,
                                    p: 0,
                                    flexShrink: 0,
                                    border: '1px solid var(--border)',
                                    borderRadius: `${R.sm}px`,
                                    background: 'none',
                                    cursor: 'pointer',
                                  }}
                                />
                                <TextField
                                  fullWidth
                                  size="small"
                                  value={field.value}
                                  onChange={(event) => field.onChange(event.target.value)}
                                  disabled={busy}
                                  error={Boolean(fieldState.error)}
                                  helperText={
                                    fieldError(fieldState.error?.message, t) ??
                                    t('settings.accentHelp')
                                  }
                                  inputProps={{ maxLength: 7, 'aria-label': t('settings.accentHex') }}
                                />
                              </Stack>
                            )}
                          />
                        </Grid>
                        <Grid item xs={12} md={7}>
                          <BrandPreview
                            color={previewAccent}
                            radius={previewRadius}
                            font={previewFont}
                            storeName={previewName}
                          />
                        </Grid>
                      </Grid>
                    </SectionCard>

                    <SectionCard
                      icon={<PhotoLibraryRoundedIcon />}
                      title={t('settings.section.images')}
                      subtitle={t('settings.section.imagesHelp')}
                      padded
                    >
                      {/* Los tres huecos en una fila y a la misma altura: son
                          tres piezas de la misma decisión, y apiladas obligaban
                          a hacer scroll para comparar el logo con el favicon. */}
                      <Grid container spacing={2.5} sx={{ alignItems: 'stretch' }}>
                        <Grid item xs={12} sm={6} md={3}>
                          <Controller
                            control={form.control}
                            name="logo_url"
                            render={({ field }) => (
                              <StoreAssetField
                                kind="logo"
                                ratio="1 / 1"
                                label={t('settings.logo')}
                                help={t('settings.logoHelp')}
                                value={field.value}
                                previewUrl={field.value ? (assetUrls[field.value] ?? null) : null}
                                disabled={busy}
                                organizationId={tenant?.organization_id ?? ''}
                                storeId={storeId ?? ''}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6} md={6}>
                          <Controller
                            control={form.control}
                            name="banner_url"
                            render={({ field }) => (
                              <StoreAssetField
                                kind="banner"
                                ratio="16 / 6"
                                label={t('settings.banner')}
                                help={t('settings.bannerHelp')}
                                value={field.value}
                                previewUrl={field.value ? (assetUrls[field.value] ?? null) : null}
                                disabled={busy}
                                organizationId={tenant?.organization_id ?? ''}
                                storeId={storeId ?? ''}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                          <Controller
                            control={form.control}
                            name="favicon_url"
                            render={({ field }) => (
                              <StoreAssetField
                                kind="favicon"
                                ratio="1 / 1"
                                label={t('settings.favicon')}
                                help={t('settings.faviconHelp')}
                                value={field.value}
                                previewUrl={field.value ? (assetUrls[field.value] ?? null) : null}
                                disabled={busy}
                                organizationId={tenant?.organization_id ?? ''}
                                storeId={storeId ?? ''}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </Grid>
                      </Grid>
                    </SectionCard>

                    {/* Radio y densidad: tematización, NO addon. El lockup de la
                        suite sigue puesto, así que cobrar por elegir esquinas
                        redondeadas sería vender una casilla en vez de una
                        capacidad. La raya del premium está escrita en la
                        migración 20260828140200. */}
                    <SectionCard
                      icon={<TuneRoundedIcon />}
                      title={t('settings.section.style')}
                      subtitle={t('settings.section.styleHelp')}
                      padded
                    >
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={4}>
                          <Controller
                            control={form.control}
                            name="ui_radius"
                            render={({ field }) => (
                              <TextField
                                select
                                fullWidth
                                slotProps={SHRINK}
                                label={t('settings.radius')}
                                helperText={t('settings.radiusHelp')}
                                value={field.value}
                                disabled={busy}
                                onChange={(event) => field.onChange(event.target.value)}
                              >
                                <MenuItem value="">{t('settings.tokenDefault')}</MenuItem>
                                {BRAND_RADII.map((value) => (
                                  <MenuItem key={value} value={value}>
                                    {t(`settings.radius.${value}` as MessageKey)}
                                  </MenuItem>
                                ))}
                              </TextField>
                            )}
                          />
                        </Grid>

                        <Grid item xs={12} md={4}>
                          <Controller
                            control={form.control}
                            name="ui_density"
                            render={({ field }) => (
                              <TextField
                                select
                                fullWidth
                                slotProps={SHRINK}
                                label={t('settings.density')}
                                helperText={t('settings.densityHelp')}
                                value={field.value}
                                disabled={busy}
                                onChange={(event) => field.onChange(event.target.value)}
                              >
                                <MenuItem value="">{t('settings.tokenDefault')}</MenuItem>
                                {DENSITIES.map((value) => (
                                  <MenuItem key={value} value={value}>
                                    {t(`appearance.density.${value}` as MessageKey)}
                                  </MenuItem>
                                ))}
                              </TextField>
                            )}
                          />
                        </Grid>

                        {/* Tipografía: PREMIUM. Es de las que hacen que la
                            tienda deje de parecer de la suite. */}
                        <CapabilityFeature capability="content.white_label">
                          <Grid item xs={12} md={4}>
                            <Controller
                              control={form.control}
                              name="font_family"
                              render={({ field }) => (
                                <TextField
                                  select
                                  fullWidth
                                  slotProps={SHRINK}
                                  label={t('settings.font')}
                                  helperText={t('settings.fontHelp')}
                                  value={field.value}
                                  disabled={busy}
                                  onChange={(event) => field.onChange(event.target.value)}
                                >
                                  <MenuItem value="">{t('settings.tokenDefault')}</MenuItem>
                                  {BRAND_FONTS.map((value) => (
                                    <MenuItem key={value} value={value}>
                                      {t(`settings.font.${value}` as MessageKey)}
                                    </MenuItem>
                                  ))}
                                </TextField>
                              )}
                            />
                          </Grid>
                        </CapabilityFeature>
                      </Grid>
                    </SectionCard>

                    <SectionCard
                      icon={<MailOutlineRoundedIcon />}
                      title={t('settings.section.email')}
                      subtitle={t('settings.section.emailHelp')}
                      padded
                    >
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={4}>
                          <TextField
                            fullWidth
                            slotProps={SHRINK}
                            label={t('settings.businessName')}
                            helperText={t('settings.businessNameHelp')}
                            disabled={busy}
                            {...form.register('business_display_name')}
                          />
                        </Grid>

                        {/* Identidad del correo: PREMIUM, igual que la
                            tipografía. */}
                        <CapabilityFeature capability="content.white_label">
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              slotProps={SHRINK}
                              label={t('settings.emailFromName')}
                              helperText={t('settings.emailFromNameHelp')}
                              disabled={busy}
                              {...form.register('email_from_name')}
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              slotProps={SHRINK}
                              label={t('settings.emailReplyTo')}
                              helperText={
                                fieldError(form.formState.errors.email_reply_to?.message, t) ??
                                t('settings.emailReplyToHelp')
                              }
                              error={Boolean(form.formState.errors.email_reply_to)}
                              disabled={busy}
                              {...form.register('email_reply_to')}
                            />
                          </Grid>
                        </CapabilityFeature>
                      </Grid>
                    </SectionCard>

                    {/* Marca blanca: addon premium de suite (contrato §4.3). Es
                        el primer módulo vendible con superficie real, y está
                        aquí explicado en vez de escondido: un control que
                        desaparece sin dejar rastro es la forma más rápida de que
                        nadie descubra que existe. */}
                    <CapabilityFeature capability="content.white_label">
                      <SectionCard
                        icon={<WorkspacePremiumRoundedIcon />}
                        title={t('settings.whiteLabel')}
                        subtitle={t('settings.whiteLabelHelp')}
                        tone="warning"
                        padded
                      >
                        <Controller
                          control={form.control}
                          name="white_label"
                          render={({ field }) => (
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={field.value}
                                  disabled={busy}
                                  onChange={(event) => field.onChange(event.target.checked)}
                                />
                              }
                              label={t('settings.whiteLabel')}
                            />
                          )}
                        />
                      </SectionCard>
                    </CapabilityFeature>
                  </Stack>
                )}
              </ManagedSection>
            ),
          },
          {
            id: 'users',
            label: t('admin.settings.tab.users'),
            content: (
              <ManagedSection>
                <Card>
                  <CardContent>
                    <SectionCard
                      icon={<GroupRoundedIcon />}
                      title={t('settings.section.users')}
                      subtitle={t('settings.section.usersHelp')}
                      padded
                    >
                      <MembersSection
                        organizationId={tenant?.organization_id ?? null}
                        companyId={activeCompanyId}
                        canManage={canManage}
                        currentUserId={session?.user?.id ?? null}
                      />
                    </SectionCard>
                  </CardContent>
                </Card>
              </ManagedSection>
            ),
          },
          {
            id: 'taxes',
            label: t('admin.settings.tab.taxes'),
            content: (
              <ManagedSection>
                <Card>
                  <CardContent>
                    <TaxesSection
                      organizationId={tenant?.organization_id ?? null}
                      companyId={activeCompanyId}
                      canManage={canManage}
                    />
                  </CardContent>
                </Card>
              </ManagedSection>
            ),
          },
          {
            id: 'appearance',
            label: t('admin.settings.tab.appearance'),
            content: <AppearanceSection />,
          },
        ]}
      />

      {/* Barra de guardar persistente. Va en tarjeta y no como una franja del
          fondo: pegada abajo sobre el mismo gris de la página parecía parte del
          lienzo, y lo que hace es esperar una decisión. */}
      <Box
        sx={{
          display: canManage ? 'flex' : 'none',
          position: 'sticky',
          bottom: 16,
          zIndex: 2,
          mt: 3,
          px: 2,
          py: 1.5,
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 1,
          flexWrap: 'wrap',
          rowGap: 1,
          bgcolor: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: `${R.lg}px`,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {form.formState.isDirty && (
          <Box sx={{ mr: 'auto' }}>
            <StatusChip tone="warning" label={t('settings.unsaved')} />
          </Box>
        )}
        <GhostButton
          type="button"
          disabled={busy || !form.formState.isDirty}
          onClick={() => form.reset()}
        >
          {t('common.cancel')}
        </GhostButton>
        <PrimaryButton type="submit" disabled={busy || !storeId}>
          {t('common.save')}
        </PrimaryButton>
      </Box>
    </Box>
  )
}
