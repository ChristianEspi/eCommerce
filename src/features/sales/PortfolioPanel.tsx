import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import {
  Alert,
  Stack,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import type { SalesScope } from './api'
import { SalesError } from './errors'
import { useAssignCustomer, usePortfolio, useRemoveFromPortfolio } from './hooks'

/**
 * La cartera de un vendedor: a qué clientes atiende.
 *
 * ## El titular, y por qué se avisa antes
 *
 * Un cliente puede ser atendido por varios, pero **uno solo responde por él**:
 * la base lo impone con un índice único parcial, y sin esa regla la comisión de
 * una misma venta se pagaría dos veces. Aquí el interruptor viene encendido
 * —lo normal es que quien atiende sea el titular— y si el cliente ya tiene uno,
 * la base rechaza y el mensaje lo dice: hay que quitárselo al otro primero.
 *
 * ## Se reutiliza el buscador de clientes de `features/customers`
 *
 * No se escribe otro. Ese hook ya resuelve el término, el tipo y la paginación
 * contra la misma tabla; duplicarlo aquí sería un segundo sitio donde arreglar
 * el día que el buscador cambie.
 */
export function PortfolioPanel({
  repId,
  scope,
  canWrite,
}: {
  repId: string
  scope: SalesScope | null
  canWrite: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const [search, setSearch] = useState('')
  const [asPrimary, setAsPrimary] = useState(true)
  const [error, setError] = useState<MessageKey | null>(null)

  const portfolio = usePortfolio(repId)
  const assign = useAssignCustomer()
  const remove = useRemoveFromPortfolio()

  const options = useCustomerOptions({ term: search, enabled: true })

  const opciones = useMemo<PickerOption[]>(
    () => (options.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [options.data],
  )

  const rows = portfolio.data ?? []
  const yaEstan = new Set(rows.map((row) => row.customer_id))

  async function añadir(customerId: string) {
    if (!scope) return
    setError(null)
    try {
      await assign.mutateAsync({ scope, repId, customerId, isPrimary: asPrimary })
      notify(t('sales.portfolio.added'), 'success')
      setSearch('')
    } catch (err) {
      setError(err instanceof SalesError ? err.key : 'sales.error.generic')
    }
  }

  async function quitar(id: string) {
    setError(null)
    try {
      await remove.mutateAsync(id)
      notify(t('sales.portfolio.removed'), 'success')
    } catch (err) {
      setError(err instanceof SalesError ? err.key : 'sales.error.generic')
    }
  }

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('sales.portfolio.help')}</Typography>

      {error && <Alert severity="error">{t(error)}</Alert>}

      {portfolio.isPending && <TableSkeleton columns={4} />}
      {portfolio.isError && (
        <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} />
      )}

      {!portfolio.isPending && !portfolio.isError && rows.length === 0 && (
        <EmptyState
          title={t('sales.portfolio.empty')}
          description={t('sales.portfolio.emptyBody')}
          icon={<GroupsRoundedIcon fontSize="small" />}
        />
      )}

      {rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('sales.field.customerCode')}</TableCell>
              <TableCell>{t('sales.field.customerName')}</TableCell>
              <TableCell>{t('sales.field.holder')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>{row.customer_code ?? '—'}</TableCell>
                <TableCell>{row.customer_name ?? '—'}</TableCell>
                <TableCell>
                  <StatusChip
                    tone={row.is_primary ? 'success' : 'default'}
                    label={row.is_primary ? t('sales.holder.yes') : t('sales.holder.support')}
                  />
                </TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'del',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('sales.portfolio.remove')}: ${row.customer_name ?? ''}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => void quitar(row.id),
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canWrite && (
        <Stack spacing={1.5}>
          <EntityPicker
          minChars={0}
            label={t('sales.field.customerName')}
            placeholder={t('sales.portfolio.search')}
            term={search}
            onTermChange={setSearch}
            options={opciones}
            loading={options.isFetching}
            alreadyIn={yaEstan}
            clearOnPick
            onPick={(option) => void añadir(option.id)}
          />

          <FormControlLabel
            control={
              <Switch checked={asPrimary} onChange={(event) => setAsPrimary(event.target.checked)} />
            }
            label={t('sales.portfolio.asPrimary')}
          />
        </Stack>
      )}
    </Stack>
  )
}
