import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useChannels, useSegments } from '@/features/pricing/hooks'
import { useTerritories } from '@/features/sales/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { RowActions } from '@/shared/ui/RowActions'
import { SelectField } from '@/shared/ui/SelectField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import type { TradeScope } from './api'
import { TradeError } from './errors'
import {
  useAddAssortmentAssignment,
  useAssortmentAssignments,
  useDeleteAssortmentAssignment,
  useToggleAssortmentAssignment,
} from './hooks'
import { ASSORTMENT_SCOPES, SCOPE_PRECEDENCE, type Assortment, type AssortmentScope } from './types'

/**
 * A quién se le aplica el surtido (2026-11-16).
 *
 * La base ya lo soportaba (`assortment_assignments`) pero no había pantalla:
 * un surtido creado aquí no se aplicaba a nadie hasta que alguien lo asignaba
 * por SQL. Mismo patrón que las asignaciones de listas de precios.
 *
 * Se enseña el RANGO de cada ámbito porque la precedencia
 * (cliente > segmento > territorio > canal > tienda) es la única regla que no
 * se configura: si a un cliente le aplican dos surtidos, gana el de ámbito más
 * específico, y la pantalla tiene que decirlo antes de que se descubra vendiendo.
 */
export function AssortmentAssignmentsPanel({
  assortment,
  scope: tradeScope,
  canWrite,
}: {
  assortment: Assortment
  scope: TradeScope | null
  canWrite: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const assignments = useAssortmentAssignments(assortment.id)
  const channels = useChannels(assortment.store_id)
  const segments = useSegments()
  const territories = useTerritories()
  const [customerTerm, setCustomerTerm] = useState('')
  const customers = useCustomerOptions({ term: customerTerm })
  const add = useAddAssortmentAssignment()
  const remove = useDeleteAssortmentAssignment()
  const toggle = useToggleAssortmentAssignment()

  const [scope, setScope] = useState<AssortmentScope>('customer')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<MessageKey | null>(null)

  // Nombres de los destinatarios para la tabla (los clientes vienen en la propia fila).
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of channels.data ?? []) m.set(c.id, `${c.code} · ${c.name}`)
    for (const s of segments.data ?? []) m.set(s.id, s.name)
    for (const tr of territories.data ?? []) m.set(tr.id, `${tr.code} · ${tr.name}`)
    return m
  }, [channels.data, segments.data, territories.data])

  const opcionesCliente = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )

  async function submit(targetId: string) {
    if (!tradeScope) return
    if (scope !== 'store' && !targetId) {
      setError('trade.assignments.error.target')
      return
    }
    setError(null)
    try {
      await add.mutateAsync({ scope: tradeScope, assortmentId: assortment.id, assignmentScope: scope, targetId })
      notify(t('trade.assignments.saved'), 'success')
      setTarget('')
      setCustomerTerm('')
    } catch (caught) {
      setError(caught instanceof TradeError ? caught.key : 'trade.error.generic')
    }
  }

  const filas = [...(assignments.data ?? [])].sort((a, b) => SCOPE_PRECEDENCE[a.scope] - SCOPE_PRECEDENCE[b.scope])

  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontWeight: 800 }}>{t('trade.assignments.title')}</Typography>
      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{t('trade.assignments.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
            <SelectField
              size="small"
              label={t('trade.assignments.scope')}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as AssortmentScope)
                setTarget('')
                setError(null)
              }}
              sx={{ minWidth: 200 }}
            >
              {ASSORTMENT_SCOPES.map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`trade.assignments.scope.${s}` as MessageKey)} ({SCOPE_PRECEDENCE[s]})
                </MenuItem>
              ))}
            </SelectField>

            {scope === 'channel' && (
              <SelectField size="small" fullWidth label={t('trade.assignments.target.channel')} value={target} onChange={(e) => setTarget(e.target.value)}>
                {(channels.data ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.code} · {c.name}</MenuItem>
                ))}
              </SelectField>
            )}
            {scope === 'segment' && (
              <SelectField size="small" fullWidth label={t('trade.assignments.target.segment')} value={target} onChange={(e) => setTarget(e.target.value)}>
                {(segments.data ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </SelectField>
            )}
            {scope === 'territory' && (
              <SelectField size="small" fullWidth label={t('trade.assignments.target.territory')} value={target} onChange={(e) => setTarget(e.target.value)}>
                {(territories.data ?? []).map((tr) => (
                  <MenuItem key={tr.id} value={tr.id}>{tr.code} · {tr.name}</MenuItem>
                ))}
              </SelectField>
            )}
            {scope === 'customer' && (
              <Stack sx={{ flex: 1 }}>
                <EntityPicker
                  label={t('trade.assignments.target.customer')}
                  placeholder={t('trade.assignments.searchCustomer')}
                  term={customerTerm}
                  onTermChange={setCustomerTerm}
                  options={opcionesCliente}
                  loading={customers.isFetching}
                  alreadyIn={new Set((assignments.data ?? []).map((a) => a.customer_id ?? ''))}
                  clearOnPick
                  onPick={(option) => void submit(option.id)}
                />
              </Stack>
            )}

            {scope !== 'customer' && (
              <Button variant="contained" onClick={() => void submit(target)} disabled={add.isPending}>
                {t('common.add')}
              </Button>
            )}
          </Stack>
        </Stack>
      )}

      {!assignments.isPending && filas.length === 0 && (
        <EmptyState title={t('trade.assignments.empty')} description={t('trade.assignments.emptyBody')} />
      )}

      {filas.length > 0 && (
        <Table size="small" aria-label={t('trade.assignments.title')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('trade.assignments.scope')}</TableCell>
              <TableCell>{t('trade.assignments.target')}</TableCell>
              <TableCell align="right">{t('trade.assignments.rank')}</TableCell>
              <TableCell>{t('trade.assignments.active')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filas.map((a) => {
              const destino =
                a.scope === 'store'
                  ? t('trade.assignments.storeAll')
                  : a.scope === 'customer'
                    ? (a.customer_name ?? a.customer_id ?? '—')
                    : (names.get(a.channel_id ?? a.segment_id ?? a.territory_id ?? '') ?? '—')
              return (
                <TableRow key={a.id} hover>
                  <TableCell>
                    <StatusChip label={t(`trade.assignments.scope.${a.scope}` as MessageKey)} />
                  </TableCell>
                  <TableCell>{destino}</TableCell>
                  <TableCell align="right">{SCOPE_PRECEDENCE[a.scope]}</TableCell>
                  <TableCell>
                    <Tooltip title={a.is_active ? t('trade.assignments.deactivate') : t('trade.assignments.activate')}>
                      <Switch
                        size="small"
                        checked={a.is_active}
                        disabled={!canWrite || toggle.isPending}
                        onChange={(e) => void toggle.mutateAsync({ id: a.id, isActive: e.target.checked })}
                        inputProps={{ 'aria-label': `${t('trade.assignments.active')}: ${destino}` }}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: 'del',
                          icon: <DeleteRoundedIcon fontSize="small" />,
                          label: `${t('common.delete')}: ${destino}`,
                          tone: 'danger',
                          disabled: !canWrite || remove.isPending,
                          onClick: () => {
                            void remove.mutateAsync(a.id).then(() => notify(t('trade.assignments.deleted'), 'success'))
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
