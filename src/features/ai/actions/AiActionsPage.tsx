import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { Field } from '@/shared/ui/Field'
import { FilterBar } from '@/shared/ui/FilterBar'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchField } from '@/shared/ui/SearchField'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { StatusChip, type StatusTone } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import {
  AiActionError,
  decideAction,
  listProposals,
  matchesProposal,
  type AiActionProposal,
  type AiActionStatus,
} from './api'

import { AI_ACTIONS_QUERY_KEY } from './keys'

const TONE: Record<AiActionStatus, StatusTone> = {
  pending: 'warning',
  executed: 'success',
  rejected: 'default',
  failed: 'error',
  expired: 'default',
}

const TABS: readonly { id: string; statuses: readonly AiActionStatus[]; label: MessageKey }[] = [
  { id: 'pendientes', statuses: ['pending'], label: 'aiActions.tab.pending' },
  { id: 'ejecutadas', statuses: ['executed'], label: 'aiActions.tab.executed' },
  { id: 'otras', statuses: ['rejected', 'failed', 'expired'], label: 'aiActions.tab.other' },
]

/** Lo que hará la acción, en palabras. Solo con lo que ya validó la base. */
function Summary({ proposal }: { proposal: AiActionProposal }) {
  const { t } = useI18n()
  const p = proposal.payload
  if (proposal.kind === 'promotion.create_draft') {
    const productos = Array.isArray(p.product_ids) ? p.product_ids.length : 0
    return (
      <Typography variant="body2">
        {t('aiActions.summary.promotion')
          .replace('{name}', String(p.name ?? ''))
          .replace('{percent}', String(p.value_percent ?? ''))
          .replace('{count}', String(productos))}
      </Typography>
    )
  }
  return (
    <Typography variant="body2">
      {p.decision === 'reject'
        ? t('aiActions.summary.reviewReject').replace('{reason}', String(p.reason ?? ''))
        : t('aiActions.summary.reviewPublish')}
    </Typography>
  )
}

/**
 * «Acciones de la IA»: la bandeja donde se aprueba lo que la IA dejó armado.
 *
 * Aprobar EJECUTA el comando de siempre con tu sesión (mismas reglas que a
 * mano) y deja el rastro de quién propuso y quién aprobó. La RLS decide qué
 * propuestas ve cada rol: campañas, dueño y administración; reseñas, también
 * catálogo.
 */
export function AiActionsPage() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeCompanyId } = useTenant()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [deciding, setDeciding] = useState<{ proposal: AiActionProposal; decision: 'approve' | 'reject' } | null>(null)
  const [note, setNote] = useState('')

  const query = useQuery({
    queryKey: [...AI_ACTIONS_QUERY_KEY, activeCompanyId ?? null],
    queryFn: listProposals,
    enabled: Boolean(activeCompanyId),
  })

  const decide = useMutation({
    mutationFn: decideAction,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: AI_ACTIONS_QUERY_KEY })
      setDeciding(null)
      setNote('')
      notify(t(`aiActions.result.${result.status}` as MessageKey))
    },
  })

  const rows = useMemo(() => (query.data ?? []).filter((p) => matchesProposal(p, search)), [query.data, search])

  const table = (statuses: readonly AiActionStatus[]) => {
    const visible = rows.filter((p) => statuses.includes(p.status))
    if (query.isPending) return <TableSkeleton columns={4} />
    if (query.isError) return <ErrorState title={t('aiActions.error.load')} onRetry={() => void query.refetch()} />
    if (visible.length === 0) {
      return (
        <EmptyState
          title={t('aiActions.empty')}
          description={t('aiActions.emptyBody')}
          icon={<AutoAwesomeRoundedIcon fontSize="small" />}
        />
      )
    }
    return (
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('aiActions.col.action')}</TableCell>
              <TableCell>{t('aiActions.col.what')}</TableCell>
              <TableCell>{t('aiActions.col.status')}</TableCell>
              <TableCell align="right">{t('aiActions.col.decide')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((p) => (
              <TableRow key={p.id} sx={{ verticalAlign: 'top' }}>
                <TableCell sx={{ minWidth: 200 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {p.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                    {t(`aiActions.kind.${p.kind}` as MessageKey)} · {new Date(p.created_at).toLocaleDateString()}
                  </Typography>
                  {p.rationale && (
                    <Typography variant="body2" sx={{ color: 'var(--muted)', mt: 0.5 }}>
                      {p.rationale}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ minWidth: 220 }}>
                  <Summary proposal={p} />
                  {p.error_code && (
                    <Typography variant="caption" sx={{ color: 'var(--danger, inherit)' }}>
                      {t('aiActions.failedCode').replace('{code}', p.error_code)}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <StatusChip tone={TONE[p.status]} label={t(`aiActions.status.${p.status}` as MessageKey)} />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {p.status === 'pending' && (
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button size="small" onClick={() => setDeciding({ proposal: p, decision: 'reject' })}>
                        {t('aiActions.reject')}
                      </Button>
                      <Button size="small" variant="contained" onClick={() => setDeciding({ proposal: p, decision: 'approve' })}>
                        {t('aiActions.approve')}
                      </Button>
                    </Stack>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    )
  }

  const pendientes = (query.data ?? []).filter((p) => p.status === 'pending').length

  return (
    <>
      <PageHeader
        icon={<AutoAwesomeRoundedIcon />}
        title={t('aiActions.title')}
        subtitle={t('aiActions.subtitle').replace('{n}', String(pendientes))}
      />
      <Typography sx={{ color: 'var(--muted)', mb: 2 }}>{t('aiActions.help')}</Typography>
      <Card sx={{ p: 2, mb: 2 }}>
        <FilterBar disableGutter>
          <SearchField value={search} onChange={setSearch} placeholder={t('aiActions.search')} />
        </FilterBar>
      </Card>
      <Card>
        <SectionTabs
          ariaLabel={t('aiActions.title')}
          items={TABS.map((tab) => ({ id: tab.id, label: t(tab.label), content: table(tab.statuses) }))}
        />
      </Card>

      <Dialog open={deciding !== null} onClose={() => !decide.isPending && setDeciding(null)} fullWidth maxWidth="sm">
        {deciding && (
          <>
            <DialogTitle>
              {deciding.decision === 'approve' ? t('aiActions.confirm.approveTitle') : t('aiActions.confirm.rejectTitle')}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography sx={{ fontWeight: 700 }}>{deciding.proposal.title}</Typography>
              <Summary proposal={deciding.proposal} />
              <Alert severity={deciding.decision === 'approve' ? 'info' : 'warning'}>
                {deciding.decision === 'approve'
                  ? t(`aiActions.confirm.approve.${deciding.proposal.kind}` as MessageKey)
                  : t('aiActions.confirm.reject')}
              </Alert>
              <Field
                label={t('aiActions.note')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rule="longText"
                maxLength={500}
                multiline
                minRows={2}
              />
              {decide.isError && (
                <Alert severity="error">
                  {decide.error instanceof AiActionError && decide.error.code === 'PROPUESTA_YA_DECIDIDA'
                    ? t('aiActions.error.alreadyDecided')
                    : t('aiActions.error.decide')}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeciding(null)} disabled={decide.isPending}>
                {t('aiActions.cancel')}
              </Button>
              <Button
                variant="contained"
                color={deciding.decision === 'approve' ? 'primary' : 'inherit'}
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ id: deciding.proposal.id, decision: deciding.decision, note: note.trim() || null })
                }
              >
                {deciding.decision === 'approve' ? t('aiActions.approve') : t('aiActions.reject')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}
