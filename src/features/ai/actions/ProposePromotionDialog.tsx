import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import { AiActionError, proposeAction } from './api'
import { AI_ACTIONS_QUERY_KEY } from './keys'

export interface PromotionCandidate {
  readonly productId: string
  readonly name: string
}

/**
 * Deja ARMADA una campaña de liquidación para que alguien la apruebe en
 * «Acciones de la IA». Los productos los eligió el sistema (señales de
 * exceso y sin rotación); el porcentaje y la duración los pone la persona.
 * Aprobarla crea la campaña en BORRADOR: activarla sigue siendo otra decisión.
 */
export function ProposePromotionDialog({
  open,
  storeId,
  candidates,
  rationale,
  onClose,
}: {
  open: boolean
  storeId: string
  candidates: readonly PromotionCandidate[]
  rationale: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [name, setName] = useState(() => t('aiActions.propose.defaultName'))
  const [percent, setPercent] = useState('15')
  const [days, setDays] = useState('14')

  const pct = Number(percent)
  const dias = Number.parseInt(days, 10)
  const valid =
    name.trim().length >= 3 && Number.isFinite(pct) && pct > 0 && pct <= 90 && Number.isInteger(dias) && dias >= 1 && dias <= 90

  const propose = useMutation({
    mutationFn: () =>
      proposeAction({
        kind: 'promotion.create_draft',
        storeId,
        title: name.trim(),
        rationale,
        sourceFeature: 'inventory',
        payload: {
          name: name.trim(),
          value_percent: pct,
          valid_to: new Date(Date.now() + dias * 86_400_000).toISOString(),
          product_ids: candidates.slice(0, 50).map((c) => c.productId),
        },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: AI_ACTIONS_QUERY_KEY }),
  })

  return (
    <Dialog open={open} onClose={() => !propose.isPending && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t('aiActions.propose.title')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ color: 'var(--muted)' }}>
          {t('aiActions.propose.help').replace('{count}', String(Math.min(candidates.length, 50)))}
        </Typography>
        <Typography variant="body2">{candidates.slice(0, 8).map((c) => c.name).join(' · ')}{candidates.length > 8 ? ' …' : ''}</Typography>
        <Field label={t('aiActions.propose.name')} value={name} onChange={(e) => setName(e.target.value)} rule="text" maxLength={160} />
        <Stack direction="row" spacing={1.5}>
          <Field label={t('aiActions.propose.percent')} value={percent} onChange={(e) => setPercent(e.target.value)} rule="integer" maxLength={2} />
          <Field label={t('aiActions.propose.days')} value={days} onChange={(e) => setDays(e.target.value)} rule="integer" maxLength={2} />
        </Stack>
        {propose.isSuccess && (
          <Alert
            severity="success"
            action={
              <Button color="inherit" size="small" component={Link} to="/app/ai-actions">
                {t('aiActions.propose.goInbox')}
              </Button>
            }
          >
            {t('aiActions.propose.done')}
          </Alert>
        )}
        {propose.isError && (
          <Alert severity="error">
            {propose.error instanceof AiActionError && propose.error.code === 'SIN_PERMISO'
              ? t('aiActions.error.forbidden')
              : t('aiActions.error.propose')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={propose.isPending}>
          {propose.isSuccess ? t('aiActions.close') : t('aiActions.cancel')}
        </Button>
        {!propose.isSuccess && (
          <Button variant="contained" disabled={!valid || propose.isPending || candidates.length === 0} onClick={() => propose.mutate()}>
            {t('aiActions.propose.submit')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
