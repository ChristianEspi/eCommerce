import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useBusinessAccounts, useCustomerOptions } from '@/features/customers/hooks'
import { useChannels, useSegments } from '@/features/pricing/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { RowActions } from '@/shared/ui/RowActions'
import { SelectField } from '@/shared/ui/SelectField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import type { PromotionScopeIds } from './api'
import { PromotionsError } from './errors'
import { useAddAudience, useAudiences, useRemoveAudience } from './hooks'
import { TARGET_AUDIENCE_KINDS, type PromotionAudience, type TargetAudienceKind } from './types'

/**
 * «Dirigida a»: a quién le vale la campaña (2026-11-18).
 *
 * La base ya lo soportaba (`promotion_audiences`) y el motor de promociones, el
 * checkout y «Mis cupones» lo respetan, pero no había pantalla: toda campaña
 * creada aquí valía para toda la tienda sin que nadie lo hubiera decidido.
 *
 * La regla, dicha en la propia sección para que no se descubra vendiendo:
 * sin destinatarios vale para todo el mundo; con uno o más, SOLO para quien
 * encaje en alguno (canal, segmento, cliente o cuenta de empresa).
 */
export function PromotionAudiencePanel({
  promotionId,
  scope,
  canWrite = true,
}: {
  promotionId: string
  scope: PromotionScopeIds | null
  canWrite?: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const audiences = useAudiences(promotionId)
  const channels = useChannels(scope?.storeId ?? null)
  const segments = useSegments()
  const accounts = useBusinessAccounts()
  const [customerTerm, setCustomerTerm] = useState('')
  const customers = useCustomerOptions({ term: customerTerm })
  const add = useAddAudience(scope)
  const remove = useRemoveAudience()

  const [kind, setKind] = useState<TargetAudienceKind>('channel')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<MessageKey | null>(null)

  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of channels.data ?? []) m.set(c.id, `${c.code} · ${c.name}`)
    for (const s of segments.data ?? []) m.set(s.id, s.name)
    for (const a of accounts.data ?? []) m.set(a.id, `${a.code} · ${a.name}`)
    return m
  }, [channels.data, segments.data, accounts.data])

  const opcionesCliente = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )

  const filas = audiences.data ?? []
  // «Para todos» explícito ya es toda la tienda: no hay nada más que añadir.
  const paraTodos = filas.some((a) => a.audience_kind === 'all')

  function destino(a: PromotionAudience): string {
    switch (a.audience_kind) {
      case 'all':
        return t('promotions.audience.everyone')
      case 'customer':
        return a.customer_name ?? names.get(a.customer_id ?? '') ?? '—'
      case 'business_account':
        return a.account_name ?? names.get(a.business_account_id ?? '') ?? '—'
      default:
        return names.get(a.channel_id ?? a.segment_id ?? '') ?? '—'
    }
  }

  function yaEsta(targetId: string): boolean {
    return filas.some(
      (a) =>
        a.audience_kind === kind &&
        (a.channel_id ?? a.segment_id ?? a.customer_id ?? a.business_account_id) === targetId,
    )
  }

  async function submit(targetId: string) {
    if (!targetId) {
      setError('promotions.audience.error.target')
      return
    }
    if (yaEsta(targetId)) {
      setError('promotions.audience.error.duplicate')
      return
    }
    setError(null)
    try {
      await add.mutateAsync({ promotionId, kind, targetId })
      notify(t('promotions.audience.added'), 'success')
      setTarget('')
      setCustomerTerm('')
    } catch (caught) {
      setError(caught instanceof PromotionsError ? caught.key : 'promotions.audience.error.generic')
    }
  }

  return (
    <Stack spacing={1.5} data-promotion-audiences>
      <Divider textAlign="left">
        <Typography variant="overline">{t('promotions.section.audience')}</Typography>
      </Divider>
      <Alert severity={filas.length === 0 ? 'info' : 'success'} sx={{ py: 0 }}>
        {filas.length === 0 || paraTodos ? t('promotions.audience.everyoneHelp') : t('promotions.audience.restrictedHelp')}
      </Alert>

      {canWrite && !paraTodos && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
            <SelectField
              size="small"
              label={t('promotions.audience.kind')}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as TargetAudienceKind)
                setTarget('')
                setError(null)
              }}
              sx={{ minWidth: 190 }}
            >
              {TARGET_AUDIENCE_KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`promotions.audience.kind.${k}` as MessageKey)}
                </MenuItem>
              ))}
            </SelectField>

            {kind === 'channel' && (
              <SelectField size="small" fullWidth label={t('promotions.audience.kind.channel')} value={target} onChange={(e) => setTarget(e.target.value)}>
                {(channels.data ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.code} · {c.name}</MenuItem>
                ))}
              </SelectField>
            )}
            {kind === 'segment' && (
              <SelectField size="small" fullWidth label={t('promotions.audience.kind.segment')} value={target} onChange={(e) => setTarget(e.target.value)}>
                {(segments.data ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </SelectField>
            )}
            {kind === 'business_account' && (
              <SelectField size="small" fullWidth label={t('promotions.audience.kind.business_account')} value={target} onChange={(e) => setTarget(e.target.value)}>
                {(accounts.data ?? []).filter((a) => a.is_active).map((a) => (
                  <MenuItem key={a.id} value={a.id}>{a.code} · {a.name}</MenuItem>
                ))}
              </SelectField>
            )}
            {kind === 'customer' && (
              <Stack sx={{ flex: 1 }}>
                <EntityPicker
                  label={t('promotions.audience.kind.customer')}
                  placeholder={t('promotions.audience.searchCustomer')}
                  term={customerTerm}
                  onTermChange={setCustomerTerm}
                  options={opcionesCliente}
                  loading={customers.isFetching}
                  alreadyIn={new Set(filas.map((a) => a.customer_id ?? ''))}
                  clearOnPick
                  onPick={(option) => void submit(option.id)}
                />
              </Stack>
            )}

            {kind !== 'customer' && (
              <Button variant="contained" onClick={() => void submit(target)} disabled={add.isPending}>
                {t('promotions.audience.add')}
              </Button>
            )}
          </Stack>
        </Stack>
      )}

      {filas.length > 0 && (
        <Table size="small" aria-label={t('promotions.section.audience')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('promotions.audience.kind')}</TableCell>
              <TableCell>{t('promotions.audience.target')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filas.map((a) => {
              const nombre = destino(a)
              return (
                <TableRow key={a.id} hover>
                  <TableCell>
                    <StatusChip label={t(`promotions.audience.kind.${a.audience_kind}` as MessageKey)} />
                  </TableCell>
                  <TableCell>{nombre}</TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: 'del',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: `${t('common.delete')}: ${nombre}`,
                          tone: 'danger',
                          disabled: !canWrite || remove.isPending,
                          onClick: () => {
                            void remove.mutateAsync(a.id).then(() => notify(t('promotions.audience.removed'), 'success'))
                          },
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Stack>
  )
}
