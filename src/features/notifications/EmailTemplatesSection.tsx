import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { Field } from '@/shared/ui/Field'
import { SelectField } from '@/shared/ui/SelectField'
import { useFeedback } from '@/shared/ui/feedback-context'
import { LoadingState } from '@/shared/ui/states'
import {
  defaultCopy,
  EDITABLE_KIND_LIST,
  renderEmail,
  resolveCopyFromParams,
  validateCopy,
  variablesOf,
  type CopyIssue,
  type CustomCopy,
} from './emailCopy'
import { useEmailTemplates, useResetEmailTemplate, useSaveEmailTemplate } from './emailTemplates'

/**
 * Configuración → Correo → Textos de los correos (2026-11-20).
 *
 * El admin de la tienda cambia asunto, título y mensaje de los avisos que
 * recibe el comprador por un pedido. Las variables se insertan con botones y
 * salen de una lista cerrada por aviso; la vista previa usa EL MISMO motor que
 * el envío (`customCopy.ts` + `renderEmail`), con datos de ejemplo.
 *
 * Lo que no se edita, a propósito: el botón, la marca y el pie. Son lo que hace
 * que el correo funcione y se reconozca; el texto es lo que cambia por tienda.
 */

type CopyField = keyof CustomCopy
type Locale = 'es' | 'en'

const KIND_LABEL: Record<string, MessageKey> = {
  'order.confirmed': 'emailTemplates.kind.confirmed',
  'order.approved': 'emailTemplates.kind.approved',
  'order.rejected': 'emailTemplates.kind.rejected',
  'order.shipped': 'emailTemplates.kind.shipped',
}

const LIMITS: Record<CopyField, number> = { subject: 150, title: 120, body: 2000 }

