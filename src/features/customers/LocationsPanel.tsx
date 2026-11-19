import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { Field } from '@/shared/ui/Field'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState } from '@/shared/ui/states'
import type { TenantScope } from './api'
import { CustomersError } from './errors'
import { useAddresses, useDeleteLocation, useLocations, useSaveLocation } from './hooks'
import {
  formatAddress,
  locationFormSchema,
  type BusinessAccount,
  type BusinessLocation,
  type LocationFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

const EMPTY: LocationFormValues = {
  code: '',
  name: '',
  address_id: '',
  is_default: false,
  is_active: true,
}

/**
 * Sucursales y centros de entrega de la cuenta.
 *
 * Una empresa no compra «para la empresa»: compra para su planta o para su
 * local del centro. Sin sucursal, todo el gasto de un cliente grande queda en
 * un solo montón y no hay forma de explicar un reparto.
 *
 * La dirección se ELIGE entre las del cliente, no se escribe: duplicar el
 * domicilio aquí significaría corregirlo dos veces el día que cambie. La base
 * además exige que la dirección sea de ese mismo cliente, con una FK compuesta.
 */
export function LocationsPanel({
  account,
  scope,
  canWrite,
}: {
  account: BusinessAccount
  scope: TenantScope
  canWrite: boolean
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const locations = useLocations(account.id)
  const addresses = useAddresses(account.customer_id)
  const save = useSaveLocation()
  const remove = useDeleteLocation()

  const [editing, setEditing] = useState<BusinessLocation | null>(null)
  const [values, setValues] = useState<LocationFormValues>(EMPTY)
  const [error, setError] = useState<MessageKey | null>(null)

  const addressLabel = useMemo(
    () => new Map((addresses.data ?? []).map((address) => [address.id, address.label])),
    [addresses.data],
  )

  function set<K extends keyof LocationFormValues>(key: K, value: LocationFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function cancel() {
    setEditing(null)
    setValues(EMPTY)
    setError(null)
  }

  async function submit() {
    const parsed = locationFormSchema.safeParse(values)
    if (!parsed.success) {
      setError((parsed.error.issues[0]?.message as MessageKey) ?? 'customers.error.invalid')
      return
    }
    setError(null)
    try {
      await save.mutateAsync({
        id: editing?.id ?? null,
        scope,
        accountId: account.id,
        customerId: account.customer_id,
        values: parsed.data,
      })
      notify(t('customers.toast.saved'))
      cancel()
    } catch (caught) {
      setError(caught instanceof CustomersError ? caught.key : 'customers.error.generic')
    }
  }

  const rows = locations.data ?? []

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(rows)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('customers.locations.help')}</Typography>

      {canWrite && (
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{t(error)}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Field
              size="small"
              fullWidth
              rule="code"
              maxLength={41}
              help={t('help.customers.locationCode')}
              label={t('customers.field.code')}
              value={values.code}
              onChange={(event) => set('code', event.target.value)}
              inputProps={{ spellCheck: false }}
            />
            <Field
              size="small"
              fullWidth
              rule="text"
              maxLength={160}
              label={t('customers.field.name')}
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
            <SelectField
              size="small"
              fullWidth
              label={t('customers.field.address')}
              value={values.address_id}
              onChange={(event) => set('address_id', event.target.value)}
              helperText={t('customers.field.addressHint')}
            >
              <MenuItem value="">{t('customers.field.noAddress')}</MenuItem>
              {(addresses.data ?? []).map((address) => (
                <MenuItem key={address.id} value={address.id}>
                  {address.label} · {formatAddress(address)}
                </MenuItem>
              ))}
            </SelectField>
            <FormControlLabel
              control={
                <Switch
                  checked={values.is_default}
                  onChange={(_, checked) => set('is_default', checked)}
                />
              }
              label={t('customers.field.defaultLocation')}
            />
            <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
              {editing ? t('common.save') : t('common.add')}
            </Button>
            {editing && <Button onClick={cancel}>{t('common.cancel')}</Button>}
          </Stack>
        </Stack>
      )}

      {!locations.isPending && rows.length === 0 && (
        <EmptyState title={t('customers.locations.empty')} />
      )}

      {rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('customers.field.code')}</TableCell>
              <TableCell>{t('customers.field.name')}</TableCell>
              <TableCell>{t('customers.field.address')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pager.rows.map((location) => (
              <TableRow key={location.id} hover>
                <TableCell sx={{ fontWeight: 700 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <span>{location.code}</span>
                    {location.is_default && (
                      <StatusChip tone="success" label={t('customers.field.byDefault')} />
                    )}
                  </Stack>
                </TableCell>
                <TableCell>{location.name}</TableCell>
                <TableCell>
                  {location.address_id ? (addressLabel.get(location.address_id) ?? '—') : '—'}
                </TableCell>
                <TableCell align="right">
                  <RowActions
                    actions={[
                      {
                        id: 'edit',
                        icon: <EditRoundedIcon fontSize="small" />,
                        label: `${t('common.edit')}: ${location.name}`,
                        tone: 'neutral',
                        disabled: !canWrite,
                        onClick: () => {
                          setEditing(location)
                          setValues({
                            code: location.code,
                            name: location.name,
                            address_id: location.address_id ?? '',
                            is_default: location.is_default,
                            is_active: location.is_active,
                          })
                          setError(null)
                        },
                      },
                      {
                        id: 'delete',
                        icon: <DeleteRoundedIcon fontSize="small" />,
                        label: `${t('common.delete')}: ${location.name}`,
                        tone: 'danger',
                        disabled: !canWrite || remove.isPending,
                        onClick: () => {
                          void remove
                            .mutateAsync(location.id)
                            .then(() => notify(t('customers.toast.deleted')))
                        },
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {/* El paginador solo aparece cuando hay algo que paginar: un
          "0-0 de 0" bajo un estado vacio es ruido que contradice al
          propio estado vacio. */}
      {pager.total > 0 && (
        <TablePager
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          onPageChange={pager.setPage}
        />
      )}
    </Stack>
  )
}
