import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { slugify } from '@/shared/lib/slug'
import { Field } from '@/shared/ui/Field'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CLONE_SECTIONS, type CloneSection } from './api'
import { StoreAdminError } from './errors'
import { useCloneStore } from './hooks'
import type { ManagedStore } from './types'

/**
 * «Crear a partir de esta tienda» (2026-11-24).
 *
 * Nombre y dirección de la tienda nueva, y qué se copia. Todas las secciones
 * vienen marcadas: lo habitual es abrir una sucursal igual a la que ya vende.
 * Lo que nunca se copia (moneda distinta, dominio, secretos de pago, puntos de
 * recojo, operación) se dice antes de confirmar, no después.
 */
export function CloneStoreDialog({ source, onClose }: { source: ManagedStore | null; onClose: () => void }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const clone = useCloneStore()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [sections, setSections] = useState<Set<CloneSection>>(() => new Set(CLONE_SECTIONS))

  const open = source !== null
  const valid = name.trim().length >= 1 && /^[a-z0-9][a-z0-9-]{1,61}$/.test(slug) && sections.size > 0

  function close() {
    if (clone.isPending) return
    setName('')
    setSlug('')
    setSlugTouched(false)
    setSections(new Set(CLONE_SECTIONS))
    clone.reset()
    onClose()
  }

  function toggle(section: CloneSection, checked: boolean) {
    setSections((current) => {
      const next = new Set(current)
      if (checked) next.add(section)
      else next.delete(section)
      return next
    })
  }

  function submit() {
    if (!source || !valid) return
    clone.mutate(
      { sourceStoreId: source.id, name: name.trim(), slug, sections: CLONE_SECTIONS.filter((s) => sections.has(s)) },
      {
        onSuccess: ({ store }) => {
          notify(t('storesAdmin.clone.done').replace('{store}', store.name), 'success')
          close()
        },
      },
    )
  }

  const errorKey: MessageKey | null = clone.isError
    ? clone.error instanceof StoreAdminError
      ? clone.error.key
      : 'storesAdmin.error.generic'
    : null

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{t('storesAdmin.clone.title').replace('{store}', source?.name ?? '')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ color: 'var(--muted)' }}>{t('storesAdmin.clone.help')}</Typography>
        <Field
          label={t('storesAdmin.field.name')}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (!slugTouched) setSlug(slugify(event.target.value).slice(0, 62))
          }}
          rule="text"
          maxLength={120}
          autoFocus
        />
        <Field
          label={t('storesAdmin.field.slug')}
          helperText={t('storesAdmin.clone.slugHelp').replace('{slug}', slug || '…')}
          value={slug}
          onChange={(event) => {
            setSlugTouched(true)
            setSlug(slugify(event.target.value).slice(0, 62))
          }}
          rule="slug"
          maxLength={62}
        />

        <Stack>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{t('storesAdmin.clone.sections')}</Typography>
          {CLONE_SECTIONS.map((section) => (
            <FormControlLabel
              key={section}
              control={<Checkbox checked={sections.has(section)} onChange={(event) => toggle(section, event.target.checked)} />}
              label={
                <Stack sx={{ py: 0.25 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t(`storesAdmin.clone.section.${section}` as MessageKey)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                    {t(`storesAdmin.clone.sectionHelp.${section}` as MessageKey)}
                  </Typography>
                </Stack>
              }
              sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.5 } }}
            />
          ))}
        </Stack>

        <Alert severity="info">
          {t('storesAdmin.clone.never').replace('{currency}', source?.currency ?? '')}
        </Alert>
        {errorKey && <Alert severity="error">{t(errorKey)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={clone.isPending}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={submit} disabled={!valid || clone.isPending}>
          {clone.isPending ? t('storesAdmin.clone.creating') : t('storesAdmin.clone.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
