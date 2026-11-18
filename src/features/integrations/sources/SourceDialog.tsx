import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useState } from 'react'
import type { MessageKey } from '@/shared/i18n/messages'
import { useI18n } from '@/shared/i18n/i18n-context'
import { SelectField } from '@/shared/ui/SelectField'
import { IntegrationsError } from '../errors'
import { useSaveSource } from './hooks'
import { sourceDraftProblem } from './rules'
import { AUTH_TYPES, isPublicHttpsUrl, type AuthType, type ConnectorSource, type SourceDraft } from './types'

function initialDraft(source: ConnectorSource | null): SourceDraft {
  return {
    name: source?.name ?? '',
    description: source?.description ?? '',
    baseUrl: source?.base_url ?? 'https://',
    authType: source?.auth_type ?? 'api_key',
    authHeader: source?.auth_header ?? 'X-ERP-Key',
    authUsername: source?.auth_username ?? '',
    oauthTokenUrl: source?.oauth_token_url ?? 'https://',
    oauthScope: source?.oauth_scope ?? '',
    timeoutSeconds: source?.timeout_seconds ?? 20,
    isActive: source?.is_active ?? true,
    secret: '',
  }
}

export function SourceDialog({
  open,
  source,
  onClose,
}: {
  open: boolean
  source: ConnectorSource | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const save = useSaveSource()
  const [draft, setDraft] = useState<SourceDraft>(() => initialDraft(source))
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const problem = sourceDraftProblem(draft, source?.has_secret ?? false)
  const auth = draft.authType

  const secretLabel: MessageKey =
    auth === 'api_key'
      ? 'integrations.sources.field.apiKey'
      : auth === 'bearer'
        ? 'integrations.sources.field.token'
        : auth === 'oauth2'
          ? 'integrations.sources.field.clientSecret'
          : 'integrations.sources.field.password'

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t(source ? 'integrations.sources.editTitle' : 'integrations.sources.newTitle')}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="connector-source-form"
          sx={{ gap: 2, pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (problem) return
            save.mutate({ id: source?.id ?? null, draft }, { onSuccess: onClose })
          }}
        >
          {save.isError && (
            <Alert severity="error">
              {t(save.error instanceof IntegrationsError ? save.error.key : 'integrations.error.generic')}
            </Alert>
          )}
          {touched && problem && <Alert severity="warning">{t(problem)}</Alert>}

          <Field
            rule="text" maxLength={80}
            label={t('integrations.sources.field.name')}
            value={draft.name}
            onChange={(event) => set('name', event.target.value.slice(0, 80))}
            placeholder="ERP central"
            required
          />
          <Field
            rule="url" help={t('integrations.sources.field.baseUrlHelp')}
            label={t('integrations.sources.field.baseUrl')}
            value={draft.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            error={touched && !isPublicHttpsUrl(draft.baseUrl)}
            required
          />
          <SelectField
            label={t('integrations.sources.field.auth')}
            value={auth}
            onChange={(event) => set('authType', event.target.value as AuthType)}
          >
            {AUTH_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {t(`integrations.sources.auth.${type}` as MessageKey)}
              </MenuItem>
            ))}
          </SelectField>

          {auth === 'api_key' && (
            <Field
              rule="code" maxLength={61} help={t('integrations.sources.field.headerHelp')}
              label={t('integrations.sources.field.header')}
              value={draft.authHeader}
              onChange={(event) => set('authHeader', event.target.value.trim())}
            />
          )}
          {(auth === 'basic' || auth === 'oauth2') && (
            <Field
              rule="text" maxLength={200} help={t(auth === 'basic' ? 'help.integrations.sources.username' : 'help.integrations.sources.clientId')}
              label={t(auth === 'basic' ? 'integrations.sources.field.username' : 'integrations.sources.field.clientId')}
              value={draft.authUsername}
              onChange={(event) => set('authUsername', event.target.value)}
              autoComplete="off"
            />
          )}
          {auth === 'oauth2' && (
            <>
              <Field
                rule="url" help={t('help.integrations.sources.tokenUrl')}
                label={t('integrations.sources.field.tokenUrl')}
                value={draft.oauthTokenUrl}
                onChange={(event) => set('oauthTokenUrl', event.target.value)}
                error={touched && !isPublicHttpsUrl(draft.oauthTokenUrl)}
              />
              <Field
                rule="text" maxLength={300} help={t('help.integrations.sources.scope')}
                label={t('integrations.sources.field.scope')}
                value={draft.oauthScope}
                onChange={(event) => set('oauthScope', event.target.value)}
              />
            </>
          )}
          {auth !== 'none' && (
            <Field
              maxLength={1024}
              type="password"
              label={t(secretLabel)}
              value={draft.secret}
              onChange={(event) => set('secret', event.target.value)}
              autoComplete="new-password"
              helperText={t(
                source?.has_secret
                  ? 'integrations.sources.field.secretKeep'
                  : 'integrations.sources.field.secretHelp',
              )}
            />
          )}

          <Field
            rule="integer" maxLength={2} help={t('help.integrations.sources.timeout')}
            type="number"
            label={t('integrations.sources.field.timeout')}
            value={draft.timeoutSeconds}
            onChange={(event) => set('timeoutSeconds', Math.min(60, Math.max(5, Number(event.target.value) || 20)))}
            slotProps={{ htmlInput: { min: 5, max: 60 } }}
          />
          <Field
            rule="longText" maxLength={500}
            label={t('integrations.sources.field.description')}
            value={draft.description}
            onChange={(event) => set('description', event.target.value.slice(0, 500))}
            multiline
            minRows={2}
          />
          <FormControlLabel
            control={<Switch checked={draft.isActive} onChange={(event) => set('isActive', event.target.checked)} />}
            label={t('integrations.sources.field.active')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" form="connector-source-form" variant="contained" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
