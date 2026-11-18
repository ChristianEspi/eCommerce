import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Alert, Box, Button, IconButton, MenuItem, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { SOCIAL_NETWORKS, type SocialNetwork } from '@/features/storefront/identity'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'
import { helpContactSchemaFor, useHelpContact, useSaveHelpContact, type HelpContact } from './helpContact'
import { SelectField } from '@/shared/ui/SelectField'
import { Field } from '@/shared/ui/Field'

const VACIO: HelpContact = {
  legal_name: '',
  tax_id: '',
  whatsapp_phone: '',
  help_note: '',
  business_hours: '',
  social_links: [],
}

const NOMBRE_RED: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
}

/**
 * Atención al cliente y datos legales (2026-10-02): razón social, RUC, WhatsApp,
 * nota de atención, horario y redes. Lo pinta el pie de la vitrina y la hoja
 * del Libro de Reclamaciones.
 */
export function HelpContactSection({ storeId, canManage }: { storeId: string | null; canManage: boolean }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const actual = useHelpContact(storeId)
  const guardar = useSaveHelpContact(storeId)
  const [v, setV] = useState<HelpContact>(VACIO)

  useEffect(() => {
    if (actual.data) setV(actual.data)
  }, [actual.data])

  // Esta sección se guarda con SU botón, no con el «Guardar» de la página. Si
  // alguien edita el RUC y pulsa el de abajo, el aviso «Configuración guardada»
  // le hacía creer que también se guardó esto. Ahora se avisa en la propia
  // sección y el navegador pregunta antes de salir con cambios pendientes.
  const pendiente = JSON.stringify(v) !== JSON.stringify(actual.data ?? VACIO)
  useEffect(() => {
    if (!pendiente) return
    const aviso = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [pendiente])

  if (actual.isPending) return <LoadingState />

  const check = helpContactSchemaFor(actual.data?.tax_id).safeParse(v)
  const malo = (campo: keyof HelpContact) =>
    !check.success && check.error.issues.some((issue) => issue.path[0] === campo)
  const libres = SOCIAL_NETWORKS.filter((n) => !v.social_links.some((l) => l.network === n))
  const set = <K extends keyof HelpContact>(campo: K, valor: HelpContact[K]) => setV((prev) => ({ ...prev, [campo]: valor }))

  return (
    <Stack sx={{ gap: 2.5 }}>
      {/* Una sola columna de ancho cómodo (sin `Grid`: sus márgenes negativos
          se comían el borde de la tarjeta). Se lee de arriba abajo, en el orden
          en que aparece en el pie y en el Libro de Reclamaciones. */}
      <Stack sx={{ gap: 2, maxWidth: 640 }}>
        <Field fullWidth rule="text" maxLength={160} help={t('help.admin.contact.legalName')} label={t('settings.help.legalName')} value={v.legal_name} onChange={(e) => set('legal_name', e.target.value)} error={malo('legal_name')} disabled={!canManage} />
        <Field fullWidth rule="ruc" help={t('field.help.ruc')} label={t('settings.help.taxId')} value={v.tax_id} onChange={(e) => set('tax_id', e.target.value)} error={malo('tax_id')} helperText={malo('tax_id') ? t('field.error.ruc') : undefined} disabled={!canManage} />
        <Field fullWidth rule="phone" help={t('help.admin.contact.whatsapp')} label={t('settings.help.whatsapp')} placeholder="+51 900 000 001" value={v.whatsapp_phone} onChange={(e) => set('whatsapp_phone', e.target.value)} error={malo('whatsapp_phone')} disabled={!canManage} />
        <Field fullWidth rule="text" maxLength={160} help={t('help.admin.contact.note')} label={t('settings.help.note')} placeholder={t('settings.help.notePlaceholder')} value={v.help_note} onChange={(e) => set('help_note', e.target.value)} error={malo('help_note')} disabled={!canManage} />
        <Field fullWidth multiline minRows={3} rule="longText" maxLength={240} label={t('settings.help.hours')} placeholder={t('settings.help.hoursPlaceholder')} value={v.business_hours} onChange={(e) => set('business_hours', e.target.value)} error={malo('business_hours')} disabled={!canManage} />
      </Stack>

      <Box sx={{ maxWidth: 640 }}>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>{t('settings.help.social')}</Typography>
        <Stack sx={{ gap: 1.25 }}>
          {v.social_links.map((link, i) => (
            <Stack key={link.network} direction="row" sx={{ gap: 1, alignItems: 'center' }}>
              <SelectField size="small" sx={{ width: 160 }} value={link.network} disabled={!canManage}
                onChange={(e) => set('social_links', v.social_links.map((l, j) => (j === i ? { ...l, network: e.target.value as SocialNetwork } : l)))}>
                {[link.network, ...libres].map((n) => (
                  <MenuItem key={n} value={n}>{NOMBRE_RED[n]}</MenuItem>
                ))}
              </SelectField>
              <Field size="small" fullWidth rule="url" maxLength={300} help={t('help.admin.contact.socialUrl')} placeholder="https://" value={link.url} disabled={!canManage}
                error={!/^https:\/\/\S+$/.test(link.url)}
                onChange={(e) => set('social_links', v.social_links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))} />
              <IconButton aria-label={`${t('settings.help.removeSocial')} ${NOMBRE_RED[link.network]}`} disabled={!canManage}
                onClick={() => set('social_links', v.social_links.filter((_, j) => j !== i))}>
                <DeleteOutlineRoundedIcon />
              </IconButton>
            </Stack>
          ))}
          {libres.length > 0 && v.social_links.length < 6 ? (
            <Button startIcon={<AddRoundedIcon />} sx={{ alignSelf: 'flex-start' }} disabled={!canManage}
              onClick={() => set('social_links', [...v.social_links, { network: libres[0] as SocialNetwork, url: 'https://' }])}>
              {t('settings.help.addSocial')}
            </Button>
          ) : null}
        </Stack>
      </Box>

      {guardar.isError ? <Alert severity="error">{t('settings.help.error')}</Alert> : null}
      {pendiente && canManage ? <Alert severity="warning">{t('settings.help.unsaved')}</Alert> : null}

      {canManage ? (
        <Button variant="contained" sx={{ alignSelf: 'flex-start' }} disabled={!check.success || guardar.isPending}
          onClick={() => guardar.mutate(v, { onSuccess: () => notify(t('settings.help.saved')) })}>
          {t('settings.help.save')}
        </Button>
      ) : null}
    </Stack>
  )
}