export function EmailTemplatesSection({
  storeId,
  storeName,
  storeSlug,
}: {
  storeId: string | null
  storeName: string
  storeSlug: string
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const templates = useEmailTemplates(storeId)
  const save = useSaveEmailTemplate(storeId)
  const reset = useResetEmailTemplate(storeId)

  const [kind, setKind] = useState<string>(EDITABLE_KIND_LIST[0] as string)
  const [locale, setLocale] = useState<Locale>('es')
  const [draft, setDraft] = useState<CustomCopy>(() => defaultCopy(kind, 'es') as CustomCopy)
  const [confirmReset, setConfirmReset] = useState(false)

  const saved = useMemo(
    () => templates.data?.find((row) => row.kind === kind && row.locale === locale) ?? null,
    [templates.data, kind, locale],
  )
  const base: CustomCopy = useMemo(
    () => (saved ? { subject: saved.subject, title: saved.title, body: saved.body } : (defaultCopy(kind, locale) as CustomCopy)),
    [saved, kind, locale],
  )

  // Al cambiar de aviso o idioma, o al llegar lo guardado, el borrador se reinicia.
  useEffect(() => setDraft(base), [base])

  // Dónde insertar la variable: el último campo con foco y su cursor.
  const refs = {
    subject: useRef<HTMLInputElement | null>(null),
    title: useRef<HTMLInputElement | null>(null),
    body: useRef<HTMLTextAreaElement | null>(null),
  }
  const lastField = useRef<CopyField>('body')

  function insert(variable: string) {
    const field = lastField.current
    const el = refs[field].current
    const token = `{{${variable}}}`
    const current = draft[field]
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    if (next.length > LIMITS[field]) return
    setDraft({ ...draft, [field]: next })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const issues = validateCopy(kind, draft)
  const changed = draft.subject !== base.subject || draft.title !== base.title || draft.body !== base.body

  const preview = useMemo(() => {
    const params = {
      order_number: 'EC-20261120-00058',
      grand_total: '1250.40',
      currency: 'PEN',
      customer_name: 'Ana Torres',
      store_name: storeName || 'Mi Tienda',
      store_slug: storeSlug || 'mi-tienda',
      reason: locale === 'es' ? 'Excede el presupuesto del mes' : 'Over the monthly budget',
    }
    const custom = issues.length === 0 ? resolveCopyFromParams(kind, draft, params, new Date()) : null
    return renderEmail(kind, locale, params, window.location.origin, custom)
  }, [kind, locale, draft, issues.length, storeName, storeSlug])

  if (!storeId) return null
  if (templates.isPending) return <LoadingState />

  const issueText = (issue: CopyIssue) => {
    const campo = t(`emailTemplates.field.${issue.field}` as MessageKey)
    if (issue.code === 'VARIABLE_DESCONOCIDA')
      return t('emailTemplates.issue.unknown').replace('{field}', campo).replace('{variable}', `{{${issue.variable}}}`)
    return t(issue.code === 'VACIO' ? 'emailTemplates.issue.empty' : 'emailTemplates.issue.long').replace('{field}', campo)
  }

  const onSave = () =>
    save.mutate({ kind, locale, ...draft }, { onSuccess: () => notify(t('emailTemplates.saved')) })

  const onReset = () =>
    reset.mutate(
      { kind, locale },
      {
        onSuccess: () => {
          setConfirmReset(false)
          notify(t('emailTemplates.restored'))
        },
      },
    )

  const fieldProps = (field: CopyField) => ({
    value: draft[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft({ ...draft, [field]: event.target.value }),
    onFocus: () => {
      lastField.current = field
    },
    inputRef: refs[field],
    maxLength: LIMITS[field],
    fullWidth: true,
    label: t(`emailTemplates.field.${field}` as MessageKey),
    error: issues.some((i) => i.field === field),
  })

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('emailTemplates.help')}</Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <SelectField
          size="small"
          label={t('emailTemplates.kind')}
          value={kind}
          onChange={(event) => setKind(String(event.target.value))}
          sx={{ minWidth: 240 }}
        >
          {EDITABLE_KIND_LIST.map((k) => (
            <MenuItem key={k} value={k}>
              {t(KIND_LABEL[k] as MessageKey)}
              {templates.data?.some((row) => row.kind === k && row.locale === locale) ? ` · ${t('emailTemplates.custom')}` : ''}
            </MenuItem>
          ))}
        </SelectField>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={locale}
          onChange={(_e, value: Locale | null) => value && setLocale(value)}
          aria-label={t('emailTemplates.language')}
        >
          <ToggleButton value="es">ES</ToggleButton>
          <ToggleButton value="en">EN</ToggleButton>
        </ToggleButtonGroup>
        <Chip
          size="small"
          color={saved ? 'primary' : 'default'}
          variant={saved ? 'filled' : 'outlined'}
          label={saved ? t('emailTemplates.custom') : t('emailTemplates.original')}
        />
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={1.5}>
          <Field {...fieldProps('subject')} />
          <Field {...fieldProps('title')} />
          <Field {...fieldProps('body')} multiline minRows={6} />

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {t('emailTemplates.insert')}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              {variablesOf(kind, locale).map((v) => (
                <Chip
                  key={v.key}
                  size="small"
                  variant="outlined"
                  label={`${v.label} {{${v.key}}}`}
                  onClick={() => insert(v.key)}
                  // No quitar el foco al campo: el cursor marca dónde va.
                  onMouseDown={(event) => event.preventDefault()}
                />
              ))}
            </Stack>
            <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mt: 0.75 }}>
              {t('emailTemplates.insertHelp')}
            </Typography>
          </Box>

          {issues.length > 0 && (
            <Alert severity="warning">
              {issues.map((issue) => (
                <div key={`${issue.field}-${issue.code}-${'variable' in issue ? issue.variable : ''}`}>{issueText(issue)}</div>
              ))}
            </Alert>
          )}
          {(save.isError || reset.isError || templates.isError) && <Alert severity="error">{t('emailTemplates.error')}</Alert>}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={onSave} disabled={!changed || issues.length > 0 || save.isPending}>
              {t('emailTemplates.save')}
            </Button>
            {changed && (
              <Button variant="text" onClick={() => setDraft(base)}>
                {t('emailTemplates.discard')}
              </Button>
            )}
            {saved && (
              <Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => setConfirmReset(true)}>
                {t('emailTemplates.reset')}
              </Button>
            )}
          </Stack>
        </Stack>

        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
            {t('emailTemplates.preview')}
          </Typography>
          {preview && (
            <Box sx={{ border: '1px solid var(--line)', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid var(--line)' }}>
                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                  {t('emailTemplates.field.subject')}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                  {preview.subject}
                </Typography>
              </Box>
              {/* sandbox vacío: el HTML no ejecuta nada ni navega. */}
              <Box
                component="iframe"
                title={t('emailTemplates.preview')}
                sandbox=""
                srcDoc={preview.html}
                sx={{ width: '100%', height: 460, border: 0, display: 'block', bgcolor: '#f4f6f5' }}
              />
            </Box>
          )}
          <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mt: 0.75 }}>
            {t('emailTemplates.previewHelp')}
          </Typography>
        </Box>
      </Box>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)}>
        <DialogTitle>{t('emailTemplates.resetTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('emailTemplates.resetBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmReset(false)}>{t('emailTemplates.cancel')}</Button>
          <Button variant="contained" color="error" onClick={onReset} disabled={reset.isPending}>
            {t('emailTemplates.reset')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
